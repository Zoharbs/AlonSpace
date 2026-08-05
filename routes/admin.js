const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session?.userId && req.session?.userRole === 'admin') {
    return next();
  }

  return res.redirect('/login');
}

function normalizeOptional(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parsePositiveNumber(value, fallback = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

router.use(requireAdmin);

router.get('/', (req, res) => {
  const clients = db.prepare(`
    SELECT
      id,
      username,
      email,
      display_name,
      phone,
      business_name,
      office_number,
      floor,
      rental_start_date,
      rental_end_date,
      monthly_meeting_hours,
      is_active,
      must_change_password,
      created_at
    FROM users
    WHERE role = 'tenant'
    ORDER BY is_active DESC, display_name COLLATE NOCASE ASC
  `).all();

  const messages = db
    .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100')
    .all();

  const testimonials = db
    .prepare('SELECT * FROM testimonials ORDER BY created_at DESC')
    .all();

  const meetingBookings = db.prepare(`
    SELECT
      mb.*,
      u.display_name,
      u.business_name,
      u.office_number,
      u.floor
    FROM meeting_bookings mb
    JOIN users u ON u.id = mb.user_id
    ORDER BY mb.booking_date DESC, mb.start_time DESC
    LIMIT 200
  `).all();

  const stats = {
    activeClients: db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'tenant' AND is_active = 1`)
      .get().c,
    upcomingMeetings: db
      .prepare(`
        SELECT COUNT(*) AS c
        FROM meeting_bookings
        WHERE datetime(booking_date || ' ' || start_time) >= datetime('now', 'localtime')
      `)
      .get().c,
    unreadMessages: db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE is_read = 0')
      .get().c,
    pendingTestimonials: db
      .prepare(`SELECT COUNT(*) AS c FROM testimonials WHERE status = 'ממתין'`)
      .get().c,
  };

  return res.render('admin/dashboard', {
    title: 'פאנל ניהול — AlonSpace',
    layout: false,
    adminName: req.session.userName,
    clients,
    messages,
    testimonials,
    meetingBookings,
    stats,
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

router.post('/clients/create', (req, res) => {
  const {
    username,
    password,
    display_name,
    email,
    phone,
    business_name,
    office_number,
    floor,
    rental_start_date,
    rental_end_date,
    monthly_meeting_hours,
  } = req.body;

  const cleanUsername = String(username || '').trim();
  const cleanPassword = String(password || '');
  const cleanDisplayName = String(display_name || '').trim();

  if (!cleanUsername || cleanPassword.length < 8 || !cleanDisplayName) {
    return res.redirect(
      '/admin?error=' +
        encodeURIComponent('יש למלא שם משתמש, שם תצוגה וסיסמה של לפחות 8 תווים') +
        '#clients'
    );
  }

  const duplicate = db
    .prepare('SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)')
    .get(cleanUsername, normalizeOptional(email));

  if (duplicate) {
    return res.redirect(
      '/admin?error=' +
        encodeURIComponent('שם המשתמש או האימייל כבר קיימים במערכת') +
        '#clients'
    );
  }

  const passwordHash = bcrypt.hashSync(cleanPassword, 12);

  db.prepare(`
    INSERT INTO users (
      username,
      email,
      password_hash,
      display_name,
      role,
      phone,
      business_name,
      office_number,
      floor,
      rental_start_date,
      rental_end_date,
      monthly_meeting_hours,
      is_active,
      must_change_password
    )
    VALUES (?, ?, ?, ?, 'tenant', ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `).run(
    cleanUsername,
    normalizeOptional(email),
    passwordHash,
    cleanDisplayName,
    normalizeOptional(phone),
    normalizeOptional(business_name),
    normalizeOptional(office_number),
    normalizeOptional(floor),
    normalizeOptional(rental_start_date),
    normalizeOptional(rental_end_date),
    parsePositiveNumber(monthly_meeting_hours, 6)
  );

  return res.redirect(
    '/admin?success=' + encodeURIComponent('חשבון הלקוח נוצר בהצלחה') + '#clients'
  );
});

router.post('/clients/:id/update', (req, res) => {
  const {
    display_name,
    email,
    phone,
    business_name,
    office_number,
    floor,
    rental_start_date,
    rental_end_date,
    monthly_meeting_hours,
    is_active,
  } = req.body;

  const client = db
    .prepare(`SELECT id FROM users WHERE id = ? AND role = 'tenant'`)
    .get(req.params.id);

  if (!client) {
    return res.redirect('/admin?error=' + encodeURIComponent('הלקוח לא נמצא') + '#clients');
  }

  db.prepare(`
    UPDATE users
    SET
      display_name = ?,
      email = ?,
      phone = ?,
      business_name = ?,
      office_number = ?,
      floor = ?,
      rental_start_date = ?,
      rental_end_date = ?,
      monthly_meeting_hours = ?,
      is_active = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'tenant'
  `).run(
    String(display_name || '').trim(),
    normalizeOptional(email),
    normalizeOptional(phone),
    normalizeOptional(business_name),
    normalizeOptional(office_number),
    normalizeOptional(floor),
    normalizeOptional(rental_start_date),
    normalizeOptional(rental_end_date),
    parsePositiveNumber(monthly_meeting_hours, 6),
    is_active ? 1 : 0,
    req.params.id
  );

  return res.redirect(
    '/admin?success=' + encodeURIComponent('פרטי הלקוח עודכנו') + '#clients'
  );
});

router.post('/clients/:id/reset-password', (req, res) => {
  const newPassword = String(req.body.new_password || '');

  if (newPassword.length < 8) {
    return res.redirect(
      '/admin?error=' +
        encodeURIComponent('הסיסמה החדשה חייבת להכיל לפחות 8 תווים') +
        '#clients'
    );
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);

  const result = db.prepare(`
    UPDATE users
    SET
      password_hash = ?,
      must_change_password = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'tenant'
  `).run(passwordHash, req.params.id);

  if (!result.changes) {
    return res.redirect('/admin?error=' + encodeURIComponent('הלקוח לא נמצא') + '#clients');
  }

  return res.redirect(
    '/admin?success=' + encodeURIComponent('הסיסמה אופסה בהצלחה') + '#clients'
  );
});

router.post('/clients/:id/delete', (req, res) => {
  const result = db.prepare(`
    UPDATE users
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'tenant'
  `).run(req.params.id);

  if (!result.changes) {
    return res.redirect('/admin?error=' + encodeURIComponent('הלקוח לא נמצא') + '#clients');
  }

  return res.redirect(
    '/admin?success=' + encodeURIComponent('החשבון הושבת') + '#clients'
  );
});

router.post('/meeting-bookings/:id/delete', (req, res) => {
  db.prepare('DELETE FROM meeting_bookings WHERE id = ?').run(req.params.id);

  return res.redirect(
    '/admin?success=' + encodeURIComponent('השריון נמחק') + '#meeting-room'
  );
});

router.post('/messages/:id/read', (req, res) => {
  db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(req.params.id);
  return res.redirect('/admin#messages');
});

router.post('/messages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  return res.redirect('/admin#messages');
});

router.post('/testimonials/:id/approve', (req, res) => {
  db.prepare(`UPDATE testimonials SET status = 'מאושר' WHERE id = ?`).run(req.params.id);
  return res.redirect('/admin#testimonials');
});

router.post('/testimonials/:id/reject', (req, res) => {
  db.prepare(`UPDATE testimonials SET status = 'נדחה' WHERE id = ?`).run(req.params.id);
  return res.redirect('/admin#testimonials');
});

router.post('/testimonials/:id/delete', (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(req.params.id);
  return res.redirect('/admin#testimonials');
});

module.exports = router;
