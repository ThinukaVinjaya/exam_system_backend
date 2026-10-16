const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  console.log('Connecting to Supabase PostgreSQL...');
  const pool = new Pool({
    connectionString: 'postgresql://postgres.qlafgbdzcdmsbenpwvcy:AvishkaUthum%40123@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const sqlPath = path.join(__dirname, '../src/config/schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing schema.sql...');
    await pool.query(sql);
    console.log('SUCCESS! All PostgreSQL tables and indexes created on Supabase!');

    // Verify created tables
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Created tables in public schema:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
