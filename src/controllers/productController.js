const pool = require("../config/db");

exports.getProductsByCategory = async (req, res) => {
  const { categoryId } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE category_id = $1 AND is_active = true ORDER BY name",
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
      "INSERT INTO products (name, description, base_price, category_id, main_image) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, description, base_price, category_id, main_image || null],
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
      "UPDATE products SET name=$1,description=$2,base_price=$3,main_image=$4 WHERE id=$5 RETURNING *",
      [name, description, base_price, main_image, id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Soft delete the product
    await client.query(
      "UPDATE products SET is_active = false WHERE id = $1",
      [id]
    );

    // Soft delete all its variants too
    await client.query(
      "UPDATE product_variants SET is_active = false WHERE product_id = $1",
      [id]
    );

    await client.query("COMMIT");
    res.json({ message: "Product deactivated" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.updateVariant = async (req, res) => {
  const { id } = req.params;
  const { sku, size, color, barcode, variant_price } = req.body;
  try {
    // Duplicate SKU check (exclude self)
    const skuCheck = await pool.query(
      "SELECT id FROM product_variants WHERE sku = $1 AND id != $2",
      [sku, id],
    );
    if (skuCheck.rows.length > 0) {
      return res
        .status(400)
        .json({ error: `SKU "${sku}" is already used by another variant.` });
    }

    const result = await pool.query(
      `UPDATE product_variants SET sku=$1, size=$2, color=$3, barcode=$4, variant_price=$5
       WHERE id=$6 RETURNING *`,
      [
        sku,
        size || null,
        color || null,
        barcode || null,
        variant_price || null,
        id,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteVariant = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE product_variants SET is_active = false WHERE id = $1",
      [id]
    );
    res.json({ message: "Variant deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addVariant = async (req, res) => {
  const { product_id, sku, size, color, barcode, variant_price, branch_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Duplicate SKU check (global — across all products)
    const skuCheck = await client.query(
      "SELECT id FROM product_variants WHERE sku = $1",
      [sku],
    );
    if (skuCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `SKU "${sku}" already exists. Use a different SKU.` });
    }

    const result = await client.query(
      `INSERT INTO product_variants (product_id, sku, size, color, barcode, variant_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [product_id, sku, size, color, barcode, variant_price || null],
    );
    const variantId = result.rows[0].id;

    const branches = await client.query(
      "SELECT id FROM branches WHERE is_active = true",
    );
    for (const branch of branches.rows) {
      // The branch that created this variant gets is_active = true immediately
      // (qty stays 0 until they actually receive stock, but it's their own item
      // so it should show as Out of Stock + trigger low stock alerts right away).
      // All other branches stay is_active = false until they receive it themselves.
      const isOwningBranch = branch_id && branch.id === parseInt(branch_id);
      await client.query(
        `INSERT INTO inventory (variant_id, branch_id, stock_qty, is_active) 
        VALUES ($1, $2, 0, $3) ON CONFLICT DO NOTHING`,
        [variantId, branch.id, isOwningBranch],
      );
    }

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
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
       WHERE pv.product_id = $1 AND pv.is_active = true
       GROUP BY pv.id ORDER BY pv.size, pv.color`,
      [productId],
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
    const result = await pool.query(
      `
      SELECT p.id AS product_id, p.name, p.base_price, p.description,
             pv.id AS variant_id, pv.sku, pv.size, pv.color, pv.barcode,
             COALESCE(pv.variant_price, p.base_price) AS price,
             COALESCE(i.stock_qty, 0) AS stock_qty
      FROM products p
      JOIN product_variants pv ON p.id = pv.product_id
      LEFT JOIN inventory i ON pv.id = i.variant_id AND i.branch_id = $2
      WHERE pv.barcode = $1 AND pv.is_active = true AND p.is_active = true
    `,
      [barcode.trim(), branchId || 1],
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Product not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchProducts = async (req, res) => {
  const { q, branchId } = req.query;
  try {
    const result = await pool.query(
      `
      SELECT p.id AS product_id, p.name, p.base_price,
             pv.id AS variant_id, pv.sku, pv.size, pv.color, pv.barcode,
             COALESCE(pv.variant_price, p.base_price) AS price,
             COALESCE(i_this.stock_qty, 0)            AS stock_qty,
             COALESCE(i_total.total_stock, 0)         AS total_stock,
             -- true only when this branch has an active inventory record for this variant
             (i_this.id IS NOT NULL)                  AS is_active_here
      FROM products p
      JOIN product_variants pv ON p.id = pv.product_id AND pv.is_active = true
      LEFT JOIN inventory i_this
        ON pv.id = i_this.variant_id
        AND i_this.branch_id = $2
        AND i_this.is_active = true
      LEFT JOIN LATERAL (
        SELECT SUM(stock_qty) AS total_stock
        FROM inventory
        WHERE variant_id = pv.id AND is_active = true
      ) i_total ON true
      WHERE p.is_active = true AND (
        p.name ILIKE $1 OR pv.sku ILIKE $1 OR pv.barcode ILIKE $1
      )
      ORDER BY p.name LIMIT 50
    `,
      [`%${q}%`, branchId || 1],
    );
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
      JOIN inventory i ON pv.id = i.variant_id AND i.is_active = true
      WHERE p.is_active = true AND pv.is_active = true
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProductsByCategoryAndBranch = async (req, res) => {
  const { categoryId } = req.params;
  const { branchId } = req.query;
  try {
    let query, params;

    if (branchId) {
      // Return only products that have at least one variant
      // with an inventory record (any qty) in the selected branch
      query = `
        SELECT DISTINCT p.*
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
        JOIN inventory i ON i.variant_id = pv.id 
          AND i.branch_id = $2 
          AND i.is_active = true
        WHERE p.category_id = $1
          AND p.is_active = true
        ORDER BY p.name
      `;
      params = [categoryId, branchId];
    } else {
      query = `
        SELECT * FROM products
        WHERE category_id = $1 AND is_active = true
        ORDER BY name
      `;
      params = [categoryId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVariantsByBranch = async (req, res) => {
  const { productId } = req.params;
  const { branchId } = req.query;
  try {
    let query, params;

    if (branchId) {
      // Only return variants that have an inventory record for this branch
      query = `
        SELECT pv.*,
          json_build_array(
            json_build_object(
              'branch_id', i.branch_id,
              'branch_name', b.branch_name,
              'stock_qty', i.stock_qty
            )
          ) AS stock
        FROM product_variants pv
        JOIN inventory i ON i.variant_id = pv.id AND i.branch_id = $2 AND i.stock_qty > 0
        JOIN branches b ON b.id = i.branch_id
        WHERE pv.product_id = $1 AND pv.is_active = true
        ORDER BY pv.size, pv.color
      `;
      params = [productId, branchId];
    } else {
      // All branches (manager view — existing behavior)
      query = `
        SELECT pv.*,
          COALESCE(json_agg(
            json_build_object(
              'branch_id', i.branch_id,
              'branch_name', b.branch_name,
              'stock_qty', i.stock_qty
            )
          ) FILTER (WHERE i.id IS NOT NULL), '[]') AS stock
        FROM product_variants pv
        LEFT JOIN inventory i ON pv.id = i.variant_id
        LEFT JOIN branches b ON i.branch_id = b.id
        WHERE pv.product_id = $1 AND pv.is_active = true
        GROUP BY pv.id
        ORDER BY pv.size, pv.color
      `;
      params = [productId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get products in a category WITH stock summary for a specific branch (manager)
// or with stock across ALL branches + total (owner)
exports.getProductsByCategoryWithStock = async (req, res) => {
  const { categoryId } = req.params;
  const { branchId, allBranches } = req.query;
  try {
    if (allBranches === "true") {
      // Aggregate inventory per product per branch FIRST (via subquery),
      // then aggregate branches per product — this prevents duplicate branch
      // rows that appear when a product has multiple variants.
      const result = await pool.query(
        `
        SELECT
          p.id AS product_id,
          p.name,
          p.base_price,
          p.description,
          COALESCE(
            json_agg(
              json_build_object(
                'branch_id',  bs.branch_id,
                'branch_name', bs.branch_name,
                'stock_qty',  bs.branch_total
              )
              ORDER BY bs.branch_name
            ) FILTER (WHERE bs.branch_id IS NOT NULL),
            '[]'
          ) AS stock,
          COALESCE(SUM(bs.branch_total), 0) AS total_stock
        FROM products p
        LEFT JOIN LATERAL (
          SELECT
            i.branch_id,
            b.branch_name,
            SUM(i.stock_qty) AS branch_total
          FROM product_variants pv
          JOIN inventory i ON i.variant_id = pv.id AND i.is_active = true
          JOIN branches b   ON b.id = i.branch_id
          WHERE pv.product_id = p.id AND pv.is_active = true
          GROUP BY i.branch_id, b.branch_name
        ) bs ON true
        WHERE p.category_id = $1 AND p.is_active = true
        GROUP BY p.id
        ORDER BY p.name
        `,
        [categoryId],
      );
      return res.json(result.rows);
    }

    // MANAGER / BRANCH VIEW — stock for one branch only
    const result = await pool.query(
      `
      SELECT
        p.id AS product_id,
        p.name,
        p.base_price,
        p.description,
        COALESCE(SUM(i.stock_qty) FILTER (WHERE i.is_active = true AND i.branch_id = $2), 0) AS branch_stock,
        COALESCE(
          json_agg(
            json_build_object(
              'branch_id',  bs.branch_id,
              'branch_name', bs.branch_name,
              'stock_qty',  bs.branch_total
            )
            ORDER BY bs.branch_name
          ) FILTER (WHERE bs.branch_id IS NOT NULL),
          '[]'
        ) AS stock,
        COALESCE(SUM(bs.branch_total), 0) AS total_stock
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
      LEFT JOIN inventory i ON i.variant_id = pv.id
      LEFT JOIN LATERAL (
        SELECT
          i2.branch_id,
          b2.branch_name,
          SUM(i2.stock_qty) AS branch_total
        FROM product_variants pv2
        JOIN inventory i2 ON i2.variant_id = pv2.id AND i2.is_active = true
        JOIN branches b2   ON b2.id = i2.branch_id
        WHERE pv2.product_id = p.id AND pv2.is_active = true
        GROUP BY i2.branch_id, b2.branch_name
      ) bs ON true
      WHERE p.category_id = $1 AND p.is_active = true
      GROUP BY p.id
      ORDER BY p.name
      `,
      [categoryId, branchId || 0],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};