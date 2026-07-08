const pool = require("../config/db");

exports.getAllBranches = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.branch_name,
             COALESCE(b.address, '')    AS address,
             COALESCE(b.phone, '')      AS phone,
             COALESCE(b.receipt_prefix, '') AS receipt_prefix,
             COALESCE(b.is_active, true) AS is_active,
             b.created_at,
             COUNT(DISTINCT u.id) AS staff_count
      FROM branches b
      LEFT JOIN users u ON u.branch_id = b.id
      GROUP BY b.id, b.branch_name, b.address, b.phone, b.receipt_prefix, b.is_active, b.created_at
      ORDER BY b.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("getAllBranches error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.createBranch = async (req, res) => {
  const { branch_name, address, phone, receipt_prefix } = req.body;
  try {
    if (!branch_name || !branch_name.trim())
      return res.status(400).json({ error: "Branch name is required" });
    const result = await pool.query(
      "INSERT INTO branches (branch_name, address, phone, receipt_prefix) VALUES ($1, $2, $3, $4) RETURNING *",
      [branch_name, address || null, phone || null, receipt_prefix || null],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("createBranch error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.updateBranch = async (req, res) => {
  const { id } = req.params;
  const { branch_name, address, phone, is_active, receipt_prefix } = req.body;
  try {
    if (!branch_name || !branch_name.trim())
      return res.status(400).json({ error: "Branch name is required" });
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid branch ID" });
    const result = await pool.query(
      "UPDATE branches SET branch_name=$1, address=$2, phone=$3, is_active=$4, receipt_prefix=$5 WHERE id=$6 RETURNING *",
      [
        branch_name,
        address || null,
        phone || null,
        is_active,
        receipt_prefix || null,
        parseInt(id),
      ],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Branch not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("updateBranch error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.deleteBranch = async (req, res) => {
  const { id } = req.params;
  try {
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid branch ID" });
    const result = await pool.query(
      "UPDATE branches SET is_active = false WHERE id = $1 RETURNING id",
      [parseInt(id)],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Branch not found" });
    res.json({ message: "Branch deactivated" });
  } catch (err) {
    console.error("deleteBranch error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getBranchStats = async (req, res) => {
  const { id } = req.params;
  try {
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid branch ID" });
    // Managers can only view their own branch stats
    if (req.user.role === "Manager" && parseInt(id) !== req.user.branchId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const revenue = await pool.query(
      `
      SELECT COALESCE(SUM(total_amount), 0) AS today_revenue,
             COUNT(*)                        AS today_transactions
      FROM sales
      WHERE branch_id = $1
        AND sale_date::date = CURRENT_DATE
    `,
      [id],
    );

    const lowStock = await pool.query(
      `
      SELECT COUNT(*) AS cnt
      FROM inventory
      WHERE branch_id = $1
        AND is_active = true
        AND stock_qty <= COALESCE(low_stock_threshold, 5)
    `,
      [id],
    );

    res.json({
      today_revenue: revenue.rows[0].today_revenue,
      today_transactions: revenue.rows[0].today_transactions,
      low_stock_count: lowStock.rows[0].cnt,
    });
  } catch (err) {
    console.error("getBranchStats error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.hardDeleteBranch = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!id || isNaN(parseInt(id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid branch ID" });
    }

    // Safety check — block delete if branch has staff assigned
    const staffCheck = await client.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE branch_id = $1",
      [id],
    );
    if (parseInt(staffCheck.rows[0].cnt) > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Cannot delete this branch — it still has staff assigned. Reassign or remove staff first.",
      });
    }

    // Remove inventory records for this branch
    await client.query("DELETE FROM inventory WHERE branch_id = $1", [id]);

    // Remove sales linked to this branch
    // (only safe if you want full removal — adjust if you prefer to keep history)
    // await client.query('DELETE FROM sales WHERE branch_id = $1', [id]);

    // Delete the branch
    await client.query("DELETE FROM branches WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ message: "Branch permanently deleted" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("hardDeleteBranch error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  } finally {
    client.release();
  }
};
