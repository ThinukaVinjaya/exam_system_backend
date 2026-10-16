import { Quiz } from '../models/Quiz.js';
import { logger } from '../utils/logger.js';
import { memoryCache } from '../utils/cache.js';

/**
 * Ensures all quizzes in the entire system are numbered sequentially (1, 2, 3...)
 * strictly in chronological order from the system's first quiz to the latest.
 */
export async function resequenceAllQuizNumbers(): Promise<void> {
  try {
    // Only assign numbers to quizzes that are missing a valid quizNumber
    const quizzesWithoutNumber = await Quiz.find({
      $or: [
        { quizNumber: { $exists: false } },
        { quizNumber: null },
        { quizNumber: { $lte: 0 } },
      ],
    }).sort({ createdAt: 1, _id: 1 });

    if (quizzesWithoutNumber.length === 0) return;

    const highestQuiz = await Quiz.findOne({ quizNumber: { $gt: 0 } }).sort({ quizNumber: -1 });
    let nextNum = (highestQuiz?.quizNumber || 0) + 1;

    for (const quiz of quizzesWithoutNumber) {
      await Quiz.findByIdAndUpdate(quiz._id, { quizNumber: nextNum });
      quiz.quizNumber = nextNum;
      nextNum++;
    }

    memoryCache.delByPrefix('quiz_');
    logger.info(`[QUIZ NUMBER] Assigned quiz numbers to ${quizzesWithoutNumber.length} unnumbered quizzes.`);
  } catch (err) {
    logger.error('[QUIZ NUMBER] Failed to fill missing quiz numbers:', err);
  }
}

/**
 * Gets the next available quiz number for a new quiz.
 */
export async function getNextQuizNumber(): Promise<number> {
  await resequenceAllQuizNumbers();
  const highestQuiz = await Quiz.findOne({ quizNumber: { $gt: 0 } }).sort({ quizNumber: -1 }).select('quizNumber').lean();
  if (highestQuiz && typeof highestQuiz.quizNumber === 'number' && highestQuiz.quizNumber > 0) {
    return highestQuiz.quizNumber + 1;
  }
  const total = await Quiz.countDocuments();
  return total + 1;
}

/**
 * Backfill alias that ensures all quizzes have numbers.
 */
export async function backfillQuizNumbers(): Promise<void> {
  await resequenceAllQuizNumbers();
}

/**
 * Ensures a quiz has a sequential quizNumber, assigning one if missing.
 */
export async function ensureQuizNumber(quizDoc: any): Promise<number> {
  if (quizDoc && typeof quizDoc.quizNumber === 'number' && quizDoc.quizNumber > 0) {
    return quizDoc.quizNumber;
  }
  const nextNum = await getNextQuizNumber();
  if (quizDoc && quizDoc._id) {
    await Quiz.findByIdAndUpdate(quizDoc._id, { quizNumber: nextNum });
    quizDoc.quizNumber = nextNum;
    memoryCache.delByPrefix('quiz_');
  }
  return nextNum;
}
