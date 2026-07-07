const pool = require("../config/db");

exports.holdSale = async (req, res) => {
  const { cart, discountId, customerNote } = req.body;
  if (!Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO held_sales (branch_id, cashier_id, customer_note, cart_json, discount_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [req.user.branchId, req.user.id, customerNote || null, JSON.stringify(cart), discountId || null],
    );
    res.json({ id: result.rows[0].id, createdAt: result.rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not hold sale. Please try again." });
  }
};

exports.getHeldSales = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT hs.id, hs.customer_note, hs.created_at,
              jsonb_array_length(hs.cart_json) AS item_count,
              COALESCE(u.full_name, u.username) AS held_by
       FROM held_sales hs
       LEFT JOIN users u ON hs.cashier_id = u.id
       WHERE hs.branch_id = $1
       ORDER BY hs.created_at ASC`,
      [req.user.branchId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load held sales." });
  }
};

exports.resumeSale = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: "Invalid held sale ID" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM held_sales WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
      [id, req.user.branchId],
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Held sale not found" });
    }
    await client.query("DELETE FROM held_sales WHERE id = $1", [id]);
    await client.query("COMMIT");
    const row = result.rows[0];
    res.json({ cart: row.cart_json, discountId: row.discount_id, customerNote: row.customer_note });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Could not resume sale." });
  } finally {
    client.release();
  }
};

exports.deleteHeldSale = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM held_sales WHERE id=$1 AND branch_id=$2 RETURNING id",
      [id, req.user.branchId],
    );
    if (!result.rows.length) return res.status(404).json({ error: "Held sale not found" });
    res.json({ message: "Held sale removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove held sale." });
  }
};