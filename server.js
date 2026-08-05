require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(compression());

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, 'data'),
    }),
    secret:
      process.env.SESSION_SECRET ||
      'alonspace-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'יותר מדי בקשות, נסו שוב בעוד כמה דקות',
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.',
});

app.use('/api/contact', publicFormLimiter);
app.use('/api/testimonials', publicFormLimiter);
app.use('/login', loginLimiter);
app.use((req, res, next) => {
  res.locals.path = req.path;

  res.locals.site = {
    name: 'AlonSpace',
    phone: '054-4730266',
    phoneHref: '972544730266',
    whatsapp: 'https://wa.me/972544730266',
    email: 'alonspace@icloud.com',
    address: 'יגאל אלון 94 (מגדלי אלון), תל אביב',
  };

  res.locals.currentUser = req.session?.userId
    ? {
        id: req.session.userId,
        role: req.session.userRole,
        name: req.session.userName,
      }
    : null;

  res.locals.tourWhatsappUrl =
    'https://wa.me/972544730266?text=' +
    encodeURIComponent('שלום, אני מעוניין לקבוע סיור ב-AlonSpace.');

  next();
});
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/', require('./routes/pages'));

app.use((req, res) => {
  return res.status(404).send(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>הדף לא נמצא — AlonSpace</title>
      </head>

      <body style="
        margin:0;
        min-height:100vh;
        display:grid;
        place-items:center;
        font-family:Arial,sans-serif;
        background:#0a0c1a;
        color:#ece9f7;
        text-align:center;
      ">
        <div>
          <h1 style="font-size:5rem;margin:0;">404</h1>
          <h2>הדף לא נמצא</h2>
          <p>ייתכן שהכתובת השתנתה או שהעמוד אינו קיים.</p>

          <a
            href="/"
            style="
              display:inline-block;
              margin-top:16px;
              padding:12px 24px;
              border-radius:8px;
              background:#f2c14e;
              color:#0a0c1a;
              text-decoration:none;
              font-weight:700;
            "
          >
            חזרה לדף הבית
          </a>
        </div>
      </body>
    </html>
  `);
});

app.use((error, req, res, next) => {
  console.error(error);
  return res
    .status(500)
    .send('אירעה שגיאה בשרת. נסו שוב מאוחר יותר.');
});

app.listen(PORT, () => {
  console.log(`AlonSpace server running at http://localhost:${PORT}`);
});
