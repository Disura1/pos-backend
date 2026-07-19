const pool = require("../config/db");

exports.checkout = async (req, res) => {
  const {
    cart,
    discountId,
    paymentMethod,
    amountTendered,
    branchId,
    note,
  } = req.body;

  // Input validation
  if (!Array.isArray(cart) || cart.length === 0)
    return res.status(400).json({ error: "Cart is empty" });
  if (!branchId)
    return res.status(400).json({ error: "Branch ID is required" });
  // Cashier can only checkout for their own branch — ignore client-sent branchId
  const safeBranchId = req.user.role === 'Cashier'
    ? req.user.branchId
    : parseInt(branchId);
  if (!safeBranchId) {
    return res.status(400).json({ error: "Branch ID is required" });
  }
  for (const item of cart) {
    if (!item.sku || typeof item.sku !== "string")
      return res.status(400).json({ error: "Invalid cart item: missing SKU" });
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 9999
    )
      return res
        .status(400)
        .json({ error: `Invalid quantity for ${item.sku}` });
  }

  const validPaymentMethods = ['cash', 'card'];
  if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const cashierId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ---- 1. Look up each item's real price/variant FIRST, before creating the sale ----
    const priced = [];
    for (const item of cart) {
      const varRes = await client.query(
        `SELECT pv.id AS variant_id,
                COALESCE(pv.variant_price, p.base_price) AS price
         FROM product_variants pv
         JOIN products p ON pv.product_id = p.id
         WHERE pv.sku = $1 AND pv.is_active = true`,
        [item.sku],
      );
      if (!varRes.rows.length) {
        const e = new Error(`SKU not found: ${item.sku}`);
        e.status = 400;
        throw e;
      }
      const variantId = varRes.rows[0].variant_id;
      const unitPrice = parseFloat(varRes.rows[0].price || 0);
      priced.push({ sku: item.sku, variantId, qty: item.quantity, unitPrice });
    }

    // ---- 2. Server computes subtotal — never trust the client's number ----
    const subtotal = priced.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

    // ---- 3. Server computes the discount from the real discount row ----
    let discountAmount = 0;
    let safeDiscountId = null;
    if (discountId) {
      const discRes = await client.query(
        'SELECT id, type, value, min_amount FROM discounts WHERE id = $1 AND is_active = true',
        [discountId],
      );
      if (!discRes.rows.length) {
        const e = new Error('Invalid or inactive discount');
        e.status = 400;
        throw e;
      }
      const disc = discRes.rows[0];
      if (subtotal < parseFloat(disc.min_amount || 0)) {
        const e = new Error(`Order must be at least ${disc.min_amount} to use this discount`);
        e.status = 400;
        throw e;
      }
      discountAmount = disc.type === 'percentage'
        ? (subtotal * parseFloat(disc.value)) / 100
        : Math.min(parseFloat(disc.value), subtotal);
      safeDiscountId = disc.id;
    }

    const total = Math.max(0, subtotal - discountAmount);

    // ---- 4. Validate cash payment covers the (server-computed) total ----
    const tendered = parseFloat(amountTendered || total);
    if (paymentMethod === 'cash' && tendered < total) {
      const e = new Error('Amount tendered is less than total');
      e.status = 400;
      throw e;
    }

    const saleRes = await client.query(
      `INSERT INTO sales
         (branch_id, cashier_id, subtotal, discount_id, discount_amount,
          total_amount, payment_method, amount_tendered, change_amount, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        safeBranchId,
        cashierId,
        subtotal,
        safeDiscountId,
        discountAmount,
        total,
        paymentMethod || "cash",
        tendered,
        Math.max(0, tendered - total),
        note || null,
      ],
    );
    const saleId = saleRes.rows[0].id;

    // Generate standard receipt number e.g. TGM-000007
    const prefixRes = await client.query(
      "SELECT COALESCE(receipt_prefix, 'TG') AS prefix FROM branches WHERE id = $1",
      [safeBranchId],
    );
    const prefix = prefixRes.rows[0]?.prefix || "TG";
    const receiptNumber = `${prefix}-${String(saleId).padStart(6, "0")}`;
    await client.query("UPDATE sales SET receipt_number = $1 WHERE id = $2", [
      receiptNumber,
      saleId,
    ]);

    for (const item of priced) {
      // Lock the inventory row and check stock before deducting — this same
      // locked row also gives us the branch's current average cost, which we
      // snapshot permanently onto this sale_item and never recalculate again.
      const stockCheck = await client.query(
        `SELECT stock_qty, avg_cost FROM inventory
         WHERE variant_id = $1 AND branch_id = $2
         FOR UPDATE`,
        [item.variantId, safeBranchId],
      );
      const availableQty = stockCheck.rows[0]?.stock_qty || 0;
      if (availableQty < item.qty) {
        const e = new Error(`Insufficient stock for item "${item.sku}"`);
        e.status = 400;
        throw e;
      }
      const unitCost = stockCheck.rows[0]?.avg_cost != null
        ? parseFloat(stockCheck.rows[0].avg_cost) : null;

      await client.query(
        `INSERT INTO sale_items (sale_id, variant_id, quantity, unit_price, total_price, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [saleId, item.variantId, item.qty, item.unitPrice, item.unitPrice * item.qty, unitCost],
      );

      await client.query(
        `UPDATE inventory SET stock_qty = stock_qty - $1
         WHERE variant_id=$2 AND branch_id=$3`,
        [item.qty, item.variantId, safeBranchId],
      );

      await client.query(
        `INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, reference_id, created_by)
         VALUES ($1,$2,'sale',$3,$4,$5)`,
        [item.variantId, safeBranchId, -item.qty, saleId, cashierId],
      );
    }

    await client.query("COMMIT");

    const saleDetails = await pool.query(
      `SELECT s.*, b.branch_name, b.address AS branch_address, b.phone AS branch_phone,
              COALESCE(u.full_name, u.username) AS cashier_name
       FROM sales s
       JOIN branches b ON s.branch_id = b.id
       LEFT JOIN users u ON s.cashier_id = u.id
       WHERE s.id = $1`,
      [saleId],
    );

    res.json({
      success: true,
      saleId,
      receiptNumber,
      sale: saleDetails.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Checkout error:", err);
    // err.status is set for expected/validation errors above — safe to show.
    // Anything else is an unexpected DB/server error — hide the details.
    res.status(err.status || 500).json({
      error: err.status ? err.message : "Checkout failed. Please try again.",
    });
  } finally {
    client.release();
  }
};

