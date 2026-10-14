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
function getOfficeNumbers(officeNumber) {
  if (!officeNumber) return [];

  return String(officeNumber)
    .split('-')
    .map(value => value.trim())
    .filter(value => /^\d+$/.test(value))
    .map(Number);
}


function getDirectoryName(client) {
  return String(
    client.directory_name ||
    client.business_name ||
    client.display_name ||
    ''
  ).trim();
}


function buildFloorDirectory(clients, floor) {
  const directory = {};

  clients
    .filter(client =>
      client.is_active === true &&
      Number(client.floor) === Number(floor)
    )
    .forEach(client => {
      const officeNumbers =
        getOfficeNumbers(client.office_number);

      const name =
        getDirectoryName(client);

      officeNumbers.forEach(officeNumber => {
        directory[officeNumber] = {
          officeNumber,
          name,
          userId: client.id
        };
      });
    });

  return directory;
}

router.use(requireAdmin);
// =====================================================
// AlonSpace - Create Unit Owner
// =====================================================

router.post('/units/owners', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const phone = normalizeOptional(req.body.phone);
  const email = normalizeOptional(req.body.email);
  const notes = normalizeOptional(req.body.notes);

  const asArray = (value) => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  };

  const unitIds = asArray(req.body.unit_ids).map(String);

  const floors = asArray(req.body.new_unit_floors);
  const numbers = asArray(req.body.new_unit_numbers);

  const redirectError = (message) => {
    return res.redirect(
      '/admin/units?error=' + encodeURIComponent(message)
    );
  };

  if (!name || name.length > 200) {
    return redirectError('יש להזין שם בעלים תקין');
  }

  if (
    email &&
    (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
  ) {
    return redirectError('כתובת האימייל אינה תקינה');
  }

  if (
    (phone && phone.length > 50) ||
    (notes && notes.length > 2000)
  ) {
    return redirectError('אחד השדות ארוך מדי');
  }

  if (
    unitIds.length > 100 ||
    unitIds.some(id => !/^[1-9]\d*$/.test(id)) ||
    new Set(unitIds).size !== unitIds.length
  ) {
    return redirectError('רשימת היחידות הקיימות אינה תקינה');
  }

  if (
    floors.length !== numbers.length ||
    floors.length > 100
  ) {
    return redirectError('רשימת היחידות החדשות אינה תקינה');
  }

  const newUnits = [];

  for (let i = 0; i < floors.length; i++) {
    const floor = Number(floors[i]);
    const unitNumber = String(numbers[i] || '').trim();

    if (
      ![4, 6].includes(floor) ||
      !unitNumber ||
      unitNumber.length > 30
    ) {
      return redirectError(
        'יש להזין קומה ומספר תקינים לכל יחידה'
      );
    }

    newUnits.push({
      floor,
      unitNumber
    });
  }

  const uniqueUnits = new Set(
    newUnits.map(unit => `${unit.floor}:${unit.unitNumber}`)
  );

  if (uniqueUnits.size !== newUnits.length) {
    return redirectError(
      'אותה יחידה הוזנה יותר מפעם אחת'
    );
  }

  let client;

  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    if (unitIds.length > 0) {
      const availableResult = await client.query(
        `
          SELECT id
          FROM rental_units
          WHERE
            id = ANY($1::bigint[])
            AND ownership_type = 'external'
            AND owner_id IS NULL
            AND is_active = TRUE
          FOR UPDATE
        `,
        [unitIds]
      );

      if (availableResult.rows.length !== unitIds.length) {
        await client.query('ROLLBACK');

        return redirectError(
          'אחת היחידות הקיימות כבר משויכת לבעלים או אינה זמינה'
        );
      }
    }

    const ownerResult = await client.query(
      `
        INSERT INTO unit_owners (
          name,
          phone,
          email,
          notes
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [name, phone, email, notes]
    );

    const ownerId = ownerResult.rows[0].id;

    if (unitIds.length > 0) {
      await client.query(
        `
          UPDATE rental_units
          SET
            owner_id = $1,
            updated_at = NOW()
          WHERE id = ANY($2::bigint[])
        `,
        [ownerId, unitIds]
      );
    }

    for (const unit of newUnits) {
      await client.query(
        `
          INSERT INTO rental_units (
            floor,
            unit_number,
            ownership_type,
            owner_id
          )
          VALUES ($1, $2, 'external', $3)
        `,
        [unit.floor, unit.unitNumber, ownerId]
      );
    }

    await client.query('COMMIT');

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent(
        'בעל היחידות והמשרדים נשמרו בהצלחה'
      )
    );
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Owner rollback failed:', rollbackError);
      }
    }

    if (error.code === '23505') {
      return redirectError(
        'אחד המשרדים שהוזנו כבר קיים בקומה שנבחרה'
      );
    }

    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});

 // =====================================================
 // AlonSpace - Update Unit Owner
 // =====================================================

router.post('/units/owners/:id/update', async (req, res, next) => {
  try {
    const ownerId = String(req.params.id || '').trim();
    const name = String(req.body.name || '').trim();
    const phone = normalizeOptional(req.body.phone);
    const email = normalizeOptional(req.body.email);
    const notes = normalizeOptional(req.body.notes);

    const redirectError = message =>
      res.redirect('/admin/units?error=' + encodeURIComponent(message));

    if (!/^[1-9]\d*$/.test(ownerId)) {
      return redirectError('מזהה בעלים אינו תקין');
    }

    if (!name || name.length > 200) {
      return redirectError('יש להזין שם בעלים תקין');
    }

    if (
      email &&
      (email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      return redirectError('כתובת האימייל אינה תקינה');
    }

    if (
      (phone && phone.length > 50) ||
      (notes && notes.length > 2000)
    ) {
      return redirectError('אחד השדות ארוך מדי');
    }

    const result = await db.query(
      `
        UPDATE unit_owners
        SET
          name = $2,
          phone = $3,
          email = $4,
          notes = $5
        WHERE id = $1
          AND is_active = TRUE
        RETURNING id
      `,
      [ownerId, name, phone, email, notes]
    );

    if (!result.rows.length) {
      return redirectError('בעל היחידה לא נמצא או אינו פעיל');
    }

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('פרטי בעל היחידה עודכנו בהצלחה')
    );
  } catch (error) {
    return next(error);
  }
});

// =====================================================
// AlonSpace - Deactivate Unit Owner
// =====================================================

router.post('/units/owners/:id/delete', async (req, res, next) => {
  const ownerId = String(req.params.id || '').trim();

  const redirectError = message =>
    res.redirect('/admin/units?error=' + encodeURIComponent(message));

  if (!/^[1-9]\d*$/.test(ownerId)) {
    return redirectError('מזהה בעלים אינו תקין');
  }

  let client;

  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const ownerResult = await client.query(
      `
        SELECT id
        FROM unit_owners
        WHERE id = $1
          AND is_active = TRUE
        FOR UPDATE
      `,
      [ownerId]
    );

    if (!ownerResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError('בעל היחידה לא נמצא או אינו פעיל');
    }

    const unitsResult = await client.query(
      `
        SELECT id
        FROM rental_units
        WHERE owner_id = $1
        LIMIT 1
      `,
      [ownerId]
    );

    if (unitsResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return redirectError(
        'לא ניתן למחוק בעלים שמשויכות אליו יחידות. יש להסיר את השיוכים תחילה.'
      );
    }

    await client.query(
      `
        UPDATE unit_owners
        SET is_active = FALSE
        WHERE id = $1
      `,
      [ownerId]
    );

    await client.query('COMMIT');

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('בעל היחידה הוסר מהרשימה בהצלחה')
    );
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Owner deletion rollback failed:', rollbackError);
      }
    }

    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});

// =====================================================
// AlonSpace - Create Rental Unit
// =====================================================

router.post('/units/create', async (req, res, next) => {
  try {
    const floor = Number(req.body.floor);

    const unitNumber = String(
      req.body.unit_number || ''
    ).trim();

    const ownershipType = String(
      req.body.ownership_type || ''
    ).trim();

    const ownerId = String(
      req.body.owner_id || ''
    ).trim();

    const notes = normalizeOptional(req.body.notes);

    const redirectError = (message) => {
      return res.redirect(
        '/admin/units?error=' +
        encodeURIComponent(message)
      );
    };

    if (![4, 6].includes(floor)) {
      return redirectError('יש לבחור קומה תקינה');
    }

    if (
      !unitNumber ||
      unitNumber.length > 30
    ) {
      return redirectError(
        'יש להזין מספר יחידה תקין (עד 30 תווים)'
      );
    }

    if (
      !['external', 'alonspace'].includes(
        ownershipType
      )
    ) {
      return redirectError('סוג הבעלות אינו תקין');
    }

    if (notes && notes.length > 2000) {
      return redirectError('שדה ההערות ארוך מדי');
    }

    let selectedOwnerId = null;

    if (ownershipType === 'external') {
      if (!/^[1-9]\d*$/.test(ownerId)) {
        return redirectError(
          'יש לבחור בעלים ליחידה בבעלות חיצונית'
        );
      }

      const ownerResult = await db.query(
        `
          SELECT id
          FROM unit_owners
          WHERE
            id = $1
            AND is_active = TRUE
          LIMIT 1
        `,
        [ownerId]
      );

      if (!ownerResult.rows.length) {
        return redirectError(
          'הבעלים שנבחר אינו קיים או אינו פעיל'
        );
      }

      selectedOwnerId = ownerResult.rows[0].id;
    }

    await db.query(
      `
        INSERT INTO rental_units (
          floor,
          unit_number,
          ownership_type,
          owner_id,
          notes
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        floor,
        unitNumber,
        ownershipType,
        selectedOwnerId,
        notes
      ]
    );

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent(
        `יחידה ${unitNumber} בקומה ${floor} נוספה בהצלחה`
      )
    );

  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(
        '/admin/units?error=' +
        encodeURIComponent(
          'יחידה עם מספר זה כבר קיימת בקומה שנבחרה'
        )
      );
    }

    return next(error);
  }
});


