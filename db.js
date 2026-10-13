const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      content TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 5
        CHECK (rating BETWEEN 1 AND 5),
      status TEXT NOT NULL DEFAULT 'ממתין',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gallery (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      alt TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,

      role TEXT NOT NULL DEFAULT 'tenant'
        CHECK (role IN ('admin', 'tenant')),

      phone TEXT,
      business_name TEXT,
      office_number TEXT,
      floor INTEGER,

      rental_start_date DATE,
      rental_end_date DATE,

      monthly_meeting_hours NUMERIC(5, 2) NOT NULL DEFAULT 6
        CHECK (monthly_meeting_hours > 0),

      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS meeting_bookings (
      id BIGSERIAL PRIMARY KEY,

      user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      booking_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      note TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (end_time > start_time)
    );

    CREATE INDEX IF NOT EXISTS idx_meeting_bookings_date
      ON meeting_bookings (
        booking_date,
        start_time,
        end_time
      );

    CREATE INDEX IF NOT EXISTS idx_meeting_bookings_user_date
      ON meeting_bookings (
        user_id,
        booking_date
      );

      
  `);
await query(`
  CREATE TABLE IF NOT EXISTS meeting_rooms (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    floor INTEGER NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await query(`
  CREATE TABLE IF NOT EXISTS floor_directory_overrides (
    id BIGSERIAL PRIMARY KEY,
    floor INTEGER NOT NULL,
    office_number INTEGER NOT NULL,
    directory_name TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (floor, office_number)
  )
`);
await query(`
  INSERT INTO meeting_rooms (name, floor)
  VALUES
    ('חדר ישיבות קומה 4', 4),
    ('חדר ישיבות קומה 6', 6)
  ON CONFLICT (floor) DO NOTHING;
`);

await query(`
  ALTER TABLE meeting_bookings
  ADD COLUMN IF NOT EXISTS meeting_room_id BIGINT;
`);

await query(`
  UPDATE meeting_bookings mb
  SET meeting_room_id = mr.id
  FROM users u
  JOIN meeting_rooms mr
    ON mr.floor = u.floor
  WHERE
    mb.user_id = u.id
    AND mb.meeting_room_id IS NULL;
`);
await query(`
ALTER TABLE users
ADD COLUMN IF NOT EXISTS magic_login_token_hash TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS magic_login_expires_at TIMESTAMP;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS magic_login_used_at TIMESTAMP;
`);
await query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'meeting_bookings_room_fk'
    ) THEN
      ALTER TABLE meeting_bookings
      ADD CONSTRAINT meeting_bookings_room_fk
      FOREIGN KEY (meeting_room_id)
      REFERENCES meeting_rooms(id);
    END IF;
  END
  $$;
`);

await query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM meeting_bookings
      WHERE meeting_room_id IS NULL
    ) THEN
      ALTER TABLE meeting_bookings
      ALTER COLUMN meeting_room_id SET NOT NULL;
    END IF;
  END
  $$;
`);
await query(`
  ALTER TABLE users
ADD COLUMN IF NOT EXISTS meeting_quota_warning_month VARCHAR(7);

ALTER TABLE meeting_bookings
ADD COLUMN IF NOT EXISTS billing_status VARCHAR(20) DEFAULT 'included';
`);
// =====================================================
// מעקב אחרי מי יצר את השריון
// =====================================================

await query(`
  ALTER TABLE meeting_bookings
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;

  ALTER TABLE meeting_bookings
  ADD COLUMN IF NOT EXISTS booking_source VARCHAR(20);
`);

// שריונים ישנים נחשבים כאילו נוצרו על ידי הלקוח עצמו.
// כך אנחנו לא משאירים נתונים ישנים ללא מקור.
await query(`
  UPDATE meeting_bookings
  SET
    created_by_user_id = user_id,
    booking_source = 'tenant'
  WHERE
    created_by_user_id IS NULL
    OR booking_source IS NULL;
`);

