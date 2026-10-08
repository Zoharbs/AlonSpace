require('dotenv').config();
const db = require('./db');

async function run() {
  try {
    await db.query(`
      ALTER TABLE tenant_profiles
      ADD COLUMN IF NOT EXISTS community_status
      VARCHAR(20) NOT NULL DEFAULT 'pending'
    `);

    await db.query(`
      UPDATE tenant_profiles
      SET community_status =
        CASE
          WHEN community_visible = FALSE
            THEN 'rejected'
          WHEN public_status = 'approved'
            THEN 'approved'
          ELSE 'pending'
        END
    `);

    console.log('✅ Community status added');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();