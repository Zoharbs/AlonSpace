require('dotenv').config();

const db = require('./db');

async function addGalleryImages() {
  try {

    await db.query(`
      INSERT INTO gallery (
        url,
        alt,
        sort_order
      )
      VALUES
        ('/images/16.jpeg', 'מתחם AlonSpace', 16),
        ('/images/17.jpeg', 'מתחם AlonSpace', 17),
        ('/images/18.jpeg', 'מתחם AlonSpace', 18),
        ('/images/19.jpeg', 'מתחם AlonSpace', 19),
        ('/images/20.jpeg', 'מתחם AlonSpace', 20),
        ('/images/21.jpeg', 'מתחם AlonSpace', 21)
    `);

    console.log('✅ 6 התמונות נוספו לגלריה');

    process.exit(0);

  } catch (error) {

    console.error(
      '❌ שגיאה בהוספת התמונות:',
      error
    );

    process.exit(1);
  }
}

addGalleryImages();