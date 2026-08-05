const db = require('./db');

const images = [
  '/images/1.jpeg',
  '/images/2.jpg',
  '/images/3.jpeg',
  '/images/4.jpeg',
  '/images/5.jpeg',
  '/images/6.jpeg',
  '/images/7.jpeg',
  '/images/8.jpeg',
  '/images/9.jpeg',
  '/images/10.jpeg',
  '/images/11.jpeg',
  '/images/12.jpeg',
  '/images/13.jpeg',
  '/images/14.jpeg',
  '/images/15.jpeg',
];

const stmt = db.prepare(`
  UPDATE gallery
  SET url = ?
  WHERE id = ?
`);

images.forEach((img, index) => {
  stmt.run(img, index + 1);
});

console.log("✅ Gallery updated");