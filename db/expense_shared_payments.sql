-- Run once against the same PostgreSQL database used by AlonSpace.
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS shared_group_id BIGINT;
CREATE INDEX IF NOT EXISTS expense_payments_shared_group_idx
ON expense_payments(shared_group_id) WHERE shared_group_id IS NOT NULL;
