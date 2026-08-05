const express = require('express');
const db = require('../db');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

function isValidEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/contact', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const message = String(req.body.message || '').trim();

    if (!name || !message || !phone) {
      return res.status(400).json({
        error: 'נא למלא שם, טלפון והודעה',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'כתובת אימייל לא תקינה',
      });
    }

    await db.query(
      `
        INSERT INTO messages (
          name,
          email,
          phone,
          message
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        name,
        email || null,
        phone,
        message,
      ]
    );

    try {
      await sendMail({
        subject: `פנייה חדשה מהאתר מאת ${name}`,
        text:
          `שם: ${name}\n` +
          `טלפון: ${phone}\n` +
          `אימייל: ${email || 'לא צוין'}\n\n` +
          `הודעה:\n${message}`,
        replyTo: email || undefined,
      });
    } catch (mailError) {
      console.error(
        'CONTACT MAIL FAILED:',
        mailError
      );
    }

    return res.json({
      ok: true,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/testimonials',
  async (req, res, next) => {
    try {
      const name = String(
        req.body.name || ''
      ).trim();

      const role = String(
        req.body.role || ''
      ).trim();

      const content = String(
        req.body.content || ''
      ).trim();

      const rating = Math.min(
        5,
        Math.max(
          1,
          Number.parseInt(
            req.body.rating,
            10
          ) || 5
        )
      );

      if (!name || !content) {
        return res.status(400).json({
          error:
            'נא למלא שם ותוכן ההמלצה',
        });
      }

      await db.query(
        `
          INSERT INTO testimonials (
            name,
            role,
            content,
            rating,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'ממתין'
          )
        `,
        [
          name,
          role || null,
          content,
          rating,
        ]
      );

      return res.json({
        ok: true,
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;