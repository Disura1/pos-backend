const pool = require('../config/db');

// Generate a branch-prefixed receipt number
// e.g. "TGM-000007" for Main Branch sale #7
const generateReceiptNumber = async (client, saleId, branchId) => {
  // Get all active branches to detect prefix collisions
  const branchRes = await client.query(
    'SELECT id, branch_name FROM branches WHERE is_active = true ORDER BY id'
  );
  const branches = branchRes.rows;

  // Build prefix for each branch — use first letters of words, drop common words
  const getWords = (name) =>
    name.toUpperCase()
      .replace(/\b(BRANCH|STORE|SHOP)\b/g, '')
      .trim()
      .split(/[\s\-]+/)
      .filter(Boolean);

  // First pass: single-letter prefix for each branch
  const prefixMap = {};
  for (const b of branches) {
    const words = getWords(b.branch_name);
    prefixMap[b.id] = words.map(w => w[0]).join('').slice(0, 3) || 'X';
  }

  // Detect collisions and extend with extra letters until unique
  let changed = true;
  while (changed) {
    changed = false;
    const seen = {};
    for (const b of branches) {
      const p = prefixMap[b.id];
      if (!seen[p]) seen[p] = [];
      seen[p].push(b.id);
    }
    for (const [p, ids] of Object.entries(seen)) {
      if (ids.length > 1) {
        // Extend each conflicting branch's prefix by one more char
        for (const id of ids) {
          const words = getWords(branches.find(b => b.id === id).branch_name);
          const combined = words.map(w => w).join('');
          const current = prefixMap[id];
          if (combined.length > current.length) {
            prefixMap[id] = combined.slice(0, current.length + 1);
            changed = true;
          }
        }
      }
    }
  }

  const branchPrefix = prefixMap[branchId] || 'TG';
  const paddedId = String(saleId).padStart(6, '0');
  return `TG${branchPrefix}-${paddedId}`;
};

exports.checkout = async (req, res) => {
  const { cart, subtotal, discountId, discountAmount, total, paymentMethod, amountTendered, branchId, note } = req.body;

  // Input validation
  if (!Array.isArray(cart) || cart.length === 0)
    return res.status(400).json({ error: 'Cart is empty' });
  if (!branchId)
    return res.status(400).json({ error: 'Branch ID is required' });
  for (const item of cart) {
    if (!item.sku || typeof item.sku !== 'string')
      return res.status(400).json({ error: 'Invalid cart item: missing SKU' });
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999)
      return res.status(400).json({ error: `Invalid quantity for ${item.sku}` });
  }

  const cashierId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const saleRes = await client.query(
      `INSERT INTO sales
         (branch_id, cashier_id, subtotal, discount_id, discount_amount,
          total_amount, payment_method, amount_tendered, change_amount, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        branchId, cashierId,
        subtotal || total,
        discountId || null,
        discountAmount || 0,
        total,
        paymentMethod || 'cash',
        amountTendered || total,
        Math.max(0, (amountTendered || total) - total),
        note || null,
      ]
    );
    const saleId = saleRes.rows[0].id;

    // Generate standard receipt number e.g. TGM-000007
    // Use stored prefix from branches table — no need to query all branches
    const prefixRes = await client.query(
      'SELECT COALESCE(receipt_prefix, \'TG\') AS prefix FROM branches WHERE id = $1',
      [branchId]
    );
    const prefix = prefixRes.rows[0]?.prefix || 'TG';
    const receiptNumber = `${prefix}-${String(saleId).padStart(6, '0')}`;
    await client.query(
      'UPDATE sales SET receipt_number = $1 WHERE id = $2',
      [receiptNumber, saleId]
    );

    for (const item of cart) {
      const varRes = await client.query(
        'SELECT id FROM product_variants WHERE sku = $1', [item.sku]
      );
      if (!varRes.rows.length) throw new Error(`SKU not found: ${item.sku}`);
      const variantId = varRes.rows[0].id;
      const qty = item.quantity;
      // Always use server-side price — never trust client-sent price
      const priceRes = await client.query(
        `SELECT COALESCE(pv.variant_price, p.base_price) AS price
         FROM product_variants pv
         JOIN products p ON pv.product_id = p.id
         WHERE pv.id = $1`,
        [variantId]
      );
      const unitPrice = parseFloat(priceRes.rows[0]?.price || 0);

      await client.query(
        `INSERT INTO sale_items (sale_id, variant_id, quantity, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [saleId, variantId, qty, unitPrice, unitPrice * qty]
      );

      await client.query(
        `UPDATE inventory SET stock_qty = stock_qty - $1
         WHERE variant_id=$2 AND branch_id=$3`,
        [qty, variantId, branchId]
      );

      await client.query(
        `INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, reference_id, created_by)
         VALUES ($1,$2,'sale',$3,$4,$5)`,
        [variantId, branchId, -qty, saleId, cashierId]
      );
    }

    await client.query('COMMIT');

    const saleDetails = await pool.query(
      `SELECT s.*, b.branch_name, b.address AS branch_address, b.phone AS branch_phone,
              COALESCE(u.full_name, u.username) AS cashier_name
       FROM sales s
       JOIN branches b ON s.branch_id = b.id
       LEFT JOIN users u ON s.cashier_id = u.id
       WHERE s.id = $1`,
      [saleId]
    );

    res.json({ success: true, saleId, receiptNumber, sale: saleDetails.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed: ' + err.message });
  } finally {
    client.release();
  }
};

exports.getHistory = async (req, res) => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  const limit    = parseInt(req.query.limit) || 20;
  const date     = req.query.date || null;
  try {
    const result = await pool.query(`
      SELECT s.id, s.total_amount,
             COALESCE(s.subtotal, s.total_amount)    AS subtotal,
             COALESCE(s.discount_amount, 0)           AS discount_amount,
             COALESCE(s.payment_method, 'cash')       AS payment_method,
             s.sale_date, b.branch_name,
             COALESCE(u.full_name, u.username, 'N/A') AS cashier_name,
             COUNT(si.id) AS item_count
      FROM sales s
      JOIN branches b ON s.branch_id = b.id
      LEFT JOIN users u ON s.cashier_id = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ($1::int IS NULL OR s.branch_id = $1)
        AND ($2::date IS NULL OR s.sale_date::date = $2::date)
      GROUP BY s.id, b.branch_name, u.full_name, u.username
      ORDER BY s.sale_date DESC
      LIMIT $3
    `, [branchId || null, date || null, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('getHistory error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getSaleDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const sale = await pool.query(
      `SELECT s.*,
              b.branch_name, b.address AS branch_address, b.phone AS branch_phone,
              COALESCE(u.full_name, u.username) AS cashier_name,
              d.name AS discount_name
       FROM sales s
       JOIN branches b  ON s.branch_id   = b.id
       LEFT JOIN users u     ON s.cashier_id  = u.id
       LEFT JOIN discounts d ON s.discount_id = d.id
       WHERE s.id = $1`, [id]
    );
    const items = await pool.query(
      `SELECT si.*,
              pv.sku, pv.size, pv.color,
              p.name AS product_name
       FROM sale_items si
       JOIN product_variants pv ON si.variant_id = pv.id
       JOIN products p          ON pv.product_id = p.id
       WHERE si.sale_id = $1`, [id]
    );
    if (!sale.rows.length) return res.status(404).json({ error: 'Sale not found' });
    res.json({ ...sale.rows[0], items: items.rows });
  } catch (err) {
    console.error('getSaleDetail error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
