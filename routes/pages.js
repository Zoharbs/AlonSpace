const express = require('express');
const db = require('../db');

const router = express.Router();

const SITE = {
  name: 'AlonSpace',
  phone: '054-4730266',
  phoneHref: '972544730266',
  whatsapp: 'https://wa.me/972544730266',
  email: 'alonspace@icloud.com',
  address: 'יגאל אלון 94 (מגדלי אלון), תל אביב',
};

const TOUR_WHATSAPP_URL =
  `${SITE.whatsapp}?text=` +
  encodeURIComponent('שלום, אני מעוניין לקבוע סיור ב-AlonSpace.');

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

router.get('/', (req, res) => {
  const testimonials = db
    .prepare(`
      SELECT *
      FROM testimonials
      WHERE status = 'מאושר'
      ORDER BY created_at DESC
      LIMIT 3
    `)
    .all();

  const gallery = db
    .prepare('SELECT * FROM gallery ORDER BY sort_order LIMIT 6')
    .all();

  return res.render('home', {
    title: 'AlonSpace — משרדים פרטיים בלב תל אביב',
    testimonials,
    gallery,
  });
});

router.get(['/אודות', '/about'], (req, res) => {
  return res.render('about', {
    title: 'אודות — AlonSpace',
  });
});

router.get(['/המתחם-והשירותים', '/amenities'], (req, res) => {
  return res.render('amenities', {
    title: 'המתחם והשירותים — AlonSpace',
  });
});

router.get('/המלצות', (req, res) => {
  const testimonials = db
    .prepare(`
      SELECT *
      FROM testimonials
      WHERE status = 'מאושר'
      ORDER BY created_at DESC
    `)
    .all();

  return res.render('testimonials', {
    title: 'המלצות — AlonSpace',
    testimonials,
    sent: req.query.sent === '1',
  });
});

router.get(['/שאלות-נפוצות', '/faq'], (req, res) => {
  return res.render('faq', {
    title: 'שאלות נפוצות — AlonSpace',
  });
});

router.get('/gallery', (req, res) => {
  const gallery = db
    .prepare('SELECT * FROM gallery ORDER BY sort_order')
    .all();

  return res.render('gallery', {
    title: 'גלריה — AlonSpace',
    gallery,
  });
});

router.get(['/יצירת-קשר', '/contact'], (req, res) => {
  return res.render('contact', {
    title: 'יצירת קשר — AlonSpace',
    sent: req.query.sent === '1',
  });
});

router.get('/booking', (req, res) => {
  return res.redirect(302, TOUR_WHATSAPP_URL);
});

router.get(['/offices', '/checkout'], (req, res) => {
  return res.redirect(302, '/');
});

router.get('/terms', (req, res) => {
  return res.render('terms', {
    title: 'תנאי שימוש — AlonSpace',
  });
});

module.exports = router;