// =====================================================
// AlonSpace - Create Unit Tenancy
// =====================================================

router.post('/units/tenancies/create', async (req, res, next) => {
  const unitId = String(req.body.unit_id || '').trim();
  const userId = String(req.body.user_id || '').trim();
  const rentalModel = String(req.body.rental_model || '').trim();
  const startDate = String(req.body.start_date || '').trim();
  const endDate = String(req.body.end_date || '').trim() || null;
  const notes = normalizeOptional(req.body.notes);

  const redirectError = (message) => {
    return res.redirect(
      '/admin/units?error=' + encodeURIComponent(message)
    );
  };

  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      return false;
    }

    const date = new Date(value + 'T00:00:00Z');

    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };

  if (
    !/^[1-9]\d*$/.test(unitId) ||
    !/^[1-9]\d*$/.test(userId)
  ) {
    return redirectError('יש לבחור יחידה ושוכר תקינים');
  }

  if (!validDate(startDate) || (endDate && !validDate(endDate))) {
    return redirectError('יש להזין תאריכי חוזה תקינים');
  }

  if (endDate && endDate < startDate) {
    return redirectError('תאריך הסיום קודם לתאריך ההתחלה');
  }

  if (notes && notes.length > 2000) {
    return redirectError('שדה ההערות ארוך מדי');
  }
  let client;

  try {
    client = await db.pool.connect();

    await client.query('BEGIN');

    // מונע יצירת חוזים חופפים בבקשות מקבילות
    await client.query(
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [unitId]
    );

    const unitResult = await client.query(
      `
        SELECT id, ownership_type
        FROM rental_units
        WHERE id = $1 AND is_active = TRUE
        LIMIT 1
      `,
      [unitId]
    );

    if (!unitResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError('היחידה אינה קיימת או אינה פעילה');
    }

    const ownershipType = unitResult.rows[0].ownership_type;

    const allowedModels = ownershipType === 'alonspace'
      ? ['alonspace_owned']
      : ['managed', 'direct_owner'];

    if (!allowedModels.includes(rentalModel)) {
      await client.query('ROLLBACK');
      return redirectError('מודל ההשכרה אינו מתאים לסוג הבעלות');
    }

    const userResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE
          id = $1
          AND role = 'tenant'
          AND is_active = TRUE
        LIMIT 1
      `,
      [userId]
    );

    if (!userResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError('השוכר אינו קיים או אינו פעיל');
    }

    const overlapResult = await client.query(
      `
        SELECT id
        FROM unit_tenancies
        WHERE
          unit_id = $1
          AND start_date <= COALESCE(
            $3::date,
            'infinity'::date
          )
          AND COALESCE(
            end_date,
            'infinity'::date
          ) >= $2::date
        LIMIT 1
      `,
      [unitId, startDate, endDate]
    );

    if (overlapResult.rows.length) {
      await client.query('ROLLBACK');

      return redirectError(
        'כבר קיים חוזה לתקופה זו ביחידה. לא ניתן ליצור חוזים חופפים.'
      );
    }

    const tenancyResult = await client.query(
      `
        INSERT INTO unit_tenancies (
          unit_id,
          rental_model,
          start_date,
          end_date,
          notes
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [unitId, rentalModel, startDate, endDate, notes]
    );

    await client.query(
      `
        INSERT INTO unit_tenancy_users (
          tenancy_id,
          user_id,
          tenant_role
        )
        VALUES ($1, $2, 'primary')
      `,
      [tenancyResult.rows[0].id, userId]
    );

    await client.query('COMMIT');

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('חוזה השכירות נוצר בהצלחה')
    );
    } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Tenancy rollback failed:', rollbackError);
      }
    }

    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});


