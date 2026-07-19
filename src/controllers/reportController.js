const pool = require("../config/db");

exports.getDailySummary = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE sale_date::date = CURRENT_DATE
        AND ($1::int IS NULL OR branch_id = $1::int)
    `,
      [branchId],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("getDailySummary error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getRevenueByPeriod = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 365); // cap at 1 year
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        sale_date::date                    AS date,
        COALESCE(SUM(total_amount), 0)     AS revenue,
        COUNT(*)                           AS transactions
      FROM sales
      WHERE sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY sale_date::date
      ORDER BY date ASC
    `,
      [days, branchId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getRevenueByPeriod error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getTopProducts = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
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
    `,
      [days, branchId, limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getTopProducts error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
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
    console.error("getBranchComparison error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getDateRangeReport = async (req, res) => {
  const { startDate, endDate } = req.query;
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "startDate and endDate are required" });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res
        .status(400)
        .json({ error: "Dates must be in YYYY-MM-DD format" });
    }
    if (new Date(startDate) > new Date(endDate)) {
      return res
        .status(400)
        .json({ error: "startDate cannot be after endDate" });
    }
    const summary = await pool.query(
      `
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
    `,
      [startDate, endDate, branchId],
    );

    const daily = await pool.query(
      `
      SELECT
        sale_date::date           AS date,
        SUM(total_amount)         AS revenue,
        COUNT(*)                  AS transactions
      FROM sales
      WHERE sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      GROUP BY sale_date::date
      ORDER BY date
    `,
      [startDate, endDate, branchId],
    );

    res.json({ summary: summary.rows[0], daily: daily.rows });
  } catch (err) {
    console.error("getDateRangeReport error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getProfitSummary = async (req, res) => {
  const { startDate, endDate } = req.query;
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: "Dates must be in YYYY-MM-DD format" });
    }

    // Revenue comes straight from `sales` (post-discount, the real amount collected)
    const revenueRes = await pool.query(
      `
      SELECT COUNT(id) AS total_transactions,
             COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM sales
      WHERE sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      `,
      [startDate, endDate, branchId],
    );

    // Cost comes from a separate query against sale_items — kept independent
    // from the revenue query above so joining line items never inflates revenue.
    const costRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs,
        COUNT(*) FILTER (WHERE si.unit_cost IS NULL) AS items_missing_cost,
        COUNT(*) AS total_items
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.sale_date::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR s.branch_id = $3::int)
      `,
      [startDate, endDate, branchId],
    );

    const totalRevenue = parseFloat(revenueRes.rows[0].total_revenue) || 0;
    const totalCogs = parseFloat(costRes.rows[0].total_cogs) || 0;
    const grossProfit = totalRevenue - totalCogs;
    const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    res.json({
      total_transactions: parseInt(revenueRes.rows[0].total_transactions) || 0,
      total_revenue: totalRevenue,
      total_cogs: totalCogs,
      gross_profit: grossProfit,
      margin_pct: marginPct,
      items_missing_cost: parseInt(costRes.rows[0].items_missing_cost) || 0,
      total_items: parseInt(costRes.rows[0].total_items) || 0,
    });
  } catch (err) {
    console.error("getProfitSummary error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getProfitByProduct = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        p.name AS product_name,
        pv.sku, pv.size, pv.color,
        SUM(si.quantity) AS total_sold,
        SUM(si.quantity * si.unit_price) AS total_revenue,
        COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs,
        COUNT(*) FILTER (WHERE si.unit_cost IS NULL) AS items_missing_cost
      FROM sale_items si
      JOIN product_variants pv ON si.variant_id = pv.id
      JOIN products p          ON pv.product_id = p.id
      JOIN sales s              ON si.sale_id    = s.id
      WHERE s.sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR s.branch_id = $2::int)
      GROUP BY p.name, pv.sku, pv.size, pv.color
      ORDER BY (SUM(si.quantity * si.unit_price)
                - COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0)) DESC
      LIMIT $3
      `,
      [days, branchId, limit],
    );
    res.json(result.rows.map((r) => {
      const revenue = parseFloat(r.total_revenue) || 0;
      const cogs = parseFloat(r.total_cogs) || 0;
      return {
        ...r,
        total_revenue: revenue,
        total_cogs: cogs,
        gross_profit: revenue - cogs,
        margin_pct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
      };
    }));
  } catch (err) {
    console.error("getProfitByProduct error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getProfitByCategory = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const result = await pool.query(
      `
      SELECT
        c.name AS category_name,
        SUM(si.quantity) AS total_sold,
        SUM(si.quantity * si.unit_price) AS total_revenue,
        COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs
      FROM sale_items si
      JOIN product_variants pv ON si.variant_id = pv.id
      JOIN products p          ON pv.product_id = p.id
      JOIN categories c        ON p.category_id = c.id
      JOIN sales s              ON si.sale_id    = s.id
      WHERE s.sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR s.branch_id = $2::int)
      GROUP BY c.name
      ORDER BY total_revenue DESC
      `,
      [days, branchId],
    );
    res.json(result.rows.map((r) => {
      const revenue = parseFloat(r.total_revenue) || 0;
      const cogs = parseFloat(r.total_cogs) || 0;
      return {
        ...r,
        total_revenue: revenue,
        total_cogs: cogs,
        gross_profit: revenue - cogs,
        margin_pct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
      };
    }));
  } catch (err) {
    console.error("getProfitByCategory error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getProfitByBranch = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  try {
    const result = await pool.query(
      `
      WITH rev AS (
        SELECT branch_id, COUNT(id) AS total_transactions, SUM(total_amount) AS total_revenue
        FROM sales
        WHERE sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        GROUP BY branch_id
      ),
      cost AS (
        SELECT s.branch_id,
               COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        GROUP BY s.branch_id
      )
      SELECT b.id AS branch_id, b.branch_name,
             COALESCE(rev.total_transactions, 0) AS total_transactions,
             COALESCE(rev.total_revenue, 0)      AS total_revenue,
             COALESCE(cost.total_cogs, 0)        AS total_cogs
      FROM branches b
      LEFT JOIN rev  ON rev.branch_id  = b.id
      LEFT JOIN cost ON cost.branch_id = b.id
      WHERE COALESCE(b.is_active, true) = true
      ORDER BY total_revenue DESC
      `,
      [days],
    );
    res.json(result.rows.map((r) => {
      const revenue = parseFloat(r.total_revenue) || 0;
      const cogs = parseFloat(r.total_cogs) || 0;
      return {
        ...r,
        total_revenue: revenue,
        total_cogs: cogs,
        gross_profit: revenue - cogs,
        margin_pct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
      };
    }));
  } catch (err) {
    console.error("getProfitByBranch error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getProfitTrend = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 365);
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const revenueRes = await pool.query(
      `
      SELECT sale_date::date AS date, SUM(total_amount) AS revenue
      FROM sales
      WHERE sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY sale_date::date
      `,
      [days, branchId],
    );
    const costRes = await pool.query(
      `
      SELECT s.sale_date::date AS date,
             COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.sale_date >= LOCALTIMESTAMP - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR s.branch_id = $2::int)
      GROUP BY s.sale_date::date
      `,
      [days, branchId],
    );
    const costByDate = {};
    costRes.rows.forEach((r) => { costByDate[String(r.date).slice(0, 10)] = parseFloat(r.cogs) || 0; });

    const merged = revenueRes.rows.map((r) => {
      const dateKey = String(r.date).slice(0, 10);
      const revenue = parseFloat(r.revenue) || 0;
      const cogs = costByDate[dateKey] || 0;
      return { date: r.date, revenue, cogs, profit: revenue - cogs };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json(merged);
  } catch (err) {
    console.error("getProfitTrend error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};