import mongoose from 'mongoose';
import { QuizResult, IQuizResult } from '../models/QuizResult.js';
import { RankingSnapshot, IRankingItem } from '../models/RankingSnapshot.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Quiz } from '../models/Quiz.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { QuizAttempt } from '../models/QuizAttempt.js';
import { logger } from '../utils/logger.js';
import { getQuizWindowStatus } from '../utils/scheduleWindows.js';

const activeRankingCalculations = new Map<string, Promise<void>>();

export async function calculateAndStoreQuizRankings(
  quizId: string | mongoose.Types.ObjectId,
  force = false
): Promise<void> {
  const quizIdStr = quizId.toString();

  const quiz = await Quiz.findById(quizId);
  if (!quiz) return;

  const now = new Date();
  const ws = getQuizWindowStatus(quiz, now);

  // STRICT REQUIREMENT: Quiz MCQ Rankings can ONLY be calculated when the quiz has reached its final MCQ end time across all schedule windows
  if (!force && now < ws.mcqFinalEndTime && quiz.status !== 'ARCHIVED') {
    logger.info(
      `[RANKING] Quiz ranking calculation deferred for Quiz "${quiz.title}" (${quiz._id}). Final MCQ session ends at ${ws.mcqFinalEndTime.toISOString()}`
    );
    return;
  }

  // Concurrency Guard: If a ranking calculation is already running for this quiz, share the active promise
  if (activeRankingCalculations.has(quizIdStr)) {
    return activeRankingCalculations.get(quizIdStr)!;
  }

  const calculationPromise = (async () => {
    try {
      // Fetch all non-late attempts / results for this quiz, sorted by Tie-breaker rule:
      // 1. Higher score (-1)
      // 2. Lower time taken (1)
      // 3. Earlier submission timestamp (1)
      const results = await QuizResult.find({ quizId: quizIdStr, isLateAttempt: { $ne: true } }).sort({
        score: -1,
        timeTakenSeconds: 1,
        createdAt: 1,
      });

      if (results.length === 0) {
        logger.warn(`No attempt results found for quizId ${quizId} during ranking calculation.`);
        return;
      }

      // Populate student details to create snapshot items
      const studentIds = results
        .map((r) => (r.studentId?._id || r.studentId?.id || r.studentId || '').toString())
        .filter(Boolean);
      const profiles = studentIds.length > 0 ? await StudentProfile.find({ userId: { $in: studentIds } }).lean() : [];
      const profileMap = new Map<string, any>();
      profiles.forEach((p) => {
        const uId = (p.userId?._id || p.userId?.id || p.userId || '').toString();
        if (uId) profileMap.set(uId, p);
      });

      // 1. Calculate Island Rank
      // 2. Group by Province & calculate Province Rank
      // 3. Group by District & calculate District Rank

      const provinceCountsMap = new Map<string, number>();
      const districtCountsMap = new Map<string, number>();

      const rankingSnapshotItems: IRankingItem[] = [];
      const bulkOps: any[] = [];

      for (let i = 0; i < results.length; i++) {
        const resDoc = results[i];
        const islandRank = i + 1;

        // Province Rank calculation
        const pId = resDoc.provinceId;
        const currentPCount = (provinceCountsMap.get(pId) || 0) + 1;
        provinceCountsMap.set(pId, currentPCount);
        const provinceRank = currentPCount;

        // District Rank calculation
        const dId = resDoc.districtId;
        const currentDCount = (districtCountsMap.get(dId) || 0) + 1;
        districtCountsMap.set(dId, currentDCount);
        const districtRank = currentDCount;

        // Queue bulk update for QuizResult document
        bulkOps.push({
          updateOne: {
            filter: { _id: resDoc._id },
            update: {
              $set: {
                islandRank,
                provinceRank,
                districtRank,
              },
            },
          },
        });

        const sIdStr = (resDoc.studentId?._id || resDoc.studentId?.id || resDoc.studentId || '').toString();
        const profile = profileMap.get(sIdStr);
        rankingSnapshotItems.push({
          studentId: resDoc.studentId,
          fullName: profile?.fullName || 'Student',
          school: profile?.school || '',
          provinceId: resDoc.provinceId,
          districtId: resDoc.districtId,
          score: resDoc.score,
          percentage: resDoc.percentage,
          timeTakenSeconds: resDoc.timeTakenSeconds,
          submittedAt: resDoc.createdAt,
          islandRank,
          provinceRank,
          districtRank,
        });
      }

      // Execute all rank updates in a single bulk operation
      if (bulkOps.length > 0) {
        await QuizResult.bulkWrite(bulkOps, { ordered: false });
      }

      // Calculate Aggregates
      const scores = results.map((r) => r.score);
      const totalParticipants = results.length;
      const averageScore = scores.reduce((a, b) => a + b, 0) / totalParticipants;
      const highestScore = Math.max(...scores);
      const lowestScore = Math.min(...scores);

      // Store or update Official Ranking Snapshot
      await RankingSnapshot.findOneAndUpdate(
        { quizId: quizIdStr, isOfficialSnapshot: true },
        {
          quizId: quizIdStr,
          isOfficialSnapshot: true,
          totalParticipants,
          averageScore,
          highestScore,
          lowestScore,
          rankings: rankingSnapshotItems,
        },
        { upsert: true, new: true }
      );

      // Mark quiz as having rankings calculated officially
      await Quiz.findByIdAndUpdate(quizIdStr, { isRankingsCalculated: true });

      logger.info(`Rankings calculated and stored successfully for Quiz ${quizId}. Total participants: ${totalParticipants}. Student answers & question reviews preserved for 7-day review period.`);
    } finally {
      activeRankingCalculations.delete(quizIdStr);
    }
  })();

  activeRankingCalculations.set(quizIdStr, calculationPromise);
  return calculationPromise;
}

export async function computeRanksForSingleAttempt(resultDoc: IQuizResult): Promise<{ islandRank: number; provinceRank: number; districtRank: number }> {
  // Count how many better scores exist for this quiz
  const baseFilter = { quizId: resultDoc.quizId };

  const isBetterCondition = {
    $or: [
      { score: { $gt: resultDoc.score } },
      { score: resultDoc.score, timeTakenSeconds: { $lt: resultDoc.timeTakenSeconds } },
      { score: resultDoc.score, timeTakenSeconds: resultDoc.timeTakenSeconds, createdAt: { $lt: resultDoc.createdAt } },
    ],
  };

  const betterIslandCount = await QuizResult.countDocuments({
    ...baseFilter,
    ...isBetterCondition,
  });

  const betterProvinceCount = await QuizResult.countDocuments({
    ...baseFilter,
    provinceId: resultDoc.provinceId,
    ...isBetterCondition,
  });

  const betterDistrictCount = await QuizResult.countDocuments({
    ...baseFilter,
    districtId: resultDoc.districtId,
    ...isBetterCondition,
  });

  return {
    islandRank: betterIslandCount + 1,
    provinceRank: betterProvinceCount + 1,
    districtRank: betterDistrictCount + 1,
  };
}