// =====================================================
// AlonSpace - Update Existing Unit Tenancy
// =====================================================

router.post('/units/tenancies/update', async (req, res, next) => {
  const tenancyId = String(req.body.tenancy_id || '').trim();
  const userId = String(req.body.user_id || '').trim();
  const rentalModel = String(req.body.rental_model || '').trim();
  const startDate = String(req.body.start_date || '').trim();
  const endDate = String(req.body.end_date || '').trim() || null;
  const notes = normalizeOptional(req.body.notes);

  const redirectError = (message) => {
    return res.redirect(
      '/admin/units?error=' + encodeURIComponent(message)
    );
  };

  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      return false;
    }

    const date = new Date(value + 'T00:00:00Z');

    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };

  if (
    !/^[1-9]\d*$/.test(tenancyId) ||
    !/^[1-9]\d*$/.test(userId)
  ) {
    return redirectError('יש לבחור שכירות ושוכר תקינים');
  }

  if (
    !validDate(startDate) ||
    (endDate && !validDate(endDate))
  ) {
    return redirectError('יש להזין תאריכים תקינים');
  }

  if (endDate && endDate < startDate) {
    return redirectError('תאריך הסיום קודם לתאריך ההתחלה');
  }

  if (notes && notes.length > 2000) {
    return redirectError('שדה ההערות ארוך מדי');
  }

  let client;

  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const tenancyResult = await client.query(
      `
        SELECT
          t.id,
          t.unit_id,
          ru.ownership_type
        FROM unit_tenancies t
        JOIN rental_units ru ON ru.id = t.unit_id
        WHERE
          t.id = $1
          AND ru.is_active = TRUE
        LIMIT 1
      `,
      [tenancyId]
    );

    if (!tenancyResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError('השכירות אינה קיימת');
    }

    const tenancy = tenancyResult.rows[0];

    await client.query(
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [tenancy.unit_id]
    );

    const allowedModels = tenancy.ownership_type === 'alonspace'
      ? ['alonspace_owned']
      : ['managed', 'direct_owner'];

    if (!allowedModels.includes(rentalModel)) {
      await client.query('ROLLBACK');
      return redirectError('מודל ההשכרה אינו מתאים לסוג הבעלות');
    }

    const userResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE
          id = $1
          AND role = 'tenant'
          AND is_active = TRUE
        LIMIT 1
      `,
      [userId]
    );

    if (!userResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError('השוכר אינו קיים או אינו פעיל');
    }

    const overlapResult = await client.query(
      `
        SELECT id
        FROM unit_tenancies
        WHERE
          unit_id = $1
          AND id <> $2
          AND start_date <= COALESCE(
            $4::date,
            'infinity'::date
          )
          AND COALESCE(
            end_date,
            'infinity'::date
          ) >= $3::date
        LIMIT 1
      `,
      [
        tenancy.unit_id,
        tenancyId,
        startDate,
        endDate
      ]
    );

    if (overlapResult.rows.length) {
      await client.query('ROLLBACK');
      return redirectError(
        'התאריכים חופפים לשכירות אחרת באותו משרד'
      );
    }

    await client.query(
      `
        UPDATE unit_tenancies
        SET
          rental_model = $1,
          start_date = $2,
          end_date = $3,
          notes = $4,
          updated_at = NOW()
        WHERE id = $5
      `,
      [
        rentalModel,
        startDate,
        endDate,
        notes,
        tenancyId
      ]
    );

    const primaryResult = await client.query(
      `
        UPDATE unit_tenancy_users
        SET user_id = $1
        WHERE
          tenancy_id = $2
          AND tenant_role = 'primary'
        RETURNING id
      `,
      [userId, tenancyId]
    );

    if (!primaryResult.rows.length) {
      await client.query(
        `
          INSERT INTO unit_tenancy_users (
            tenancy_id,
            user_id,
            tenant_role
          )
          VALUES ($1, $2, 'primary')
        `,
        [tenancyId, userId]
      );
    }

    await client.query('COMMIT');

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('פרטי השכירות עודכנו בהצלחה')
    );
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Tenancy update rollback failed:', rollbackError);
      }
    }

    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});
// =====================================================
// AlonSpace - Save Monthly Management Fee
// =====================================================

router.post('/units/management-fee', async (req, res, next) => {
  try {
    const unitId = String(req.body.unit_id || '').trim();
    const amountText = String(
      req.body.monthly_amount ?? ''
    ).trim();

    const amount = Number(amountText);

    const redirectError = (message) => {
      return res.redirect(
        '/admin/units?error=' +
        encodeURIComponent(message)
      );
    };

    if (!/^[1-9]\d*$/.test(unitId)) {
      return redirectError('יחידה לא תקינה');
    }

    if (
      amountText === '' ||
      !/^\d+(\.\d{1,2})?$/.test(amountText) ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1000000
    ) {
      return redirectError(
        'יש להזין דמי ניהול תקינים בשקלים'
      );
    }

    const unitResult = await db.query(
      `
        SELECT id
        FROM rental_units
        WHERE
          id = $1
          AND ownership_type = 'external'
          AND is_active = TRUE
        LIMIT 1
      `,
      [unitId]
    );

    if (!unitResult.rows.length) {
      return redirectError(
        'ניתן להגדיר דמי ניהול רק ליחידה פעילה בבעלות חיצונית'
      );
    }

    await db.query(
      `
        INSERT INTO unit_management_fee_rates (
          unit_id,
          monthly_amount,
          effective_from
        )
        VALUES (
          $1,
          $2,
          DATE_TRUNC('month', CURRENT_DATE)::date
        )
        ON CONFLICT (unit_id, effective_from)
        DO UPDATE SET
          monthly_amount = EXCLUDED.monthly_amount
      `,
      [unitId, amount]
    );

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('דמי הניהול נשמרו בהצלחה')
    );
  } catch (error) {
    return next(error);
  }
});

// =====================================================
// AlonSpace - Save Unit Rent Settings
// =====================================================

router.post('/units/rent-settings', async (req, res, next) => {
  try {
    const tenancyId = String(req.body.tenancy_id || '').trim();
    const rentText = String(req.body.monthly_rent ?? '').trim();
    const payoutText = String(req.body.monthly_owner_payout ?? '').trim();

    const validAmount = value =>
      /^\d+(\.\d{1,2})?$/.test(value) &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 1000000;

    const redirectError = message =>
      res.redirect(
        '/admin/units?error=' + encodeURIComponent(message)
      );

    if (!/^[1-9]\d*$/.test(tenancyId)) {
      return redirectError('מזהה שכירות אינו תקין');
    }

    if (!validAmount(rentText) || !validAmount(payoutText)) {
      return redirectError('יש להזין סכומים תקינים בשקלים');
    }

    const tenancyResult = await db.query(
      `
        SELECT
          ut.id,
          ut.rental_model,
          ru.ownership_type
        FROM unit_tenancies ut
        JOIN rental_units ru ON ru.id = ut.unit_id
        WHERE
          ut.id = $1
          AND ru.is_active = TRUE
        LIMIT 1
      `,
      [tenancyId]
    );

    if (!tenancyResult.rows.length) {
      return redirectError('השכירות אינה קיימת או אינה פעילה');
    }
    if (tenancyResult.rows[0].rental_model === 'direct_owner') {
      return redirectError(
        'בשכירות ישירה מול הבעלים ניתן לנהל רק דמי ניהול'
      );
    }
    if (
      tenancyResult.rows[0].ownership_type === 'alonspace' &&
      Number(payoutText) !== 0
    ) {
      return redirectError(
        'ביחידה בבעלות AlonSpace אין תשלום לבעלים חיצוניים'
      );
    }

    await db.query(
      `
        INSERT INTO unit_rent_rates (
          tenancy_id,
          monthly_rent,
          monthly_owner_payout,
          effective_from
        )
        VALUES (
          $1,
          $2,
          $3,
          DATE_TRUNC('month', CURRENT_DATE)::date
        )
        ON CONFLICT (tenancy_id, effective_from)
        DO UPDATE SET
          monthly_rent = EXCLUDED.monthly_rent,
          monthly_owner_payout = EXCLUDED.monthly_owner_payout
      `,
      [
        tenancyId,
        Number(rentText),
        Number(payoutText)
      ]
    );

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('ההגדרות הכספיות נשמרו בהצלחה')
    );
  } catch (error) {
    return next(error);
  }
});

// =====================================================
// AlonSpace - Update Unit Tenant Display Assignment
// =====================================================

router.post('/units/tenant-assignment', async (req, res, next) => {
  try {
    const unitId = String(req.body.unit_id || '').trim();

    const userIds = [
      ...new Set(
        (Array.isArray(req.body.user_ids)
          ? req.body.user_ids
          : req.body.user_ids
            ? [req.body.user_ids]
            : []
        ).map(String)
      )
    ];

    const redirectError = message =>
      res.redirect('/admin/units?error=' + encodeURIComponent(message));

    if (!/^[1-9]\d*$/.test(unitId)) {
      return redirectError('מזהה יחידה אינו תקין');
    }

    if (
      userIds.length > 100 ||
      userIds.some(id => !/^[1-9]\d*$/.test(id))
    ) {
      return redirectError('רשימת הדיירים אינה תקינה');
    }

    const unitResult = await db.query(
      `SELECT id FROM rental_units
       WHERE id = $1 AND is_active = TRUE`,
      [unitId]
    );

    if (!unitResult.rows.length) {
      return redirectError('היחידה לא נמצאה');
    }

    if (req.body.restore_auto === '1') {
      await db.query(
        'DELETE FROM unit_tenant_overrides WHERE unit_id = $1',
        [unitId]
      );
    } else {
      if (userIds.length) {
        const usersResult = await db.query(
          `SELECT id FROM users
           WHERE id = ANY($1::bigint[])
             AND role = 'tenant'
             AND is_active = TRUE`,
          [userIds]
        );

        if (usersResult.rows.length !== userIds.length) {
          return redirectError('אחד הדיירים שנבחרו אינו פעיל או אינו קיים');
        }
      }

      await db.query(
        `INSERT INTO unit_tenant_overrides
           (unit_id, user_ids, updated_at)
         VALUES ($1, $2::bigint[], NOW())
         ON CONFLICT (unit_id)
         DO UPDATE SET
           user_ids = EXCLUDED.user_ids,
           updated_at = NOW()`,
        [unitId, userIds]
      );
    }

    return res.redirect(
      '/admin/units?success=' +
      encodeURIComponent('שיוך הדיירים עודכן בהצלחה')
    );
  } catch (error) {
    return next(error);
  }
});

// =====================================================
// AlonSpace - Units Management
// =====================================================

router.get('/units', async (req, res, next) => {
  try {
    const unitsResult = await db.query(`
      SELECT
        ru.id,
        ru.floor,
        ru.unit_number,
        ru.ownership_type,
        ru.owner_id,
        ru.is_active,
        ru.notes,

        uo.name AS owner_name,

        COALESCE(
          fee.monthly_amount,
          0
        ) AS monthly_management_fee,

        rent.monthly_rent,
        rent.monthly_owner_payout,

        ut.id AS tenancy_id,
        ut.rental_model,
        ut.start_date,
        ut.end_date,
        NULL::text AS tenancy_notes,

        tenant.display_name AS tenant_name,
        tenant.business_name AS tenant_business_name,
        tenant.id AS tenant_user_id

      FROM rental_units ru

      LEFT JOIN unit_owners uo
        ON uo.id = ru.owner_id

      LEFT JOIN LATERAL (
        SELECT monthly_amount
        FROM unit_management_fee_rates
        WHERE
          unit_id = ru.id
          AND effective_from <=
            DATE_TRUNC('month', CURRENT_DATE)::date
        ORDER BY effective_from DESC, id DESC
        LIMIT 1
      ) fee ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          t.id,
          t.rental_model,
          t.start_date,
          t.end_date,
          t.notes
        FROM unit_tenancies t
        WHERE
          t.unit_id = ru.id
        ORDER BY
          CASE
            WHEN t.start_date <= CURRENT_DATE
              AND (
                t.end_date IS NULL
                OR t.end_date >= CURRENT_DATE
              )
            THEN 0
            WHEN t.start_date > CURRENT_DATE
            THEN 1
            ELSE 2
          END,
          t.start_date DESC,
          t.id DESC
        LIMIT 1
      ) ut ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          monthly_rent,
          monthly_owner_payout
        FROM unit_rent_rates
        WHERE
          tenancy_id = ut.id
          AND effective_from <=
            DATE_TRUNC('month', CURRENT_DATE)::date
        ORDER BY effective_from DESC, id DESC
        LIMIT 1
      ) rent ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          u.id,
          u.display_name,
          u.business_name
        FROM unit_tenancy_users tu
        JOIN users u
          ON u.id = tu.user_id
        WHERE
          tu.tenancy_id = ut.id
          AND tu.tenant_role = 'primary'
        LIMIT 1
      ) tenant ON TRUE

      ORDER BY
        ru.floor ASC,
        CASE
          WHEN ru.unit_number ~ '^[0-9]+'
          THEN (
            SUBSTRING(
              ru.unit_number FROM '^[0-9]+'
            )
          )::NUMERIC
          ELSE 999999
        END ASC,
        ru.unit_number ASC
    `);

       const units = unitsResult.rows;

    const ownersResult = await db.query(`
      SELECT
        id,
        name,
        phone,
        email,
        notes
      FROM unit_owners
      WHERE is_active = TRUE
      ORDER BY LOWER(name) ASC, id ASC
    `);

      const tenantsResult = await db.query(`
      SELECT
        id,
        display_name,
        business_name,
        office_number,
        floor,
        rental_start_date,
        rental_end_date
      FROM users
      WHERE
        role = 'tenant'
        AND is_active = TRUE
      ORDER BY LOWER(display_name), id
    `);

    const overridesResult = await db.query(`
      SELECT unit_id, user_ids
      FROM unit_tenant_overrides
    `);

    const overridesByUnit = new Map(
      overridesResult.rows.map(row => [
        String(row.unit_id),
        row.user_ids.map(String)
      ])
    );

    units.forEach(unit => {
      const unitId = String(unit.id);

      unit.tenant_override_active = overridesByUnit.has(unitId);
      unit.manual_tenant_ids = overridesByUnit.get(unitId) || [];
    });

    return res.render('admin/units', {
      title: 'יחידות וכספים - AlonSpace',
      layout: false,
      adminName: req.session.userName,
      units,
      owners: ownersResult.rows,
      tenants: tenantsResult.rows,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const pendingBusinessProfilesResult =
  await db.query(
    `
      SELECT
        tp.id,
        tp.user_id,
        tp.display_name,
        tp.business_field,
        tp.bio,
        tp.website_url,
        tp.linkedin_url,
        tp.logo_data IS NOT NULL
          AS has_logo,
        tp.community_visible,
