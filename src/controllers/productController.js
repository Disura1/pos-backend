const pool = require("../config/db");

// Get products for a specific folder
exports.getProductsByCategory = async (req, res) => {
  const { categoryId } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE category_id = $1",
      [categoryId],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createProduct = async (req, res) => {
  const { name, description, base_price, category_id, main_image } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO products (name, description, base_price, category_id, main_image) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, description, base_price, category_id, main_image],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addVariant = async (req, res) => {
  const { product_id, sku, size, color, barcode, variant_price } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO product_variants (product_id, sku, size, color, barcode, variant_price) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [product_id, sku, size, color, barcode, variant_price || null],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, description, base_price, main_image } = req.body;
  try {
    const result = await pool.query(
      "UPDATE products SET name=$1, description=$2, base_price=$3, main_image=$4 WHERE id=$5 RETURNING *",
      [name, description, base_price, main_image, id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [id]);
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.scanProduct = async (req, res) => {
  const { barcode } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.name, v.sku, p.base_price 
             FROM products p 
             JOIN product_variants v ON p.id = v.product_id 
             WHERE v.barcode = $1`,
      [barcode.trim()],
    );
    if (result.rows.length > 0) res.json(result.rows[0]);
    else res.status(404).json({ message: "Not Found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllProducts = async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT p.name, v.sku, v.size, v.color, p.base_price, i.stock_qty
            FROM products p
            JOIN product_variants v ON p.id = v.product_id
            JOIN inventory i ON v.id = i.variant_id
        `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
