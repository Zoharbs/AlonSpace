const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function redirectForRole(role) {
  return role === 'admin' ? '/admin' : '/dashboard';
}

function renderLogin(res, status, error) {
  return res.status(status).render('login', {
    title: 'התחברות — AlonSpace',
    error,
    layout: false,
  });
}

router.get('/login', (req, res) => {
  if (req.session?.userId && req.session?.userRole) {
    return res.redirect(redirectForRole(req.session.userRole));
  }

  return res.render('login', {
    title: 'התחברות — AlonSpace',
    error: null,
    layout: false,
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return renderLogin(
        res,
        400,
        'נא למלא שם משתמש וסיסמה'
      );
    }

    const result = await db.query(
      `
        SELECT
          id,
          username,
          password_hash,
          display_name,
          role,
          is_active,
          must_change_password
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];

    const validPassword =
      user &&
      await bcrypt.compare(password, user.password_hash);

    if (!user || !validPassword) {
      return renderLogin(
        res,
        401,
        'שם משתמש או סיסמה שגויים'
      );
    }

    if (!user.is_active) {
      return renderLogin(
        res,
        403,
        'החשבון אינו פעיל. יש לפנות להנהלת AlonSpace.'
      );
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        return next(regenerateError);
      }

      req.session.userId = user.id;
      req.session.userRole = user.role;
      req.session.userName = user.display_name;
      req.session.mustChangePassword =
        Boolean(user.must_change_password);

      // נשאר זמנית לתאימות עם קוד אדמין ישן.
      req.session.adminId =
        user.role === 'admin' ? user.id : null;

      req.session.adminName =
        user.role === 'admin'
          ? user.display_name
          : null;



req.session.save(async (saveError) => {
  if (saveError) {
    return next(saveError);
  }

  try {
    await db.query(
      `
        UPDATE users
        SET
          last_login_at = NOW(),
          login_count = COALESCE(login_count, 0) + 1,
          updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    await db.query(
      `
        INSERT INTO user_activity (
          user_id,
          event_type
        )
        VALUES ($1, 'login')
      `,
      [user.id]
    );
  } catch (analyticsError) {
    console.error(
      'LOGIN ANALYTICS ERROR:',
      analyticsError
    );
  }

  return res.redirect(
    redirectForRole(user.role)
  );
});
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/magic-login', async (req, res, next) => {
  try {
    const token = String(
      req.query.token || ''
    ).trim();

    if (!token) {
      return res.redirect(
        '/login?error=' +
        encodeURIComponent(
          'קישור ההתחברות אינו תקין'
        )
      );
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const result = await db.query(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          is_active,
          must_change_password,
          magic_login_expires_at
        FROM users
        WHERE
          magic_login_token_hash = $1
          AND role = 'tenant'
          AND is_active = TRUE
        LIMIT 1
      `,
      [tokenHash]
    );

    const user = result.rows[0];

    if (!user) {
      return res.redirect(
        '/login?error=' +
        encodeURIComponent(
          'קישור ההתחברות אינו תקין'
        )
      );
    }

    if (
      !user.magic_login_expires_at ||
      new Date(user.magic_login_expires_at) <= new Date()
    ) {
      return res.redirect(
        '/login?error=' +
        encodeURIComponent(
          'קישור ההתחברות פג תוקף'
        )
      );
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.display_name;
    req.session.mustChangePassword =
      user.must_change_password;
return req.session.save(async (saveError) => {
  if (saveError) {
    return next(saveError);
  }

  try {
    await db.query(
      `
        UPDATE users
        SET
          last_login_at = NOW(),
          login_count = COALESCE(login_count, 0) + 1,
          updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    await db.query(
      `
        INSERT INTO user_activity (
          user_id,
          event_type
        )
        VALUES ($1, 'login')
      `,
      [user.id]
    );
  } catch (analyticsError) {
    console.error(
      'MAGIC LOGIN ANALYTICS ERROR:',
      analyticsError
    );
  }

  return res.redirect('/dashboard');
});

  } catch (error) {
    return next(error);
  }
});

router.get('/change-password', (req, res) => {
  if (!req.session?.userId || !req.session?.userRole) {
    return res.redirect('/login');
  }

  if (!req.session.mustChangePassword) {
    return res.redirect(
      redirectForRole(req.session.userRole)
    );
  }

  return res.render('change-password', {
    title: 'בחירת סיסמה חדשה — AlonSpace',
    error: null,
    layout: false,
  });
});
router.post('/change-password', async (req, res, next) => {
  try {
    if (
      !req.session?.userId ||
      !req.session?.userRole
    ) {
      return res.redirect('/login');
    }

    const newPassword = String(
      req.body.new_password || ''
    );

    const confirmPassword = String(
      req.body.confirm_password || ''
    );

    if (newPassword.length < 8) {
      return res.status(400).render(
        'change-password',
        {
          title:
            'בחירת סיסמה חדשה — AlonSpace',
          error:
            'הסיסמה חייבת להכיל לפחות 8 תווים',
          layout: false,
        }
      );
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).render(
        'change-password',
        {
          title:
            'בחירת סיסמה חדשה — AlonSpace',
          error:
            'הסיסמאות שהוזנו אינן תואמות',
          layout: false,
        }
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
            must_change_password = FALSE,
            updated_at = NOW()
          WHERE
            id = $2
            AND is_active = TRUE
          RETURNING id
        `,
      [
        passwordHash,
        req.session.userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).render(
        'change-password',
        {
          title:
            'בחירת סיסמה חדשה — AlonSpace',
          error:
            'המשתמש לא נמצא או שהחשבון אינו פעיל',
          layout: false,
        }
      );
    }

    req.session.mustChangePassword = false;

    return req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.redirect(
        redirectForRole(
          req.session.userRole
        )
      );
    });
  } catch (error) {
    return next(error);
  }
}
);
router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie('connect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res.redirect('/');
  });
});

module.exports = router;