tp.public_consent,
tp.public_status,
tp.updated_at,
        u.display_name AS tenant_name,
        u.business_name AS tenant_business_name,
        u.office_number,
        u.floor

      FROM tenant_profiles tp

      JOIN users u
        ON u.id = tp.user_id

      WHERE
  tp.community_visible = TRUE
  AND tp.public_consent = TRUE
  AND tp.public_status = 'pending'
  AND u.role = 'tenant'
      ORDER BY
        tp.updated_at ASC
    `
  );

const pendingBusinessProfiles =
  pendingBusinessProfilesResult.rows;
  const businessProfilesResult =
  await db.query(
    `
      SELECT
        tp.id,
        tp.user_id,
        tp.display_name,
        tp.business_field,
        tp.bio,
        tp.website_url,
        tp.linkedin_url,

        tp.logo_data IS NOT NULL
          AS has_logo,

        tp.community_visible,
        tp.community_status,
        tp.public_consent,
        tp.public_status,
        tp.updated_at,

        u.display_name AS tenant_name,
        u.business_name AS tenant_business_name,
        u.office_number,
        u.floor

      FROM tenant_profiles tp

      JOIN users u
        ON u.id = tp.user_id

      WHERE
        u.role = 'tenant'
        AND u.is_active = TRUE

      ORDER BY
        tp.updated_at DESC
    `
  );

const businessProfiles =
  businessProfilesResult.rows;
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
    const rentalAlertsResult = await db.query(`
  SELECT
    id,
    display_name,
    is_active,
    business_name,
    office_number,
    floor,
    phone,
    email,
    rental_end_date,

    (rental_end_date - CURRENT_DATE)::INTEGER
      AS days_remaining

  FROM users

  WHERE
    role = 'tenant'
    AND is_active = TRUE
    AND rental_end_date IS NOT NULL
    AND rental_end_date <= CURRENT_DATE + INTERVAL '30 days'

  ORDER BY
    rental_end_date ASC
