const db = require('../db');

async function run() {
  try {
    console.log('Starting analytics migration...');

    // =========================
    // נתוני כניסה למשתמשים
    // =========================

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_login_at
        TIMESTAMPTZ
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login_count
        INTEGER NOT NULL DEFAULT 0
    `);


    // =========================
    // פעילות משתמשים
    // =========================

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id BIGSERIAL PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        event_type VARCHAR(100) NOT NULL,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        idx_user_activity_user_id
      ON user_activity(user_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        idx_user_activity_created_at
      ON user_activity(created_at)
    `);


    // =========================
    // סקר משתמש חדש
    // =========================

    await db.query(`
      CREATE TABLE IF NOT EXISTS onboarding_surveys (
        id BIGSERIAL PRIMARY KEY,

        user_id BIGINT NOT NULL UNIQUE
          REFERENCES users(id)
          ON DELETE CASCADE,

        uses_meeting_room BOOLEAN,

        meeting_room_times_per_month INTEGER,

        primary_office_use TEXT,

        most_important_feature TEXT,

        improvement_suggestion TEXT,

        completed_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      )
    `);

    console.log('Analytics migration completed successfully.');

    process.exit(0);

  } catch (error) {
    console.error('ANALYTICS MIGRATION ERROR:');
    console.error(error);

    process.exit(1);
  }
}

run();