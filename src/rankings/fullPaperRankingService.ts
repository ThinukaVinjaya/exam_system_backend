import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { QuizResult } from '../models/QuizResult.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { EssayFile } from '../models/EssayFile.js';
import { FullPaperRankingSnapshot, IFullPaperRankingItem } from '../models/FullPaperRankingSnapshot.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

const activeFullPaperCalculations = new Map<string, Promise<void>>();

export async function calculateAndStoreFullPaperRankings(
  quizId: string | mongoose.Types.ObjectId,
  force = false
): Promise<void> {
  const quizIdStr = quizId.toString();

  const quiz = await Quiz.findById(quizId);
  if (!quiz || !quiz.hasEssay) {
    logger.info(`[FULL_PAPER_RANK] Quiz ${quizIdStr} does not have essay paper enabled.`);
    return;
  }

  // Concurrency Guard
  if (activeFullPaperCalculations.has(quizIdStr)) {
    return activeFullPaperCalculations.get(quizIdStr)!;
  }

  const calculationPromise = (async () => {
    try {
      // Find all marked essay submissions for this quiz
      const essaySubmissions = await EssaySubmission.find({
        quizId: quizIdStr,
        isMarked: true,
      });

      if (essaySubmissions.length === 0) {
        logger.warn(`[FULL_PAPER_RANK] No marked essay submissions found for quizId ${quizIdStr}.`);
        return;
      }

      // Check if all submitted essays are marked
      const totalSubmittedCount = await EssaySubmission.countDocuments({ quizId: quizIdStr });
      const isAllMarked = essaySubmissions.length >= totalSubmittedCount;

      if (!isAllMarked) {
        const pending = totalSubmittedCount - essaySubmissions.length;
        logger.warn(
          `[FULL_PAPER_RANK] Cannot finalize full paper rankings for quizId ${quizIdStr}: ${pending} of ${totalSubmittedCount} student essay submissions are not marked yet.`
        );
        throw new Error(
          `All student essay answers must be marked before generating rankings. ${pending} submission(s) pending.`
        );
      }

      const studentIds = essaySubmissions.map((s) => s.studentId);

      // Fetch non-late QuizResults for these students
      const quizResults = await QuizResult.find({
        quizId: quizIdStr,
        studentId: { $in: studentIds },
        isLateAttempt: { $ne: true },
      });

      const submissionMap = new Map<string, any>();
      essaySubmissions.forEach((sub) => submissionMap.set(sub.studentId.toString(), sub));

      const profiles = await StudentProfile.find({ userId: { $in: studentIds } }).lean();
      const profileMap = new Map<string, any>();
      profiles.forEach((p) => profileMap.set(p.userId.toString(), p));

      const users = await User.find({ _id: { $in: studentIds } }).lean();
      const userMap = new Map<string, any>();
      users.forEach((u) => userMap.set(u._id.toString(), u));

      // Build composite list
      interface FullPaperCandidate {
        resultId: any;
        studentId: any;
        username: string;
        fullName: string;
        school: string;
        provinceId: string;
        districtId: string;
        mcqScore: number;
        mcqTotalMarks: number;
        essayScore: number;
        essayTotalMarks: number;
        fullPaperScore: number;
        fullPaperTotalMarks: number;
        percentage: number;
        timeTakenSeconds: number;
        submittedAt: Date;
      }

      const essayMaxMarks = quiz.essayTotalMarks || 100;
      const mcqMaxMarks = quiz.totalMarks || 100;
      const combinedMaxMarks = mcqMaxMarks + essayMaxMarks;

      const candidates: FullPaperCandidate[] = [];

      for (const resDoc of quizResults) {
        const studentIdStr = resDoc.studentId.toString();
        const essaySub = submissionMap.get(studentIdStr);
        if (!essaySub) continue;

        const profile = profileMap.get(studentIdStr);
        const userObj = userMap.get(studentIdStr);
        const essayScore = typeof essaySub.marksAwarded === 'number' ? essaySub.marksAwarded : 0;
        const mcqScore = resDoc.score;
        const totalScore = mcqScore + essayScore;
        const percentage = combinedMaxMarks > 0 ? Math.round((totalScore / combinedMaxMarks) * 10000) / 100 : 0;

        candidates.push({
          resultId: resDoc._id,
          studentId: resDoc.studentId,
          username: userObj?.username || essaySub.studentUsername,
          fullName: profile?.fullName || essaySub.studentFullName || userObj?.username || 'Student',
          school: profile?.school || essaySub.studentSchool || '',
          provinceId: resDoc.provinceId || profile?.provinceId || 'WP',
          districtId: resDoc.districtId || profile?.districtId || 'COLOMBO',
          mcqScore,
          mcqTotalMarks: mcqMaxMarks,
          essayScore,
          essayTotalMarks: essayMaxMarks,
          fullPaperScore: totalScore,
          fullPaperTotalMarks: combinedMaxMarks,
          percentage,
          timeTakenSeconds: resDoc.timeTakenSeconds,
          submittedAt: essaySub.submittedAt || resDoc.createdAt,
        });
      }

      if (candidates.length === 0) {
        logger.warn(`[FULL_PAPER_RANK] No candidates with both MCQ and marked essay for quiz ${quizIdStr}.`);
        return;
      }

      // Sort Tie-breaker:
      // 1. Higher fullPaperScore (-1)
      // 2. Lower MCQ timeTakenSeconds (1)
      // 3. Earlier essay submission timestamp (1)
      candidates.sort((a, b) => {
        if (b.fullPaperScore !== a.fullPaperScore) {
          return b.fullPaperScore - a.fullPaperScore;
        }
        if (a.timeTakenSeconds !== b.timeTakenSeconds) {
          return a.timeTakenSeconds - b.timeTakenSeconds;
        }
        return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      });

      // Rank calculations
      const provinceCountsMap = new Map<string, number>();
      const districtCountsMap = new Map<string, number>();

      const rankingSnapshotItems: IFullPaperRankingItem[] = [];
      const bulkOps: any[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        const islandRank = i + 1;

        // Province Rank
        const pId = item.provinceId;
        const pCount = (provinceCountsMap.get(pId) || 0) + 1;
        provinceCountsMap.set(pId, pCount);
        const provinceRank = pCount;

        // District Rank
        const dId = item.districtId;
        const dCount = (districtCountsMap.get(dId) || 0) + 1;
        districtCountsMap.set(dId, dCount);
        const districtRank = dCount;

        // Update QuizResult
        bulkOps.push({
          updateOne: {
            filter: { _id: item.resultId },
            update: {
              $set: {
                hasEssaySubmission: true,
                essayAttended: true,
                essayMarks: item.essayScore,
                essayTotalMarks: item.essayTotalMarks,
                isEssayMarked: true,
                fullPaperTotalMarks: item.fullPaperTotalMarks,
                fullPaperScore: item.fullPaperScore,
                fullPaperPercentage: item.percentage,
                fullPaperIslandRank: islandRank,
                fullPaperProvinceRank: provinceRank,
                fullPaperDistrictRank: districtRank,
              },
            },
          },
        });

        rankingSnapshotItems.push({
          studentId: item.studentId,
          fullName: item.fullName,
          username: item.username,
          school: item.school,
          provinceId: item.provinceId,
          districtId: item.districtId,
          mcqScore: item.mcqScore,
          mcqTotalMarks: item.mcqTotalMarks,
          essayScore: item.essayScore,
          essayTotalMarks: item.essayTotalMarks,
          totalScore: item.fullPaperScore,
          totalMarks: item.fullPaperTotalMarks,
          percentage: item.percentage,
          timeTakenSeconds: item.timeTakenSeconds,
          submittedAt: item.submittedAt,
          islandRank,
          provinceRank,
          districtRank,
        });
      }

      if (bulkOps.length > 0) {
        await QuizResult.bulkWrite(bulkOps, { ordered: false });
      }

      // Mark all students who did MCQ but did NOT submit/attend essay as not attended
      const attendedStudentIds = candidates.map((c) => c.studentId);
      await QuizResult.updateMany(
        {
          quizId: quizIdStr,
          studentId: { $nin: attendedStudentIds },
        },
        {
          $set: {
            hasEssaySubmission: false,
            essayAttended: false,
            isEssayMarked: false,
            fullPaperIslandRank: 0,
            fullPaperProvinceRank: 0,
            fullPaperDistrictRank: 0,
          },
        }
      );

      // Aggregates
      const totalScores = candidates.map((c) => c.fullPaperScore);
      const totalParticipants = candidates.length;
      const averageScore = Math.round((totalScores.reduce((a, b) => a + b, 0) / totalParticipants) * 100) / 100;
      const highestScore = Math.max(...totalScores);
      const lowestScore = Math.min(...totalScores);

      await FullPaperRankingSnapshot.findOneAndUpdate(
        { quizId: quizIdStr },
        {
          quizId: quizIdStr,
          totalParticipants,
          averageScore,
          highestScore,
          lowestScore,
          isAllMarked,
          rankings: rankingSnapshotItems,
        },
        { upsert: true, new: true }
      );

      const now = new Date();
      const existingQuiz = await Quiz.findById(quizIdStr).select('fullPaperRankingsCalculatedAt');
      const quizUpdate: any = { isFullPaperRankingsCalculated: true };
      if (!existingQuiz?.fullPaperRankingsCalculatedAt) {
        quizUpdate.fullPaperRankingsCalculatedAt = now;
      }
      await Quiz.findByIdAndUpdate(quizIdStr, quizUpdate);

      logger.info(
        `[FULL_PAPER_RANK] Full paper rankings calculated for Quiz ${quizIdStr}. Participants: ${totalParticipants}. Student essay answer files and marker exam card will be retained for 1 week (7 days) before automated deletion.`
      );
    } finally {
      activeFullPaperCalculations.delete(quizIdStr);
    }
  })();

  activeFullPaperCalculations.set(quizIdStr, calculationPromise);
  return calculationPromise;
}
