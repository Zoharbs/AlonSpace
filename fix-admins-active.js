const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // נדרש לחיבור חיצוני ל-Render
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  try {
const result = await pool.query(`
  SELECT
    id,
    username,
    display_name,
    role,
    is_active
  FROM users
  ORDER BY id
`);

console.log('ALL USERS:');
console.table(result.rows);



  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await pool.end();
  }
}

run();