const pool = require('../config/db');

exports.checkout = async (req, res) => {
  const { cart, subtotal, discountId, discountAmount, total, paymentMethod, amountTendered, branchId, note } = req.body;
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

    for (const item of cart) {
      const varRes = await client.query(
        'SELECT id FROM product_variants WHERE sku = $1', [item.sku]
      );
      if (!varRes.rows.length) throw new Error(`SKU not found: ${item.sku}`);
      const variantId = varRes.rows[0].id;
      const qty = item.quantity || 1;
      const unitPrice = parseFloat(item.variant_price || item.base_price);

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
      `SELECT s.*, b.branch_name,
              COALESCE(u.full_name, u.username) AS cashier_name
       FROM sales s
       JOIN branches b ON s.branch_id = b.id
       LEFT JOIN users u ON s.cashier_id = u.id
       WHERE s.id = $1`,
      [saleId]
    );

    res.json({ success: true, saleId, sale: saleDetails.rows[0] });
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
              b.branch_name,
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
