const pool = require("../config/db");

// GET all categories organized as a tree
exports.getAllCategories = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, parent_id, is_active FROM categories WHERE is_active = true ORDER BY parent_id ASC, name ASC",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

// CREATE new category
exports.createCategory = async (req, res) => {
  const { name, parent_id, size_chart_json, size_chart_image } = req.body;
  try {
    if (!name || !name.trim())
      return res.status(400).json({ error: "Category name is required" });
    // Limit size_chart_json size to 50KB to prevent payload abuse
    if (size_chart_json && JSON.stringify(size_chart_json).length > 50000) {
      return res.status(400).json({ error: "Size chart data is too large" });
    }
    const result = await pool.query(
      "INSERT INTO categories (name, parent_id, size_chart_json, size_chart_image) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, parent_id || null, size_chart_json, size_chart_image],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, size_chart_json, size_chart_image } = req.body;
  try {
    if (!name || !name.trim())
      return res.status(400).json({ error: "Category name is required" });
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid category ID" });
    if (size_chart_json && JSON.stringify(size_chart_json).length > 50000) {
      return res.status(400).json({ error: "Size chart data is too large" });
    }
    const result = await pool.query(
      "UPDATE categories SET name=$1, size_chart_json=$2, size_chart_image=$3 WHERE id=$4 RETURNING *",
      [name, size_chart_json, size_chart_image, id],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Category not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid category ID" });
    // Soft delete — also deactivate any sub-categories under it
    await pool.query(
      `UPDATE categories SET is_active = false 
       WHERE id = $1 OR parent_id = $1`,
      [id],
    );
    res.json({ message: "Category deactivated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
