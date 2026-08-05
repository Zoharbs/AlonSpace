const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'alonspace.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  content TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'ממתין',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  alt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  rental_start_date TEXT,
  rental_end_date TEXT,
  monthly_meeting_hours REAL NOT NULL DEFAULT 6,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meeting_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_bookings_date
ON meeting_bookings (booking_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_meeting_bookings_user_month
ON meeting_bookings (user_id, booking_date);

-- טבלאות ישנות נשארות זמנית כדי לא למחוק מידע קיים.


CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  office_type TEXT,
  booking_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  message TEXT,
  status TEXT DEFAULT 'ממתין',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocked_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocked_date TEXT NOT NULL,
  time_slot TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS availability_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_type TEXT DEFAULT 'tour',
  office_number TEXT,
  floor INTEGER,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  office_number TEXT NOT NULL,
  floor INTEGER NOT NULL,
  title TEXT DEFAULT 'משרד',
  status TEXT DEFAULT 'פנוי',
  price_hour INTEGER,
  price_day INTEGER,
  price_week INTEGER,
  price_month INTEGER,
  price_year INTEGER,
  can_book_online INTEGER DEFAULT 0,
  tenant_display_name TEXT,
  tenant_description TEXT,
  show_tenant INTEGER DEFAULT 0,
  x REAL,
  y REAL,
  w REAL,
  h REAL,
  image_url TEXT,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS office_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  office_number TEXT NOT NULL,
  floor INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'ממתין',
  source TEXT DEFAULT 'site',
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function seedAdmin() {
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();

  if (existingAdmin) {
    return;
  }

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = bcrypt.hashSync(password, 12);

  db.prepare(`
    INSERT INTO users (
      username,
      password_hash,
      display_name,
      role,
      is_active,
      must_change_password
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    username,
    passwordHash,
    "Administrator",
    "admin",
    1,
    1
  );

  console.log(`[seed] Admin user created: ${username}`);
}

function seedGallery() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM gallery').get().c;
  if (count !== 0) return;

  const images = [
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-9.jpeg', 'משרד פרטי מאובזר ב-AlonSpace'],
    ['https://alonspace.co.il/wp-content/uploads/2025/07/Spacez_coworking-space_Alon_Towers_Tel_Aviv_image-2-970x650-1.jpg', 'חלל העבודה במגדלי אלון'],
    ['https://alonspace.co.il/wp-content/uploads/2025/07/SPacenter.co_.il-אלונספייס-AlonSpace-1.jpg', 'המתחם של AlonSpace'],
    ['https://alonspace.co.il/wp-content/uploads/2025/07/Spacez_coworking-space_Alon_Towers_Tel_Aviv_thumbnail-970x650-1.jpg', 'נוף ממגדלי אלון'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file8.jpeg', 'חדר ישיבות מרוהט'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file6.jpeg', 'פינת ישיבה נעימה'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file5.jpeg', 'מטבחון מאובזר'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file4.jpeg', 'משרד פרטי בעיצוב מודרני'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file.jpeg', 'אזור עבודה שקט'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-8.jpeg', 'לובי הכניסה'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file9.jpeg', 'חלל עבודה משותף'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file1.jpeg', 'עמדת עבודה מאובזרת'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file2.jpeg', 'תאורה טבעית במשרד'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file3.jpeg', 'משרד עם נוף לעיר'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file10.jpeg', 'חדר כושר במתחם'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-7.jpeg', 'אזור לאונג׳'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-6.jpeg', 'מסדרון המתחם'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-5.jpeg', 'משרד גדול לכמה עמדות'],
    ['https://alonspace.co.il/wp-content/uploads/2025/08/file-4.jpeg', 'פרטים ועיצוב'],
  ];

  const insert = db.prepare(
    'INSERT INTO gallery (url, alt, sort_order) VALUES (?, ?, ?)'
  );

  const seed = db.transaction(() => {
    images.forEach(([url, alt], index) => {
      insert.run(url, alt, index);
    });
  });

  seed();
}

function seedTestimonials() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM testimonials').get().c;
  if (count !== 0) return;

  const testimonials = [
    ['משה', 'בניית אתרים', 'לא חשבתי שאמצא משרד בתל אביב בלי חוזה ל-12 חודשים. פה מצאתי פרטיות, שקט ושירות מעולה.', 5],
    ['מיכל', 'מפתחת תוכנה', 'איזה כיף למצוא מקום קרוב לבית אבל שקט, ללא ילדים על הראש. בדיוק מה שהייתי צריכה כדי להתרכז.', 5],
    ['רועי', 'יועץ עסקי', 'החוזה החודשי הגמיש נתן לי בדיוק את השקט הנפשי שחיפשתי. גדלתי מהמשרד הקטן לגדול תוך חודשיים בלי כאב ראש.', 5],
  ];

  const insert = db.prepare(`
    INSERT INTO testimonials (name, role, content, rating, status)
    VALUES (?, ?, ?, ?, 'מאושר')
  `);

  const seed = db.transaction(() => {
    testimonials.forEach((testimonial) => {
      insert.run(...testimonial);
    });
  });

  seed();
}

seedAdmin();
seedGallery();
seedTestimonials();

module.exports = db;
