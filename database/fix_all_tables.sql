-- ============================================================
-- Teen Girl POS — Complete Fix Script
-- Run this entire file in pgAdmin Query Tool.
-- Safe to run multiple times. Creates what is missing.
-- ============================================================

-- ── STEP 1: Fix existing tables (add missing columns) ────────

ALTER TABLE branches ADD COLUMN IF NOT EXISTS address    TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone      VARCHAR(20);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name   VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id   INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;

-- ── STEP 2: Clean duplicate inventory rows, then unique constraint ──

DELETE FROM inventory a
USING inventory b
WHERE a.id < b.id
  AND a.variant_id = b.variant_id
  AND a.branch_id  = b.branch_id;

DO $$ BEGIN
  ALTER TABLE inventory
    ADD CONSTRAINT inventory_variant_branch_unique UNIQUE (variant_id, branch_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
  NULL; -- constraint already exists, skip
END $$;

-- ── STEP 3: Create STOCK MOVEMENTS table ────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id            SERIAL PRIMARY KEY,
  variant_id    INTEGER REFERENCES product_variants(id),
  branch_id     INTEGER REFERENCES branches(id),
  movement_type VARCHAR(50) NOT NULL,
  quantity      INTEGER NOT NULL,
  reference_id  INTEGER,
  note          TEXT,
  created_by    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── STEP 4: Create DISCOUNTS table ──────────────────────────

CREATE TABLE IF NOT EXISTS discounts (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  type        VARCHAR(20)  NOT NULL,
  value       DECIMAL(10,2) NOT NULL,
  min_amount  DECIMAL(10,2) DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── STEP 5: Create SALES table ──────────────────────────────

CREATE TABLE IF NOT EXISTS sales (
  id             SERIAL PRIMARY KEY,
  branch_id      INTEGER REFERENCES branches(id),
  cashier_id     INTEGER,
  subtotal       DECIMAL(10,2) DEFAULT 0,
  discount_id    INTEGER,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount   DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20)   DEFAULT 'cash',
  amount_tendered DECIMAL(10,2),
  change_amount  DECIMAL(10,2) DEFAULT 0,
  note           TEXT,
  sale_date      TIMESTAMPTZ   DEFAULT NOW()
);

-- If sales already existed, add missing columns
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cashier_id      INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal        DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_id     INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(20)   DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_tendered DECIMAL(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_amount   DECIMAL(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS note            TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_date       TIMESTAMPTZ   DEFAULT NOW();

-- ── STEP 6: Create SALE ITEMS table ─────────────────────────

CREATE TABLE IF NOT EXISTS sale_items (
  id         SERIAL PRIMARY KEY,
  sale_id    INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id),
  quantity   INTEGER       NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2)
);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2);
UPDATE sale_items SET total_price = unit_price * quantity WHERE total_price IS NULL;

-- ── STEP 7: Create STOCK TRANSFERS table ────────────────────

CREATE TABLE IF NOT EXISTS stock_transfers (
  id             SERIAL PRIMARY KEY,
  from_branch_id INTEGER REFERENCES branches(id),
  to_branch_id   INTEGER REFERENCES branches(id),
  variant_id     INTEGER REFERENCES product_variants(id),
  quantity       INTEGER NOT NULL,
  status         VARCHAR(20) DEFAULT 'pending',
  note           TEXT,
  created_by     INTEGER,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── STEP 8: Ensure roles exist ───────────────────────────────

INSERT INTO roles (role_name)
  SELECT 'Owner'   WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Owner');
INSERT INTO roles (role_name)
  SELECT 'Manager' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Manager');
INSERT INTO roles (role_name)
  SELECT 'Cashier' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Cashier');

-- ── STEP 9: Seed discounts ───────────────────────────────────

INSERT INTO discounts (name, type, value, min_amount, is_active)
  SELECT '10% Off', 'percentage', 10, 0, true
  WHERE NOT EXISTS (SELECT 1 FROM discounts WHERE name = '10% Off');

INSERT INTO discounts (name, type, value, min_amount, is_active)
  SELECT '20% Off', 'percentage', 20, 5000, true
  WHERE NOT EXISTS (SELECT 1 FROM discounts WHERE name = '20% Off');

INSERT INTO discounts (name, type, value, min_amount, is_active)
  SELECT 'LKR 500 Off', 'fixed', 500, 2000, true
  WHERE NOT EXISTS (SELECT 1 FROM discounts WHERE name = 'LKR 500 Off');

INSERT INTO discounts (name, type, value, min_amount, is_active)
  SELECT 'LKR 1000 Off', 'fixed', 1000, 5000, true
  WHERE NOT EXISTS (SELECT 1 FROM discounts WHERE name = 'LKR 1000 Off');

-- ── STEP 10: Fix/create user accounts ───────────────────────

-- Add missing columns on users
UPDATE users SET is_active = true WHERE is_active IS NULL;

-- Fix owner account (password: admin123)
UPDATE users
SET
  password_hash = '$2b$10$asw4j.p.DeecKeKkqMYiEuSCgoJB9lTUQLDoHbwOPHKlV52WzUNBu',
  role_id       = (SELECT id FROM roles WHERE role_name = 'Owner' LIMIT 1),
  is_active     = true
WHERE username = 'owner';

-- Create manager1 (password: manager123)
INSERT INTO users (username, password_hash, full_name, role_id, branch_id, is_active)
SELECT 'manager1',
       '$2b$10$joknH0/pthLKh9pOQVXkuutqUQPNNLciCAM6t/Iyn5ir2/0VGjRma',
       'Branch Manager',
       (SELECT id FROM roles WHERE role_name = 'Manager' LIMIT 1),
       1, true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'manager1');

UPDATE users
SET password_hash = '$2b$10$joknH0/pthLKh9pOQVXkuutqUQPNNLciCAM6t/Iyn5ir2/0VGjRma',
    role_id       = (SELECT id FROM roles WHERE role_name = 'Manager' LIMIT 1),
    is_active     = true
WHERE username = 'manager1';

-- Create cashier1 (password: cashier123)
INSERT INTO users (username, password_hash, full_name, role_id, branch_id, is_active)
SELECT 'cashier1',
       '$2b$10$f07HU8pHYvs1UyyfSTQKHu5IBNzIQYmV.IP8POLuq5JJTm4Qw1TD6',
       'Kasun Perera',
       (SELECT id FROM roles WHERE role_name = 'Cashier' LIMIT 1),
       1, true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'cashier1');

UPDATE users
SET password_hash = '$2b$10$f07HU8pHYvs1UyyfSTQKHu5IBNzIQYmV.IP8POLuq5JJTm4Qw1TD6',
    role_id       = (SELECT id FROM roles WHERE role_name = 'Cashier' LIMIT 1),
    is_active     = true
WHERE username = 'cashier1';

-- ── VERIFY ───────────────────────────────────────────────────

SELECT '=== TABLES ===' AS info;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT '=== USERS ===' AS info;
SELECT u.username, r.role_name, b.branch_name, u.is_active
FROM users u
JOIN roles r ON u.role_id = r.id
LEFT JOIN branches b ON u.branch_id = b.id
ORDER BY r.id, u.username;

SELECT '=== DISCOUNTS ===' AS info;
SELECT name, type, value FROM discounts WHERE is_active = true;
