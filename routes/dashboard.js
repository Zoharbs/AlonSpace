const express = require('express');
const db = require('../db');

const router = express.Router();
function requireTenant(req, res, next) {
  if (
    !req.session?.userId ||
    req.session?.userRole !== 'tenant'
  ) {
    return res.redirect('/login');
  }


  return next();
}

function minutesFromTime(value) {
  const normalized = String(value || '').slice(0, 5);

  const match =
    /^([01]\d|2[0-3]):([0-5]\d)$/.exec(normalized);

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
}

function getMonthKey(dateValue) {
  return String(dateValue || '').slice(0, 7);
}

function dashboardRedirect(
  type,
  message,
  hash = ''
) {
  const suffix = hash ? `#${hash}` : '';

  return (
    `/dashboard?${type}=` +
    encodeURIComponent(message) +
    suffix
  );
}

async function getUsedHours(
  userId,
  monthKey,
  client = db
) {
  const result = await client.query(
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
        AND COALESCE(
          booking_source,
          'tenant'
        ) <> 'admin'
        AND TO_CHAR(
          booking_date,
          'YYYY-MM'
        ) = $2
    `,
    [userId, monthKey]
  );

  return Number(
    result.rows[0]?.used_hours || 0
  );
}

router.use(requireTenant);

router.get('/', async (req, res, next) => {
  try {

    /* =====================================
       USER
    ===================================== */

    const userResult = await db.query(
      `
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
        WHERE
          id = $1
          AND role = 'tenant'
          AND is_active = TRUE
        LIMIT 1
      `,
      [req.session.userId]
    );

    const user = userResult.rows[0];


    if (!user) {
      return req.session.destroy(() => {
        res.redirect('/login');
      });
    }


    /* =====================================
       BUSINESS PROFILE
    ===================================== */

    const tenantProfileResult =
      await db.query(
        `
          SELECT
            id,
            user_id,
            person_name,
            display_name,
            business_field,
            bio,
            website_url,
            linkedin_url,
         logo_url,
community_visible,
public_consent,
public_status,
created_at,
            updated_at
          FROM tenant_profiles
          WHERE user_id = $1
          LIMIT 1
        `,
        [user.id]
      );


    const tenantProfile =
      tenantProfileResult.rows[0] || null;


    /* =====================================
       ONBOARDING SURVEY
    ===================================== */

    const surveyResult = await db.query(
      `
        SELECT id
        FROM onboarding_surveys
        WHERE user_id = $1
        LIMIT 1
      `,
      [user.id]
    );


    const shouldShowSurvey =
      surveyResult.rows.length === 0;


    /* =====================================
       MEETING ROOM QUOTA
    ===================================== */

    const currentMonth =
      new Date().toISOString().slice(0, 7);


    const usedHours =
      await getUsedHours(
        user.id,
        currentMonth
      );


    const monthlyLimit =
      Number(
        user.monthly_meeting_hours || 6
      );


    const remainingHours =
      Math.max(
        0,
        monthlyLimit - usedHours
      );


    const quotaExceeded =
      usedHours > monthlyLimit;


    const chargeableResult =
      await db.query(
        `
          SELECT
            COUNT(*)::INTEGER AS count
          FROM meeting_bookings
          WHERE
            user_id = $1
            AND billing_status = 'chargeable'
            AND TO_CHAR(
              booking_date,
              'YYYY-MM'
            ) = $2
        `,
        [
          user.id,
          currentMonth,
        ]
      );


    const hasChargeableBookings =
      chargeableResult.rows[0].count > 0;


    /* =====================================
       MEETING BOOKINGS
    ===================================== */

    const bookingsResult =
      await db.query(
        `
          SELECT
            mb.id,
            mb.user_id,
            mb.booking_date,
            mb.booking_source,
            mb.start_time,
            mb.end_time,
            mb.note,
            mb.created_at,
            u.display_name,
            u.business_name,
            u.office_number,
            u.floor,

            CASE
              WHEN mb.user_id = $1
              THEN TRUE
              ELSE FALSE
            END AS is_mine

          FROM meeting_bookings mb

          JOIN users u
            ON u.id = mb.user_id

          WHERE
            mb.meeting_room_id = (
              SELECT id
              FROM meeting_rooms
              WHERE floor = $2
            )

          ORDER BY
            mb.booking_date ASC,
            mb.start_time ASC

          LIMIT 200
        `,
        [
          user.id,
          user.floor
        ]
      );


    /* =====================================
       RENDER
    ===================================== */

    return res.render(
      'dashboard',
      {
        title:
          'האזור האישי - AlonSpace',

        user,

        tenantProfile,

        usedHours,

        remainingHours,

        meetingBookings:
          bookingsResult.rows,

        error:
          req.query.error || null,

        success:
          req.query.success || null,

        warning:
          req.query.warning || null,

        quotaExceeded,

        hasChargeableBookings,

        shouldShowSurvey,
      }
    );

  } catch (error) {

    return next(error);

  }
});
/* =====================================
   ALONSPACE COMMUNITY
===================================== */

router.get('/community',

  async (req, res, next) => {

    try {

      /* =====================================
         CURRENT USER
      ===================================== */

      const userResult =
        await db.query(
          `
            SELECT
              id,
              username,
              email,
              display_name,
              phone,
              business_name,
              office_number,
              floor,
              community_tutorial_seen
            FROM users
            WHERE
              id = $1
              AND role = 'tenant'
              AND is_active = TRUE
            LIMIT 1
          `,
          [req.session.userId]
        );


      const user =
        userResult.rows[0];


      if (!user) {

        return req.session.destroy(() => {
          res.redirect('/login');
        });

      }


      /* =====================================
         COMMUNITY PROFILES
      ===================================== */

      const profilesResult =
        await db.query(
          `
            SELECT
              tp.id,
              tp.user_id,
              tp.display_name,
              tp.person_name,
              tp.business_field,
              tp.bio,
              tp.website_url,
              tp.linkedin_url,

              tp.logo_data IS NOT NULL
                AS has_logo,

              tp.community_visible,

              u.office_number,
              u.floor

            FROM tenant_profiles tp

            JOIN users u
              ON u.id = tp.user_id

            WHERE
              tp.community_visible = TRUE
              AND u.role = 'tenant'
              AND u.is_active = TRUE

            ORDER BY
              tp.display_name ASC
          `
        );


      const communityProfiles =
        profilesResult.rows;


      return res.render(
        'community',
        {
          title:
            'קהילת AlonSpace',

          user,

          communityProfiles,

          error:
            req.query.error || null,

          success:
            req.query.success || null,
        }
      );


    } catch (error) {

      return next(error);

    }

  }
);

router.post('/community/tutorial-seen',

  async (req, res, next) => {

    try {

      await db.query(
        `
          UPDATE users
          SET
            community_tutorial_seen = TRUE
          WHERE
            id = $1
            AND role = 'tenant'
            AND is_active = TRUE
        `,
        [req.session.userId]
      );


      return res.redirect(
        '/dashboard/community'
      );


    } catch (error) {

      return next(error);

    }

  }
);
/* =====================================
   COMMUNITY PROFILE LOGO
===================================== */

router.get(
  '/community/business-profiles/:id/logo',

  async (req, res, next) => {

    try {

      const result =
        await db.query(
          `
            SELECT
              tp.logo_data,
              tp.logo_mime_type

            FROM tenant_profiles tp

            JOIN users u
              ON u.id = tp.user_id

            WHERE
              tp.id = $1
              AND tp.community_visible = TRUE
              AND u.role = 'tenant'
              AND u.is_active = TRUE

            LIMIT 1
          `,
          [req.params.id]
        );


      const profile =
        result.rows[0];


      if (
        !profile ||
        !profile.logo_data ||
        !profile.logo_mime_type
      ) {

        return res.status(404).end();

      }


      res.set(
        'Content-Type',
        profile.logo_mime_type
      );


      res.set(
        'Cache-Control',
        'private, max-age=3600'
      );


      return res.send(
        profile.logo_data
      );


    } catch (error) {

      return next(error);

    }

  }
);
router.post('/business-profile',

  async (req, res, next) => {

    try {

      /* =====================================
         VERIFY TENANT
      ===================================== */

      const userResult =
        await db.query(
          `
            SELECT
              id,
              business_name
            FROM users
            WHERE
              id = $1
              AND role = 'tenant'
              AND is_active = TRUE
            LIMIT 1
          `,
          [req.session.userId]
        );


      const user =
        userResult.rows[0];


      if (!user) {

        return res.redirect(
          '/login'
        );

      }


      /* =====================================
         FORM VALUES
      ===================================== */
      const personName =
        String(
          req.body.person_name || ''
        )
          .trim()
          .slice(0, 120);

      const displayName =
        String(
          req.body.display_name || ''
        )
          .trim()
          .slice(0, 120);


      const businessField =
        String(
          req.body.business_field || ''
        )
          .trim()
          .slice(0, 120);


      const bio =
        String(
          req.body.bio || ''
        )
          .trim()
          .slice(0, 300);


      const websiteUrl =
        String(
          req.body.website_url || ''
        ).trim();


      const linkedinUrl =
        String(
          req.body.linkedin_url || ''
        ).trim();


      const communityVisible =
        req.body.community_visible === '1';

      const publicConsent =
        communityVisible &&
        req.body.public_consent === '1';

      /* =====================================
         BASIC VALIDATION
      ===================================== */

      if (!displayName) {

        return res.redirect(
          '/dashboard?error=' +
          encodeURIComponent(
            'נא להזין שם עסק או שם לתצוגה'
          ) +
          '#business-profile'
        );

      }


      function normalizeOptionalUrl(value) {

        const trimmed =
          String(value || '').trim();


        if (!trimmed) {
          return {
            valid: true,
            url: null,
          };
        }


        const withProtocol =
          /^https?:\/\//i.test(trimmed)
            ? trimmed
            : `https://${trimmed}`;


        try {

          const parsed =
            new URL(withProtocol);


          if (
            parsed.protocol !== 'http:' &&
            parsed.protocol !== 'https:'
          ) {
            return {
              valid: false,
              url: null,
            };
          }


          return {
            valid: true,
            url: parsed.toString(),
          };

        } catch {

          return {
            valid: false,
            url: null,
          };

        }

      }


      const normalizedWebsite =
        normalizeOptionalUrl(websiteUrl);


      const normalizedLinkedin =
        normalizeOptionalUrl(linkedinUrl);


      if (
        !normalizedWebsite.valid ||
        !normalizedLinkedin.valid
      ) {

        return res.redirect(
          '/dashboard?error=' +
          encodeURIComponent(
            'כתובת האתר או LinkedIn אינה תקינה'
          ) +
          '#business-profile'
        );

      }




      /* =====================================
         CURRENT PROFILE
      ===================================== */

      const currentResult =
        await db.query(
          `
            SELECT
              id,
              public_status,
              public_consent
            FROM tenant_profiles
            WHERE user_id = $1
            LIMIT 1
          `,
          [user.id]
        );


      const currentProfile =
        currentResult.rows[0] || null;


      /*
        אם הדייר רוצה פרסום:
        הפרופיל עובר לאישור.

        אם הוא מבטל הסכמה:
        יורד מיד מהאתר.
      */

      let publicStatus =
        publicConsent
          ? 'pending'
          : 'private';


      /*
        אם הפרופיל כבר מאושר
        והדייר רק לוחץ שוב שמירה בלי
        לשנות דבר — בהמשך נוכל להשוות
        שדות בצורה מלאה.

        כרגע כל שמירה בפרופיל ציבורי
        שולחת אותו לבדיקה מחדש.
      */


      /* =====================================
         LOGO
      ===================================== */

      const logoData =
        req.file
          ? req.file.buffer
          : null;


      const logoMimeType =
        req.file
          ? req.file.mimetype
          : null;


      /* =====================================
         UPSERT PROFILE
      ===================================== */

      await db.query(
        `
          INSERT INTO tenant_profiles (

            user_id,
            person_name,
            display_name,
            business_field,
            bio,

            website_url,
            linkedin_url,

            logo_data,
            logo_mime_type,

logo_url,
community_visible,
public_consent,
public_status,
updated_at

          )

          VALUES (

            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
$12,
$13,

NOW()

          )

          ON CONFLICT (user_id)

          DO UPDATE SET
person_name =
  EXCLUDED.person_name,
            display_name =
              EXCLUDED.display_name,

            business_field =
              EXCLUDED.business_field,

            bio =
              EXCLUDED.bio,

            website_url =
              EXCLUDED.website_url,

            linkedin_url =
              EXCLUDED.linkedin_url,

            logo_data =
              CASE
                WHEN EXCLUDED.logo_data
                  IS NOT NULL
                THEN EXCLUDED.logo_data
                ELSE tenant_profiles.logo_data
              END,

            logo_mime_type =
              CASE
                WHEN EXCLUDED.logo_data
                  IS NOT NULL
                THEN EXCLUDED.logo_mime_type
                ELSE tenant_profiles.logo_mime_type
              END,

            logo_url =
              CASE
                WHEN EXCLUDED.logo_data
                  IS NOT NULL
                THEN EXCLUDED.logo_url
                ELSE tenant_profiles.logo_url
              END,

           community_visible =
  EXCLUDED.community_visible,
public_consent =
  EXCLUDED.public_consent,
public_status =
  EXCLUDED.public_status,

            updated_at =
              NOW()
        `,
[
  user.id,

  personName || null,
  displayName,
  businessField || null,
  bio || null,

  normalizedWebsite.url,
  normalizedLinkedin.url,

  logoData,
  logoMimeType,

  req.file
    ? `/dashboard/business-profile/logo`
    : null,

  communityVisible,
  publicConsent,
  publicStatus
]
      );


      return res.redirect(
        '/dashboard?success=' +
        encodeURIComponent(
          publicConsent
            ? 'הפרופיל נשמר ונשלח לאישור הנהלת AlonSpace'
            : 'הפרופיל העסקי נשמר'
        ) +
        '#business-profile'
      );


    } catch (error) {

      return next(error);

    }

  }
);
router.get('/business-profile/logo',

  async (req, res, next) => {

    try {

      const result =
        await db.query(
          `
            SELECT
              logo_data,
              logo_mime_type
            FROM tenant_profiles
            WHERE user_id = $1
            LIMIT 1
          `,
          [req.session.userId]
        );


      const profile =
        result.rows[0];


      if (
        !profile ||
        !profile.logo_data ||
        !profile.logo_mime_type
      ) {

        return res.status(404).end();

      }


      res.set(
        'Content-Type',
        profile.logo_mime_type
      );


      res.set(
        'Cache-Control',
        'private, max-age=3600'
      );


      return res.send(
        profile.logo_data
      );


    } catch (error) {

      return next(error);

    }

  }
);



