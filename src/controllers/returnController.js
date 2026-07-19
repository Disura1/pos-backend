const pool = require("../config/db");

exports.lookupSale = async (req, res) => {
  const { receiptNumber } = req.query;
  if (!receiptNumber || !receiptNumber.trim()) {
    return res.status(400).json({ error: "Receipt number is required" });
  }
  try {
    const saleRes = await pool.query(
      `SELECT s.*, b.branch_name FROM sales s JOIN branches b ON s.branch_id = b.id WHERE s.receipt_number = $1`,
      [receiptNumber.trim()],
    );
    if (!saleRes.rows.length) {
      return res.status(404).json({ error: "No sale found with that receipt number" });
    }
    const sale = saleRes.rows[0];

    // Cashiers can only look up / return sales made at their own branch
    if (req.user.role === "Cashier" && sale.branch_id !== req.user.branchId) {
      return res.status(403).json({ error: "This sale belongs to a different branch" });
    }

    // Deliberately excludes unit_cost — cost never reaches a return screen
    const itemsRes = await pool.query(
      `SELECT si.id AS sale_item_id, si.variant_id, si.quantity, si.unit_price,
              pv.sku, pv.size, pv.color, p.name AS product_name,
              COALESCE((
                SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.sale_item_id = si.id
              ), 0) AS already_returned
       FROM sale_items si
       JOIN product_variants pv ON si.variant_id = pv.id
       JOIN products p ON pv.product_id = p.id
       WHERE si.sale_id = $1`,
      [sale.id],
    );

    const items = itemsRes.rows.map((i) => ({
      ...i,
      returnable_qty: i.quantity - parseInt(i.already_returned),
    }));

    res.json({ sale, items });
  } catch (err) {
    console.error("lookupSale error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.searchSales = async (req, res) => {
  const { query } = req.query;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: "Enter at least 2 characters to search" });
  }
  let branchId = null;
  if (req.user.role === "Cashier") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT s.id, s.receipt_number, s.sale_date, s.total_amount,
             b.branch_name, COALESCE(u.full_name, u.username) AS cashier_name
      FROM sales s
      JOIN branches b ON s.branch_id = b.id
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE s.receipt_number ILIKE '%' || $1 || '%'
        AND ($2::int IS NULL OR s.branch_id = $2)
      ORDER BY s.sale_date DESC
      LIMIT 20
      `,
      [query.trim(), branchId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("searchSales error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.processReturn = async (req, res) => {
  const { saleId, items, reason, refundMethod } = req.body;
  if (!saleId) return res.status(400).json({ error: "Sale ID is required" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one item is required" });
  }
  for (const it of items) {
    if (!it.saleItemId || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      return res.status(400).json({ error: "Invalid return item" });
    }
  }
  const validMethods = ["cash", "card"];
  if (refundMethod && !validMethods.includes(refundMethod)) {
    return res.status(400).json({ error: "Invalid refund method" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [saleId]);
    if (!saleRes.rows.length) {
      const e = new Error("Sale not found");
      e.status = 404;
      throw e;
    }
    const sale = saleRes.rows[0];

    // Cashiers can only return sales from their own branch — returns always
    // restock at the branch the sale actually belongs to.
    if (req.user.role === "Cashier" && sale.branch_id !== req.user.branchId) {
      const e = new Error("This sale belongs to a different branch");
      e.status = 403;
      throw e;
    }
    const branchId = sale.branch_id;

    // Prorate the sale's discount across returned items, so a discounted
    // purchase doesn't get refunded at full undiscounted price.
    const subtotal = parseFloat(sale.subtotal || sale.total_amount) || 0;
    const discountAmount = parseFloat(sale.discount_amount || 0);
    const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0;

    let refundTotal = 0;
    const lineDetails = [];

    for (const it of items) {
      const siRes = await client.query(
        `SELECT si.*,
                COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.sale_item_id = si.id), 0) AS already_returned
         FROM sale_items si WHERE si.id = $1 AND si.sale_id = $2 FOR UPDATE`,
        [it.saleItemId, saleId],
      );
      if (!siRes.rows.length) {
        const e = new Error("One of the items doesn't belong to this sale");
        e.status = 400;
        throw e;
      }
      const saleItem = siRes.rows[0];
      const alreadyReturned = parseInt(saleItem.already_returned) || 0;
      const returnableQty = saleItem.quantity - alreadyReturned;
      if (it.quantity > returnableQty) {
        const e = new Error(`Cannot return more than ${returnableQty} unit(s) of this item`);
        e.status = 400;
        throw e;
      }

      const unitPrice = parseFloat(saleItem.unit_price);
      const unitCost = saleItem.unit_cost != null ? parseFloat(saleItem.unit_cost) : null;
      const lineRefund = Math.round(unitPrice * it.quantity * (1 - discountRatio) * 100) / 100;
      refundTotal += lineRefund;

      lineDetails.push({
        saleItemId: saleItem.id,
        variantId: saleItem.variant_id,
        quantity: it.quantity,
        unitPrice,
        unitCost,
      });
    }

    const returnRes = await client.query(
      `INSERT INTO returns (original_sale_id, branch_id, processed_by, reason, refund_amount, refund_method)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [saleId, branchId, req.user.id, reason || null, refundTotal, refundMethod || sale.payment_method || "cash"],
    );
    const returnId = returnRes.rows[0].id;

    // Build a standard return number matching the branch's receipt prefix,
    // e.g. TGMN-RE-000001 — instantly recognizable as a return, not a sale.
    const prefixRes = await client.query(
      "SELECT COALESCE(receipt_prefix, 'TG') AS prefix FROM branches WHERE id = $1",
      [branchId],
    );
    const prefix = prefixRes.rows[0]?.prefix || "TG";
    const returnNumber = `${prefix}-RE-${String(returnId).padStart(6, "0")}`;
    await client.query("UPDATE returns SET return_number = $1 WHERE id = $2", [returnNumber, returnId]);

    for (const line of lineDetails) {
      await client.query(
        `INSERT INTO return_items (return_id, sale_item_id, quantity, unit_price, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [returnId, line.saleItemId, line.quantity, line.unitPrice, line.unitCost],
      );

      // Always restock — add the quantity back at this branch. Average cost
      // is deliberately left untouched: these units were already part of
      // that same population moments ago, so the average doesn't change.
      await client.query(
        `INSERT INTO inventory (variant_id, branch_id, stock_qty, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (variant_id, branch_id) DO UPDATE SET stock_qty = inventory.stock_qty + $3, is_active = true`,
        [line.variantId, branchId, line.quantity],
      );

      await client.query(
        `INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, unit_cost, note, created_by, reference_id)
         VALUES ($1,$2,'return',$3,$4,$5,$6,$7)`,
        [line.variantId, branchId, line.quantity, line.unitCost, reason || "Customer return", req.user.id, returnId],
      );
    }

    await client.query("COMMIT");
    res.json({
      returnId,
      returnNumber,
      refundAmount: refundTotal,
      refundMethod: refundMethod || sale.payment_method || "cash",
      originalReceiptNumber: sale.receipt_number,
      createdAt: returnRes.rows[0].created_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("processReturn error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : "Could not process return. Please try again.",
    });
  } finally {
    client.release();
  }
};

exports.getReturnHistory = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Cashier" || req.user.role === "Manager") {
    branchId = req.user.branchId;
  }
  const { startDate, endDate, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  try {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if ((startDate && !dateRegex.test(startDate)) || (endDate && !dateRegex.test(endDate))) {
      return res.status(400).json({ error: "Dates must be in YYYY-MM-DD format" });
    }
    const result = await pool.query(
      `
      SELECT r.id, r.return_number, r.reason, r.refund_amount, r.refund_method, r.created_at,
             s.receipt_number AS original_receipt_number,
             b.branch_name, b.id AS branch_id,
             COALESCE(u.full_name, u.username) AS processed_by_name,
             COUNT(ri.id) AS item_count
      FROM returns r
      JOIN sales s ON r.original_sale_id = s.id
      JOIN branches b ON r.branch_id = b.id
      LEFT JOIN users u ON r.processed_by = u.id
      LEFT JOIN return_items ri ON ri.return_id = r.id
      WHERE ($1::int IS NULL OR r.branch_id = $1)
        AND ($2::date IS NULL OR r.created_at::date >= $2::date)
        AND ($3::date IS NULL OR r.created_at::date <= $3::date)
        AND ($4::text IS NULL OR r.return_number ILIKE '%' || $4 || '%' OR s.receipt_number ILIKE '%' || $4 || '%')
      GROUP BY r.id, s.receipt_number, b.branch_name, b.id, u.full_name, u.username
      ORDER BY r.created_at DESC
      LIMIT $5
      `,
      [branchId, startDate || null, endDate || null, search?.trim() || null, limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getReturnHistory error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};