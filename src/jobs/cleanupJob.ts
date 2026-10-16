import cron from 'node-cron';
import mongoose from 'mongoose';
import { QuizAttempt } from '../models/QuizAttempt.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { QuizResult } from '../models/QuizResult.js';
import { MonthlyStudentStatistics } from '../models/MonthlyStudentStatistics.js';
import { MonthlyQuizStatistics } from '../models/MonthlyQuizStatistics.js';
import { RankingSnapshot } from '../models/RankingSnapshot.js';
import { FullPaperRankingSnapshot } from '../models/FullPaperRankingSnapshot.js';
import { User } from '../models/User.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Quiz } from '../models/Quiz.js';
import { Question } from '../models/Question.js';
import { QuestionImage } from '../models/QuestionImage.js';
import { PdfImport } from '../models/PdfImport.js';
import { EssayFile } from '../models/EssayFile.js';
import { calculateAndStoreQuizRankings } from '../rankings/rankingService.js';
import { calculateAndStoreFullPaperRankings } from '../rankings/fullPaperRankingService.js';
import { logger } from '../utils/logger.js';
import { getQuizWindowStatus } from '../utils/scheduleWindows.js';

export interface CleanupResult {
  deletedAttempts: number;
  deletedAnswers: number;
  deletedEssayFiles: number;
  deletedPdfImports: number;
  deletedImages: number;
  deletedQuestions: number;
  preservedResults: number;
  preservedStudentAccounts: number;
  cutoffDate: string;
  timestamp: string;
}

/**
 * Automatically manages data lifecycle according to exam retention policies:
 * 1. Essay Student Answer Files: Purged immediately after full paper ranking list is created.
 *    (Official exam question paper remains intact until admin deletes it).
 * 2. PdfImports Data: Purged immediately once the examination finishes.
 * 3. Student Answers (Choice selections): Preserved for 7 days after exam completion
 *    so students can review their selected options, correct/wrong status, and explanations; purged after 7 days.
 * 4. Questions & Question Images: NEVER deleted automatically after 7 days!
 *    They remain intact in the database until the admin explicitly deletes the quiz.
 * 5. Quiz Results & Ranks: Permanently preserved until admin deletes the batch category (e.g. 2028 A/L).
 */
