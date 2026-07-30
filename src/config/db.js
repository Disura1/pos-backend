const { Pool } = require('pg');
require('dotenv').config();

// Neon / Render provides DATABASE_URL; local dev uses individual vars
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        options: '-c timezone=Asia/Colombo',
      }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
        options: '-c timezone=Asia/Colombo',
      }
);

module.exports = pool;