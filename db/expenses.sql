BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_expenses BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS expense_categories (
 id BIGSERIAL PRIMARY KEY, floor INTEGER NOT NULL CHECK(floor IN (4,6)), name TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'regular' CHECK(kind IN ('regular','electricity','arnona')),
 default_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(default_amount>=0),
 is_active BOOLEAN NOT NULL DEFAULT TRUE, sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(floor,name)
);
CREATE TABLE IF NOT EXISTS expense_payments (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES expense_categories(id),
 total_amount NUMERIC(12,2) NOT NULL CHECK(total_amount>0),
 status TEXT NOT NULL CHECK(status IN ('estimated','paid')),
 period_start DATE, period_end DATE, payment_date DATE,
 created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 cancelled_at TIMESTAMPTZ,
 CHECK(period_end IS NULL OR period_start IS NOT NULL),
 CHECK(period_end IS NULL OR period_end >= period_start)
);
CREATE TABLE IF NOT EXISTS expense_entries (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES expense_categories(id),
 month DATE NOT NULL, estimated_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(estimated_amount>=0),
 actual_amount NUMERIC(12,2) CHECK(actual_amount>=0),
 status TEXT NOT NULL DEFAULT 'estimated' CHECK(status IN ('estimated','paid')),
 payment_id BIGINT REFERENCES expense_payments(id), updated_by BIGINT REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(category_id,month),
 CHECK(EXTRACT(DAY FROM month)=1),
 CHECK(status <> 'paid' OR actual_amount IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS expense_audit (
 id BIGSERIAL PRIMARY KEY, entry_id BIGINT REFERENCES expense_entries(id),
 user_id BIGINT REFERENCES users(id), action TEXT NOT NULL,
 old_value JSONB, new_value JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS expense_entries_month_idx ON expense_entries(month);
CREATE INDEX IF NOT EXISTS expense_audit_entry_idx ON expense_audit(entry_id,created_at DESC);
COMMIT;