router.post('/meeting-bookings/create',
  async (req, res, next) => {
    const client = await db.pool.connect();

    try {
      const userResult = await client.query(
        `
          SELECT
            id,
            floor,
            monthly_meeting_hours
          FROM users
          WHERE
            id = $1
            AND role = 'tenant'
            AND is_active = TRUE
          LIMIT 1
        `,
        [req.session.userId]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.redirect('/login');
      }

      const roomResult = await client.query(
        `
    SELECT id
    FROM meeting_rooms
    WHERE floor = $1
    LIMIT 1
  `,
        [user.floor]
      );

      const room = roomResult.rows[0];

      if (!room) {
        return res.redirect(
          dashboardRedirect(
            'error',
            'לא נמצא חדר ישיבות עבור הקומה שלך',
            'meeting-room'
          )
        );
      }

      const roomId = room.id;

      const bookingDate = String(
        req.body.booking_date || ''
      );

      const startTime = String(
        req.body.start_time || ''
      ).slice(0, 5);

      const endTime = String(
        req.body.end_time || ''
      ).slice(0, 5);

      const note = String(
        req.body.note || ''
      ).trim();

      const startMinutes =
        minutesFromTime(startTime);

      const endMinutes =
        minutesFromTime(endTime);

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          bookingDate
        ) ||
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes
      ) {
        return res.redirect(
          dashboardRedirect(
            'error',
            'נא לבחור תאריך וטווח שעות תקינים',
            'meeting-room'
          )
        );
      }

      const futureCheck = await client.query(
        `
          SELECT
            (
              $1::DATE + $2::TIME
            ) > NOW() AS is_future
        `,
        [bookingDate, startTime]
      );

      if (!futureCheck.rows[0].is_future) {
        return res.redirect(
          dashboardRedirect(
            'error',
            'אפשר לשריין רק זמן עתידי',
            'meeting-room'
          )
        );
      }

      await client.query('BEGIN');

      // נעילה ברמת transaction לפי התאריך,
      // כדי ששני משתמשים לא יצליחו לשריין
      // את אותו זמן בו-זמנית.
      await client.query(
        `
    SELECT pg_advisory_xact_lock(
      hashtext($1)
    )
  `,
        [`meeting-room:${roomId}:${bookingDate}`]
      );

      const conflictResult =
        await client.query(
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
            roomId,
            bookingDate,
            endTime,
            startTime,
          ]
        );

      if (conflictResult.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.redirect(
          dashboardRedirect(
            'error',
            'החדר כבר משוריין בטווח שנבחר',
            'meeting-room'
          )
        );
      }

      const monthKey =
        getMonthKey(bookingDate);

      const usedHours =
        await getUsedHours(
          user.id,
          monthKey,
          client
        );

      const requestedHours =
        (endMinutes - startMinutes) / 60;

      const limit = Number(
        user.monthly_meeting_hours || 6
      );

      let billingStatus = 'included';


      const newTotalHours =
        usedHours + requestedHours;
      if (newTotalHours > limit) {

        const warningResult = await client.query(
          `
      SELECT meeting_quota_warning_month
      FROM users
      WHERE id = $1
      FOR UPDATE
    `,
          [user.id]
        );

        const warningMonth =
          warningResult.rows[0]
            ?.meeting_quota_warning_month;

        if (warningMonth !== monthKey) {

          billingStatus = 'warning';

          await client.query(
            `
        UPDATE users
        SET
          meeting_quota_warning_month = $1,
          updated_at = NOW()
        WHERE id = $2
      `,
            [
              monthKey,
              user.id,
            ]
          );

        } else {

          billingStatus = 'chargeable';

        }
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
      $7,
      $8,
      'tenant'
    )
  `,
        [
          user.id,
          roomId,
          bookingDate,
          startTime,
          endTime,
          note || null,
          billingStatus,
          req.session.userId
        ]
      );
      await client.query(
        `
    INSERT INTO user_activity (
      user_id,
      event_type
    )
    VALUES ($1, 'meeting_booking_created')
  `,
        [user.id]
      );
      await client.query('COMMIT');



      return res.redirect(
        dashboardRedirect(
          'success',
          'חדר הישיבות שוריין בהצלחה',
          'meeting-room'
        )
      );
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Meeting booking rollback failed:',
          rollbackError
        );
      }
      console.error('BOOKING ERROR:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        stack: error.stack
      });
      return next(error);
    } finally {
      client.release();
    }
  }
);

router.post('/meeting-bookings/:id/delete',
  async (req, res, next) => {
    try {
      const result = await db.query(
        `
          DELETE FROM meeting_bookings
          WHERE
            id = $1
            AND user_id = $2
            AND (
              booking_date + start_time
            ) > NOW()
          RETURNING id, user_id
        `,
        [
          req.params.id,
          req.session.userId,
        ]
      );

      if (result.rows.length === 0) {
        return res.redirect(
          dashboardRedirect(
            'error',
            'לא ניתן לבטל את השריון הזה',
            'meeting-room'
          )
        );
      }
      await db.query(
        `
    INSERT INTO user_activity (
      user_id,
      event_type
    )
    VALUES ($1, 'meeting_booking_cancelled')
  `,
        [req.session.userId]
      );

      return res.redirect(
        dashboardRedirect(
          'success',
          'השריון בוטל',
          'meeting-room'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/survey', async (req, res, next) => {
  try {
    const existingSurvey = await db.query(
      `
        SELECT id
        FROM onboarding_surveys
        WHERE user_id = $1
        LIMIT 1
      `,
      [req.session.userId]
    );

    // המשתמש כבר מילא את הסקר
    if (existingSurvey.rows.length > 0) {
      return res.redirect(
        dashboardRedirect(
          'success',
          'הסקר כבר מולא. תודה!',
        )
      );
    }

    return res.render('survey', {
      title: 'סקר קצר - AlonSpace',
      error: null,
    });
  } catch (error) {
    return next(error);
  }
});


router.post('/survey', async (req, res, next) => {
  try {
    const {
      uses_meeting_room,
      meeting_room_times_per_month,
      primary_office_use,
      most_important_feature,
      improvement_suggestion,
    } = req.body;

    await db.query(
      `
        INSERT INTO onboarding_surveys (
          user_id,
          uses_meeting_room,
          meeting_room_times_per_month,
          primary_office_use,
          most_important_feature,
          improvement_suggestion
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6
        )
        ON CONFLICT (user_id)
        DO NOTHING
      `,
      [
        req.session.userId,
        uses_meeting_room === 'yes',
        meeting_room_times_per_month
          ? Number(meeting_room_times_per_month)
          : null,
        String(primary_office_use || '').trim() || null,
        String(most_important_feature || '').trim() || null,
        String(improvement_suggestion || '').trim() || null,
      ]
    );

    await db.query(
      `
        INSERT INTO user_activity (
          user_id,
          event_type
        )
        VALUES ($1, 'onboarding_survey_completed')
      `,
      [req.session.userId]
    );

    return res.redirect(
      dashboardRedirect(
        'success',
        'תודה! התשובות שלך נשמרו בהצלחה.'
      )
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;