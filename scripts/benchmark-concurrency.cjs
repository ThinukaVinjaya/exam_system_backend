const { query, pool } = require('../dist/config/pgPool.js');

async function benchmark() {
  console.log('====================================================');
  console.log('SUPABASE POSTGRESQL CONCURRENCY BENCHMARK');
  console.log('Testing High Concurrency Handling (2,000 - 4,000 Requests)');
  console.log('====================================================\n');

  // Warm-up query
  await query('SELECT NOW()');

  // Test 1: 500 Concurrent Operations
  await runBatch(500);

  // Test 2: 1,000 Concurrent Operations
  await runBatch(1000);

  // Test 3: 2,000 Concurrent Operations
  await runBatch(2000);

  // Test 4: 4,000 Concurrent Operations
  await runBatch(4000);

  console.log('\n====================================================');
  console.log('CONCURRENCY BENCHMARK COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  await pool.end();
}

async function runBatch(concurrency) {
  process.stdout.write(`Executing ${concurrency} simultaneous database requests... `);
  const t0 = Date.now();

  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    // Alternate between read query (fetching active quizzes) and atomic student answer update
    if (i % 2 === 0) {
      promises.push(
        query('SELECT id, title, status FROM quizzes WHERE status = ANY($1) LIMIT 10', [['LIVE', 'SCHEDULED', 'ENDED']])
      );
    } else {
      promises.push(
        query(
          `INSERT INTO student_answers (id, attempt_id, question_id, student_id, quiz_id, selected_option, is_correct, marks_obtained, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option = EXCLUDED.selected_option, updated_at = NOW()`,
          [`bench_${i}`, `bench_attempt_${i % 100}`, `bench_q_${i % 20}`, `bench_student_${i}`, 'bench_quiz_1', 'C', true, 1]
        )
      );
    }
  }

  const results = await Promise.allSettled(promises);
  const durationMs = Date.now() - t0;
  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  const rps = Math.round((concurrency / (durationMs / 1000)));

  console.log(`DONE in ${durationMs}ms! (${fulfilled} passed, ${failed} failed) => ~${rps} ops/sec`);
}

benchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
