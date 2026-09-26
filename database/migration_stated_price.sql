-- Add stated_price (original/market price) to product_variants
-- stated_price = what the item is originally priced / market price shown on label
-- variant_price = our actual selling price used for billing
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS stated_price DECIMAL(10,2);
