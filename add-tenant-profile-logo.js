require('dotenv').config();

const db = require('./db');


async function addTenantProfileLogo() {

  const client =
    await db.pool.connect();

  try {

    await client.query('BEGIN');


    await client.query(`
      ALTER TABLE tenant_profiles
      ADD COLUMN IF NOT EXISTS
        logo_data BYTEA
    `);


    await client.query(`
      ALTER TABLE tenant_profiles
      ADD COLUMN IF NOT EXISTS
        logo_mime_type VARCHAR(50)
    `);


    await client.query('COMMIT');


    console.log(
      '✅ Tenant profile logo columns added'
    );

    process.exit(0);

  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      '❌ Failed adding logo columns:',
      error
    );

    process.exit(1);

  } finally {

    client.release();

  }

}


addTenantProfileLogo();