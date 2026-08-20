require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const {
  pool,
  initializeDatabase,
} = require('./db');

const app = express();
app.locals.formatDate = (date) => {
  if (!date) return '-';

  return new Date(date).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  });
};
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not configured');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(compression());

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

app.use(
  session({
    store: new PgSession({
      pool,
      createTableIfMissing: true,
      tableName: 'user_sessions',
    }),

    name: 'alonspace.sid',

    secret: process.env.SESSION_SECRET,

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

app.use(
  csrf({
    cookie: false
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
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
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
    address: 'יגאל אלון 94 (מגדל אלון 2), תל אביב',
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
    encodeURIComponent(
      'שלום, אני מעוניין לקבוע סיור ב-AlonSpace.'
    );

  next();
});

app.use((req, res, next) => {
  // מזהה קבוע יחסית לדפדפן
  if (!req.cookies.alonspace_visitor) {
    const visitorId = require('crypto').randomUUID();

    res.cookie('alonspace_visitor', visitorId, {
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    req.analyticsVisitorId = visitorId;
  } else {
    req.analyticsVisitorId =
      req.cookies.alonspace_visitor;
  }

  // מזהה של ה-session הנוכחי
  req.analyticsSessionId = req.sessionID;

  next();
});
const analyticsMiddleware =
  require('./middleware/analytics');

app.use(analyticsMiddleware);

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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >
        <title>הדף לא נמצא - AlonSpace</title>
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

          <p>
            ייתכן שהכתובת השתנתה או שהעמוד אינו קיים.
          </p>

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
  if (error.code === 'EBADCSRFTOKEN') {
    console.error('CSRF validation failed:', {
      method: req.method,
      path: req.path,
      hasBodyToken: Boolean(req.body?._csrf),
      hasHeaderToken: Boolean(
        req.get('CSRF-Token') ||
        req.get('X-CSRF-Token') ||
        req.get('X-XSRF-Token')
      ),
    });

    return res.status(403).send(
      'הטופס פג תוקף. רעננו את העמוד ונסו שוב.'
    );
  }

  return next(error);
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  return res
    .status(500)
    .send('אירעה שגיאה בשרת. נסו שוב מאוחר יותר.');
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(
        `AlonSpace server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      'Failed to initialize PostgreSQL:',
      error
    );

    process.exit(1);
  }
}

startServer();