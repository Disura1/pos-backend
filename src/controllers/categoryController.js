const pool = require("../config/db");

// GET all categories organized as a tree
exports.getAllCategories = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM categories ORDER BY parent_id ASC, name ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE new category
exports.createCategory = async (req, res) => {
  const { name, parent_id, size_chart_json, size_chart_image } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO categories (name, parent_id, size_chart_json, size_chart_image) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, parent_id || null, size_chart_json, size_chart_image],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, size_chart_json, size_chart_image } = req.body;
  try {
    const result = await pool.query(
      "UPDATE categories SET name=$1, size_chart_json=$2, size_chart_image=$3 WHERE id=$4 RETURNING *",
      [name, size_chart_json, size_chart_image, id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    // Warning: Ensure your DB schema uses ON DELETE CASCADE for parent_id
    await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    res.json({ message: "Category and its sub-items removed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
