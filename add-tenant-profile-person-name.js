require('dotenv').config();
const db = require('./db');

async function addPersonName() {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE tenant_profiles
      ADD COLUMN IF NOT EXISTS
        person_name VARCHAR(120)
    `);

    await client.query('COMMIT');

    console.log(
      '✅ person_name added successfully'
    );

    process.exit(0);

  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      '❌ Failed adding person_name:',
      error
    );

    process.exit(1);

  } finally {
    client.release();
  }
}

addPersonName();