const { pool } = require('../dist/config/db.js');
const { User } = require('../dist/models/User.js');
const { Quiz } = require('../dist/models/Quiz.js');
const { Question } = require('../dist/models/Question.js');
const { Category } = require('../dist/models/Category.js');
const { Institute } = require('../dist/models/Institute.js');
const { StudentProfile } = require('../dist/models/StudentProfile.js');
const { QuizAttempt } = require('../dist/models/QuizAttempt.js');
const { StudentAnswer } = require('../dist/models/StudentAnswer.js');
const { QuizResult } = require('../dist/models/QuizResult.js');

async function testE2E() {
  console.log('Testing Supabase PostgreSQL operations...');

  const t0 = Date.now();
  const [users, quizzes, questions, categories, institutes, attempts, results] = await Promise.all([
    User.find(),
    Quiz.find().populate('subjectId').populate('questions'),
    Question.find(),
    Category.find(),
    Institute.find(),
    QuizAttempt.find(),
    QuizResult.find()
  ]);

  console.log(`[E2E Read in ${Date.now() - t0}ms]:`);
  console.log(`- Users: ${users.length}`);
  console.log(`- Quizzes: ${quizzes.length}`);
  console.log(`- Questions: ${questions.length}`);
  console.log(`- Categories: ${categories.length}`);
  console.log(`- Institutes: ${institutes.length}`);
  console.log(`- Attempts: ${attempts.length}`);
  console.log(`- Results: ${results.length}`);

  if (quizzes.length > 0) {
    const q = quizzes[0];
    console.log(`Sample Quiz: "${q.title}", Quiz #${q.quizNumber}, Questions: ${q.questions?.length}, Subject: ${q.subjectId?.nameSi || q.subjectId?.nameEn}`);
  }

  // Test atomic upsert
  const tUpsert = Date.now();
  const testAns = await StudentAnswer.findOneAndUpdate(
    { attemptId: 'test_attempt_1', questionId: 'test_q_1' },
    {
      studentId: 'test_student_1',
      quizId: 'test_quiz_1',
      selectedOption: 'B',
      displayOption: 'A',
      isCorrect: true,
      marksObtained: 1
    },
    { upsert: true, new: true }
  );
  console.log(`[Atomic UPSERT in ${Date.now() - tUpsert}ms]: Saved answer id: ${testAns.id}, selected: ${testAns.selectedOption}`);

  // Clean test answer
  await StudentAnswer.deleteOne({ id: testAns.id });
  console.log('Cleaned test answer.');

  console.log('ALL E2E POSTGRESQL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  await pool.end();
}

testE2E().catch(err => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