export async function purgeFinishedExamFilesAndAnswers(
  quizId: string | mongoose.Types.ObjectId
): Promise<{ deletedAnswers: number; deletedFiles: number; deletedPdfImports: number; deletedImages: number; deletedQuestions: number }> {
  try {
    const objectQuizId = quizId.toString();
    const quiz = await Quiz.findById(objectQuizId);
    if (!quiz) return { deletedAnswers: 0, deletedFiles: 0, deletedPdfImports: 0, deletedImages: 0, deletedQuestions: 0 };

    const now = new Date();
    const ws = getQuizWindowStatus(quiz, now);
    const mcqEndTime = ws.mcqFinalEndTime || (quiz.endTime ? new Date(quiz.endTime) : null);
    const isMcqEnded = Boolean((mcqEndTime && now >= mcqEndTime) || quiz.status === 'ARCHIVED' || quiz.status === 'ENDED');

    let deletedAnswers = 0;
    let deletedFiles = 0;
    let deletedPdfImports = 0;
    let deletedImages = 0;
    let deletedQuestions = 0;

    // 1. Delete student essay answer files and archive marker exam card 1 WEEK (7 days) AFTER full paper rank is generated
    // (Exam question paper files remain 100% intact until admin deletes it)
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (quiz.hasEssay && quiz.isFullPaperRankingsCalculated) {
      const calcAt = quiz.fullPaperRankingsCalculatedAt || quiz.updatedAt || new Date();
      const isOneWeekPassed = now.getTime() >= new Date(calcAt).getTime() + ONE_WEEK_MS;

      if (isOneWeekPassed) {
        const fileRes = await EssayFile.deleteMany({
          quizId: objectQuizId,
          fileRole: 'STUDENT_ANSWER',
        });
        deletedFiles = fileRes.deletedCount || 0;

        let shouldSave = false;
        if (!quiz.isMarkerExamCardArchived) {
          quiz.isMarkerExamCardArchived = true;
          shouldSave = true;
        }
        if (!quiz.essayFilesPurged) {
          quiz.essayFilesPurged = true;
          shouldSave = true;
        }
        if (shouldSave) {
          await quiz.save();
        }

        if (deletedFiles > 0 || shouldSave) {
          logger.info(`[MEMORY PURGE] 1 week passed after generating rankings for Quiz "${quiz.title}" (${quiz._id}). Purged ${deletedFiles} student essay answer files and removed marker exam card. Official student marks and ranks permanently preserved.`);
        }
      }
    }

    // 2. Delete PdfImports data when the exam finishes
    if (isMcqEnded) {
      const pdfRes = await PdfImport.deleteMany({
        $or: [
          { quizId: objectQuizId },
          { filename: quiz.title },
        ],
      });
      deletedPdfImports = pdfRes.deletedCount || 0;
      if (deletedPdfImports > 0) {
        logger.info(`[MEMORY PURGE] Purged ${deletedPdfImports} PdfImport documents for finished Quiz "${quiz.title}" (${quiz._id}).`);
      }
    }

    // 3. 7-Day rule: Students have 7 days after exam completion to review answers & explanations.
    // After 7 days, purge StudentAnswer documents and clear shuffledQuestions cache.
    // IMPORTANT: Questions and question images are NEVER deleted here. They remain in the database
    // until the admin explicitly deletes the quiz.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const isSevenDaysPassed = Boolean(mcqEndTime && now.getTime() >= mcqEndTime.getTime() + SEVEN_DAYS_MS);

    if (isSevenDaysPassed) {
      // Purge student answer choices
      const ansRes = await StudentAnswer.deleteMany({ quizId: objectQuizId });
      deletedAnswers = ansRes.deletedCount || 0;
      await QuizAttempt.updateMany({ quizId: objectQuizId }, { $unset: { shuffledQuestions: 1 } });

      if (deletedAnswers > 0) {
        logger.info(`[MEMORY PURGE] 7-Day review period elapsed for Quiz "${quiz.title}" (${quiz._id}). Purged ${deletedAnswers} raw student answers. Question text, options, question images, marks, and ranks remain intact until admin deletes quiz.`);
      }
    }

    return { deletedAnswers, deletedFiles, deletedPdfImports, deletedImages, deletedQuestions };
  } catch (err: any) {
    logger.error(`[MEMORY PURGE ERROR] Error executing data lifecycle purge for quiz ${quizId}:`, err);
    return { deletedAnswers: 0, deletedFiles: 0, deletedPdfImports: 0, deletedImages: 0, deletedQuestions: 0 };
  }
}

/**
 * Storage Health & Heavy Artifact Cleanup
 *
 * POLICY:
 * - Student accounts (User & StudentProfile), paper marks (QuizResult), and rankings
 *   (RankingSnapshot & FullPaperRankingSnapshot) are PERMANENT and preserved across all months
 *   so students and admin can analyze historical progress throughout their A/L year.
 *   They are ONLY removed when an admin deletes the student's batch category (e.g. "2028 A/L").
 * - Exam question papers and question images remain intact until admin deletes the quiz.
 * - Heavy student uploaded answer PDF files (EssayFile) are purged after full paper rank creation.
 * - Raw question answers (StudentAnswer) are preserved for 7 days for student review,
 *   and purged after 7 days to conserve database memory.
 * - Questions and Question Images are ONLY deleted when an admin explicitly deletes the quiz.
 */
