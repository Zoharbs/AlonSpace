require('dotenv').config();

const db = require('./db');


async function fixGallery() {

  const client =
    await db.pool.connect();

  try {

    await client.query('BEGIN');


    /*
      1. מחיקת התמונות החדשות
         שהן כפילויות של תמונות קיימות

      16 = 10
      17 = 11
      18 = 9
      19 = 4
    */

    await client.query(`
      DELETE FROM gallery
      WHERE url IN (
        '/images/16.jpeg',
        '/images/17.jpeg',
        '/images/18.jpeg',
        '/images/19.jpeg'
      )
    `);


    /*
      2. הגנה מפני מצב שבו אותה
         תמונה נוספה פעמיים ל-DB
    */

    await client.query(`
      DELETE FROM gallery a
      USING gallery b
      WHERE
        a.url = b.url
        AND a.id > b.id
    `);


    /*
      3. קודם מזיזים את כל ה-sort_order
         כדי שלא יהיו התנגשויות
    */

    await client.query(`
      UPDATE gallery
      SET sort_order = sort_order + 1000
    `);


    /*
      4. סדר חדש לגלריה

      מתחילים מהבניין,
      עוברים לכניסה ולמתחם,
      ואז למשרדים וחדרי הישיבות.
    */

    const galleryOrder = [
      '/images/20.jpeg',
      '/images/1.jpeg',
      '/images/3.jpeg',
      '/images/8.jpeg',
      '/images/7.jpeg',
      '/images/15.jpeg',
      '/images/2.jpg',
      '/images/12.jpeg',
      '/images/14.jpeg',
      '/images/21.jpeg',
      '/images/10.jpeg',
      '/images/11.jpeg',
      '/images/9.jpeg',
      '/images/4.jpeg',
      '/images/5.jpeg',
      '/images/6.jpeg',
      '/images/13.jpeg'
    ];


    for (
      let i = 0;
      i < galleryOrder.length;
      i++
    ) {

      await client.query(
        `
          UPDATE gallery
          SET sort_order = $1
          WHERE url = $2
        `,
        [
          i + 1,
          galleryOrder[i]
        ]
      );

    }


    await client.query('COMMIT');


    console.log(
      '✅ הגלריה נוקתה וסודרה בהצלחה'
    );

    console.log(
      `📸 ${galleryOrder.length} תמונות בגלריה`
    );


    process.exit(0);

  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      '❌ שגיאה בסידור הגלריה:',
      error
    );

    process.exit(1);

  } finally {

    client.release();

  }

}


fixGallery();