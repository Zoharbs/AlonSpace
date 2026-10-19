
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

module.exports = router;
