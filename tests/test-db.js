const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "postgres",
  password: "Dis29@pgsql",
  port: 5432,
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Connection Error:", err.stack);
  } else {
    console.log(
      "✅ Database Connected Successfully! Current Time:",
      res.rows[0].now,
    );
  }
  pool.end();
});
