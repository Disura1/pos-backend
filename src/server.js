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
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'app://.' ],
  credentials: true,
}));
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Teen Girl POS Server running on port ${PORT}`)
);
