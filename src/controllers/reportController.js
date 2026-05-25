const pool = require("../config/db");

exports.getDailySummary = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(id) AS total_transactions, 
                COALESCE(SUM(total_amount), 0) AS total_revenue 
            FROM sales 
            WHERE sale_date::date = CURRENT_DATE
        `);
        
        // result.rows[0] will look like { total_transactions: "2", total_revenue: "13500.00" }
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Report Error:", err.message);
        res.status(500).json({ error: "Failed to fetch daily summary" });
    }
};