exports.getHistory = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  // Cashiers and Managers can only view their own branch
  if (req.user.role === "Cashier" || req.user.role === "Manager") {
    branchId = req.user.branchId;
  }
  const limit = Math.min(parseInt(req.query.limit) || 20, 500); // cap at 500
  const date = req.query.date || null;
  const startDate = req.query.startDate || null;
  const endDate = req.query.endDate || null;
  try {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (date && !dateRegex.test(date)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    }
    if ((startDate && !dateRegex.test(startDate)) || (endDate && !dateRegex.test(endDate))) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    const result = await pool.query(
      `
      SELECT s.id, s.receipt_number, s.total_amount,
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
        AND ($4::date IS NULL OR s.sale_date::date >= $4::date)
        AND ($5::date IS NULL OR s.sale_date::date <= $5::date)
      GROUP BY s.id, b.branch_name, u.full_name, u.username
      ORDER BY s.sale_date DESC
      LIMIT $3
    `,
      [branchId || null, date || null, limit, startDate || null, endDate || null],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getHistory error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getSaleDetail = async (req, res) => {
  const { id } = req.params;
  try {
    // Validate ID is a number to prevent unexpected queries
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: "Invalid sale ID" });
    }
    const sale = await pool.query(
      `SELECT s.*,
              b.branch_name, b.address AS branch_address, b.phone AS branch_phone,
              COALESCE(u.full_name, u.username) AS cashier_name,
              d.name AS discount_name
       FROM sales s
       JOIN branches b  ON s.branch_id   = b.id
       LEFT JOIN users u     ON s.cashier_id  = u.id
       LEFT JOIN discounts d ON s.discount_id = d.id
       WHERE s.id = $1`,
      [id],
    );
    // Explicit column list — deliberately excludes unit_cost. Cost/profit
    // data belongs in dedicated profit reports (Owner/Manager only), never
    // in a receipt or sale-detail view that any role (including Cashier) can open.
    const items = await pool.query(
      `SELECT si.id, si.sale_id, si.variant_id, si.quantity, si.unit_price, si.total_price,
              pv.sku, pv.size, pv.color,
              p.name AS product_name
       FROM sale_items si
       JOIN product_variants pv ON si.variant_id = pv.id
       JOIN products p          ON pv.product_id = p.id
       WHERE si.sale_id = $1`,
      [id],
    );
    if (!sale.rows.length)
      return res.status(404).json({ error: "Sale not found" });
    // Cashiers and Managers can only view sales from their own branch
    const saleData = sale.rows[0];
    if (req.user.role === "Cashier" || req.user.role === "Manager") {
      if (saleData.branch_id !== req.user.branchId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    res.json({ ...sale.rows[0], items: items.rows });
  } catch (err) {
    console.error("getSaleDetail error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
