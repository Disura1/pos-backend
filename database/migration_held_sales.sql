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