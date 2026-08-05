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