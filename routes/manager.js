
const express = require('express');
const db = require('../db');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.redirect('/login');
    }

    const result = await db.query(
      `
        SELECT id, role, is_active, display_name
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.session.userId]
    );

    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(403).send('אין הרשאה');
    }

    req.session.userRole = user.role;
    req.session.userName = user.display_name;

    if (!['admin', 'manager'].includes(user.role)) {
      return res.status(403).send('אין הרשאה');
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        ru.id,
        ru.floor,
        ru.unit_number,
        uo.name AS owner_name,
        STRING_AGG(
          DISTINCT tenant.display_name,
          ', '
        ) AS tenant_names
      FROM rental_units ru
      LEFT JOIN unit_owners uo
        ON uo.id = ru.owner_id
      LEFT JOIN unit_tenancies tenancy
        ON tenancy.unit_id = ru.id
        AND (
          tenancy.start_date IS NULL
          OR tenancy.start_date <= CURRENT_DATE
        )
        AND (
          tenancy.end_date IS NULL
          OR tenancy.end_date >= CURRENT_DATE
        )
      LEFT JOIN unit_tenancy_users tu
        ON tu.tenancy_id = tenancy.id
      LEFT JOIN users tenant
        ON tenant.id = tu.user_id
        AND tenant.is_active = TRUE
        AND tenant.role = 'tenant'
      WHERE
        ru.floor IN (4, 6)
        AND ru.is_active = TRUE
      GROUP BY
        ru.id,
        ru.floor,
        ru.unit_number,
        uo.name
      ORDER BY
        ru.floor,
        CASE
          WHEN ru.unit_number ~ '^[0-9]+'
          THEN SUBSTRING(
            ru.unit_number FROM '^[0-9]+'
          )::INTEGER
          ELSE 999999
        END,
        ru.unit_number
    `);

    return res.render('manager/dashboard', {
      title: 'ניהול מתחם - AlonSpace',
      layout: false,
      managerName: req.session.userName,
      units: result.rows
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/calendar-data', async (req, res, next) => {
  try {
    const [roomsResult, bookingsResult, tenantsResult] =
      await Promise.all([
        db.query(`
          SELECT id, name, floor
          FROM meeting_rooms
          WHERE is_active = TRUE
            AND floor IN (4, 6)
          ORDER BY floor ASC
        `),

        db.query(`
          SELECT
            mb.id,
            mb.user_id,
            mb.meeting_room_id,
            mb.booking_date,
            mb.start_time,
            mb.end_time,
            mb.note,
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
          WHERE mr.floor IN (4, 6)
            AND mb.booking_date >= CURRENT_DATE - INTERVAL '30 days'
            AND mb.booking_date < CURRENT_DATE + INTERVAL '180 days'
          ORDER BY
            mb.booking_date ASC,
            mb.start_time ASC
        `),

        db.query(`
          SELECT
            id,
            display_name,
            business_name,
            office_number,
            floor,
            is_active
          FROM users
          WHERE role = 'tenant'
          ORDER BY display_name ASC
        `)
      ]);

    return res.json({
      rooms: roomsResult.rows,
      bookings: bookingsResult.rows,
      tenants: tenantsResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
