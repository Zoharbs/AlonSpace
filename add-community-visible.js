require('dotenv').config();

const db = require('./db');

async function addCommunityVisible() {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE tenant_profiles
      ADD COLUMN IF NOT EXISTS
        community_visible BOOLEAN
        NOT NULL
        DEFAULT FALSE
    `);

    await client.query('COMMIT');

    console.log(
      '✅ community_visible added successfully'
    );

    process.exit(0);

  } catch (error) {
    await client.query('ROLLBACK');

    console.error(
      '❌ Failed adding community_visible:',
      error
    );

    process.exit(1);

  } finally {
    client.release();
  }
}

addCommunityVisible();