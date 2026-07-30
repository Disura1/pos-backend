-- ============================================================
-- Teen Girl POS System — Neon Database Full Setup
-- Run this ONCE on a fresh Neon database.
-- All statements are safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- ROLES
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(50) UNIQUE NOT NULL
);
INSERT INTO roles (role_name) VALUES ('Owner'), ('Manager'), ('Cashier') ON CONFLICT DO NOTHING;

-- BRANCHES
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  branch_name VARCHAR(100) NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO branches (branch_name, address, phone)
VALUES ('Main Branch', 'Colombo', '+94 11 000 0000') ON CONFLICT DO NOTHING;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(100),
  role_id INTEGER REFERENCES roles(id),
  branch_id INTEGER REFERENCES branches(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  size_chart_json TEXT,
  size_chart_image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  main_image TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCT VARIANTS
CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  sku VARCHAR(100) UNIQUE NOT NULL,
  size VARCHAR(20),
  color VARCHAR(50),
  barcode VARCHAR(100) UNIQUE,
  variant_price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVENTORY
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  stock_qty INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  avg_cost NUMERIC(10,2),
  UNIQUE(variant_id, branch_id)
);

-- STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  variant_id INTEGER REFERENCES product_variants(id),
  branch_id INTEGER REFERENCES branches(id),
  movement_type VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost NUMERIC(10,2),
  reference_id INTEGER,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DISCOUNTS
CREATE TABLE IF NOT EXISTS discounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value DECIMAL(10,2) NOT NULL,
  min_amount DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SALES
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  cashier_id INTEGER REFERENCES users(id),
  subtotal DECIMAL(10,2) DEFAULT 0,
  discount_id INTEGER REFERENCES discounts(id),
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20) DEFAULT 'cash',
  amount_tendered DECIMAL(10,2),
  change_amount DECIMAL(10,2) DEFAULT 0,
  note TEXT,
  sale_date TIMESTAMPTZ DEFAULT NOW()
);

-- SALE ITEMS
CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  unit_cost NUMERIC(10,2),
  total_price DECIMAL(10,2) NOT NULL
);

-- STOCK TRANSFERS
CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  from_branch_id INTEGER REFERENCES branches(id),
  to_branch_id INTEGER REFERENCES branches(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HELD SALES
CREATE TABLE IF NOT EXISTS held_sales (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  customer_note VARCHAR(100),
  cart_json JSONB NOT NULL,
  discount_id INTEGER REFERENCES discounts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_held_sales_branch ON held_sales(branch_id);

-- RETURNS
CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  original_sale_id INTEGER NOT NULL REFERENCES sales(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  processed_by INTEGER NOT NULL REFERENCES users(id),
  reason VARCHAR(255),
  refund_amount NUMERIC(10,2) NOT NULL,
  refund_method VARCHAR(20) DEFAULT 'cash',
  return_number VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_returns_branch ON returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(original_sale_id);

-- RETURN ITEMS
CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2)
);
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO discounts (name, type, value, min_amount, is_active) VALUES
  ('10% Off',       'percentage', 10,   0,    true),
  ('20% Off',       'percentage', 20,   5000, true),
  ('LKR 500 Off',   'fixed',      500,  2000, true),
  ('LKR 1000 Off',  'fixed',      1000, 5000, true)
ON CONFLICT DO NOTHING;

-- Default owner account (password: admin123)
-- IMPORTANT: Change this password immediately after first login!
INSERT INTO users (username, password_hash, full_name, role_id, branch_id)
VALUES (
  'owner',
  '$2b$10$SHNGuRqjvEbR0mRX07OG../FDgeN3FUzdhTZqu.NTNKzTTi/CQgIS',
  'Shop Owner',
  1,
  1
) ON CONFLICT (username) DO NOTHING;

SELECT 'Neon database setup completed successfully!' AS status;
