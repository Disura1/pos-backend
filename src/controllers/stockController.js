const pool = require("../config/db");

exports.getInventory = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        i.id, i.stock_qty,
        COALESCE(i.low_stock_threshold, 5) AS low_stock_threshold,
        pv.id   AS variant_id, pv.sku, pv.size, pv.color, pv.barcode, pv.variant_price,
        p.id    AS product_id, p.name AS product_name, p.base_price,
        c.name  AS category_name,
        b.branch_name, i.branch_id
      FROM inventory i
      JOIN product_variants pv ON i.variant_id = pv.id AND pv.is_active = true
      JOIN products p          ON pv.product_id = p.id AND p.is_active = true
      LEFT JOIN categories c   ON p.category_id = c.id
      JOIN branches b          ON i.branch_id   = b.id
      WHERE i.is_active = true
        AND ($1::int IS NULL OR i.branch_id = $1)
      ORDER BY p.name, pv.size, pv.color
    `,
      [branchId || null],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getInventory error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getLowStockAlerts = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        i.stock_qty,
        COALESCE(i.low_stock_threshold, 5) AS low_stock_threshold,
        pv.sku, pv.size, pv.color,
        p.name AS product_name,
        b.branch_name, i.branch_id
      FROM inventory i
      JOIN product_variants pv ON i.variant_id = pv.id AND pv.is_active = true
      JOIN products p          ON pv.product_id = p.id AND p.is_active = true
      JOIN branches b          ON i.branch_id   = b.id
      WHERE i.stock_qty <= COALESCE(i.low_stock_threshold, 5)
        AND i.is_active = true
        AND ($1::int IS NULL OR i.branch_id = $1)
      ORDER BY i.stock_qty ASC
    `,
      [branchId || null],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getLowStockAlerts error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.receiveStock = async (req, res) => {
  let { variant_id, branch_id, quantity, unit_cost, note } = req.body;
  if (req.user.role === "Manager") branch_id = req.user.branchId;
  if (!branch_id) {
    return res.status(400).json({ error: "Branch ID is required" });
  }
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) {
    return res.status(400).json({ error: "Receive quantity must be greater than 0" });
  }
  if (unit_cost !== undefined && unit_cost !== null && unit_cost !== "" && parseFloat(unit_cost) < 0) {
    return res.status(400).json({ error: "Unit cost cannot be negative" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so two simultaneous receives can't corrupt the running average
    const existing = await client.query(
      "SELECT stock_qty, avg_cost FROM inventory WHERE variant_id=$1 AND branch_id=$2 FOR UPDATE",
      [variant_id, branch_id],
    );
    const currentQty = existing.rows[0]?.stock_qty || 0;
    const currentAvgCost = existing.rows[0]?.avg_cost != null ? parseFloat(existing.rows[0].avg_cost) : null;

    let newAvgCost = currentAvgCost;
    const hasCost = unit_cost !== undefined && unit_cost !== null && unit_cost !== "";
    const incomingCost = hasCost ? parseFloat(unit_cost) : null;

    if (hasCost) {
      newAvgCost = (currentAvgCost == null || currentQty === 0)
        ? incomingCost
        : ((currentQty * currentAvgCost) + (qty * incomingCost)) / (currentQty + qty);
    }

    await client.query(
      `
      INSERT INTO inventory (variant_id, branch_id, stock_qty, avg_cost, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (variant_id, branch_id)
      DO UPDATE SET stock_qty = inventory.stock_qty + $3, avg_cost = $4, is_active = true
    `,
      [variant_id, branch_id, qty, newAvgCost],
    );

    await client.query(
      `
      INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, unit_cost, note, created_by)
      VALUES ($1, $2, 'receive', $3, $4, $5, $6)
    `,
      [variant_id, branch_id, qty, incomingCost, note || "Stock received", req.user.id],
    );

    await client.query("COMMIT");
    res.json({ message: "Stock received successfully", avg_cost: newAvgCost });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("receiveStock error:", err);
    res.status(500).json({ error: "Could not receive stock. Please try again." });
  } finally {
    client.release();
  }
};

exports.adjustStock = async (req, res) => {
  let { variant_id, branch_id, new_qty, note } = req.body;
  if (req.user.role === "Manager") branch_id = req.user.branchId;
  if (!branch_id) {
    return res.status(400).json({ error: "Branch ID is required" });
  }
  if (
    new_qty === undefined ||
    new_qty === null ||
    isNaN(new_qty) ||
    parseInt(new_qty) < 0
  ) {
    return res
      .status(400)
      .json({ error: "Invalid quantity — must be 0 or greater" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT stock_qty FROM inventory WHERE variant_id=$1 AND branch_id=$2",
      [variant_id, branch_id],
    );
    const currentQty = current.rows[0]?.stock_qty || 0;
    const diff = new_qty - currentQty;

    await client.query(
      `
      INSERT INTO inventory (variant_id, branch_id, stock_qty, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (variant_id, branch_id) DO UPDATE SET stock_qty = $3, is_active = true
    `,
      [variant_id, branch_id, new_qty],
    );

    await client.query(
      `
      INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, note, created_by)
      VALUES ($1, $2, 'adjustment', $3, $4, $5)
    `,
      [variant_id, branch_id, diff, note || "Manual adjustment", req.user.id],
    );

    await client.query("COMMIT");
    res.json({ message: "Stock adjusted successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("adjustStock error:", err);
    res
      .status(500)
      .json({ error: "Could not adjust stock. Please try again." });
  } finally {
    client.release();
  }
};

exports.transferStock = async (req, res) => {
  let { variant_id, from_branch_id, to_branch_id, quantity, note } = req.body;
  if (req.user.role === "Manager") from_branch_id = req.user.branchId;
  if (!from_branch_id) {
    return res.status(400).json({ error: "Source branch is required" });
  }
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) {
    return res.status(400).json({ error: "Transfer quantity must be greater than 0" });
  }
  if (parseInt(from_branch_id) === parseInt(to_branch_id)) {
    return res.status(400).json({ error: "Source and destination branches cannot be the same" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fromStock = await client.query(
      "SELECT stock_qty, avg_cost FROM inventory WHERE variant_id=$1 AND branch_id=$2 FOR UPDATE",
      [variant_id, from_branch_id],
    );
    if (!fromStock.rows[0] || fromStock.rows[0].stock_qty < qty) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient stock in source branch" });
    }
    const sourceAvgCost = fromStock.rows[0].avg_cost != null ? parseFloat(fromStock.rows[0].avg_cost) : null;

    await client.query(
      "UPDATE inventory SET stock_qty = stock_qty - $1 WHERE variant_id=$2 AND branch_id=$3",
      [qty, variant_id, from_branch_id],
    );

    // Lock destination row and blend in the source's cost basis
    const destExisting = await client.query(
      "SELECT stock_qty, avg_cost FROM inventory WHERE variant_id=$1 AND branch_id=$2 FOR UPDATE",
      [variant_id, to_branch_id],
    );
    const destQty = destExisting.rows[0]?.stock_qty || 0;
    const destAvgCost = destExisting.rows[0]?.avg_cost != null ? parseFloat(destExisting.rows[0].avg_cost) : null;

    let newDestAvgCost = destAvgCost;
    if (sourceAvgCost != null) {
      newDestAvgCost = (destAvgCost == null || destQty === 0)
        ? sourceAvgCost
        : ((destQty * destAvgCost) + (qty * sourceAvgCost)) / (destQty + qty);
    }

    await client.query(
      `
      INSERT INTO inventory (variant_id, branch_id, stock_qty, avg_cost, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (variant_id, branch_id) DO UPDATE
        SET stock_qty = inventory.stock_qty + $3,
            avg_cost = $4,
            is_active = true
    `,
      [variant_id, to_branch_id, qty, newDestAvgCost],
    );

    const transfer = await client.query(
      `
      INSERT INTO stock_transfers (from_branch_id, to_branch_id, variant_id, quantity, status, note, created_by)
      VALUES ($1,$2,$3,$4,'completed',$5,$6) RETURNING id
    `,
      [from_branch_id, to_branch_id, variant_id, qty, note, req.user.id],
    );
    const transferId = transfer.rows[0].id;

    await client.query(
      `
      INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, unit_cost, note, created_by, reference_id)
      VALUES ($1,$2,'transfer_out',$3,$4,$5,$6,$7)
    `,
      [variant_id, from_branch_id, qty, sourceAvgCost, note, req.user.id, transferId],
    );

    await client.query(
      `
      INSERT INTO stock_movements (variant_id, branch_id, movement_type, quantity, unit_cost, note, created_by, reference_id)
      VALUES ($1,$2,'transfer_in',$3,$4,$5,$6,$7)
    `,
      [variant_id, to_branch_id, qty, sourceAvgCost, note, req.user.id, transferId],
    );

    await client.query("COMMIT");
    res.json({ message: "Transfer completed successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("transferStock error:", err);
    res.status(500).json({ error: "Could not complete transfer. Please try again." });
  } finally {
    client.release();
  }
};

exports.getMovements = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  const limit = parseInt(req.query.limit) || 50;
  try {
    const result = await pool.query(
      `
      SELECT sm.*, pv.sku, pv.size, pv.color, p.name AS product_name,
             b.branch_name, u.full_name AS created_by_name
      FROM stock_movements sm
      JOIN product_variants pv ON sm.variant_id = pv.id
      JOIN products p          ON pv.product_id = p.id
      JOIN branches b          ON sm.branch_id  = b.id
      LEFT JOIN users u        ON sm.created_by = u.id
      WHERE ($1::int IS NULL OR sm.branch_id = $1)
      ORDER BY sm.created_at DESC
      LIMIT $2
    `,
      [branchId || null, limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getMovements error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.updateThreshold = async (req, res) => {
  let { variant_id, branch_id, threshold } = req.body;
  if (req.user.role === "Manager") branch_id = req.user.branchId;
  try {
    if (!branch_id) {
      return res.status(400).json({ error: "Branch ID is required" });
    }
    if (
      threshold === undefined ||
      threshold === null ||
      isNaN(threshold) ||
      parseInt(threshold) < 1
    ) {
      return res.status(400).json({ error: "Threshold must be at least 1" });
    }
    await pool.query(
      "UPDATE inventory SET low_stock_threshold = $1 WHERE variant_id=$2 AND branch_id=$3",
      [threshold, variant_id, branch_id],
    );
    res.json({ message: "Threshold updated" });
  } catch (err) {
    console.error("updateThreshold error:", err);
    res
      .status(500)
      .json({ error: "Could not update threshold. Please try again." });
  }
};
