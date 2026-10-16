const { Client } = require('pg');

async function test(name, config) {
  const t0 = Date.now();
  console.log(`[TEST] Starting ${name}...`);
  const client = new Client(config);
  try {
    await client.connect();
    const res = await client.query('SELECT NOW() as now, version() as v');
    console.log(`[TEST SUCCESS] ${name} (${Date.now() - t0}ms):`, res.rows[0].v.slice(0, 40));
    await client.end();
    return true;
  } catch (err) {
    console.error(`[TEST FAILED] ${name} (${Date.now() - t0}ms):`, err.message);
    try { await client.end(); } catch (e) {}
    return false;
  }
}

async function run() {
  // Test direct connection
  await test('Direct_5432', {
    connectionString: 'postgresql://postgres:AvishkaUthum%40123@db.qlafgbdzcdmsbenpwvcy.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  // Test pooler connection
  await test('Pooler_6543', {
    connectionString: 'postgresql://postgres.qlafgbdzcdmsbenpwvcy:AvishkaUthum%40123@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  // Test pooler session
  await test('Pooler_5432', {
    connectionString: 'postgresql://postgres.qlafgbdzcdmsbenpwvcy:AvishkaUthum%40123@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
}

run();