// Foreign key למשתמש שביצע בפועל את השריון
await query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'meeting_bookings_created_by_fk'
    ) THEN
      ALTER TABLE meeting_bookings
      ADD CONSTRAINT meeting_bookings_created_by_fk
      FOREIGN KEY (created_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
    END IF;
  END
  $$;
`);

// booking_source יכול להיות רק tenant או admin
await query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'meeting_bookings_source_check'
    ) THEN
      ALTER TABLE meeting_bookings
      ADD CONSTRAINT meeting_bookings_source_check
      CHECK (
        booking_source IN ('tenant', 'admin')
      );
    END IF;
  END
  $$;
`);

await query(`
  CREATE INDEX IF NOT EXISTS
    idx_meeting_bookings_created_by
  ON meeting_bookings(created_by_user_id);
`);
  // =====================================================
  // AlonSpace - Unit Owners
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_owners (
      id BIGSERIAL PRIMARY KEY,

      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // =====================================================
  // AlonSpace - Rental Units
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS rental_units (
      id BIGSERIAL PRIMARY KEY,

      floor INTEGER NOT NULL
        CHECK (floor IN (4, 6)),

      unit_number TEXT NOT NULL,

      ownership_type TEXT NOT NULL DEFAULT 'external'
        CHECK (ownership_type IN ('external', 'alonspace')),

      owner_id BIGINT
        REFERENCES unit_owners(id)
        ON DELETE RESTRICT,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (floor, unit_number)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_rental_units_owner
    ON rental_units(owner_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_rental_units_floor
    ON rental_units(floor, unit_number);
  `);

  // =====================================================
  // AlonSpace - Unit Tenancies
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_tenancies (
      id BIGSERIAL PRIMARY KEY,

      unit_id BIGINT NOT NULL
        REFERENCES rental_units(id)
        ON DELETE RESTRICT,

      rental_model TEXT NOT NULL
        CHECK (
          rental_model IN (
            'managed',
            'direct_owner',
            'alonspace_owned'
          )
        ),

      start_date DATE NOT NULL,
      end_date DATE,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (
        end_date IS NULL
        OR end_date >= start_date
      )
    );
  `);
await pool.query(`
  ALTER TABLE unit_tenancies
  ADD COLUMN IF NOT EXISTS notes TEXT
`);
  // =====================================================
  // AlonSpace - Tenancy Users
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_tenancy_users (
      id BIGSERIAL PRIMARY KEY,

      tenancy_id BIGINT NOT NULL
        REFERENCES unit_tenancies(id)
        ON DELETE CASCADE,

      user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

      tenant_role TEXT NOT NULL DEFAULT 'primary'
        CHECK (
          tenant_role IN ('primary', 'partner')
        ),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (tenancy_id, user_id)
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_unit_tenancy_one_primary
    ON unit_tenancy_users(tenancy_id)
    WHERE tenant_role = 'primary';
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_tenancies_unit_dates
    ON unit_tenancies(unit_id, start_date, end_date);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_tenancy_users_user
    ON unit_tenancy_users(user_id);
  `);

  // =====================================================
  // AlonSpace - Unit Management Fee Rates
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_management_fee_rates (
      id BIGSERIAL PRIMARY KEY,

      unit_id BIGINT NOT NULL
        REFERENCES rental_units(id)
        ON DELETE RESTRICT,

      monthly_amount NUMERIC(12, 2) NOT NULL
        CHECK (monthly_amount >= 0),

      effective_from DATE NOT NULL,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (unit_id, effective_from)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_management_fee_rates_lookup
    ON unit_management_fee_rates (
      unit_id,
      effective_from DESC
    );
  `);

  // =====================================================
  // AlonSpace - Unit Rent Rates
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_rent_rates (
      id BIGSERIAL PRIMARY KEY,

      tenancy_id BIGINT NOT NULL
        REFERENCES unit_tenancies(id)
        ON DELETE RESTRICT,

      monthly_rent NUMERIC(12, 2) NOT NULL
        CHECK (monthly_rent >= 0),

      monthly_owner_payout NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (monthly_owner_payout >= 0),

      effective_from DATE NOT NULL,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (tenancy_id, effective_from)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_rent_rates_lookup
    ON unit_rent_rates (
      tenancy_id,
      effective_from DESC
    );
  `);

  // =====================================================
  // AlonSpace - Unit Financial Entries
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_financial_entries (
      id BIGSERIAL PRIMARY KEY,

      unit_id BIGINT NOT NULL
        REFERENCES rental_units(id)
        ON DELETE RESTRICT,

      tenancy_id BIGINT
        REFERENCES unit_tenancies(id)
        ON DELETE RESTRICT,

      entry_type TEXT NOT NULL
        CHECK (
          entry_type IN (
            'rent_income',
            'management_fee_income',
            'owner_payout',
            'operating_expense',
            'other_income',
            'other_expense'
          )
        ),

      category TEXT,

      description TEXT,

      amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),

      period_month DATE NOT NULL,

      due_date DATE,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (
        period_month =
        DATE_TRUNC('month', period_month)::DATE
      )
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_entries_unit_month
    ON unit_financial_entries (
      unit_id,
      period_month
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_entries_type
    ON unit_financial_entries (
      entry_type
    );
  `);

  await seedAdmin();
  await seedGallery();
  await seedTestimonials();  // =====================================================
  // AlonSpace - Unit Financial Entries
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_financial_entries (
      id BIGSERIAL PRIMARY KEY,

      unit_id BIGINT NOT NULL
        REFERENCES rental_units(id)
        ON DELETE RESTRICT,

      tenancy_id BIGINT
        REFERENCES unit_tenancies(id)
        ON DELETE RESTRICT,

      entry_type TEXT NOT NULL
        CHECK (
          entry_type IN (
            'rent_income',
            'management_fee_income',
            'owner_payout',
            'operating_expense',
            'other_income',
            'other_expense'
          )
        ),

      category TEXT,

      description TEXT,

      amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),

      period_month DATE NOT NULL,

      due_date DATE,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (
        period_month =
        DATE_TRUNC('month', period_month)::DATE
      )
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_entries_unit_month
    ON unit_financial_entries (
      unit_id,
      period_month
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_entries_type
    ON unit_financial_entries (
      entry_type
    );
  `);
  // =====================================================
  // AlonSpace - Financial Payments
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_financial_payments (
      id BIGSERIAL PRIMARY KEY,

      entry_id BIGINT NOT NULL
        REFERENCES unit_financial_entries(id)
        ON DELETE RESTRICT,

      amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),

      payment_date DATE NOT NULL,

      payment_method TEXT NOT NULL DEFAULT 'bank_transfer'
        CHECK (
          payment_method IN (
            'bank_transfer',
            'cash',
            'check',
            'credit_card',
            'other'
          )
        ),

      reference_number TEXT,
      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // =====================================================
  // AlonSpace - Owner Management Fee Offsets
  // =====================================================

  await query(`
    CREATE TABLE IF NOT EXISTS unit_financial_offsets (
      id BIGSERIAL PRIMARY KEY,

      management_fee_entry_id BIGINT NOT NULL
        REFERENCES unit_financial_entries(id)
        ON DELETE RESTRICT,

      owner_payout_entry_id BIGINT NOT NULL
        REFERENCES unit_financial_entries(id)
        ON DELETE RESTRICT,

      amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),

      offset_date DATE NOT NULL,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (
        management_fee_entry_id <> owner_payout_entry_id
      )
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_payments_entry
    ON unit_financial_payments(entry_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_offsets_management
    ON unit_financial_offsets(management_fee_entry_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS
      idx_unit_financial_offsets_payout
    ON unit_financial_offsets(owner_payout_entry_id);
  `);

  await seedAdmin();
  await seedGallery();
  await seedTestimonials();
}

async function seedAdmin() {
  const existingAdmin = await query(`
    SELECT id
    FROM users
    WHERE role = 'admin'
    LIMIT 1
  `);

  if (existingAdmin.rows.length > 0) {
    return;
  }

  const username = String(
    process.env.ADMIN_USERNAME || 'admin'
  ).trim();

  const password = String(
    process.env.ADMIN_PASSWORD || ''
  );

  if (!password || password.length < 12) {
    throw new Error(
      'ADMIN_PASSWORD must be configured and contain at least 12 characters'
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await query(
    `
      INSERT INTO users (
        username,
        password_hash,
        display_name,
        role,
        is_active,
        must_change_password
      )
      VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
    `,
    [
      username,
      passwordHash,
      username,
    ]
  );

  console.log(`[seed] Admin created: ${username}`);
}

async function seedGallery() {
  const result = await query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM gallery
  `);

  if (result.rows[0].count > 0) {
    return;
  }

  const images = [
    ['/images/1.jpeg', 'משרד פרטי מאובזר ב-AlonSpace'],
    ['/images/2.jpg', 'חלל העבודה במגדלי אלון'],
    ['/images/3.jpeg', 'המתחם של AlonSpace'],
    ['/images/4.jpeg', 'נוף ממגדלי אלון'],
    ['/images/5.jpeg', 'חדר ישיבות מרוהט'],
    ['/images/6.jpeg', 'פינת ישיבה נעימה'],
    ['/images/7.jpeg', 'מטבחון מאובזר'],
    ['/images/8.jpeg', 'משרד פרטי בעיצוב מודרני'],
    ['/images/9.jpeg', 'אזור עבודה שקט'],
    ['/images/10.jpeg', 'לובי הכניסה'],
    ['/images/11.jpeg', 'חלל עבודה משותף'],
    ['/images/12.jpeg', 'עמדת עבודה מאובזרת'],
    ['/images/13.jpeg', 'תאורה טבעית במשרד'],
    ['/images/14.jpeg', 'משרד עם נוף לעיר'],
    ['/images/15.jpeg', 'חדר כושר במתחם'],
  ];

  for (let index = 0; index < images.length; index += 1) {
    const [url, alt] = images[index];

    await query(
      `
        INSERT INTO gallery (
          url,
          alt,
          sort_order
        )
        VALUES ($1, $2, $3)
      `,
      [url, alt, index]
    );
  }

  console.log('[seed] Gallery created.');
}

async function seedTestimonials() {
  const result = await query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM testimonials
  `);

  if (result.rows[0].count > 0) {
    return;
  }

  const testimonials = [
    [
      'משה',
      'בניית אתרים',
      'לא חשבתי שאמצא משרד בתל אביב בלי חוזה ל-12 חודשים. פה מצאתי פרטיות, שקט ושירות מעולה.',
      5,
    ],
    [
      'מיכל',
      'מפתחת תוכנה',
      'איזה כיף למצוא מקום קרוב לבית אבל שקט, ללא ילדים על הראש. בדיוק מה שהייתי צריכה כדי להתרכז.',
      5,
    ],
    [
      'רועי',
      'יועץ עסקי',
      'החוזה החודשי הגמיש נתן לי בדיוק את השקט הנפשי שחיפשתי. גדלתי מהמשרד הקטן לגדול תוך חודשיים בלי כאב ראש.',
      5,
    ],
  ];

  for (const testimonial of testimonials) {
    const [name, role, content, rating] = testimonial;

    await query(
      `
        INSERT INTO testimonials (
          name,
          role,
          content,
          rating,
          status
        )
        VALUES ($1, $2, $3, $4, 'מאושר')
      `,
      [name, role, content, rating]
    );
  }

  console.log('[seed] Testimonials created.');
}

module.exports = {
  pool,
  query,
  initializeDatabase,
};