`);
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
    u.id,
    u.username,
    u.email,
    u.display_name,
    u.phone,
    u.business_name,
    u.office_number,
    u.floor,
    u.rental_start_date,
    u.rental_end_date,
    u.monthly_meeting_hours,
    u.meeting_access_both_floors,
    u.is_active,
    u.must_change_password,
    u.created_at,

    COALESCE(
      (
        SELECT SUM(
          EXTRACT(
            EPOCH FROM (
              mb.end_time - mb.start_time
            )
          ) / 3600
        )
        FROM meeting_bookings mb
        WHERE mb.user_id = u.id
      ),
      0
    )::NUMERIC AS total_meeting_hours,

    COALESCE(
      (
        SELECT SUM(
          EXTRACT(
            EPOCH FROM (
              mb.end_time - mb.start_time
            )
          ) / 3600
        )
        FROM meeting_bookings mb
        WHERE
          mb.user_id = u.id
          AND mb.booking_date >=
            DATE_TRUNC(
              'month',
              CURRENT_DATE
            )::DATE
          AND mb.booking_date <
            (
              DATE_TRUNC(
                'month',
                CURRENT_DATE
              )
              + INTERVAL '1 month'
            )::DATE
      ),
      0
    )::NUMERIC AS month_meeting_hours,

    GREATEST(
      0,

      COALESCE(
        u.monthly_meeting_hours,
        6
      )

      -

      COALESCE(
        (
          SELECT SUM(
            EXTRACT(
              EPOCH FROM (
                mb.end_time - mb.start_time
              )
            ) / 3600
          )
          FROM meeting_bookings mb
          WHERE
            mb.user_id = u.id
            AND mb.booking_date >=
              DATE_TRUNC(
                'month',
                CURRENT_DATE
              )::DATE
            AND mb.booking_date <
              (
                DATE_TRUNC(
                  'month',
                  CURRENT_DATE
                )
                + INTERVAL '1 month'
              )::DATE
        ),
        0
      )
    )::NUMERIC AS remaining_meeting_hours,

    EXISTS (
      SELECT 1
      FROM onboarding_surveys s
      WHERE s.user_id = u.id
    ) AS survey_completed

  FROM users u

  WHERE u.role = 'tenant'

ORDER BY
  CASE WHEN u.floor IS NULL THEN 1 ELSE 0 END,
  u.floor ASC,
  CASE
    WHEN u.office_number ~ '^[0-9]+$'
    THEN u.office_number::INTEGER
    ELSE 999999
  END ASC,
  u.office_number ASC,
  LOWER(u.display_name) ASC
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



const floor4Directory =
  buildFloorDirectory(clientsResult.rows, 4);

const floor6Directory =
  buildFloorDirectory(clientsResult.rows, 6);


const floorDirectoryOverridesResult = await db.query(`
  SELECT
    floor,
    office_number,
    directory_name
  FROM floor_directory_overrides
