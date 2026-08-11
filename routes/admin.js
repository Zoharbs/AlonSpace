const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (
    !req.session?.userId ||
    req.session?.userRole !== 'admin'
  ) {
    return res.redirect('/login');
  }


  return next();
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
      meetingRoomsResult,
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
    u.floor AS tenant_floor,
    mr.name AS meeting_room_name,
    mr.floor AS meeting_room_floor
  FROM meeting_bookings mb
  JOIN users u
    ON u.id = mb.user_id
  JOIN meeting_rooms mr
    ON mr.id = mb.meeting_room_id
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

      db.query(`
  SELECT
    id,
    name,
    floor
  FROM meeting_rooms
  WHERE is_active = TRUE
  ORDER BY floor ASC
`),
    ]);

    const stats = {
      activeClients: activeClientsResult.rows[0].count,
      upcomingMeetings: upcomingMeetingsResult.rows[0].count,
      unreadMessages: unreadMessagesResult.rows[0].count,
      pendingTestimonials:
        pendingTestimonialsResult.rows[0].count,
    };
    const newClientInvite =
      req.session.newClientInvite || null;

    // ההודעה והסיסמה זמינות להצגה פעם אחת בלבד
    delete req.session.newClientInvite;
    return res.render('admin/dashboard', {
      title: 'פאנל ניהול — AlonSpace',
      layout: false,
      adminName: req.session.userName,
      clients: clientsResult.rows,
      messages: messagesResult.rows,
      testimonials: testimonialsResult.rows,
      meetingBookings: meetingBookingsResult.rows,
      meetingRooms: meetingRoomsResult.rows,
      stats,
      error: req.query.error || null,
      success: req.query.success || null,
      newClientInvite,
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
    const cleanPassword =
      "Alon-" + Math.floor(10000 + Math.random() * 900000);
    const cleanDisplayName = String(
      display_name || ''
    ).trim();

    if (
      !cleanUsername ||
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

    const magicLoginToken =
  crypto.randomBytes(32).toString('hex');

const magicLoginTokenHash =
  crypto
    .createHash('sha256')
    .update(magicLoginToken)
    .digest('hex');

const magicLoginExpiresAt =
  new Date(Date.now() + 48 * 60 * 60 * 1000);

    const createResult = await db.query(
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
      must_change_password,

magic_login_token_hash,
magic_login_expires_at,
magic_login_used_at
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
      TRUE,
      $12,
      $13,
      NULL
    )
    RETURNING
      id,
      username,
      display_name,
      phone
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
        magicLoginTokenHash,
magicLoginExpiresAt,
      ]
    );

    const createdClient = createResult.rows[0];

req.session.newClientInvite = {
  userId: createdClient.id,
  displayName: createdClient.display_name,
  username: createdClient.username,
  temporaryPassword: cleanPassword,
  phone: createdClient.phone || null,
  magicLoginUrl:
    `https://alonspace.com/magic-login?token=${magicLoginToken}`,
};

    return req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.redirect(
        adminRedirect(
          'success',
          'חשבון הלקוח נוצר. הודעת ההתחברות מוכנה להעתקה.'
        )
      );
    });
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

router.post('/clients/:id/update',
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
          RETURNING
  id,
  username,
  display_name,
  phone
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
      const newPassword =
        "alon-" +
        Math.floor(1000 + Math.random() * 9000);

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
          RETURNING
  id,
  username,
  display_name,
  phone
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

      const client = result.rows[0];

      req.session.newClientInvite = {
        userId: client.id,
        displayName: client.display_name,
        username: client.username,
        temporaryPassword: newPassword,
        phone: client.phone || null,
      };

      return req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }

        return res.redirect(
          adminRedirect(
            'success',
            'הסיסמה אופסה. הודעת ההתחברות מוכנה להעתקה.'
          )
        );
      });
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

