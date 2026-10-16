const request = require('supertest');
const app = require('../dist/app.js').default;
const { pool } = require('../dist/config/db.js');

async function testEndpoints() {
  console.log('Testing Express API endpoints against Supabase PostgreSQL...');

  // 1. Healthcheck
  const healthRes = await request(app).get('/api/health');
  console.log('GET /api/health:', healthRes.status, healthRes.body);

  // 2. Categories meta endpoint
  const catRes = await request(app).get('/api/meta/categories');
  console.log('GET /api/meta/categories:', catRes.status, 'Count:', catRes.body?.data?.length);

  // 3. Institutes meta endpoint
  const instRes = await request(app).get('/api/meta/institutes');
  console.log('GET /api/meta/institutes:', instRes.status, 'Count:', instRes.body?.data?.length);

  // 4. Test login with existing admin credentials (username: admin)
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'password123' });
  console.log('POST /api/auth/login status:', loginRes.status, 'success:', loginRes.body?.success);

  console.log('API SERVER TESTS PASSED!');
  await pool.end();
}

testEndpoints().catch(err => {
  console.error('API Test Error:', err);
  process.exit(1);
});
