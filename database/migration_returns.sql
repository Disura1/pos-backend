CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  original_sale_id INTEGER NOT NULL REFERENCES sales(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  processed_by INTEGER NOT NULL REFERENCES users(id),
  reason VARCHAR(255),
  refund_amount NUMERIC(10,2) NOT NULL,
  refund_method VARCHAR(20) DEFAULT 'cash',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_returns_branch ON returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);

ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_number VARCHAR(50);