-- ============================================================
-- Teen Girl POS — Fix users & create test accounts
-- Run this in pgAdmin Query Tool
-- ============================================================

-- 1. Add missing columns to users table safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name   VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id   INTEGER REFERENCES branches(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- 2. Set is_active = true for any existing users that have it null
UPDATE users SET is_active = true WHERE is_active IS NULL;

-- 3. Make sure Owner / Manager / Cashier roles exist
INSERT INTO roles (role_name)
  SELECT 'Owner'   WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Owner');
INSERT INTO roles (role_name)
  SELECT 'Manager' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Manager');
INSERT INTO roles (role_name)
  SELECT 'Cashier' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'Cashier');

-- 4. Fix the 'owner' account — assign Owner role, update hash (password: admin123)
UPDATE users
SET
  password_hash = '$2b$10$asw4j.p.DeecKeKkqMYiEuSCgoJB9lTUQLDoHbwOPHKlV52WzUNBu',
  role_id       = (SELECT id FROM roles WHERE role_name = 'Owner' LIMIT 1),
  full_name     = COALESCE(full_name, 'Shop Owner'),
  is_active     = true
WHERE username = 'owner';

-- 5. Create Manager account (password: manager123)
INSERT INTO users (username, password_hash, full_name, role_id, branch_id, is_active)
SELECT
  'manager1',
  '$2b$10$joknH0/pthLKh9pOQVXkuutqUQPNNLciCAM6t/Iyn5ir2/0VGjRma',
  'Branch Manager',
  (SELECT id FROM roles WHERE role_name = 'Manager' LIMIT 1),
  1,
  true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'manager1');

-- Update if already exists
UPDATE users
SET
  password_hash = '$2b$10$joknH0/pthLKh9pOQVXkuutqUQPNNLciCAM6t/Iyn5ir2/0VGjRma',
  role_id       = (SELECT id FROM roles WHERE role_name = 'Manager' LIMIT 1),
  is_active     = true
WHERE username = 'manager1';

-- 6. Create Cashier account (password: cashier123)
INSERT INTO users (username, password_hash, full_name, role_id, branch_id, is_active)
SELECT
  'cashier1',
  '$2b$10$f07HU8pHYvs1UyyfSTQKHu5IBNzIQYmV.IP8POLuq5JJTm4Qw1TD6',
  'Kasun Perera',
  (SELECT id FROM roles WHERE role_name = 'Cashier' LIMIT 1),
  1,
  true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'cashier1');

-- Update if already exists
UPDATE users
SET
  password_hash = '$2b$10$f07HU8pHYvs1UyyfSTQKHu5IBNzIQYmV.IP8POLuq5JJTm4Qw1TD6',
  role_id       = (SELECT id FROM roles WHERE role_name = 'Cashier' LIMIT 1),
  is_active     = true
WHERE username = 'cashier1';

-- 7. Verify — shows all users with their roles
SELECT
  u.username,
  u.full_name,
  r.role_name,
  b.branch_name,
  u.is_active
FROM users u
JOIN roles r ON u.role_id = r.id
LEFT JOIN branches b ON u.branch_id = b.id
ORDER BY r.id, u.username;
