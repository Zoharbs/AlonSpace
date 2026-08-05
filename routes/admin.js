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

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function adminRedirect(type, message, hash = 'clients') {
  return (
    `/admin?${type}=` +
    encodeURIComponent(message) +
    `#${hash}`
  );
}

router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const [
      clientsResult,
      messagesResult,
      testimonialsResult,
      meetingBookingsResult,
      activeClientsResult,
      upcomingMeetingsResult,
      unreadMessagesResult,
      pendingTestimonialsResult,
    ] = await Promise.all([
      db.query(`
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
        ORDER BY
          is_active DESC,
          LOWER(display_name) ASC
      `),

      db.query(`
        SELECT *
        FROM messages
        ORDER BY created_at DESC
        LIMIT 100
      `),

      db.query(`
        SELECT *
        FROM testimonials
        ORDER BY created_at DESC
      `),

      db.query(`
        SELECT
          mb.*,
          u.display_name,
          u.business_name,
          u.office_number,
          u.floor
        FROM meeting_bookings mb
        JOIN users u
          ON u.id = mb.user_id
        ORDER BY
          mb.booking_date DESC,
          mb.start_time DESC
        LIMIT 200
      `),

      db.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM users
        WHERE
          role = 'tenant'
          AND is_active = TRUE
      `),

      db.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM meeting_bookings
        WHERE
          booking_date > CURRENT_DATE
          OR (
            booking_date = CURRENT_DATE
            AND start_time >= CURRENT_TIME
          )
      `),

      db.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM messages
        WHERE is_read = FALSE
      `),

      db.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM testimonials
        WHERE status = 'ממתין'
      `),
    ]);

    const stats = {
      activeClients: activeClientsResult.rows[0].count,
      upcomingMeetings: upcomingMeetingsResult.rows[0].count,
      unreadMessages: unreadMessagesResult.rows[0].count,
      pendingTestimonials:
        pendingTestimonialsResult.rows[0].count,
    };

    return res.render('admin/dashboard', {
      title: 'פאנל ניהול — AlonSpace',
      layout: false,
      adminName: req.session.userName,
      clients: clientsResult.rows,
      messages: messagesResult.rows,
      testimonials: testimonialsResult.rows,
      meetingBookings: meetingBookingsResult.rows,
      stats,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/clients/create', async (req, res, next) => {
  try {
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
    const cleanDisplayName = String(
      display_name || ''
    ).trim();

    if (
      !cleanUsername ||
      cleanPassword.length < 8 ||
      !cleanDisplayName
    ) {
      return res.redirect(
        adminRedirect(
          'error',
          'יש למלא שם משתמש, שם תצוגה וסיסמה של לפחות 8 תווים'
        )
      );
    }

    const cleanEmail = normalizeOptional(email);

    const duplicateResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE
          username = $1
          OR (
            $2::TEXT IS NOT NULL
            AND email = $2
          )
        LIMIT 1
      `,
      [cleanUsername, cleanEmail]
    );

    if (duplicateResult.rows.length > 0) {
      return res.redirect(
        adminRedirect(
          'error',
          'שם המשתמש או האימייל כבר קיימים במערכת'
        )
      );
    }

    const passwordHash = await bcrypt.hash(
      cleanPassword,
      12
    );

    await db.query(
      `
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
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'tenant',
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          TRUE,
          TRUE
        )
      `,
      [
        cleanUsername,
        cleanEmail,
        passwordHash,
        cleanDisplayName,
        normalizeOptional(phone),
        normalizeOptional(business_name),
        normalizeOptional(office_number),
        normalizeOptional(floor),
        normalizeOptional(rental_start_date),
        normalizeOptional(rental_end_date),
        parsePositiveNumber(
          monthly_meeting_hours,
          6
        ),
      ]
    );

    return res.redirect(
      adminRedirect(
        'success',
        'חשבון הלקוח נוצר בהצלחה'
      )
    );
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(
        adminRedirect(
          'error',
          'שם המשתמש או האימייל כבר קיימים במערכת'
        )
      );
    }

    return next(error);
  }
});

router.post(
  '/clients/:id/update',
  async (req, res, next) => {
    try {
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

      const cleanDisplayName = String(
        display_name || ''
      ).trim();

      if (!cleanDisplayName) {
        return res.redirect(
          adminRedirect(
            'error',
            'שם התצוגה לא יכול להיות ריק'
          )
        );
      }

      const result = await db.query(
        `
          UPDATE users
          SET
            display_name = $1,
            email = $2,
            phone = $3,
            business_name = $4,
            office_number = $5,
            floor = $6,
            rental_start_date = $7,
            rental_end_date = $8,
            monthly_meeting_hours = $9,
            is_active = $10,
            updated_at = NOW()
          WHERE
            id = $11
            AND role = 'tenant'
          RETURNING id
        `,
        [
          cleanDisplayName,
          normalizeOptional(email),
          normalizeOptional(phone),
          normalizeOptional(business_name),
          normalizeOptional(office_number),
          normalizeOptional(floor),
          normalizeOptional(rental_start_date),
          normalizeOptional(rental_end_date),
          parsePositiveNumber(
            monthly_meeting_hours,
            6
          ),
          Boolean(is_active),
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.redirect(
          adminRedirect(
            'error',
            'הלקוח לא נמצא'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          'פרטי הלקוח עודכנו'
        )
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.redirect(
          adminRedirect(
            'error',
            'האימייל כבר שייך למשתמש אחר'
          )
        );
      }

      return next(error);
    }
  }
);

router.post(
  '/clients/:id/reset-password',
  async (req, res, next) => {
    try {
      const newPassword = String(
        req.body.new_password || ''
      );

      if (newPassword.length < 8) {
        return res.redirect(
          adminRedirect(
            'error',
            'הסיסמה החדשה חייבת להכיל לפחות 8 תווים'
          )
        );
      }

      const passwordHash = await bcrypt.hash(
        newPassword,
        12
      );

      const result = await db.query(
        `
          UPDATE users
          SET
            password_hash = $1,
            must_change_password = TRUE,
            updated_at = NOW()
          WHERE
            id = $2
            AND role = 'tenant'
          RETURNING id
        `,
        [passwordHash, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.redirect(
          adminRedirect(
            'error',
            'הלקוח לא נמצא'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          'הסיסמה אופסה בהצלחה'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/clients/:id/delete',
  async (req, res, next) => {
    try {
      const result = await db.query(
        `
          UPDATE users
          SET
            is_active = FALSE,
            updated_at = NOW()
          WHERE
            id = $1
            AND role = 'tenant'
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.redirect(
          adminRedirect(
            'error',
            'הלקוח לא נמצא'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          'החשבון הושבת'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/meeting-bookings/:id/delete',
  async (req, res, next) => {
    try {
      await db.query(
        `
          DELETE FROM meeting_bookings
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect(
        adminRedirect(
          'success',
          'השריון נמחק',
          'meeting-room'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/messages/:id/read',
  async (req, res, next) => {
    try {
      await db.query(
        `
          UPDATE messages
          SET is_read = TRUE
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect('/admin#messages');
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/messages/:id/delete',
  async (req, res, next) => {
    try {
      await db.query(
        `
          DELETE FROM messages
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect('/admin#messages');
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/testimonials/:id/approve',
  async (req, res, next) => {
    try {
      await db.query(
        `
          UPDATE testimonials
          SET status = 'מאושר'
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect('/admin#testimonials');
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/testimonials/:id/reject',
  async (req, res, next) => {
    try {
      await db.query(
        `
          UPDATE testimonials
          SET status = 'נדחה'
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect('/admin#testimonials');
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/testimonials/:id/delete',
  async (req, res, next) => {
    try {
      await db.query(
        `
          DELETE FROM testimonials
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.redirect('/admin#testimonials');
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;