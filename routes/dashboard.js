const express = require('express');
const db = require('../db');

const router = express.Router();

function requireTenant(req, res, next) {
  if (req.session?.userId && req.session?.userRole === 'tenant') {
    return next();
  }

  return res.redirect('/login');
}

function minutesFromTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

function getMonthKey(dateValue) {
  return String(dateValue || '').slice(0, 7);
}

function getUsedHours(userId, monthKey) {
  const bookings = db.prepare(`
    SELECT start_time, end_time
    FROM meeting_bookings
    WHERE user_id = ?
      AND substr(booking_date, 1, 7) = ?
  `).all(userId, monthKey);

  const usedMinutes = bookings.reduce((total, booking) => {
    const start = minutesFromTime(booking.start_time);
    const end = minutesFromTime(booking.end_time);

    if (start === null || end === null || end <= start) return total;
    return total + (end - start);
  }, 0);

  return usedMinutes / 60;
}

router.use(requireTenant);

router.get('/', (req, res) => {
  const user = db.prepare(`
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
      must_change_password
    FROM users
    WHERE id = ? AND role = 'tenant' AND is_active = 1
  `).get(req.session.userId);

  if (!user) {
    return req.session.destroy(() => res.redirect('/login'));
  }

  const monthKey = new Date().toISOString().slice(0, 7);
  const usedHours = getUsedHours(user.id, monthKey);
  const remainingHours = Math.max(
    0,
    Number(user.monthly_meeting_hours || 6) - usedHours
  );

  const meetingBookings = db.prepare(`
    SELECT
      mb.*,
      u.display_name,
      u.business_name,
      u.office_number,
      u.floor,
      CASE WHEN mb.user_id = ? THEN 1 ELSE 0 END AS is_mine
    FROM meeting_bookings mb
    JOIN users u ON u.id = mb.user_id
    WHERE mb.booking_date >= date('now', 'localtime')
    ORDER BY mb.booking_date ASC, mb.start_time ASC
    LIMIT 200
  `).all(user.id);

  return res.render('dashboard', {
    title: 'האזור האישי — AlonSpace',
    user,
    usedHours,
    remainingHours,
    meetingBookings,
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

router.post('/meeting-bookings/create', (req, res) => {
  const user = db.prepare(`
    SELECT id, monthly_meeting_hours
    FROM users
    WHERE id = ? AND role = 'tenant' AND is_active = 1
  `).get(req.session.userId);

  if (!user) {
    return res.redirect('/login');
  }

  const bookingDate = String(req.body.booking_date || '');
  const startTime = String(req.body.start_time || '');
  const endTime = String(req.body.end_time || '');
  const note = String(req.body.note || '').trim();

  const startMinutes = minutesFromTime(startTime);
  const endMinutes = minutesFromTime(endTime);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
    startMinutes === null ||
    endMinutes === null ||
    endMinutes <= startMinutes
  ) {
    return res.redirect(
      '/dashboard?error=' + encodeURIComponent('נא לבחור תאריך וטווח שעות תקינים')
    );
  }

  const requestedStart = new Date(`${bookingDate}T${startTime}:00`);
  if (Number.isNaN(requestedStart.getTime()) || requestedStart <= new Date()) {
    return res.redirect(
      '/dashboard?error=' + encodeURIComponent('אפשר לשריין רק זמן עתידי')
    );
  }

  const conflict = db.prepare(`
    SELECT id
    FROM meeting_bookings
    WHERE booking_date = ?
      AND start_time < ?
      AND end_time > ?
    LIMIT 1
  `).get(bookingDate, endTime, startTime);

  if (conflict) {
    return res.redirect(
      '/dashboard?error=' + encodeURIComponent('החדר כבר משוריין בטווח שנבחר')
    );
  }

  const monthKey = getMonthKey(bookingDate);
  const usedHours = getUsedHours(user.id, monthKey);
  const requestedHours = (endMinutes - startMinutes) / 60;
  const limit = Number(user.monthly_meeting_hours || 6);

  if (usedHours + requestedHours > limit) {
    return res.redirect(
      '/dashboard?error=' +
        encodeURIComponent(`השריון חורג ממכסת ${limit} השעות החודשית`)
    );
  }

  db.prepare(`
    INSERT INTO meeting_bookings (
      user_id,
      booking_date,
      start_time,
      end_time,
      note
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, bookingDate, startTime, endTime, note || null);

  return res.redirect(
    '/dashboard?success=' + encodeURIComponent('חדר הישיבות שוריין בהצלחה')
  );
});

router.post('/meeting-bookings/:id/delete', (req, res) => {
  const booking = db.prepare(`
    SELECT id
    FROM meeting_bookings
    WHERE id = ?
      AND user_id = ?
      AND datetime(booking_date || ' ' || start_time) > datetime('now', 'localtime')
  `).get(req.params.id, req.session.userId);

  if (!booking) {
    return res.redirect(
      '/dashboard?error=' +
        encodeURIComponent('לא ניתן לבטל את השריון הזה')
    );
  }

  db.prepare('DELETE FROM meeting_bookings WHERE id = ?').run(booking.id);

  return res.redirect(
    '/dashboard?success=' + encodeURIComponent('השריון בוטל')
  );
});

module.exports = router;
