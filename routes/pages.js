const express = require('express');
const db = require('../db');

const router = express.Router();

const SITE = {
  name: 'AlonSpace',
  phone: '054-4730266',
  phoneHref: '972544730266',
  whatsapp: 'https://wa.me/972544730266',
  email: 'alonspace@icloud.com',
  address: 'יגאל אלון 94 (מגדל אלון 2), תל אביב',
};

const TOUR_WHATSAPP_URL =
  `${SITE.whatsapp}?text=` +
  encodeURIComponent(
    'שלום, אני מעוניין לקבוע סיור ב-AlonSpace.'
  );

router.use((req, res, next) => {
  res.locals.site = SITE;
  res.locals.path = req.path;
  res.locals.tourWhatsappUrl = TOUR_WHATSAPP_URL;

  res.locals.currentUser = req.session?.userId
    ? {
        id: req.session.userId,
        role: req.session.userRole,
        name: req.session.userName,
      }
    : null;

  next();
});

router.get('/', async (req, res, next) => {
  try {
    const [
      testimonialsResult,
      galleryResult,
    ] = await Promise.all([
      db.query(`
        SELECT *
        FROM testimonials
        WHERE status = 'מאושר'
        ORDER BY created_at DESC
        LIMIT 3
      `),

      db.query(`
        SELECT *
        FROM gallery
        ORDER BY sort_order ASC, id ASC
        LIMIT 6
      `),
    ]);

    return res.render('home', {
      title:
        'AlonSpace — משרדים פרטיים בלב תל אביב',
      testimonials: testimonialsResult.rows,
      gallery: galleryResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  ['/אודות', '/about'],
  (req, res) => {
    return res.render('about', {
      title: 'אודות — AlonSpace',
    });
  }
);

router.get(
  ['/המתחם-והשירותים', '/amenities'],
  (req, res) => {
    return res.render('amenities', {
      title:
        'המתחם והשירותים — AlonSpace',
    });
  }
);

router.get(
  '/המלצות',
  async (req, res, next) => {
    try {
      const result = await db.query(`
        SELECT *
        FROM testimonials
        WHERE status = 'מאושר'
        ORDER BY created_at DESC
      `);

      return res.render('testimonials', {
        title: 'המלצות — AlonSpace',
        testimonials: result.rows,
        sent: req.query.sent === '1',
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  ['/שאלות-נפוצות', '/faq'],
  (req, res) => {
    return res.render('faq', {
      title: 'שאלות נפוצות — AlonSpace',
    });
  }
);

router.get(
  '/gallery',
  async (req, res, next) => {
    try {
      const result = await db.query(`
        SELECT *
        FROM gallery
        ORDER BY sort_order ASC, id ASC
      `);

      return res.render('gallery', {
        title: 'גלריה — AlonSpace',
        gallery: result.rows,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  ['/יצירת-קשר', '/contact'],
  (req, res) => {
    return res.render('contact', {
      title: 'יצירת קשר — AlonSpace',
      sent: req.query.sent === '1',
    });
  }
);

router.get('/booking', (req, res) => {
  res.render('booking', {
    title: 'קביעת סיור - AlonSpace'
  });
});
router.get('/api/slots', (req, res) => {
  const date = String(req.query.date || '');

  if (!date) {
    return res.status(400).json({
      error: 'חסר תאריך'
    });
  }

  const selectedDate = new Date(date + 'T12:00:00');

  if (Number.isNaN(selectedDate.getTime())) {
    return res.status(400).json({
      error: 'תאריך לא תקין'
    });
  }

  // 0 = ראשון, 6 = שבת
  const day = selectedDate.getDay();

  // כרגע לא מאפשרים שישי ושבת
  if (day === 5 || day === 6) {
    return res.json({
      slots: []
    });
  }

  // שעות אפשריות לסיור
  const slots = [
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
  ];

  return res.json({
    slots
  });
});
router.get(
  ['/offices', '/checkout'],
  (req, res) => {
    return res.redirect(302, '/');
  }
);

router.get('/terms', (req, res) => {
  return res.render('terms', {
    title: 'תנאי שימוש — AlonSpace',
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy');
});

router.get('/accessibility', (req, res) => {
  res.render('accessibility');
});

module.exports = router;