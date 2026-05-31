const pool = require('../config/db');

exports.getAllBranches = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.branch_name,
             COALESCE(b.address, '')    AS address,
             COALESCE(b.phone, '')      AS phone,
             COALESCE(b.is_active, true) AS is_active,
             b.created_at,
             COUNT(DISTINCT u.id) AS staff_count
      FROM branches b
      LEFT JOIN users u ON u.branch_id = b.id
      GROUP BY b.id, b.branch_name, b.address, b.phone, b.is_active, b.created_at
      ORDER BY b.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getAllBranches error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.createBranch = async (req, res) => {
  const { branch_name, address, phone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO branches (branch_name, address, phone) VALUES ($1, $2, $3) RETURNING *',
      [branch_name, address || null, phone || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('createBranch error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updateBranch = async (req, res) => {
  const { id } = req.params;
  const { branch_name, address, phone, is_active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE branches SET branch_name=$1, address=$2, phone=$3, is_active=$4 WHERE id=$5 RETURNING *',
      [branch_name, address || null, phone || null, is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateBranch error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteBranch = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE branches SET is_active = false WHERE id = $1', [id]);
    res.json({ message: 'Branch deactivated' });
  } catch (err) {
    console.error('deleteBranch error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getBranchStats = async (req, res) => {
  const { id } = req.params;
  try {
    const revenue = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS today_revenue,
             COUNT(*)                        AS today_transactions
      FROM sales
      WHERE branch_id = $1
        AND sale_date::date = CURRENT_DATE
    `, [id]);

    const lowStock = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM inventory
      WHERE branch_id = $1
        AND stock_qty <= COALESCE(low_stock_threshold, 5)
    `, [id]);

    res.json({
      today_revenue:      revenue.rows[0].today_revenue,
      today_transactions: revenue.rows[0].today_transactions,
      low_stock_count:    lowStock.rows[0].cnt,
    });
  } catch (err) {
    console.error('getBranchStats error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
