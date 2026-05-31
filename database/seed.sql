-- ============================================================
-- Teen Girl POS — Seed Data
-- Run AFTER schema.sql
-- Default owner password: admin123  (change after first login!)
-- ============================================================

-- Default Branch
INSERT INTO branches (id, branch_name, address, phone)
VALUES (1, 'Main Branch', 'Colombo', '+94 11 000 0000')
ON CONFLICT (id) DO NOTHING;

-- Roles
INSERT INTO roles (id, role_name) VALUES (1,'Owner'),(2,'Manager'),(3,'Cashier') ON CONFLICT DO NOTHING;

-- Owner account (password: admin123)
INSERT INTO users (username, password_hash, full_name, role_id, branch_id)
VALUES (
  'owner',
  '$2b$10$SHNGuRqjvEbR0mRX07OG../FDgeN3FUzdhTZqu.NTNKzTTi/CQgIS',
  'Shop Owner',
  1,
  1
) ON CONFLICT (username) DO NOTHING;

-- Sample discounts
INSERT INTO discounts (name, type, value, min_amount, is_active) VALUES
  ('10% Off', 'percentage', 10, 0, true),
  ('20% Off', 'percentage', 20, 5000, true),
  ('LKR 500 Off', 'fixed', 500, 2000, true),
  ('LKR 1000 Off', 'fixed', 1000, 5000, true)
ON CONFLICT DO NOTHING;
