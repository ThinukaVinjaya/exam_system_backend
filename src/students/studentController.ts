import { Request, Response, NextFunction } from 'express';
import { StudentProfile } from '../models/StudentProfile.js';
import { QuizResult } from '../models/QuizResult.js';
import { QuizAttempt } from '../models/QuizAttempt.js';
import { Quiz } from '../models/Quiz.js';
import { FullPaperRankingSnapshot } from '../models/FullPaperRankingSnapshot.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { PROVINCES, DISTRICTS } from '../data/sriLankaData.js';
import { ApiError } from '../utils/apiError.js';
import { getQuizWindowStatus } from '../utils/scheduleWindows.js';
import mongoose from 'mongoose';

export async function getStudentProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const profile = await StudentProfile.findOne({ userId });
    if (!profile) {
      throw new ApiError(404, 'Student profile not found', 'PROFILE_NOT_FOUND');
    }

    const province = PROVINCES.find((p) => p.id === profile.provinceId);
    const district = DISTRICTS.find((d) => d.id === profile.districtId);

    res.json({
      success: true,
      data: {
        ...profile.toObject(),
        provinceName: province?.nameEn || profile.provinceId,
        districtName: district?.nameEn || profile.districtId,
      },
    });
  } catch (err) {
    next(err);
  }
}

import { isValidSriLankanPhone, normalizeSriLankanPhone } from '../utils/phoneValidator.js';
import { User } from '../models/User.js';
import { Category, formatCategoryName } from '../models/Category.js';
import { Institute } from '../models/Institute.js';

