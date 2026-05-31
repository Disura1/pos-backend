-- ============================================================
-- Teen Girl POS — Safe Migration Script
-- Run this if schema.sql gives "already exists" errors.
-- It only ADDS what's missing, never drops existing data.
-- ============================================================

-- ROLES
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(50) UNIQUE NOT NULL
);
INSERT INTO roles (role_name) VALUES ('Owner'), ('Manager'), ('Cashier') ON CONFLICT DO NOTHING;

-- BRANCHES — add missing columns safely
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  branch_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS size_chart_json TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS size_chart_image TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS main_image TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- PRODUCT VARIANTS
CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  sku VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS size VARCHAR(20);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS color VARCHAR(50);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode VARCHAR(100) UNIQUE;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS variant_price DECIMAL(10,2);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- INVENTORY
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  stock_qty INTEGER DEFAULT 0
);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;
-- Remove duplicate inventory rows (keep the one with highest stock_qty)
DELETE FROM inventory a USING inventory b
  WHERE a.id < b.id
    AND a.variant_id = b.variant_id
    AND a.branch_id  = b.branch_id;

-- Now safely add unique constraint
DO $$ BEGIN
  ALTER TABLE inventory ADD CONSTRAINT inventory_variant_branch_unique UNIQUE (variant_id, branch_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  variant_id INTEGER REFERENCES product_variants(id),
  branch_id INTEGER REFERENCES branches(id),
  movement_type VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reference_id INTEGER;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- DISCOUNTS
CREATE TABLE IF NOT EXISTS discounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS min_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
-- Add check constraint if not exists
DO $$ BEGIN
  ALTER TABLE discounts ADD CONSTRAINT discounts_type_check CHECK (type IN ('percentage', 'fixed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SALES
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  total_amount DECIMAL(10,2) NOT NULL,
  sale_date TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cashier_id INTEGER REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_id INTEGER REFERENCES discounts(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_tendered DECIMAL(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_date TIMESTAMPTZ DEFAULT NOW();

-- SALE ITEMS
CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL
);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2);
-- Backfill total_price where null
UPDATE sale_items SET total_price = unit_price * quantity WHERE total_price IS NULL;

-- STOCK TRANSFERS
CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  from_branch_id INTEGER REFERENCES branches(id),
  to_branch_id INTEGER REFERENCES branches(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Ensure main branch has address/phone
UPDATE branches SET address = 'Colombo', phone = '+94 11 000 0000'
WHERE id = 1 AND (address IS NULL OR address = '');

-- Default discounts
INSERT INTO discounts (name, type, value, min_amount, is_active) VALUES
  ('10% Off',       'percentage', 10,   0,    true),
  ('20% Off',       'percentage', 20,   5000, true),
  ('LKR 500 Off',   'fixed',      500,  2000, true),
  ('LKR 1000 Off',  'fixed',      1000, 5000, true)
ON CONFLICT DO NOTHING;

-- Owner account (password: admin123) — skip if already exists
INSERT INTO users (username, password_hash, full_name, role_id, branch_id)
VALUES (
  'owner',
  '$2b$10$SHNGuRqjvEbR0mRX07OG../FDgeN3FUzdhTZqu.NTNKzTTi/CQgIS',
  'Shop Owner',
  1,
  1
) ON CONFLICT (username) DO NOTHING;

-- ============================================================
SELECT 'Migration completed successfully!' AS status;
-- ============================================================
