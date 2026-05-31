const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./config/db');

const authRoutes     = require('./routes/authRoutes');
const branchRoutes   = require('./routes/branchRoutes');
const userRoutes     = require('./routes/userRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes  = require('./routes/productRoutes');
const stockRoutes    = require('./routes/stockRoutes');
const saleRoutes     = require('./routes/saleRoutes');
const reportRoutes   = require('./routes/reportRoutes');
const discountRoutes = require('./routes/discountRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/branches',  branchRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/categories',categoryRoutes);
app.use('/api/products',  productRoutes);
app.use('/api/stock',     stockRoutes);
app.use('/api/sales',     saleRoutes);
app.use('/api/reports',   reportRoutes);
app.use('/api/discounts', discountRoutes);

app.get('/api/status', (req, res) =>
  res.json({ message: 'Teen Girl POS API is running!' })
);

// Debug endpoint — tests every query the dashboards use
app.get('/api/debug', async (req, res) => {
  const results = {};
  const run = async (name, sql, params = []) => {
    try {
      const r = await pool.query(sql, params);
      results[name] = { ok: true, rows: r.rows.slice(0, 2) };
    } catch (err) {
      results[name] = { ok: false, error: err.message };
    }
  };

  await run('daily_summary',
    `SELECT COUNT(id) AS t, COALESCE(SUM(total_amount),0) AS rev,
            COALESCE(SUM(COALESCE(discount_amount,0)),0) AS disc,
            COALESCE(AVG(total_amount),0) AS avg
     FROM sales WHERE sale_date::date = CURRENT_DATE`);

  await run('branch_comparison',
    `SELECT b.id, b.branch_name,
            COALESCE(SUM(s.total_amount) FILTER (WHERE s.sale_date::date = CURRENT_DATE), 0) AS today
     FROM branches b LEFT JOIN sales s ON s.branch_id = b.id
     WHERE COALESCE(b.is_active,true)=true GROUP BY b.id`);

  await run('revenue_7d',
    `SELECT sale_date::date AS d, COALESCE(SUM(total_amount),0) AS rev
     FROM sales WHERE sale_date >= CURRENT_DATE - 6 GROUP BY d ORDER BY d`);

  await run('top_products',
    `SELECT p.name, SUM(si.quantity) AS sold,
            SUM(si.quantity * si.unit_price) AS rev
     FROM sale_items si
     JOIN product_variants pv ON si.variant_id=pv.id
     JOIN products p ON pv.product_id=p.id
     JOIN sales s ON si.sale_id=s.id
     WHERE s.sale_date >= CURRENT_DATE - 30
     GROUP BY p.name ORDER BY sold DESC LIMIT 5`);

  await run('low_stock',
    `SELECT i.stock_qty, pv.sku, p.name AS product_name
     FROM inventory i
     JOIN product_variants pv ON i.variant_id=pv.id
     JOIN products p ON pv.product_id=p.id
     WHERE i.stock_qty <= COALESCE(i.low_stock_threshold,5) LIMIT 5`);

  await run('sale_items_cols',
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='sale_items' ORDER BY column_name`);

  await run('active_discounts',
    `SELECT id, name, type, value FROM discounts WHERE is_active=true`);

  res.json(results);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Teen Girl POS Server running on port ${PORT}`)
);