`);

const floorDirectoryOverrides = {
  4: {},
  6: {}
};

floorDirectoryOverridesResult.rows.forEach(row => {
  const floor = Number(row.floor);
  const office = Number(row.office_number);

  if (!floorDirectoryOverrides[floor]) {
    floorDirectoryOverrides[floor] = {};
  }

  floorDirectoryOverrides[floor][office] =
    row.directory_name || '';
});

    return res.render('admin/dashboard', {
  title: 'פאנל ניהול - AlonSpace',
  layout: false,
  adminName: req.session.userName,

  clients: clientsResult.rows,
  admins: adminsResult.rows,
  messages: messagesResult.rows,
  testimonials: testimonialsResult.rows,
  floor4Directory,
  floor6Directory,
  meetingBookings: meetingBookingsResult.rows,
  meetingRooms: meetingRoomsResult.rows,
floorDirectoryOverrides,
  // שאלון
  surveys,
  meetingRoomUsagePercent,
  averageMeetingRoomUsage,

  stats,

  error: req.query.error || null,
  success: req.query.success || null,

  quotaAlerts: quotaAlertsResult.rows,
  rentalAlerts: rentalAlertsResult.rows,
  pendingBusinessProfiles,
  businessProfiles,
  newClientInvite,
});
  } catch (error) {
    return next(error);
  }
});


router.get('/business-profiles/:id/logo',

  async (req, res, next) => {
    try {
      const result =
        await db.query(
          `
            SELECT
              logo_data,
              logo_mime_type
            FROM tenant_profiles
            WHERE id = $1
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


