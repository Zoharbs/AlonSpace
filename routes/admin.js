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
    const quotaAlertsResult = await db.query(
      `
    SELECT
      u.id,
      u.display_name,
      u.phone,
      u.office_number,
      u.floor,
      u.monthly_meeting_hours,

      COALESCE(
        SUM(
          EXTRACT(
            EPOCH FROM (mb.end_time - mb.start_time)
          ) / 3600
        ),
        0
      )::NUMERIC AS used_hours,

      COUNT(*) FILTER (
        WHERE mb.billing_status = 'chargeable'
      ) AS chargeable_bookings

    FROM users u

    JOIN meeting_bookings mb
      ON mb.user_id = u.id

    WHERE
      u.role = 'tenant'
      AND u.is_active = TRUE
      AND TO_CHAR(mb.booking_date, 'YYYY-MM')
          = TO_CHAR(CURRENT_DATE, 'YYYY-MM')

    GROUP BY
      u.id,
      u.display_name,
      u.phone,
      u.office_number,
      u.floor,
      u.monthly_meeting_hours

    HAVING
      COALESCE(
        SUM(
          EXTRACT(
            EPOCH FROM (mb.end_time - mb.start_time)
          ) / 3600
        ),
        0
      ) > u.monthly_meeting_hours

    ORDER BY used_hours DESC
  `
    );
    const [
      clientsResult,
      adminsResult,
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
  SELECT
    id,
    username,
    email,
    display_name,
    phone,
    is_active,
    created_at
  FROM users
  WHERE role = 'admin'
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
const surveyResults = await db.query(`
  SELECT
    s.id,
    s.user_id,
    s.uses_meeting_room,
    s.meeting_room_times_per_month,
    s.primary_office_use,
    s.most_important_feature,
    s.improvement_suggestion,
    u.display_name,
    u.business_name,
    u.office_number,
    u.floor
  FROM onboarding_surveys s
  JOIN users u
    ON u.id = s.user_id
  ORDER BY u.display_name ASC
`);
const surveys = surveyResults.rows;

const meetingRoomUsers = surveys.filter(
  survey => survey.uses_meeting_room === true
);

const meetingRoomUsagePercent = surveys.length
  ? Math.round(
      (meetingRoomUsers.length / surveys.length) * 100
    )
  : 0;

const usageValues = meetingRoomUsers
  .map(survey =>
    Number(survey.meeting_room_times_per_month)
  )
  .filter(value => Number.isFinite(value));

const averageMeetingRoomUsage = usageValues.length
  ? (
      usageValues.reduce(
        (sum, value) => sum + value,
        0
      ) / usageValues.length
    ).toFixed(1)
  : '0';
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
  title: 'פאנל ניהול - AlonSpace',
  layout: false,
  adminName: req.session.userName,

  clients: clientsResult.rows,
  admins: adminsResult.rows,
  messages: messagesResult.rows,
  testimonials: testimonialsResult.rows,

  meetingBookings: meetingBookingsResult.rows,
  meetingRooms: meetingRoomsResult.rows,

  // שאלון
  surveys,
  meetingRoomUsagePercent,
  averageMeetingRoomUsage,

  stats,

  error: req.query.error || null,
  success: req.query.success || null,

  quotaAlerts: quotaAlertsResult.rows,
  newClientInvite,
});
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics', async (req, res, next) => {
  try {
    // =========================
    // נתונים כלליים
    // =========================

    const summaryResult = await db.query(`
      SELECT

        (
          SELECT COUNT(*)::INTEGER
          FROM users
          WHERE
            role = 'tenant'
            AND is_active = TRUE
        ) AS total_clients,

        (
          SELECT COUNT(*)::INTEGER
          FROM users
          WHERE
            role = 'tenant'
            AND is_active = TRUE
            AND last_login_at >=
              DATE_TRUNC('month', NOW())
        ) AS active_clients_month,

        (
          SELECT COUNT(*)::INTEGER
          FROM user_activity
          WHERE
            event_type = 'login'
            AND created_at >=
              DATE_TRUNC('month', NOW())
        ) AS logins_month,

        (
          SELECT COUNT(*)::INTEGER
          FROM meeting_bookings
          WHERE
            booking_date >=
              DATE_TRUNC('month', CURRENT_DATE)::DATE
            AND booking_date <
              (
                DATE_TRUNC('month', CURRENT_DATE)
                + INTERVAL '1 month'
              )::DATE
        ) AS bookings_month,

        (
          SELECT
            COALESCE(
              SUM(
                EXTRACT(
                  EPOCH FROM (end_time - start_time)
                ) / 3600
              ),
              0
            )::NUMERIC
          FROM meeting_bookings
          WHERE
            booking_date >=
              DATE_TRUNC('month', CURRENT_DATE)::DATE
            AND booking_date <
              (
                DATE_TRUNC('month', CURRENT_DATE)
                + INTERVAL '1 month'
              )::DATE
        ) AS meeting_hours_month
    `);


    // =========================
    // פעילות לפי לקוח
    // =========================

    const clientsActivityResult = await db.query(`
      SELECT
        u.id,
        u.display_name,
        u.business_name,
        u.office_number,
        u.floor,
        u.last_login_at,
        u.login_count,

        COUNT(mb.id) FILTER (
          WHERE
            mb.booking_date >=
              DATE_TRUNC('month', CURRENT_DATE)::DATE
            AND mb.booking_date <
              (
                DATE_TRUNC('month', CURRENT_DATE)
                + INTERVAL '1 month'
              )::DATE
        )::INTEGER AS bookings_month,

        COALESCE(
          SUM(
            CASE
              WHEN
                mb.booking_date >=
                  DATE_TRUNC('month', CURRENT_DATE)::DATE
                AND mb.booking_date <
                  (
                    DATE_TRUNC('month', CURRENT_DATE)
                    + INTERVAL '1 month'
                  )::DATE
              THEN
                EXTRACT(
                  EPOCH FROM (
                    mb.end_time - mb.start_time
                  )
                ) / 3600
              ELSE 0
            END
          ),
          0
        )::NUMERIC AS meeting_hours_month

      FROM users u

      LEFT JOIN meeting_bookings mb
        ON mb.user_id = u.id

      WHERE
        u.role = 'tenant'
        AND u.is_active = TRUE

      GROUP BY
        u.id,
        u.display_name,
        u.business_name,
        u.office_number,
        u.floor,
        u.last_login_at,
        u.login_count

      ORDER BY
        u.last_login_at DESC NULLS LAST,
        LOWER(u.display_name)
    `);


    // =========================
    // פעילות אחרונה
    // =========================

    const recentActivityResult = await db.query(`
      SELECT
        ua.id,
        ua.event_type,
        ua.created_at,
        u.display_name,
        u.business_name

      FROM user_activity ua

      JOIN users u
        ON u.id = ua.user_id

      WHERE
        u.role = 'tenant'

      ORDER BY
        ua.created_at DESC

      LIMIT 50
    `);


    // =========================
    // סקרים
    // כרגע רק כמה השלימו
    // =========================

const surveyResults = await db.query(`
  SELECT
    s.id,
    s.user_id,
    s.uses_meeting_room,
    s.meeting_room_times_per_month,
    s.primary_office_use,
    s.most_important_feature,
    s.improvement_suggestion,

    u.display_name,
    u.business_name,
    u.office_number,
    u.floor

  FROM onboarding_surveys s

  JOIN users u
    ON u.id = s.user_id

  WHERE
    u.role = 'tenant'

  ORDER BY
    LOWER(u.display_name) ASC
`);

const surveys = surveyResults.rows;

const meetingRoomUsers = surveys.filter(
  survey => survey.uses_meeting_room === true
);

const meetingRoomUsagePercent = surveys.length
  ? Math.round(
      (meetingRoomUsers.length / surveys.length) * 100
    )
  : 0;

const usageValues = meetingRoomUsers
  .map(survey =>
    Number(survey.meeting_room_times_per_month)
  )
  .filter(value => Number.isFinite(value));

const averageMeetingRoomUsage = usageValues.length
  ? (
      usageValues.reduce(
        (sum, value) => sum + value,
        0
      ) / usageValues.length
    ).toFixed(1)
  : '0';

const completedSurveys = surveys.length;

    // =========================
    // Analytics של האתר הציבורי
    // =========================

    const websiteAnalyticsResult = await db.query(`
  SELECT

    COUNT(*) FILTER (
      WHERE ae.created_at >= CURRENT_DATE
    )::INTEGER AS page_views_today,

    COUNT(*) FILTER (
      WHERE ae.created_at >= DATE_TRUNC('month', NOW())
    )::INTEGER AS page_views_month,

    COUNT(DISTINCT ae.visitor_id) FILTER (
      WHERE ae.created_at >= CURRENT_DATE
    )::INTEGER AS visitors_today,

    COUNT(DISTINCT ae.visitor_id) FILTER (
      WHERE ae.created_at >= DATE_TRUNC('month', NOW())
    )::INTEGER AS visitors_month

  FROM analytics_events ae

  LEFT JOIN users u
    ON u.id = ae.user_id

  WHERE
    ae.event_type = 'page_view'
    AND (
      u.id IS NULL
      OR u.role <> 'admin'
    )
`);


    const popularPagesResult = await db.query(`
  SELECT
    ae.page_path AS path,
    COUNT(*)::INTEGER AS views

  FROM analytics_events ae

  LEFT JOIN users u
    ON u.id = ae.user_id

  WHERE
    ae.event_type = 'page_view'
    AND ae.created_at >= DATE_TRUNC('month', NOW())
    AND (
      u.id IS NULL
      OR u.role <> 'admin'
    )

  GROUP BY ae.page_path

  ORDER BY views DESC

  LIMIT 20
`);


    const recentWebsiteActivityResult = await db.query(`
  SELECT
    ae.event_type,
    ae.page_path AS path,
    ae.created_at

  FROM analytics_events ae

  LEFT JOIN users u
    ON u.id = ae.user_id

  WHERE
    u.id IS NULL
    OR u.role <> 'admin'

  ORDER BY ae.created_at DESC

  LIMIT 50
`);


    const summary = summaryResult.rows[0];

    return res.render('admin/analytics', {
      title: 'Analytics - AlonSpace',
      layout: false,

      adminName: req.session.userName,

      summary,

      clientsActivity:
        clientsActivityResult.rows,

      recentActivity:
        recentActivityResult.rows,
completedSurveys,
surveys,
meetingRoomUsagePercent,
averageMeetingRoomUsage,

      websiteAnalytics:
        websiteAnalyticsResult.rows[0],

      popularPages:
        popularPagesResult.rows,

      recentWebsiteActivity:
        recentWebsiteActivityResult.rows,
    });

  } catch (error) {
    console.error(
      'ADMIN ANALYTICS ERROR:',
      error
    );

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
router.post('/make-admin',
  async (req, res, next) => {
    try {
      const userId = Number(req.body.user_id);

      if (!userId) {
        return res.redirect(
          adminRedirect(
            'error',
            'יש לבחור משתמש'
          )
        );
      }

      const result = await db.query(
        `
          UPDATE users
          SET
            role = 'admin',
            updated_at = NOW()
          WHERE
            id = $1
            AND role = 'tenant'
          RETURNING
            id,
            display_name
        `,
        [userId]
      );

      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'המשתמש לא נמצא או שהוא כבר אדמין'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          `${result.rows[0].display_name} הוגדר כאדמין`
        )
      );

    } catch (error) {
      return next(error);
    }
  }
);
router.post('/clients/:id/reset-password',
  async (req, res, next) => {
    try {
      // יצירת סיסמה זמנית חדשה
      const newPassword =
        "Alon-" +
        Math.floor(10000 + Math.random() * 90000);

      const passwordHash = await bcrypt.hash(
        newPassword,
        12
      );

      // יצירת Magic Login חדש
      const magicLoginToken =
        crypto.randomBytes(32).toString('hex');

      const magicLoginTokenHash =
        crypto
          .createHash('sha256')
          .update(magicLoginToken)
          .digest('hex');

      // תקף ל-48 שעות
      const magicLoginExpiresAt =
        new Date(
          Date.now() +
          48 * 60 * 60 * 1000
        );

      // עדכון המשתמש
      const result = await db.query(
        `
          UPDATE users
          SET
            password_hash = $1,
            must_change_password = TRUE,

            magic_login_token_hash = $2,
            magic_login_expires_at = $3,
            magic_login_used_at = NULL,

            updated_at = NOW()

          WHERE
            id = $4
            AND role = 'tenant'

          RETURNING
            id,
            username,
            display_name,
            phone
        `,
        [
          passwordHash,
          magicLoginTokenHash,
          magicLoginExpiresAt,
          req.params.id
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

      const client = result.rows[0];

      // יצירת הודעת ההתחברות
      req.session.newClientInvite = {
        userId: client.id,
        displayName: client.display_name,
        username: client.username,
        temporaryPassword: newPassword,
        phone: client.phone || null,

        magicLoginUrl:
          `https://alonspace.com/magic-login?token=${magicLoginToken}`,
      };

      return req.session.save(
        (saveError) => {
          if (saveError) {
            return next(saveError);
          }

          return res.redirect(
            adminRedirect(
              'success',
              'הסיסמה אופסה. נוצר גם קישור כניסה מהירה חדש ל־48 שעות.'
            )
          );
        }
      );

    } catch (error) {
      return next(error);
    }
  }
);

router.post('/clients/:id/delete',
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

router.post('/meeting-bookings/:id/delete',
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

router.post('/messages/:id/delete',
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

router.post('/testimonials/:id/approve',
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
router.post('/testimonials/:id/reject',
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
router.post('/meeting-bookings/create',
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

    await client.query(
  `
    INSERT INTO meeting_bookings (
      user_id,
      meeting_room_id,
      booking_date,
      start_time,
      end_time,
      note,
      billing_status,
      created_by_user_id,
      booking_source
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      'included',
      $7,
      'admin'
    )
  `,
  [
    tenant.id,
    room.id,
    booking_date,
    start_time,
    end_time,
    String(note || '').trim() || null,
    req.session.userId
  ]
);
await client.query(
  `
    INSERT INTO meeting_bookings (
      user_id,
      meeting_room_id,
      booking_date,
      start_time,
      end_time,
      note,
      billing_status,
      created_by_user_id,
      booking_source
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      'included',
      $7,
      'admin'
    )
  `,
  [
    tenant.id,
    room.id,
    booking_date,
    start_time,
    end_time,
    String(note || '').trim() || null,
    req.session.userId
  ]
);

// רישום מפורש שהשריון נוצר על ידי אדמין
await client.query(
  `
    INSERT INTO user_activity (
      user_id,
      event_type,
      event_data
    )
    VALUES (
      $1,
      'meeting_booking_created_by_admin',
      $2::jsonb
    )
  `,
  [
    tenant.id,
    JSON.stringify({
      created_by_admin_id:
        Number(req.session.userId),
      meeting_room_id:
        Number(room.id),
      booking_date,
      start_time,
      end_time
    })
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
router.post('/testimonials/:id/delete',
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
router.post('/clients/:id/permanent-delete',
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
router.post('/users/:id/role',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);
      const newRole = String(
        req.body.role || ''
      ).trim();

      if (!['tenant', 'admin'].includes(newRole)) {
        return res.redirect(
          adminRedirect(
            'error',
            'סוג ההרשאה אינו תקין'
          )
        );
      }

      // לא מאפשרים לאדמין שמחובר כרגע
      // להסיר לעצמו את הרשאת האדמין
      if (
        userId === Number(req.session.userId) &&
        newRole !== 'admin'
      ) {
        return res.redirect(
          adminRedirect(
            'error',
            'לא ניתן להסיר מעצמך הרשאת אדמין'
          )
        );
      }

      const result = await db.query(
        `
          UPDATE users
          SET
            role = $1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING
            id,
            display_name,
            role
        `,
        [
          newRole,
          userId
        ]
      );

      if (result.rows.length === 0) {
        return res.redirect(
          adminRedirect(
            'error',
            'המשתמש לא נמצא'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          newRole === 'admin'
            ? `${result.rows[0].display_name} הוגדר כאדמין`
            : `${result.rows[0].display_name} הוגדר כדייר`
        )
      );

    } catch (error) {
      return next(error);
    }
  }
);

router.get('/setup-analytics-db', async (req, res) => {
  try {
    // =========================
    // Analytics fields on users
    // =========================

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0
    `);


    // =========================
    // User activity table
    // =========================

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id BIGSERIAL PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        event_type VARCHAR(100) NOT NULL,

        event_data JSONB,

        created_at TIMESTAMPTZ NOT NULL
          DEFAULT NOW()
      )
    `);

    // =========================
    // Onboarding survey table
    // =========================

    await db.query(`
  CREATE TABLE IF NOT EXISTS onboarding_surveys (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL UNIQUE
      REFERENCES users(id)
      ON DELETE CASCADE,

    uses_meeting_room BOOLEAN,

    meeting_room_times_per_month INTEGER,

    primary_office_use TEXT,

    most_important_feature TEXT,

    improvement_suggestion TEXT,

    completed_at TIMESTAMPTZ
      NOT NULL DEFAULT NOW()
  )
`);
    // =========================
    // Indexes
    // =========================

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        idx_user_activity_user_id
      ON user_activity(user_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        idx_user_activity_event_type
      ON user_activity(event_type)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        idx_user_activity_created_at
      ON user_activity(created_at)
    `);


    // =========================
    // Verify
    // =========================

    const columnsResult = await db.query(`
      SELECT
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE
        table_name IN (
          'users',
          'user_activity'
        )
        AND (
          table_name = 'user_activity'
          OR column_name IN (
            'last_login_at',
            'login_count'
          )
        )
      ORDER BY
        table_name,
        ordinal_position
    `);

    return res.json({
      success: true,
      message:
        'Analytics database setup completed',
      database: columnsResult.rows
    });

  } catch (error) {
    console.error(
      'ANALYTICS DB SETUP ERROR:',
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  }
});
router.post(
  '/admins/:id/update',
  async (req, res, next) => {
    try {
      const {
        display_name,
        username,
        email,
        phone,
        is_active,
      } = req.body;

      const cleanDisplayName =
        String(display_name || '').trim();

      const cleanUsername =
        String(username || '').trim();

      if (!cleanDisplayName || !cleanUsername) {
        return res.redirect(
          adminRedirect(
            'error',
            'שם ושם משתמש הם שדות חובה'
          )
        );
      }

      // לא מאפשר לאדמין להשבית את עצמו
      const active =
        Number(req.params.id) ===
        Number(req.session.userId)
          ? true
          : Boolean(is_active);

      const result = await db.query(
        `
          UPDATE users
          SET
            display_name = $1,
            username = $2,
            email = $3,
            phone = $4,
            is_active = $5,
            updated_at = NOW()
          WHERE
            id = $6
            AND role = 'admin'
          RETURNING id
        `,
        [
          cleanDisplayName,
          cleanUsername,
          normalizeOptional(email),
          normalizeOptional(phone),
          active,
          req.params.id,
        ]
      );

      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'האדמין לא נמצא'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          'פרטי האדמין עודכנו'
        )
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.redirect(
          adminRedirect(
            'error',
            'שם המשתמש או האימייל כבר קיימים'
          )
        );
      }

      return next(error);
    }
  }
);
let adminBookingSubmitting = false;

adminBookingForm?.addEventListener('submit', (event) => {
  if (adminBookingSubmitting) {
    event.preventDefault();
    return;
  }

  adminBookingSubmitting = true;

  const submitButton =
    adminBookingForm.querySelector(
      'button[type="submit"]'
    );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'יוצר שריון...';
  }
});
module.exports = router;