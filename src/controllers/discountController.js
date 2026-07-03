const pool = require('../config/db');

exports.getAllDiscounts = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM discounts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getActiveDiscounts = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM discounts WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createDiscount = async (req, res) => {
  const { name, type, value, min_amount } = req.body;
  try {
    if (!name || !name.trim()) return res.status(400).json({ error: 'Discount name is required' });
    if (!['percentage', 'fixed'].includes(type)) return res.status(400).json({ error: 'Type must be percentage or fixed' });
    if (!value || parseFloat(value) <= 0) return res.status(400).json({ error: 'Discount value must be greater than 0' });
    if (type === 'percentage' && parseFloat(value) > 100) return res.status(400).json({ error: 'Percentage cannot exceed 100' });
    const result = await pool.query(
      'INSERT INTO discounts (name, type, value, min_amount) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, type, value, min_amount || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateDiscount = async (req, res) => {
  const { id } = req.params;
  const { name, type, value, min_amount, is_active } = req.body;
  try {
    if (!name || !name.trim()) return res.status(400).json({ error: 'Discount name is required' });
    if (!['percentage', 'fixed'].includes(type)) return res.status(400).json({ error: 'Type must be percentage or fixed' });
    if (!value || parseFloat(value) <= 0) return res.status(400).json({ error: 'Discount value must be greater than 0' });
    if (type === 'percentage' && parseFloat(value) > 100) return res.status(400).json({ error: 'Percentage cannot exceed 100' });
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'Invalid discount ID' });
    const result = await pool.query(
      'UPDATE discounts SET name=$1,type=$2,value=$3,min_amount=$4,is_active=$5 WHERE id=$6 RETURNING *',
      [name, type, value, min_amount, is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteDiscount = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE discounts SET is_active = false WHERE id = $1', [id]);
    res.json({ message: 'Discount deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