router.post('/business-profiles/:id/approve',

  async (req, res, next) => {
    try {
      const result =
        await db.query(
          `
            UPDATE tenant_profiles
            SET
              public_status = 'approved',
              updated_at = NOW()
            WHERE
              id = $1
AND community_visible = TRUE
AND community_status = 'approved'
AND public_consent = TRUE
AND public_status IN (
  'pending',
  'rejected'
)
            RETURNING
              id,
              display_name
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'הפרופיל לא נמצא או שאינו ממתין לאישור',
            'business-profiles'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          `הפרופיל של ${result.rows[0].display_name} אושר להצגה באתר`,
          'business-profiles'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.post('/business-profiles/:id/unpublish',

  async (req, res, next) => {
    try {

      const result =
        await db.query(
          `
            UPDATE tenant_profiles

            SET
              public_status = 'rejected',
              updated_at = NOW()

            WHERE
              id = $1
              AND public_status = 'approved'

            RETURNING
              id,
              display_name
          `,
          [req.params.id]
        );


      if (!result.rows.length) {

        return res.redirect(
          adminRedirect(
            'error',
            'הפרופיל לא נמצא או שאינו מוצג באתר',
            'business-profiles'
          )
        );

      }


      return res.redirect(
        adminRedirect(
          'success',
          `הפרופיל של ${result.rows[0].display_name} הוסר מהאתר הציבורי`,
          'business-profiles'
        )
      );

    } catch (error) {

      return next(error);

    }
  }
);

router.post('/business-profiles/:id/reject',

  async (req, res, next) => {
    try {
      const result =
        await db.query(
          `
            UPDATE tenant_profiles
            SET
              public_status = 'rejected',
              updated_at = NOW()
            WHERE
              id = $1
              AND public_status = 'pending'
            RETURNING
              id,
              display_name
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'הפרופיל לא נמצא או שאינו ממתין לאישור',
            'business-profiles'
          )
        );
      }

      return res.redirect(
        adminRedirect(
          'success',
          `הפרופיל של ${result.rows[0].display_name} נדחה`,
          'business-profiles'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);
router.post('/business-profiles/:id/toggle-community',

  async (req, res, next) => {
    try {

      const profileId = Number(req.params.id);

      if (
        !Number.isSafeInteger(profileId) ||
        profileId <= 0
      ) {
        return res.redirect(
          adminRedirect(
            'error',
            'מזהה פרופיל לא תקין',
            'business-profiles'
          )
        );
      }

      const result = await db.query(
        `
          UPDATE tenant_profiles

          SET
            community_status =
              CASE
                WHEN community_status = 'approved'
                  THEN 'rejected'
                ELSE 'approved'
              END,

            public_status =
              CASE
                WHEN community_status = 'approved'
                  THEN 'rejected'
                ELSE public_status
              END,

            updated_at = NOW()

          WHERE id = $1
            AND community_visible = TRUE

          RETURNING
            id,
            display_name,
            community_status
        `,
        [profileId]
      );

      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'הפרופיל לא נמצא או שהדייר לא ביקש להופיע בקהילה',
            'business-profiles'
          )
        );
      }

      const profile = result.rows[0];

      const message =
        profile.community_status === 'approved'
          ? `הפרופיל של ${profile.display_name} אושר לקהילה`
          : `הפרופיל של ${profile.display_name} הוסר מהקהילה ומהאתר`;

      return res.redirect(
        adminRedirect(
          'success',
          message,
          'business-profiles'
        )
      );

    } catch (error) {
      return next(error);
    }
  }
);

