require('dotenv').config();

const db = require('./db');


async function addCommunityTutorialSeen() {

  const client =
    await db.pool.connect();


  try {

    await client.query('BEGIN');


    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS
        community_tutorial_seen BOOLEAN
        NOT NULL
        DEFAULT FALSE
    `);


    await client.query('COMMIT');


    console.log(
      '✅ community_tutorial_seen added successfully'
    );

    process.exit(0);


  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      '❌ Failed adding community_tutorial_seen:',
      error
    );

    process.exit(1);


  } finally {

    client.release();

  }

}


addCommunityTutorialSeen();