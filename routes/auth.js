const express = require('express');
const bcrypt = require('bcryptjs');
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

      req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
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