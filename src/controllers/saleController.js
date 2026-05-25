const pool = require("../config/db");

exports.checkout = async (req, res) => {
    const { cart, total, branchId } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const saleRes = await client.query(
            "INSERT INTO sales (branch_id, total_amount) VALUES ($1, $2) RETURNING id",
            [branchId || 1, total]
        );
        const saleId = saleRes.rows[0].id;

        for (let item of cart) {
            const varRes = await client.query("SELECT id FROM product_variants WHERE sku = $1", [item.sku]);
            const variantId = varRes.rows[0].id;

            await client.query(
                "INSERT INTO sale_items (sale_id, variant_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
                [saleId, variantId, 1, item.base_price]
            );

            await client.query(
                "UPDATE inventory SET stock_qty = stock_qty - 1 WHERE variant_id = $1 AND branch_id = $2",
                [variantId, branchId || 1]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true, message: "Sale completed!", saleId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Checkout failed" });
    } finally {
        client.release();
    }
};

exports.getHistory = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.total_amount, s.sale_date, b.branch_name 
            FROM sales s
            JOIN branches b ON s.branch_id = b.id
            ORDER BY s.sale_date DESC LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};