router.post('/messages/:id/read',
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
router.get('/debug/database', async (req, res, next) => {
  try {
    const columnsResult = await db.query(`
      SELECT
        table_name,
        column_name,
        data_type,
        column_default
      FROM information_schema.columns
      WHERE table_name IN (
        'users',
        'meeting_bookings',
        'meeting_rooms'
      )
      ORDER BY table_name, ordinal_position
    `);

    const roomsResult = await db.query(`
      SELECT *
      FROM meeting_rooms
      ORDER BY id
    `);

    const usersResult = await db.query(`
      SELECT
        id,
        username,
        display_name,
        role,
        floor,
        monthly_meeting_hours,
        meeting_quota_warning_month,
        is_active
      FROM users
      WHERE role = 'tenant'
      ORDER BY id
    `);

    const bookingsResult = await db.query(`
      SELECT *
      FROM meeting_bookings
      ORDER BY id DESC
      LIMIT 10
    `);

    res.json({
      columns: columnsResult.rows,
      meetingRooms: roomsResult.rows,
      tenants: usersResult.rows,
      recentBookings: bookingsResult.rows,
    });

  } catch (error) {
    console.error('DATABASE DEBUG ERROR:', error);

    res.status(500).json({
      error: error.message,
      code: error.code,
      detail: error.detail,
    });
  }
});
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
  '/meeting-bookings/create',
  async (req, res, next) => {
    const client = await db.pool.connect();

    try {
      const {
        user_id,
        meeting_room_id,
        booking_date,
        start_time,
        end_time,
        note,
      } = req.body;

      if (
        !user_id ||
        !meeting_room_id ||
        !booking_date ||
        !start_time ||
        !end_time
      ) {
        return res.redirect(
          adminRedirect(
            'error',
            'יש לבחור לקוח, חדר, תאריך ושעות',
            'meeting-room'
          )
        );
      }

      await client.query('BEGIN');

      const userResult = await client.query(
        `
          SELECT
            id,
            display_name,
            floor,
            monthly_meeting_hours,
            is_active
          FROM users
          WHERE
            id = $1
            AND role = 'tenant'
          LIMIT 1
        `,
        [user_id]
      );

      const tenant = userResult.rows[0];

      if (!tenant || !tenant.is_active) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            'הלקוח לא נמצא או שהחשבון אינו פעיל',
            'meeting-room'
          )
        );
      }

      const roomResult = await client.query(
        `
          SELECT
            id,
            floor,
            name
          FROM meeting_rooms
          WHERE
            id = $1
            AND is_active = TRUE
          LIMIT 1
        `,
        [meeting_room_id]
      );

      const room = roomResult.rows[0];

      if (!room) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            'חדר הישיבות לא נמצא',
            'meeting-room'
          )
        );
      }

      if (Number(tenant.floor) !== Number(room.floor)) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            `לקוח מקומה ${tenant.floor} יכול לשריין רק את חדר קומה ${tenant.floor}`,
            'meeting-room'
          )
        );
      }

      const startMinutes =
        Number(start_time.slice(0, 2)) * 60 +
        Number(start_time.slice(3, 5));

      const endMinutes =
        Number(end_time.slice(0, 2)) * 60 +
        Number(end_time.slice(3, 5));

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(booking_date) ||
        !/^\d{2}:\d{2}$/.test(start_time) ||
        !/^\d{2}:\d{2}$/.test(end_time) ||
        endMinutes <= startMinutes
      ) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            'התאריך או טווח השעות אינם תקינים',
            'meeting-room'
          )
        );
      }

      const futureResult = await client.query(
        `
          SELECT
            ($1::DATE + $2::TIME) > NOW()
              AS is_future
        `,
        [booking_date, start_time]
      );

      if (!futureResult.rows[0].is_future) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            'אפשר ליצור רק שריון עתידי',
            'meeting-room'
          )
        );
      }

      await client.query(
        `
          SELECT pg_advisory_xact_lock(
            hashtext($1)
          )
        `,
        [`meeting-room:${room.id}:${booking_date}`]
      );

      const conflictResult = await client.query(
        `
          SELECT id
          FROM meeting_bookings
          WHERE
            meeting_room_id = $1
            AND booking_date = $2
            AND start_time < $3
            AND end_time > $4
          LIMIT 1
        `,
        [
          room.id,
          booking_date,
          end_time,
          start_time,
        ]
      );

      if (conflictResult.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            'החדר כבר משוריין בטווח השעות שנבחר',
            'meeting-room'
          )
        );
      }

      const usedHoursResult = await client.query(
        `
          SELECT
            COALESCE(
              SUM(
                EXTRACT(
                  EPOCH FROM (end_time - start_time)
                ) / 3600
              ),
              0
            )::NUMERIC AS used_hours
          FROM meeting_bookings
          WHERE
            user_id = $1
            AND TO_CHAR(
              booking_date,
              'YYYY-MM'
            ) = TO_CHAR(
              $2::DATE,
              'YYYY-MM'
            )
        `,
        [tenant.id, booking_date]
      );

      const usedHours = Number(
        usedHoursResult.rows[0].used_hours || 0
      );

      const requestedHours =
        (endMinutes - startMinutes) / 60;

      const monthlyLimit = Number(
        tenant.monthly_meeting_hours || 6
      );

      if (
        usedHours + requestedHours >
        monthlyLimit
      ) {
        await client.query('ROLLBACK');

        return res.redirect(
          adminRedirect(
            'error',
            `השריון חורג ממכסת ${monthlyLimit} השעות החודשית של הלקוח`,
            'meeting-room'
          )
        );
      }

      await client.query(
        `
          INSERT INTO meeting_bookings (
            user_id,
            meeting_room_id,
            booking_date,
            start_time,
            end_time,
            note
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )
        `,
        [
          tenant.id,
          room.id,
          booking_date,
          start_time,
          end_time,
          String(note || '').trim() || null,
        ]
      );

      await client.query('COMMIT');

      return res.redirect(
        adminRedirect(
          'success',
          `נוצר שריון עבור ${tenant.display_name}`,
          'meeting-room'
        )
      );
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Admin booking rollback failed:',
          rollbackError
        );
      }

      return next(error);
    } finally {
      client.release();
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
router.post(
  '/clients/:id/permanent-delete',
  async (req, res, next) => {
    try {
      await db.query(
        `
        DELETE FROM meeting_bookings
        WHERE user_id = $1
        `,
        [req.params.id]
      );

      const result = await db.query(
        `
        DELETE FROM users
        WHERE id = $1
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
          'הלקוח נמחק לצמיתות'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;