export async function runMonthlyStudentDataCleanup(): Promise<CleanupResult> {
  const now = new Date();
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  logger.info(`[STORAGE CLEANUP] Running database storage optimization check (${now.toISOString()})...`);
  logger.info('[STORAGE CLEANUP] Preserving all student accounts, paper marks (QuizResult), and official rankings.');

  const preservedStudentAccounts = await StudentProfile.countDocuments();
  const preservedResults = await QuizResult.countDocuments();

  // Find quizzes that ended more than 7 days ago
  const oldEndedQuizzes = await Quiz.find({
    status: { $in: ['ENDED', 'ARCHIVED'] },
    endTime: { $lt: sevenDaysAgo },
  }).select('_id questions');

  const oldEndedQuizIds = oldEndedQuizzes.map((q) => q._id);

  // 1. Delete student raw question answers for quizzes ended > 7 days ago
  const ansResult = await StudentAnswer.deleteMany({
    quizId: { $in: oldEndedQuizIds },
  });

  // 2. Delete heavy student essay PDF files for quizzes where full paper rankings were calculated
  const essayFileResult = await EssayFile.deleteMany({
    fileRole: 'STUDENT_ANSWER',
    quizId: { $in: oldEndedQuizIds },
  });

  // 3. Delete PdfImport documents for old ended quizzes
  const pdfImportResult = await PdfImport.deleteMany({
    $or: [
      { quizId: { $in: oldEndedQuizIds } },
      { status: 'PUBLISHED', createdAt: { $lt: sevenDaysAgo } },
    ],
  });

  // 4. Clear shuffled questions cache on older attempts
  const attResult = await QuizAttempt.updateMany(
    { createdAt: { $lt: startOfCurrentMonth } },
    { $unset: { shuffledQuestions: 1 } }
  );

  const summary: CleanupResult = {
    deletedAttempts: attResult.modifiedCount || 0,
    deletedAnswers: ansResult.deletedCount || 0,
    deletedEssayFiles: essayFileResult.deletedCount || 0,
    deletedPdfImports: pdfImportResult.deletedCount || 0,
    deletedImages: 0,
    deletedQuestions: 0,
    preservedResults,
    preservedStudentAccounts,
    cutoffDate: startOfCurrentMonth.toISOString(),
    timestamp: now.toISOString(),
  };

  logger.info(`[STORAGE CLEANUP] Memory Optimization Sweep Completed:
    • Raw Student Answers purged (>7 days): ${summary.deletedAnswers}
    • Heavy Essay PDF Files purged: ${summary.deletedEssayFiles}
    • PdfImport documents purged: ${summary.deletedPdfImports}
    • Attempt option caches cleared: ${summary.deletedAttempts}
    • Student Marks & QuizResults Preserved: ${summary.preservedResults} (100% INTACT)
    • Student Accounts Preserved: ${summary.preservedStudentAccounts} (100% INTACT)`);

  return summary;
}

/**
 * Automatically transitions SCHEDULED quizzes to LIVE and LIVE quizzes to ENDED,
 * computing official rankings for all participants at the exact end of quiz time.
 */
