const { pool } = require('../db');

function analyticsMiddleware(req, res, next) {
  // אין Analytics ללא הסכמה
  if (!req.analyticsAllowed) {
    return next();
  }

  if (
    req.method !== 'GET' ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/css') ||
    req.path.startsWith('/js') ||
    req.path.startsWith('/images') ||
    req.path.startsWith('/favicon') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  // אדמין מחובר לא נכנס ל-Analytics
  if (req.session?.userRole === 'admin') {
    return next();
  }

  res.on('finish', () => {
    // שומרים רק עמודים שהוחזרו בהצלחה
    if (
      res.statusCode < 200 ||
      res.statusCode >= 300
    ) {
      return;
    }

    pool.query(
      `
      INSERT INTO analytics_events (
        event_type,
        page_path,
        visitor_id,
        session_id,
        user_id,
        referrer,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        'page_view',

        // לא שומרים query string
        req.path,

        req.analyticsVisitorId || null,
        req.analyticsSessionId || null,
        req.session?.userId || null,
        req.get('referer') || null,

        JSON.stringify({
          userAgent:
            req.get('user-agent') || null,
        }),
      ]
    ).catch((error) => {
      console.error(
        'Analytics page view error:',
        error.message
      );
    });
  });

  next();
}

module.exports = analyticsMiddleware;