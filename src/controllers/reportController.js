const pool = require('../config/db');

exports.getDailySummary = async (req, res) => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  try {
    const result = await pool.query(`
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE sale_date::date = CURRENT_DATE
        AND ($1::int IS NULL OR branch_id = $1::int)
    `, [branchId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('getDailySummary error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getRevenueByPeriod = async (req, res) => {
  const days     = parseInt(req.query.days)     || 7;
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  try {
    const result = await pool.query(`
      SELECT
        sale_date::date                    AS date,
        COALESCE(SUM(total_amount), 0)     AS revenue,
        COUNT(*)                           AS transactions
      FROM sales
      WHERE sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY sale_date::date
      ORDER BY date ASC
    `, [days, branchId]);
    res.json(result.rows);
  } catch (err) {
    console.error('getRevenueByPeriod error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getTopProducts = async (req, res) => {
  const days     = parseInt(req.query.days)     || 30;
  const limit    = parseInt(req.query.limit)    || 10;
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  try {
    const result = await pool.query(`
      SELECT
        p.name                                  AS product_name,
        pv.sku, pv.size, pv.color,
        SUM(si.quantity)                        AS total_sold,
        SUM(si.quantity * si.unit_price)        AS total_revenue
      FROM sale_items si
      JOIN product_variants pv ON si.variant_id  = pv.id
      JOIN products p          ON pv.product_id  = p.id
      JOIN sales s             ON si.sale_id     = s.id
      WHERE s.sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR s.branch_id = $2::int)
      GROUP BY p.name, pv.sku, pv.size, pv.color
      ORDER BY total_sold DESC
      LIMIT $3
    `, [days, branchId, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('getTopProducts error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getBranchComparison = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.branch_name,
        COALESCE(SUM(s.total_amount) FILTER (WHERE s.sale_date::date = CURRENT_DATE), 0)  AS today_revenue,
        COALESCE(COUNT(s.id)         FILTER (WHERE s.sale_date::date = CURRENT_DATE), 0)  AS today_transactions,
        COALESCE(SUM(s.total_amount) FILTER (WHERE s.sale_date >= LOCALTIMESTAMP - INTERVAL '30 days'), 0)  AS month_revenue
      FROM branches b
      LEFT JOIN sales s ON s.branch_id = b.id
      WHERE COALESCE(b.is_active, true) = true
      GROUP BY b.id, b.branch_name
      ORDER BY month_revenue DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getBranchComparison error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getDateRangeReport = async (req, res) => {
  const { startDate, endDate } = req.query;
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  try {
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }
    const summary = await pool.query(`
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
    `, [startDate, endDate, branchId]);

    const daily = await pool.query(`
      SELECT
        sale_date::date           AS date,
        SUM(total_amount)         AS revenue,
        COUNT(*)                  AS transactions
      FROM sales
      WHERE sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      GROUP BY sale_date::date
      ORDER BY date
    `, [startDate, endDate, branchId]);

    res.json({ summary: summary.rows[0], daily: daily.rows });
  } catch (err) {
    console.error('getDateRangeReport error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