export async function checkAndFinalizeEndedQuizzes(): Promise<void> {
  const now = new Date();

  // 0. Auto-revive any quiz that has an essay whose essay deadline has not passed yet, but was prematurely marked ENDED
  const endedCandidates = await Quiz.find({
    status: 'ENDED',
    hasEssay: true,
  });

  for (const q of endedCandidates) {
    const ws = getQuizWindowStatus(q, now);
    if (!ws.isEnded && ws.isCurrentlyOpen) {
      q.status = 'LIVE';
      await q.save();
      logger.info(`[QUIZ SCHEDULER] Revived prematurely ended essay quiz to LIVE: "${q.title}" (${q._id}) until essay deadline`);
    }
  }

  // 1. Auto-transition SCHEDULED quizzes whose start time has arrived to LIVE (only if currently inside an active window)
  const scheduledCandidates = await Quiz.find({
    status: 'SCHEDULED',
    startTime: { $lte: now },
  });

  for (const q of scheduledCandidates) {
    const ws = getQuizWindowStatus(q, now);
    if (ws.isCurrentlyOpen) {
      q.status = 'LIVE';
      await q.save();
    }
  }

  // 1b. If a LIVE quiz with multiple scheduleWindows is currently between windows (e.g. Sunday between Saturday and Monday), transition back to SCHEDULED
  const liveCandidates = await Quiz.find({
    status: 'LIVE',
    scheduleWindows: { $exists: true, $ne: [] },
  });

  for (const q of liveCandidates) {
    const ws = getQuizWindowStatus(q, now);
    if (ws.isBetweenWindows) {
      q.status = 'SCHEDULED';
      await q.save();
    }
  }

  // 2. Find quizzes whose MCQ session has ended and Quiz rankings have not been calculated yet
  const candidateQuizzes = await Quiz.find({
    status: { $in: ['LIVE', 'SCHEDULED', 'ENDED'] },
    isRankingsCalculated: { $ne: true },
  });

  for (const quiz of candidateQuizzes) {
    const ws = getQuizWindowStatus(quiz, now);
    if (ws.mcqFinalEndTime && now >= ws.mcqFinalEndTime) {
      if (ws.isEnded) {
        quiz.status = 'ENDED';
      }
      quiz.isRankingsCalculated = true;
      await quiz.save();
      try {
        await calculateAndStoreQuizRankings(quiz._id);
        await purgeFinishedExamFilesAndAnswers(quiz._id);
        logger.info(`[QUIZ SCHEDULER] Automatically calculated official Quiz rankings for: "${quiz.title}" (${quiz._id})`);
      } catch (err) {
        logger.error(`[QUIZ SCHEDULER] Error calculating rankings for Quiz ${quiz._id}:`, err);
      }
    }
  }

  // 3. For essay quizzes whose deadline has elapsed, finalize status and trigger full paper rankings
  const endedEssayQuizzes = await Quiz.find({
    hasEssay: true,
    isFullPaperRankingsCalculated: { $ne: true },
  });

  for (const q of endedEssayQuizzes) {
    const ws = getQuizWindowStatus(q, now);
    if (ws.isEnded) {
      if (q.status !== 'ENDED') {
        q.status = 'ENDED';
        await q.save();
      }
      try {
        await calculateAndStoreFullPaperRankings(q._id);
        await purgeFinishedExamFilesAndAnswers(q._id);
      } catch (err) {
        // ignore
      }
    }
  }

  // Note: Historical ended quiz artifact sweeping is handled in the daily 2:00 AM maintenance job
  // to avoid sending redundant sweep queries to the database every 30 seconds.
}

export function initScheduledJobs(): void {
  // 1. Run at 00:01 AM on the 1st of every month (Monthly cutoff rollover)
  cron.schedule('1 0 1 * *', async () => {
    logger.info('[CRON] 1st of Month Rollover triggered: Running monthly student data cleanup...');
    await runMonthlyStudentDataCleanup();
  });

  // 2. Daily check at 02:00 AM (Safeguard in case server was restarting on the 1st)
  cron.schedule('0 2 * * *', async () => {
    logger.info('[CRON] Daily storage check: Verifying previous month data cleanup...');
    await runMonthlyStudentDataCleanup();
  });

  // 3. Every 30 seconds: check and finalize quizzes whose time ended, calculating official rankings immediately
  cron.schedule('*/30 * * * * *', async () => {
    try {
      await checkAndFinalizeEndedQuizzes();
    } catch (err) {
      logger.error('[QUIZ SCHEDULER ERROR]:', err);
    }
  });

  logger.info('Scheduled Jobs initialized:');
  logger.info('  - Auto Monthly Purge: 1st of every month at 00:01 AM');
  logger.info('  - Daily Storage Health Check: 02:00 AM');
  logger.info('  - Quiz End Time & Instant Ranking Engine: Every 30 seconds');

  // Initial check on application boot to ensure no legacy previous-month records remain
  runMonthlyStudentDataCleanup().catch((err) => {
    logger.error('[STORAGE CLEANUP] Startup storage check error:', err);
  });

  // Initial quiz check on startup
  checkAndFinalizeEndedQuizzes().catch((err) => {
    logger.error('[QUIZ SCHEDULER] Startup check error:', err);
  });
}
