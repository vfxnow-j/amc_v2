-- Only a correction (a row pointing at the movement it fixes) may carry quantity 0 or less.
-- Every other movement moves at least one unit of gear.
ALTER TABLE "Movement" ADD CONSTRAINT movement_quantity_check CHECK (quantity > 0 OR "correctsId" IS NOT NULL);
