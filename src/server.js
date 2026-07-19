const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const pool = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const branchRoutes = require("./routes/branchRoutes");
const userRoutes = require("./routes/userRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const stockRoutes = require("./routes/stockRoutes");
const saleRoutes = require("./routes/saleRoutes");
const reportRoutes = require("./routes/reportRoutes");
const discountRoutes = require("./routes/discountRoutes");
const heldSaleRoutes = require("./routes/heldSaleRoutes");
const returnRoutes = require("./routes/returnRoutes");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173", "app://."],
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

// Rate limiter — max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/held-sales", heldSaleRoutes);
app.use("/api/returns", returnRoutes);

app.get("/api/status", (req, res) =>
  res.json({ message: "Teen Girl POS API is running!" }),
);

// Global error handler — hide raw DB errors in production
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: isDev ? err.message : 'An internal server error occurred',
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Teen Girl POS Server running on port ${PORT}`),
);
