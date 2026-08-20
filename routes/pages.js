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
        'AlonSpace - משרדים פרטיים בלב תל אביב',
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
      title: 'אודות - AlonSpace',
    });
  }
);

router.get(
  ['/המתחם-והשירותים', '/amenities'],
  (req, res) => {
    return res.render('amenities', {
      title:
        'המתחם והשירותים - AlonSpace',
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
        title: 'המלצות - AlonSpace',
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
      title: 'שאלות נפוצות - AlonSpace',
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
        title: 'גלריה - AlonSpace',
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
      title: 'יצירת קשר - AlonSpace',
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
router.post('/api/booking', async (req, res, next) => {
  try {
    const {
      booking_date,
      time_slot,
      name,
      phone,
      email,
      message
    } = req.body;

    if (!booking_date || !time_slot || !name || !phone) {
      return res.status(400).json({
        error: 'נא למלא תאריך, שעה, שם וטלפון'
      });
    }

    // כרגע אנחנו רק מאשרים שהבקשה תקינה.
    // בשלב הבא נחבר את זה לוואטסאפ.
    return res.json({
      success: true,
      booking: {
        booking_date,
        time_slot,
        name,
        phone,
        email: email || '',
        message: message || ''
      }
    });

  } catch (error) {
    console.error('BOOKING ERROR:', error);
    return next(error);
  }
});


router.get('/terms', (req, res) => {
  return res.render('terms', {
    title: 'תנאי שימוש - AlonSpace',
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy');
});

router.get('/accessibility', (req, res) => {
  res.render('accessibility');
});
// ========================================
// מסך חדר ישיבות - טלוויזיה
// ========================================

router.get(
  '/meeting-room-display/:floor',
  async (req, res, next) => {
    try {
      const floor = Number(req.params.floor);

      // יש מסכים רק בקומות 4 ו-6
      if (![4, 6].includes(floor)) {
        return res.status(404).send(
          'חדר הישיבות לא נמצא'
        );
      }

      const roomResult = await db.query(
        `
          SELECT id, floor
          FROM meeting_rooms
          WHERE floor = $1
          LIMIT 1
        `,
        [floor]
      );

      const room = roomResult.rows[0];

      if (!room) {
        return res.status(404).send(
          'לא נמצא חדר ישיבות בקומה הזאת'
        );
      }

      return res.render(
        'meeting-room-display',
        {
          title:
            `חדר ישיבות קומה ${floor} - AlonSpace`,
          floor,
          roomId: room.id,
        }
      );

    } catch (error) {
      return next(error);
    }
  }
);


// ========================================
// API מצב חדר ישיבות
// ========================================

router.get(
  '/api/meeting-room-display/:floor',
  async (req, res, next) => {
    try {
      const floor = Number(req.params.floor);

      if (![4, 6].includes(floor)) {
        return res.status(404).json({
          error: 'חדר ישיבות לא נמצא'
        });
      }

      // כל השריונים של היום בקומה הזאת
      // שעדיין לא הסתיימו
      const result = await db.query(
        `
          SELECT
            mb.start_time,
            mb.end_time
          FROM meeting_bookings mb
          JOIN meeting_rooms mr
            ON mr.id = mb.meeting_room_id
          WHERE
            mr.floor = $1
            AND mb.booking_date = CURRENT_DATE
            AND mb.end_time > CURRENT_TIME
          ORDER BY
            mb.start_time ASC
        `,
        [floor]
      );

      const bookings = result.rows;

      const nowResult = await db.query(`
        SELECT
          CURRENT_TIME AS current_time
      `);

      const currentTime =
        String(
          nowResult.rows[0].current_time
        ).slice(0, 5);


      // =====================================
      // האם החדר תפוס כרגע?
      // =====================================

      const activeIndex =
        bookings.findIndex(booking => {
          const start =
            String(booking.start_time)
              .slice(0, 5);

          const end =
            String(booking.end_time)
              .slice(0, 5);

          return (
            start <= currentTime &&
            end > currentTime
          );
        });


      // =====================================
      // תפוס כרגע
      // =====================================

      if (activeIndex !== -1) {

        let busyUntil =
          String(
            bookings[activeIndex].end_time
          ).slice(0, 5);


        // ממשיכים לעבור על השריונים הבאים.
        // אם הבא מתחיל לפני/בדיוק כשהרצף
        // הנוכחי מסתיים - זה עדיין אותו רצף תפוס.
        for (
          let i = activeIndex + 1;
          i < bookings.length;
          i++
        ) {

          const nextStart =
            String(
              bookings[i].start_time
            ).slice(0, 5);

          const nextEnd =
            String(
              bookings[i].end_time
            ).slice(0, 5);


          if (nextStart <= busyUntil) {

            if (nextEnd > busyUntil) {
              busyUntil = nextEnd;
            }

          } else {

            // יש רווח בין השריונים,
            // לכן כאן מסתיים הרצף.
            break;
          }
        }


        return res.json({
          status: 'busy',
          until: busyUntil
        });
      }


      // =====================================
      // החדר פנוי כרגע
      // =====================================

      const nextBooking =
        bookings.find(booking => {

          const start =
            String(
              booking.start_time
            ).slice(0, 5);

          return start > currentTime;
        });


      if (nextBooking) {

        return res.json({
          status: 'free',
          until:
            String(
              nextBooking.start_time
            ).slice(0, 5)
        });
      }


      // אין עוד שריונים היום

      return res.json({
        status: 'free',
        until: null
      });

    } catch (error) {

      console.error(
        'MEETING ROOM DISPLAY ERROR:',
        error
      );

      return next(error);
    }
  }
);


module.exports = router;