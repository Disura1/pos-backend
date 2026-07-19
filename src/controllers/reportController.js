const pool = require("../config/db");

// The business operates in Sri Lanka (UTC+5:30). Never rely on the Postgres
// session's default timezone (often UTC on managed hosts, and that setting
// can silently fail to apply) — always convert explicitly with AT TIME ZONE
// so "today" and daily buckets always match the business's actual calendar day.
const TZ = "Asia/Colombo";

// Postgres DATE columns come back from `pg` as native JS Date objects.
// String(dateObject) calls .toString() — a locale string like "Sun Jul 06 2026...",
// NOT ISO format. Always convert through toISOString() first so date keys/values
// are reliably "YYYY-MM-DD", whether the input is a Date object or already a string.
const toDateKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

exports.getDailySummary = async (req, res) => {
  let branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
  if (req.user.role === "Manager") branchId = req.user.branchId;
  try {
    const salesRes = await pool.query(
      `
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE (sale_date AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
        AND ($1::int IS NULL OR branch_id = $1::int)
    `,
      [branchId],
    );
    const returnsRes = await pool.query(
      `
      SELECT COALESCE(SUM(refund_amount), 0) AS total_returns
      FROM returns
      WHERE (created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
        AND ($1::int IS NULL OR branch_id = $1::int)
    `,
      [branchId],
    );
    const totalRevenue = parseFloat(salesRes.rows[0].total_revenue) || 0;
    const totalReturns = parseFloat(returnsRes.rows[0].total_returns) || 0;
    res.json({
      ...salesRes.rows[0],
      total_revenue: totalRevenue - totalReturns,
      total_returns: totalReturns,
    });
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
    const salesRes = await pool.query(
      `
      SELECT
        (sale_date AT TIME ZONE '${TZ}')::date AS date,
        COALESCE(SUM(total_amount), 0)         AS revenue,
        COUNT(*)                               AS transactions
      FROM sales
      WHERE sale_date >= NOW() - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY (sale_date AT TIME ZONE '${TZ}')::date
      `,
      [days, branchId],
    );
    const returnsRes = await pool.query(
      `
      SELECT (created_at AT TIME ZONE '${TZ}')::date AS date, COALESCE(SUM(refund_amount), 0) AS returns
      FROM returns
      WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY (created_at AT TIME ZONE '${TZ}')::date
      `,
      [days, branchId],
    );
    const returnsByDate = {};
    returnsRes.rows.forEach((r) => {
      returnsByDate[toDateKey(r.date)] = parseFloat(r.returns) || 0;
    });

    const merged = salesRes.rows.map((r) => {
      const dateKey = toDateKey(r.date);
      const revenue = parseFloat(r.revenue) || 0;
      const returns = returnsByDate[dateKey] || 0;
      return { date: dateKey, revenue: revenue - returns, transactions: parseInt(r.transactions) };
    });
    // Include days that had ONLY returns and no sales, so those aren't silently dropped
    Object.keys(returnsByDate).forEach((dateKey) => {
      if (!merged.find((m) => m.date === dateKey)) {
        merged.push({ date: dateKey, revenue: -returnsByDate[dateKey], transactions: 0 });
      }
    });
    merged.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json(merged);
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
      WITH sold AS (
        SELECT
          p.name AS product_name, pv.id AS variant_id, pv.sku, pv.size, pv.color,
          SUM(si.quantity)                 AS gross_sold,
          SUM(si.quantity * si.unit_price) AS gross_revenue
        FROM sale_items si
        JOIN product_variants pv ON si.variant_id  = pv.id
        JOIN products p          ON pv.product_id  = p.id
        JOIN sales s             ON si.sale_id     = s.id
        WHERE s.sale_date >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR s.branch_id = $2::int)
        GROUP BY p.name, pv.id, pv.sku, pv.size, pv.color
      ),
      returned AS (
        SELECT
          pv.id AS variant_id,
          SUM(ri.quantity)                 AS returned_qty,
          SUM(ri.quantity * ri.unit_price) AS returned_revenue
        FROM return_items ri
        JOIN returns r        ON ri.return_id  = r.id
        JOIN sale_items si2   ON ri.sale_item_id = si2.id
        JOIN product_variants pv ON si2.variant_id = pv.id
        WHERE r.created_at >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR r.branch_id = $2::int)
        GROUP BY pv.id
      )
      SELECT
        sold.product_name, sold.sku, sold.size, sold.color,
        (sold.gross_sold - COALESCE(returned.returned_qty, 0))       AS total_sold,
        (sold.gross_revenue - COALESCE(returned.returned_revenue, 0)) AS total_revenue
      FROM sold
      LEFT JOIN returned ON returned.variant_id = sold.variant_id
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
      WITH rev AS (
        SELECT
          b.id,
          COALESCE(SUM(s.total_amount) FILTER (WHERE (s.sale_date AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date), 0)  AS today_revenue,
          COALESCE(COUNT(s.id)         FILTER (WHERE (s.sale_date AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date), 0)  AS today_transactions,
          COALESCE(SUM(s.total_amount) FILTER (WHERE s.sale_date >= NOW() - INTERVAL '30 days'), 0)  AS month_revenue
        FROM branches b
        LEFT JOIN sales s ON s.branch_id = b.id
        GROUP BY b.id
      ),
      ret AS (
        SELECT
          branch_id,
          COALESCE(SUM(refund_amount) FILTER (WHERE (created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date), 0) AS today_returns,
          COALESCE(SUM(refund_amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) AS month_returns
        FROM returns
        GROUP BY branch_id
      )
      SELECT
        b.id, b.branch_name,
        (rev.today_revenue - COALESCE(ret.today_returns, 0)) AS today_revenue,
        rev.today_transactions,
        (rev.month_revenue - COALESCE(ret.month_returns, 0)) AS month_revenue
      FROM branches b
      LEFT JOIN rev ON rev.id = b.id
      LEFT JOIN ret ON ret.branch_id = b.id
      WHERE COALESCE(b.is_active, true) = true
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

    const summaryRes = await pool.query(
      `
      SELECT
        COUNT(id)                                        AS total_transactions,
        COALESCE(SUM(total_amount), 0)                   AS total_revenue,
        COALESCE(SUM(COALESCE(discount_amount, 0)), 0)   AS total_discounts,
        COALESCE(AVG(total_amount), 0)                   AS avg_sale
      FROM sales
      WHERE (sale_date AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
    `,
      [startDate, endDate, branchId],
    );
    const returnsSummaryRes = await pool.query(
      `
      SELECT COALESCE(SUM(refund_amount), 0) AS total_returns
      FROM returns
      WHERE (created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
    `,
      [startDate, endDate, branchId],
    );

    const dailyRes = await pool.query(
      `
      SELECT
        (sale_date AT TIME ZONE '${TZ}')::date AS date,
        SUM(total_amount)                      AS revenue,
        COUNT(*)                               AS transactions
      FROM sales
      WHERE (sale_date AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      GROUP BY (sale_date AT TIME ZONE '${TZ}')::date
      ORDER BY date
    `,
      [startDate, endDate, branchId],
    );
    const dailyReturnsRes = await pool.query(
      `
      SELECT (created_at AT TIME ZONE '${TZ}')::date AS date, SUM(refund_amount) AS returns
      FROM returns
      WHERE (created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      GROUP BY (created_at AT TIME ZONE '${TZ}')::date
    `,
      [startDate, endDate, branchId],
    );
    const returnsByDate = {};
    dailyReturnsRes.rows.forEach((r) => {
      returnsByDate[toDateKey(r.date)] = parseFloat(r.returns) || 0;
    });
    const daily = dailyRes.rows.map((r) => {
      const dateKey = toDateKey(r.date);
      const revenue = parseFloat(r.revenue) || 0;
      const returns = returnsByDate[dateKey] || 0;
      return { date: dateKey, revenue: revenue - returns, transactions: parseInt(r.transactions) };
    });

    const totalRevenue = parseFloat(summaryRes.rows[0].total_revenue) || 0;
    const totalReturns = parseFloat(returnsSummaryRes.rows[0].total_returns) || 0;

    res.json({
      summary: {
        ...summaryRes.rows[0],
        total_revenue: totalRevenue - totalReturns,
        total_returns: totalReturns,
      },
      daily,
    });
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

    const revenueRes = await pool.query(
      `
      SELECT COUNT(id) AS total_transactions,
             COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM sales
      WHERE (sale_date AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR branch_id = $3::int)
      `,
      [startDate, endDate, branchId],
    );

    const costRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs,
        COUNT(*) FILTER (WHERE si.unit_cost IS NULL) AS items_missing_cost,
        COUNT(*) AS total_items
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE (s.sale_date AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR s.branch_id = $3::int)
      `,
      [startDate, endDate, branchId],
    );

    const returnsRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(r.refund_amount), 0) AS total_returns,
        COALESCE(SUM(ri.unit_cost * ri.quantity) FILTER (WHERE ri.unit_cost IS NOT NULL), 0) AS returned_cogs
      FROM returns r
      LEFT JOIN return_items ri ON ri.return_id = r.id
      WHERE (r.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR r.branch_id = $3::int)
      `,
      [startDate, endDate, branchId],
    );

    const totalRevenue = parseFloat(revenueRes.rows[0].total_revenue) || 0;
    const totalCogs = parseFloat(costRes.rows[0].total_cogs) || 0;
    const totalReturns = parseFloat(returnsRes.rows[0].total_returns) || 0;
    const returnedCogs = parseFloat(returnsRes.rows[0].returned_cogs) || 0;

    const netRevenue = totalRevenue - totalReturns;
    const netCogs = totalCogs - returnedCogs;
    const grossProfit = netRevenue - netCogs;
    const marginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    res.json({
      total_transactions: parseInt(revenueRes.rows[0].total_transactions) || 0,
      total_revenue: netRevenue,
      total_cogs: netCogs,
      gross_profit: grossProfit,
      margin_pct: marginPct,
      total_returns: totalReturns,
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
      WITH sold AS (
        SELECT
          p.name AS product_name, pv.id AS variant_id, pv.sku, pv.size, pv.color,
          SUM(si.quantity)                 AS gross_sold,
          SUM(si.quantity * si.unit_price) AS gross_revenue,
          COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS gross_cogs
        FROM sale_items si
        JOIN product_variants pv ON si.variant_id  = pv.id
        JOIN products p          ON pv.product_id  = p.id
        JOIN sales s             ON si.sale_id     = s.id
        WHERE s.sale_date >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR s.branch_id = $2::int)
        GROUP BY p.name, pv.id, pv.sku, pv.size, pv.color
      ),
      returned AS (
        SELECT
          pv.id AS variant_id,
          SUM(ri.quantity * ri.unit_price) AS returned_revenue,
          COALESCE(SUM(ri.unit_cost * ri.quantity) FILTER (WHERE ri.unit_cost IS NOT NULL), 0) AS returned_cogs
        FROM return_items ri
        JOIN returns r        ON ri.return_id  = r.id
        JOIN sale_items si2   ON ri.sale_item_id = si2.id
        JOIN product_variants pv ON si2.variant_id = pv.id
        WHERE r.created_at >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR r.branch_id = $2::int)
        GROUP BY pv.id
      )
      SELECT
        sold.product_name, sold.sku, sold.size, sold.color, sold.gross_sold AS total_sold,
        (sold.gross_revenue - COALESCE(returned.returned_revenue, 0)) AS total_revenue,
        (sold.gross_cogs    - COALESCE(returned.returned_cogs, 0))    AS total_cogs
      FROM sold
      LEFT JOIN returned ON returned.variant_id = sold.variant_id
      ORDER BY (sold.gross_revenue - COALESCE(returned.returned_revenue, 0))
                - (sold.gross_cogs - COALESCE(returned.returned_cogs, 0)) DESC
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
      WITH sold AS (
        SELECT
          c.id AS category_id, c.name AS category_name,
          SUM(si.quantity)                 AS gross_sold,
          SUM(si.quantity * si.unit_price) AS gross_revenue,
          COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS gross_cogs
        FROM sale_items si
        JOIN product_variants pv ON si.variant_id = pv.id
        JOIN products p          ON pv.product_id = p.id
        JOIN categories c        ON p.category_id = c.id
        JOIN sales s              ON si.sale_id    = s.id
        WHERE s.sale_date >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR s.branch_id = $2::int)
        GROUP BY c.id, c.name
      ),
      returned AS (
        SELECT
          c.id AS category_id,
          SUM(ri.quantity * ri.unit_price) AS returned_revenue,
          COALESCE(SUM(ri.unit_cost * ri.quantity) FILTER (WHERE ri.unit_cost IS NOT NULL), 0) AS returned_cogs
        FROM return_items ri
        JOIN returns r        ON ri.return_id    = r.id
        JOIN sale_items si2   ON ri.sale_item_id  = si2.id
        JOIN product_variants pv ON si2.variant_id = pv.id
        JOIN products p       ON pv.product_id    = p.id
        JOIN categories c     ON p.category_id     = c.id
        WHERE r.created_at >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::int IS NULL OR r.branch_id = $2::int)
        GROUP BY c.id
      )
      SELECT
        sold.category_name, sold.gross_sold AS total_sold,
        (sold.gross_revenue - COALESCE(returned.returned_revenue, 0)) AS total_revenue,
        (sold.gross_cogs    - COALESCE(returned.returned_cogs, 0))    AS total_cogs
      FROM sold
      LEFT JOIN returned ON returned.category_id = sold.category_id
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
        WHERE sale_date >= NOW() - ($1 * INTERVAL '1 day')
        GROUP BY branch_id
      ),
      cost AS (
        SELECT s.branch_id,
               COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS total_cogs
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.sale_date >= NOW() - ($1 * INTERVAL '1 day')
        GROUP BY s.branch_id
      ),
      ret AS (
        SELECT r.branch_id,
               COALESCE(SUM(r.refund_amount), 0) AS total_returns,
               COALESCE(SUM(ri.unit_cost * ri.quantity) FILTER (WHERE ri.unit_cost IS NOT NULL), 0) AS returned_cogs
        FROM returns r
        LEFT JOIN return_items ri ON ri.return_id = r.id
        WHERE r.created_at >= NOW() - ($1 * INTERVAL '1 day')
        GROUP BY r.branch_id
      )
      SELECT b.id AS branch_id, b.branch_name,
             COALESCE(rev.total_transactions, 0) AS total_transactions,
             (COALESCE(rev.total_revenue, 0) - COALESCE(ret.total_returns, 0))  AS total_revenue,
             (COALESCE(cost.total_cogs, 0)  - COALESCE(ret.returned_cogs, 0))  AS total_cogs
      FROM branches b
      LEFT JOIN rev  ON rev.branch_id  = b.id
      LEFT JOIN cost ON cost.branch_id = b.id
      LEFT JOIN ret  ON ret.branch_id  = b.id
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
      SELECT (sale_date AT TIME ZONE '${TZ}')::date AS date, SUM(total_amount) AS revenue
      FROM sales
      WHERE sale_date >= NOW() - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR branch_id = $2::int)
      GROUP BY (sale_date AT TIME ZONE '${TZ}')::date
      `,
      [days, branchId],
    );
    const costRes = await pool.query(
      `
      SELECT (s.sale_date AT TIME ZONE '${TZ}')::date AS date,
             COALESCE(SUM(si.unit_cost * si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0) AS cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.sale_date >= NOW() - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR s.branch_id = $2::int)
      GROUP BY (s.sale_date AT TIME ZONE '${TZ}')::date
      `,
      [days, branchId],
    );
    const returnsRes = await pool.query(
      `
      SELECT (r.created_at AT TIME ZONE '${TZ}')::date AS date,
             COALESCE(SUM(r.refund_amount), 0) AS returns,
             COALESCE(SUM(ri.unit_cost * ri.quantity) FILTER (WHERE ri.unit_cost IS NOT NULL), 0) AS returned_cogs
      FROM returns r
      LEFT JOIN return_items ri ON ri.return_id = r.id
      WHERE r.created_at >= NOW() - ($1 * INTERVAL '1 day')
        AND ($2::int IS NULL OR r.branch_id = $2::int)
      GROUP BY (r.created_at AT TIME ZONE '${TZ}')::date
      `,
      [days, branchId],
    );

    const revenueByDate = {};
    revenueRes.rows.forEach((r) => { revenueByDate[toDateKey(r.date)] = parseFloat(r.revenue) || 0; });
    const costByDate = {};
    costRes.rows.forEach((r) => { costByDate[toDateKey(r.date)] = parseFloat(r.cogs) || 0; });
    const returnsByDate = {};
    returnsRes.rows.forEach((r) => {
      returnsByDate[toDateKey(r.date)] = {
        returns: parseFloat(r.returns) || 0,
        returnedCogs: parseFloat(r.returned_cogs) || 0,
      };
    });

    const allDates = new Set([...Object.keys(revenueByDate), ...Object.keys(returnsByDate)]);
    const merged = Array.from(allDates).map((dateKey) => {
      const grossRevenue = revenueByDate[dateKey] || 0;
      const cogs = costByDate[dateKey] || 0;
      const ret = returnsByDate[dateKey] || { returns: 0, returnedCogs: 0 };
      const revenue = grossRevenue - ret.returns;
      const netCogs = cogs - ret.returnedCogs;
      return { date: dateKey, revenue, cogs: netCogs, profit: revenue - netCogs };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json(merged);
  } catch (err) {
    console.error("getProfitTrend error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};