export async function updateStudentProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { fullName, email, phoneNumber, whatsappNumber, school, grade, alYear, institute, provinceId, districtId } = req.body;

    const updateData: any = {};
    if (fullName) updateData.fullName = fullName.trim();
    if (school) updateData.school = school.trim();
    if (grade) updateData.grade = Number(grade);
    if (alYear) {
      const raw = alYear.trim();
      const formatted = formatCategoryName(raw) || raw;
      const existingCategory = await Category.findOne({
        $or: [{ name: formatted }, { name: raw }, { normalizedName: formatted.toLowerCase() }],
        isActive: true,
      });
      if (!existingCategory) {
        throw new ApiError(400, 'Selected category is invalid. Please select from existing categories.', 'INVALID_CATEGORY');
      }
      updateData.alYear = existingCategory.name;
    }
    if (institute !== undefined) {
      const rawInst = (institute || 'None').trim();
      const existingInst = await Institute.findOne({
        $or: [{ name: rawInst }, { normalizedName: rawInst.toLowerCase() }],
        isActive: true,
      });
      updateData.institute = existingInst ? existingInst.name : (rawInst || 'None');
    }
    if (provinceId) updateData.provinceId = provinceId;
    if (districtId) updateData.districtId = districtId;

    if (whatsappNumber) {
      if (!isValidSriLankanPhone(whatsappNumber)) {
        throw new ApiError(400, 'Please enter a valid Sri Lankan WhatsApp number (e.g. 0771234567 or +94771234567).', 'INVALID_PHONE');
      }
      updateData.whatsappNumber = normalizeSriLankanPhone(whatsappNumber);
    }

    if (phoneNumber) {
      if (!isValidSriLankanPhone(phoneNumber)) {
        throw new ApiError(400, 'Please enter a valid Sri Lankan phone number (e.g. 0771234567 or +94771234567).', 'INVALID_PHONE');
      }
      updateData.phoneNumber = normalizeSriLankanPhone(phoneNumber);
      if (!updateData.whatsappNumber) {
        updateData.whatsappNumber = updateData.phoneNumber;
      }
    }

    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      // Check if email already used by someone else
      const existing = await User.findOne({ email: cleanEmail, _id: { $ne: userId } });
      if (existing) {
        throw new ApiError(400, 'This email is already associated with another account.', 'EMAIL_IN_USE');
      }
      updateData.email = cleanEmail;
      await User.findByIdAndUpdate(userId, { email: cleanEmail });
    }

    const profile = await StudentProfile.findOneAndUpdate(
      { userId },
      updateData,
      { new: true }
    );

    if (!profile) {
      throw new ApiError(404, 'Student profile not found.', 'PROFILE_NOT_FOUND');
    }

    const province = PROVINCES.find((p) => p.id === profile.provinceId);
    const district = DISTRICTS.find((d) => d.id === profile.districtId);

    res.json({
      success: true,
      message: 'Profile details updated successfully.',
      data: {
        ...profile.toObject(),
        provinceName: province?.nameEn || profile.provinceId,
        districtName: district?.nameEn || profile.districtId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getStudentPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const results = await QuizResult.find({ studentId: userId }).populate('quizId').sort({ createdAt: -1 });

    const now = new Date();
    const finalizedResults = results.filter((r) => {
      const q: any = r.quizId;
      if (!q) return false;
      const ws = getQuizWindowStatus(q, now);
      return ws.isMcqEnded;
    });

    const totalQuizzes = results.length;
    const avgPercentage = totalQuizzes > 0 ? Math.round(results.reduce((a, b) => a + b.percentage, 0) / totalQuizzes) : 0;
    const bestPercentage = totalQuizzes > 0 ? Math.max(...results.map((r) => r.percentage)) : 0;
    const bestIslandRank = finalizedResults.length > 0
      ? Math.min(...finalizedResults.filter((r) => r.islandRank > 0).map((r) => r.islandRank), 999999)
      : 0;
    const validBestIslandRank = bestIslandRank === 999999 ? 0 : bestIslandRank;

    // Aggregate topic breakdown across all results
    const topicMap = new Map<
      string,
      { topicName: string; totalQuestions: number; correctCount: number; totalPct: number; count: number }
    >();

    results.forEach((r) => {
      r.topicBreakdown.forEach((tb) => {
        const key = tb.topicName;
        if (!topicMap.has(key)) {
          topicMap.set(key, {
            topicName: tb.topicName,
            totalQuestions: 0,
            correctCount: 0,
            totalPct: 0,
            count: 0,
          });
        }
        const item = topicMap.get(key)!;
        item.totalQuestions += tb.totalQuestions || 0;
        item.correctCount += tb.correctCount || 0;
        item.totalPct += Number(tb.percentage || 0);
        item.count += 1;
      });
    });

    const topicPerformance = Array.from(topicMap.values()).map((t) => ({
      topicName: t.topicName,
      totalQuestions: t.totalQuestions,
      correctCount: t.correctCount,
      quizzesCount: t.count,
      averagePercentage: Math.round(t.totalPct / t.count),
    }));

    res.json({
      success: true,
      data: {
        totalQuizzes,
        avgPercentage,
        bestPercentage,
        bestIslandRank: validBestIslandRank,
        recentResults: results.slice(0, 5),
        topicPerformance,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getStudentMonthlyAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const results = await QuizResult.find({ studentId: userId })
      .populate('quizId', 'quizNumber title date scheduleWindows startTime endTime status hasEssay essayTotalMarks totalMarks isFullPaperRankingsCalculated')
      .sort({ createdAt: 1 });

    const now = new Date();

    // Collect all quiz IDs for essay and snapshot checking
    const allQuizIds = results
      .map((r) => {
        const q: any = r.quizId;
        return (q?._id || r.quizId);
      })
      .filter(Boolean);

    // Fetch FullPaperRankingSnapshots for all attempted quizzes
    const fpSnapshotMap = new Map<string, any>();
    if (allQuizIds.length > 0) {
      const fpSnapshots = await FullPaperRankingSnapshot.find({ quizId: { $in: allQuizIds } }).lean();
      fpSnapshots.forEach((snap) => {
        if (snap.rankings) {
          const myItem = snap.rankings.find((ri) => ri.studentId.toString() === userId.toString());
          if (myItem) {
            fpSnapshotMap.set(snap.quizId.toString(), myItem);
          }
        }
      });
    }

    // Also fetch EssaySubmissions for this student for any fallback/marked state
    const essaySubMap = new Map<string, any>();
    if (allQuizIds.length > 0) {
      const essaySubs = await EssaySubmission.find({ studentId: userId, quizId: { $in: allQuizIds } }).lean();
      essaySubs.forEach((sub) => {
        essaySubMap.set(sub.quizId.toString(), sub);
      });
    }

    const scoreTrend = results.map((r) => {
      const q: any = r.quizId;
      const qIdStr = (q?._id || r.quizId)?.toString();
      const ws = q ? getQuizWindowStatus(q, now) : null;
      const mcqFinalEndTime = ws ? ws.mcqFinalEndTime : (q?.endTime ? new Date(q.endTime) : null);
      const isMcqEnded = Boolean((mcqFinalEndTime && now >= mcqFinalEndTime) || q?.status === 'ARCHIVED');
      const cleanTitle = (q?.title || 'Quiz').replace(/^(quiz\s*#\d+\s*[-:]?\s*)+/i, '').trim();

      const fpSnapItem = qIdStr ? fpSnapshotMap.get(qIdStr) : null;
      const essaySub = qIdStr ? essaySubMap.get(qIdStr) : null;

      const hasEssay = Boolean(
        (r as any).hasEssay ||
        (r as any).hasEssaySubmission ||
        q?.hasEssay ||
        fpSnapItem ||
        essaySub ||
        (r.fullPaperIslandRank && r.fullPaperIslandRank > 0)
      );

      const isEssayMarked = Boolean(
        r.isEssayMarked ||
        fpSnapItem ||
        (essaySub && essaySub.isMarked) ||
        (r.essayMarks != null)
      );

      const essayMarks = (r.essayMarks != null)
        ? r.essayMarks
        : (fpSnapItem && fpSnapItem.essayScore != null)
          ? fpSnapItem.essayScore
          : (essaySub && essaySub.isMarked && typeof essaySub.marksAwarded === 'number')
            ? essaySub.marksAwarded
            : null;

      const essayTotalMarks = r.essayTotalMarks || (fpSnapItem ? fpSnapItem.essayTotalMarks : (essaySub?.maxMarks || q?.essayTotalMarks || 100));

      const fpIslandRank = (r.fullPaperIslandRank && r.fullPaperIslandRank > 0)
        ? r.fullPaperIslandRank
        : (fpSnapItem && fpSnapItem.islandRank > 0 ? fpSnapItem.islandRank : null);

      const fpScore = (r.fullPaperScore != null)
        ? r.fullPaperScore
        : (fpSnapItem && fpSnapItem.totalScore != null)
          ? fpSnapItem.totalScore
          : (isEssayMarked && essayMarks != null)
            ? (r.score + essayMarks)
            : null;

      const fpTotalMarks = (r.fullPaperTotalMarks != null && r.fullPaperTotalMarks > 0)
        ? r.fullPaperTotalMarks
        : (fpSnapItem && fpSnapItem.totalMarks > 0)
          ? fpSnapItem.totalMarks
          : (hasEssay ? (r.totalMarks || q?.totalMarks || 100) + essayTotalMarks : null);

      const fpPercentage = (r.fullPaperPercentage != null)
        ? r.fullPaperPercentage
        : (fpSnapItem && fpSnapItem.percentage != null)
          ? fpSnapItem.percentage
          : (fpScore != null && fpTotalMarks ? Math.round((fpScore / fpTotalMarks) * 100) : null);

      // Auto-repair QuizResult in DB if snapshot exists and result document is missing rank
      if (fpSnapItem && (!r.fullPaperIslandRank || r.fullPaperIslandRank === 0)) {
        QuizResult.updateOne(
          { _id: r._id },
          {
            $set: {
              fullPaperIslandRank: fpSnapItem.islandRank,
              fullPaperProvinceRank: fpSnapItem.provinceRank,
              fullPaperDistrictRank: fpSnapItem.districtRank,
              fullPaperScore: fpScore,
              fullPaperTotalMarks: fpTotalMarks,
              fullPaperPercentage: fpPercentage,
              essayMarks: essayMarks,
              essayTotalMarks: essayTotalMarks,
              isEssayMarked: true,
            },
          }
        ).catch(() => {});
      }

      const islandRank = isMcqEnded && r.islandRank && r.islandRank > 0 ? r.islandRank : null;

      const isFullPaperRankingsCalculated = Boolean(q?.isFullPaperRankingsCalculated || fpSnapItem || (fpIslandRank && fpIslandRank > 0));
      const essayAttended = Boolean((fpIslandRank && fpIslandRank > 0) || (essaySub && essaySub.isMarked) || r.hasEssaySubmission || r.essayAttended);
      const isFullPaperNotAttended = Boolean(hasEssay && isFullPaperRankingsCalculated && !essayAttended);

      return {
        quizId: qIdStr,
        quizNumber: q?.quizNumber || 1,
        quizTitle: q?.quizNumber ? `Quiz #${q.quizNumber} - ${cleanTitle}` : cleanTitle,
        date: q?.date ? new Date(q.date).toLocaleDateString('si-LK') : new Date(r.createdAt).toLocaleDateString('si-LK'),
        percentage: r.percentage,
        islandRank,
        score: r.score,
        totalMarks: r.totalMarks || q?.totalMarks || 100,
        hasEssay,
        essayMarks: essayAttended ? essayMarks : null,
        essayTotalMarks,
        isEssayMarked,
        isMcqEnded,
        isFullPaperRankingsCalculated,
        essayAttended,
        isFullPaperNotAttended,
        fullPaperScore: essayAttended ? fpScore : null,
        fullPaperTotalMarks: fpTotalMarks,
        fullPaperPercentage: essayAttended ? fpPercentage : null,
        fullPaperIslandRank: fpIslandRank && fpIslandRank > 0 ? fpIslandRank : null,
      };
    });

    const totalAvailable = await Quiz.countDocuments({ status: { $in: ['LIVE', 'ENDED', 'ARCHIVED'] } });
    const attended = results.length;
    const missed = Math.max(0, totalAvailable - attended);

    const fullPaperResults = scoreTrend.filter((st) => Boolean(st.hasEssay && st.isEssayMarked && st.fullPaperScore != null));
    const fullPaperAttended = fullPaperResults.length;
    const fullPaperAveragePercentage = fullPaperAttended > 0
      ? Math.round(fullPaperResults.reduce((a, b) => a + (b.fullPaperPercentage || 0), 0) / fullPaperAttended)
      : 0;

    const essayMarkedResults = scoreTrend.filter((st) => Boolean(st.hasEssay && st.isEssayMarked && st.essayMarks != null));
    const essayAverageMarks = essayMarkedResults.length > 0
      ? Math.round((essayMarkedResults.reduce((a, b) => a + (b.essayMarks || 0), 0) / essayMarkedResults.length) * 10) / 10
      : 0;

    const validFpRanks: number[] = [];
    scoreTrend.forEach((st) => {
      if (typeof st.fullPaperIslandRank === 'number' && st.fullPaperIslandRank > 0) {
        validFpRanks.push(st.fullPaperIslandRank);
      }
    });
    const bestFullPaperRank = validFpRanks.length > 0 ? Math.min(...validFpRanks) : null;

    res.json({
      success: true,
      data: {
        scoreTrend,
        summary: {
          availableQuizzes: totalAvailable,
          attendedQuizzes: attended,
          missedQuizzes: missed,
          averageScore: attended > 0 ? Math.round(results.reduce((a, b) => a + b.percentage, 0) / attended) : 0,
          fullPaperAttended,
          fullPaperAveragePercentage,
          essayAverageMarks,
          bestFullPaperRank,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}