router.post('/business-profiles/:id/edit',

  async (req, res, next) => {

    try {

      const profileId =
        Number(req.params.id);

      if (
        !Number.isSafeInteger(profileId) ||
        profileId <= 0
      ) {
        return res.redirect(
          adminRedirect(
            'error',
            'מזהה פרופיל לא תקין',
            'business-profiles'
          )
        );
      }


      /* =====================================
         FORM VALUES
      ===================================== */

      const personName =
        String(req.body.person_name || '')
          .trim()
          .slice(0, 120);

      const displayName =
        String(req.body.display_name || '')
          .trim()
          .slice(0, 120);

      const businessField =
        String(req.body.business_field || '')
          .trim()
          .slice(0, 120);

      const bio =
        String(req.body.bio || '')
          .trim()
          .slice(0, 300);

      const websiteUrl =
        String(req.body.website_url || '')
          .trim();

      const linkedinUrl =
        String(req.body.linkedin_url || '')
          .trim();


      /* =====================================
         VALIDATION
      ===================================== */

      if (!displayName) {
        return res.redirect(
          adminRedirect(
            'error',
            'חובה להזין שם עסק',
            'business-profiles'
          )
        );
      }


      function normalizeOptionalUrl(value) {

        const trimmed =
          String(value || '').trim();

        if (!trimmed) {
          return {
            valid: true,
            url: null
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
              url: null
            };
          }

          return {
            valid: true,
            url: parsed.toString()
          };

        } catch {

          return {
            valid: false,
            url: null
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
          adminRedirect(
            'error',
            'כתובת האתר או LinkedIn אינה תקינה',
            'business-profiles'
          )
        );
      }


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
         UPDATE PROFILE
      ===================================== */

      const result =
        await db.query(
          `
            UPDATE tenant_profiles

            SET

              person_name = $2,
              display_name = $3,
              business_field = $4,
              bio = $5,

              website_url = $6,
              linkedin_url = $7,

              logo_data =
                CASE
                  WHEN $8::bytea IS NOT NULL
                  THEN $8::bytea
                  ELSE logo_data
                END,

              logo_mime_type =
                CASE
                  WHEN $8::bytea IS NOT NULL
                  THEN $9
                  ELSE logo_mime_type
                END,

              logo_url =
                CASE
                  WHEN $8::bytea IS NOT NULL
                  THEN '/dashboard/business-profile/logo'
                  ELSE logo_url
                END,

              updated_at = NOW()

            WHERE id = $1

            RETURNING
              id,
              display_name
          `,
          [
            profileId,
            personName || null,
            displayName,
            businessField || null,
            bio || null,
            normalizedWebsite.url,
            normalizedLinkedin.url,
            logoData,
            logoMimeType
          ]
        );


      if (!result.rows.length) {
        return res.redirect(
          adminRedirect(
            'error',
            'הפרופיל העסקי לא נמצא',
            'business-profiles'
          )
        );
      }


      return res.redirect(
        adminRedirect(
          'success',
          `הפרופיל של ${result.rows[0].display_name} עודכן בהצלחה`,
          'business-profiles'
        )
      );

    } catch (error) {

      return next(error);

    }

  }
);


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

router.post('/floor-directory/save',
  requireAdmin,
  async (req, res, next) => {

    try {

      const floor =
        Number(req.body.floor);

      const entries =
        JSON.parse(
          req.body.entries || '{}'
        );


      if (![4, 6].includes(floor)) {
        return res.status(400).json({
          error: 'Invalid floor'
        });
      }


      for (
        const [officeNumber, name]
        of Object.entries(entries)
      ) {

        await db.query(
          `
            INSERT INTO floor_directory_overrides (
              floor,
              office_number,
              directory_name,
              updated_at
            )
            VALUES ($1, $2, $3, NOW())

            ON CONFLICT (
              floor,
              office_number
            )

            DO UPDATE SET
              directory_name = EXCLUDED.directory_name,
              updated_at = NOW()
          `,
          [
            floor,
            Number(officeNumber),
            String(name || '').trim()
          ]
        );

      }


      return res.json({
        success: true
      });


    } catch (error) {

      next(error);

    }

  }
);

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
        meeting_access_both_floors,
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
            meeting_access_both_floors = $12,
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
          meeting_access_both_floors === 'on',
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
router.post('/admins/:id/update',
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

module.exports = router;