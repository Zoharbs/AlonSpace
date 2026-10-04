require('dotenv').config();

const db = require('./db');

async function run() {
  try {
    const result = await db.query(`
      UPDATE tenant_profiles
      SET
        community_visible = TRUE,
        updated_at = NOW()
      WHERE public_consent = TRUE
        AND community_visible = FALSE
    `);

    console.log(
      `✅ Updated ${result.rowCount} existing profiles`
    );

    process.exit(0);

  } catch (error) {
    console.error(
      '❌ Backfill failed:',
      error
    );

    process.exit(1);
  }
}

run();