require('dotenv').config();

const db = require('./db');


async function createTenantProfiles() {

  const client =
    await db.pool.connect();

  try {

    await client.query('BEGIN');


    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_profiles (

        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL UNIQUE
          REFERENCES users(id)
          ON DELETE CASCADE,

        display_name VARCHAR(120),

        business_field VARCHAR(120),

        bio VARCHAR(300),

        website_url TEXT,

        linkedin_url TEXT,

        logo_url TEXT,

        public_consent BOOLEAN
          NOT NULL
          DEFAULT FALSE,

        public_status VARCHAR(20)
          NOT NULL
          DEFAULT 'private',

        created_at TIMESTAMP
          NOT NULL
          DEFAULT NOW(),

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT NOW(),

        CONSTRAINT tenant_profiles_public_status_check
          CHECK (
            public_status IN (
              'private',
              'pending',
              'approved',
              'rejected'
            )
          )

      )
    `);


    await client.query(`
      CREATE INDEX IF NOT EXISTS
        idx_tenant_profiles_public
      ON tenant_profiles (
        public_status,
        public_consent
      )
    `);


    await client.query('COMMIT');


    console.log(
      '✅ tenant_profiles table created successfully'
    );


    process.exit(0);

  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      '❌ Failed creating tenant_profiles:',
      error
    );

    process.exit(1);

  } finally {

    client.release();

  }

}


createTenantProfiles();