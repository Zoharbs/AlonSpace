const express = require('express');
const db = require('../db');

const router = express.Router();

function requireTenant(req, res, next) {
  if (
    req.session?.userId &&
    req.session?.userRole === 'tenant'
  ) {
    return next();
  }

  return res.redirect('/login');
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
        AND TO_CHAR(booking_date, 'YYYY-MM') = $2
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

    const currentMonth =
      new Date().toISOString().slice(0, 7);

    const usedHours = await getUsedHours(
      user.id,
      currentMonth
    );

    const monthlyLimit = Number(
      user.monthly_meeting_hours || 6
    );

    const remainingHours = Math.max(
      0,
      monthlyLimit - usedHours
    );

    const bookingsResult = await db.query(
      `
        SELECT
          mb.id,
          mb.user_id,
          mb.booking_date,
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
          mb.booking_date > CURRENT_DATE
          OR (
            mb.booking_date = CURRENT_DATE
            AND mb.end_time > CURRENT_TIME
          )
        ORDER BY
          mb.booking_date ASC,
          mb.start_time ASC
        LIMIT 200
      `,
      [user.id]
    );

    return res.render('dashboard', {
      title: 'האזור האישי — AlonSpace',
      user,
      usedHours,
      remainingHours,
      meetingBookings: bookingsResult.rows,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/meeting-bookings/create',
  async (req, res, next) => {
    const client = await db.pool.connect();

    try {
      const userResult = await client.query(
        `
          SELECT
            id,
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
        [`meeting-room:${bookingDate}`]
      );

      const conflictResult =
        await client.query(
          `
            SELECT id
            FROM meeting_bookings
            WHERE
              booking_date = $1
              AND start_time < $2
              AND end_time > $3
            LIMIT 1
          `,
          [
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

      if (
        usedHours + requestedHours >
        limit
      ) {
        await client.query('ROLLBACK');

        return res.redirect(
          dashboardRedirect(
            'error',
            `השריון חורג ממכסת ${limit} השעות החודשית`,
            'meeting-room'
          )
        );
      }

      await client.query(
        `
          INSERT INTO meeting_bookings (
            user_id,
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
            $5
          )
        `,
        [
          user.id,
          bookingDate,
          startTime,
          endTime,
          note || null,
        ]
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

      return next(error);
    } finally {
      client.release();
    }
  }
);

router.post(
  '/meeting-bookings/:id/delete',
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
          RETURNING id
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

module.exports = router;