const pool = require('../config/db');

exports.getProductsByCategory = async (req, res) => {
  const { categoryId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE category_id = $1 AND is_active = true ORDER BY name',
      [categoryId]
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
      'INSERT INTO products (name, description, base_price, category_id, main_image) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, description, base_price, category_id, main_image || null]
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
      'UPDATE products SET name=$1,description=$2,base_price=$3,main_image=$4 WHERE id=$5 RETURNING *',
      [name, description, base_price, main_image, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [id]);
    res.json({ message: 'Product removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addVariant = async (req, res) => {
  const { product_id, sku, size, color, barcode, variant_price } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO product_variants (product_id, sku, size, color, barcode, variant_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [product_id, sku, size, color, barcode, variant_price || null]
    );
    const variantId = result.rows[0].id;

    const branches = await client.query('SELECT id FROM branches WHERE is_active = true');
    for (const branch of branches.rows) {
      await client.query(
        `INSERT INTO inventory (variant_id, branch_id, stock_qty) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`,
        [variantId, branch.id]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getVariants = async (req, res) => {
  const { productId } = req.params;
  try {
    const result = await pool.query(
      `SELECT pv.*, COALESCE(json_agg(json_build_object('branch_id', i.branch_id, 'branch_name', b.branch_name, 'stock_qty', i.stock_qty)) FILTER (WHERE i.id IS NOT NULL), '[]') AS stock
       FROM product_variants pv
       LEFT JOIN inventory i ON pv.id = i.variant_id
       LEFT JOIN branches b ON i.branch_id = b.id
       WHERE pv.product_id = $1
       GROUP BY pv.id ORDER BY pv.size, pv.color`,
      [productId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.scanProduct = async (req, res) => {
  const { barcode } = req.params;
  const { branchId } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.id AS product_id, p.name, p.base_price, p.description,
             pv.id AS variant_id, pv.sku, pv.size, pv.color, pv.barcode,
             COALESCE(pv.variant_price, p.base_price) AS price,
             COALESCE(i.stock_qty, 0) AS stock_qty
      FROM products p
      JOIN product_variants pv ON p.id = pv.product_id
      LEFT JOIN inventory i ON pv.id = i.variant_id AND i.branch_id = $2
      WHERE pv.barcode = $1
    `, [barcode.trim(), branchId || 1]);

    if (result.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchProducts = async (req, res) => {
  const { q, branchId } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.id AS product_id, p.name, p.base_price,
             pv.id AS variant_id, pv.sku, pv.size, pv.color, pv.barcode,
             COALESCE(pv.variant_price, p.base_price) AS price,
             COALESCE(i.stock_qty, 0) AS stock_qty
      FROM products p
      JOIN product_variants pv ON p.id = pv.product_id
      LEFT JOIN inventory i ON pv.id = i.variant_id AND i.branch_id = $2
      WHERE p.is_active = true AND (
        p.name ILIKE $1 OR pv.sku ILIKE $1 OR pv.barcode ILIKE $1
      )
      ORDER BY p.name LIMIT 20
    `, [`%${q}%`, branchId || 1]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllProducts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.name, pv.sku, pv.size, pv.color, p.base_price, i.stock_qty
      FROM products p
      JOIN product_variants pv ON p.id = pv.product_id
      JOIN inventory i ON pv.id = i.variant_id
      WHERE p.is_active = true
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
