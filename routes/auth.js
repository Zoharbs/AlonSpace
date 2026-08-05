const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function redirectForRole(role) {
  return role === 'admin' ? '/admin' : '/dashboard';
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

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).render('login', {
      title: 'התחברות — AlonSpace',
      error: 'נא למלא שם משתמש וסיסמה',
      layout: false,
    });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
    .get(username);

  const validPassword =
    user && bcrypt.compareSync(password, user.password_hash);

  if (!user || !validPassword) {
    return res.status(401).render('login', {
      title: 'התחברות — AlonSpace',
      error: 'שם משתמש או סיסמה שגויים',
      layout: false,
    });
  }

  if (!user.is_active) {
    return res.status(403).render('login', {
      title: 'התחברות — AlonSpace',
      error: 'החשבון אינו פעיל. יש לפנות להנהלת AlonSpace.',
      layout: false,
    });
  }

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      console.error('Session regenerate failed:', regenerateError);

      return res.status(500).render('login', {
        title: 'התחברות — AlonSpace',
        error: 'אירעה שגיאה בהתחברות. נסו שוב.',
        layout: false,
      });
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.display_name;
    req.session.adminId = user.role === 'admin' ? user.id : null;
    req.session.adminName = user.role === 'admin' ? user.display_name : null;

    return req.session.save((saveError) => {
      if (saveError) {
        console.error('Session save failed:', saveError);

        return res.status(500).render('login', {
          title: 'התחברות — AlonSpace',
          error: 'אירעה שגיאה בהתחברות. נסו שוב.',
          layout: false,
        });
      }

      return res.redirect(redirectForRole(user.role));
    });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error('Session destroy failed:', error);
    }

    res.clearCookie('connect.sid');
    return res.redirect('/');
  });
});

module.exports = router;
