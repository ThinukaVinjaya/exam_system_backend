import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { Question } from '../models/Question.js';
import { QuizAttempt } from '../models/QuizAttempt.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { QuizResult } from '../models/QuizResult.js';
import { processAndGradeAttempt } from '../attempts/scoringService.js';
import { calculateAndStoreQuizRankings, computeRanksForSingleAttempt } from '../rankings/rankingService.js';
import { ApiError } from '../utils/apiError.js';
import { RankingSnapshot } from '../models/RankingSnapshot.js';
import { PROVINCES, DISTRICTS } from '../data/sriLankaData.js';
import { formatSriLankanTime, formatSriLankanTimePeriod } from '../utils/sriLankanTime.js';
import { memoryCache } from '../utils/cache.js';
import { getQuizWindowStatus } from '../utils/scheduleWindows.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { resequenceAllQuizNumbers, ensureQuizNumber } from './quizNumberService.js';
import { QuestionImage } from '../models/QuestionImage.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { FullPaperRankingSnapshot } from '../models/FullPaperRankingSnapshot.js';
import { calculateAndStoreFullPaperRankings } from '../rankings/fullPaperRankingService.js';

export async function getStudentQuizzes(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const now = new Date();

    // Ensure all quizzes in the system are sequentially numbered strictly in chronological order (#1, #2, #3...)
    await resequenceAllQuizNumbers();

    // High throughput read query: fetch quizzes, student profile, and attempts using lean() for zero hydration overhead
    // Multi-day and scheduled quizzes are classified strictly by their final day end time (finalEndTime)
    const [allQuizzesRaw, studentAttempts, studentResultsDocs, studentProfile] = await Promise.all([
      Quiz.find({
        status: { $in: ['LIVE', 'SCHEDULED', 'ENDED'] },
      })
        .populate('subjectId', 'nameSi nameEn code')
        .sort({ startTime: 1 })
        .lean(),

      QuizAttempt.find({ studentId: userId }).lean(),
      QuizResult.find({ studentId: userId }).lean(),
      StudentProfile.findOne({ userId }).select('alYear').lean(),
    ]);

    const studentCategory = studentProfile?.alYear || '2027 A/L';

    const liveQuizzes: any[] = [];
    const upcomingQuizzes: any[] = [];
    const endedQuizzes: any[] = [];

    for (const q of allQuizzesRaw) {
      // Filter by targetCategory: Quizzes are for Everyone OR for student's specific category (e.g. 2027 A/L, 2028 A/L)
      const targetCat = (q.targetCategory || 'ALL').trim();
      const isForEveryone = !targetCat || targetCat.toUpperCase() === 'ALL' || targetCat.toLowerCase() === 'everyone';
      const isForStudentCategory = !isForEveryone && targetCat.toLowerCase() === studentCategory.toLowerCase();

      // If a student has already attempted or received marks for a quiz, always show it to them regardless of category
      const hasAttemptedThisQuiz =
        studentResultsDocs.some((r) => (r.quizId?._id || r.quizId)?.toString() === q._id.toString()) ||
        studentAttempts.some((a) => (a.quizId?._id || a.quizId)?.toString() === q._id.toString());

      if (!isForEveryone && !isForStudentCategory && !hasAttemptedThisQuiz) {
        continue;
      }

      const windowStatus = getQuizWindowStatus(q, now);
      // STRICT RULE: Quiz is only considered ended when the final day and final slot (including essay deadline) has ended
      if (now >= windowStatus.finalEndTime || q.status === 'ARCHIVED') {
        endedQuizzes.push(q);
      } else if (windowStatus.isCurrentlyOpen) {
        if (q.status === 'ENDED') {
          Quiz.findByIdAndUpdate(q._id, { status: 'LIVE' }).exec();
          q.status = 'LIVE';
        }
        liveQuizzes.push(q);
      } else {
        upcomingQuizzes.push(q);
      }
    }

    let studentResults: any[] = [...studentResultsDocs];

    // If student has an attempt that timed out or was submitted without a result document, grade it now
    for (const att of studentAttempts) {
      const hasResult = studentResults.some(
        (r) => r.attemptId?.toString() === att._id.toString() || r.quizId?.toString() === att.quizId.toString()
      );
      if (!hasResult) {
        if (att.status === 'SUBMITTED' || att.status === 'AUTO_SUBMITTED' || now > att.expectedEndTime) {
          try {
            const newRes = await processAndGradeAttempt(
              att._id,
              att.status === 'IN_PROGRESS' ? 'AUTO_SUBMITTED' : att.status
            );
            studentResults.push(newRes);
          } catch (e) {
            // ignore
          }
        }
      }
    }

    const resultMap = new Map<string, any>();
    studentResults.forEach((r) => {
      const qId = r.quizId?._id ? r.quizId._id.toString() : r.quizId?.toString();
      if (qId) {
        resultMap.set(qId, r);
      }
    });

    const activeAttempts = new Set(
      studentAttempts
        .filter((a) => a.status === 'IN_PROGRESS' && now <= a.expectedEndTime && !resultMap.has(a.quizId.toString()))
        .map((a) => a.quizId.toString())
    );

    const mapQuiz = (q: any) => {
      const qObj = q;
      const qIdStr = q._id.toString();
      const resDoc = resultMap.get(qIdStr);
      const hasAttempted = Boolean(resDoc);
      const hasActiveAttempt = !resDoc && activeAttempts.has(qIdStr);
      const windowStatus = getQuizWindowStatus(q, now);
      const isMcqEnded = Boolean(now >= windowStatus.mcqFinalEndTime || q.status === 'ARCHIVED');
      const isQuizEnded = Boolean(now >= windowStatus.finalEndTime || q.status === 'ARCHIVED');

      // Auto-trigger Quiz ranking calculation if MCQ session has elapsed and not yet calculated
      if (isMcqEnded && !q.isRankingsCalculated) {
        calculateAndStoreQuizRankings(q._id).catch(() => {});
      }

      const rankPublished = isMcqEnded && Boolean(resDoc && resDoc.islandRank && resDoc.islandRank > 0);
      const isQuizFullPaperCalculated = Boolean(q.isFullPaperRankingsCalculated);
      const hasStudentFpRank = Boolean(resDoc && resDoc.fullPaperIslandRank && resDoc.fullPaperIslandRank > 0);
      const fullPaperRankPublished = isQuizFullPaperCalculated || hasStudentFpRank;
      const myFullPaperAttended = Boolean(hasStudentFpRank || (resDoc && (resDoc.hasEssaySubmission || resDoc.essayAttended)));
      const myFullPaperNotAttended = Boolean(q.hasEssay && fullPaperRankPublished && !myFullPaperAttended);

      const timeRemainingSeconds = !isQuizEnded && windowStatus.finalEndTime
        ? Math.max(0, Math.floor((windowStatus.finalEndTime.getTime() - now.getTime()) / 1000))
        : 0;
      const mcqTimeRemainingSeconds = !isMcqEnded && windowStatus.mcqFinalEndTime
        ? Math.max(0, Math.floor((windowStatus.mcqFinalEndTime.getTime() - now.getTime()) / 1000))
        : 0;

      const quizNumber = q.quizNumber || (qObj && qObj.quizNumber) || 1;

      return {
        ...qObj,
        quizNumber,
        hasAttempted,
        hasActiveAttempt,
        resultId: resDoc?._id || null,
        myScore: resDoc ? resDoc.score : undefined,
        myPercentage: resDoc ? resDoc.percentage : undefined,
        myIslandRank: (rankPublished && resDoc && resDoc.islandRank && resDoc.islandRank > 0) ? resDoc.islandRank : undefined,
        myProvinceRank: (rankPublished && resDoc && resDoc.provinceRank && resDoc.provinceRank > 0) ? resDoc.provinceRank : undefined,
        myDistrictRank: (rankPublished && resDoc && resDoc.districtRank && resDoc.districtRank > 0) ? resDoc.districtRank : undefined,
        myFullPaperIslandRank: (hasStudentFpRank && resDoc && resDoc.fullPaperIslandRank && resDoc.fullPaperIslandRank > 0) ? resDoc.fullPaperIslandRank : undefined,
        myFullPaperProvinceRank: (hasStudentFpRank && resDoc && resDoc.fullPaperProvinceRank && resDoc.fullPaperProvinceRank > 0) ? resDoc.fullPaperProvinceRank : undefined,
        myFullPaperDistrictRank: (hasStudentFpRank && resDoc && resDoc.fullPaperDistrictRank && resDoc.fullPaperDistrictRank > 0) ? resDoc.fullPaperDistrictRank : undefined,
        myFullPaperScore: resDoc ? resDoc.fullPaperScore : undefined,
        myFullPaperPercentage: resDoc ? resDoc.fullPaperPercentage : undefined,
        myFullPaperAttended,
        myFullPaperNotAttended,
        isFullPaperRankingsCalculated: fullPaperRankPublished,
        isMcqEnded,
        isQuizEnded,
        rankPublished,
        fullPaperRankPublished,
        timeRemainingSeconds,
        mcqTimeRemainingSeconds,
        serverTime: now.toISOString(),
        scheduleWindows: q.scheduleWindows || [],
        isCurrentlyOpen: windowStatus.isCurrentlyOpen,
        isBetweenWindows: windowStatus.isBetweenWindows,
        currentWindow: windowStatus.currentWindow,
        nextWindow: windowStatus.nextWindow,
        firstStartTime: windowStatus.firstStartTime,
        mcqFinalEndTime: windowStatus.mcqFinalEndTime,
        finalEndTime: windowStatus.finalEndTime,
        targetCategory: q.targetCategory || 'ALL',
      };
    };

    res.json({
      success: true,
      data: {
        studentCategory,
        live: liveQuizzes.map(mapQuiz),
        upcoming: upcomingQuizzes.map(mapQuiz),
        ended: endedQuizzes.map(mapQuiz),
      },
    });
  } catch (err) {
    next(err);
  }
}

function shuffleWithGuaranteedChange<T>(items: T[], keySelector?: (item: T) => string): T[] {
  if (items.length <= 1) return [...items];

  let result = [...items];
  // Perform Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  // Check if result is identical to original order
  const isIdentical = result.every((item, idx) => {
    if (keySelector) {
      return keySelector(item) === keySelector(items[idx]);
    }
    return item === items[idx];
  });

  // If by chance the random shuffle resulted in the exact same sequence, rotate by at least 1 position
  if (isIdentical && items.length > 1) {
    const shift = 1 + Math.floor(Math.random() * (items.length - 1));
    result = [...result.slice(shift), ...result.slice(0, shift)];
  }

  return result;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'];

export function generateShuffledQuestions(questions: any[]): any[] {
  // Separate MCQ and Short Answer questions:
  // Selection (MCQ) quiz questions MUST be continuous, with NO short answer questions in between.
  // All Short Answer questions are strictly positioned after selection quiz questions.
  const mcqQuestions = (questions || []).filter((q) => q.questionType !== 'SHORT_ANSWER');
  const shortAnswerQuestions = (questions || []).filter((q) => q.questionType === 'SHORT_ANSWER');

  // 1. Shuffle MCQ question order with guaranteed change among MCQs
  const shuffledMcqs = shuffleWithGuaranteedChange(mcqQuestions, (q) => q._id?.toString() || '');

  // 2. Shuffle Short Answer question order with guaranteed change among Short Answers
  const shuffledShortAnswers = shuffleWithGuaranteedChange(shortAnswerQuestions, (q) => q._id?.toString() || '');

  // 3. Assemble: MCQs continuous first, followed strictly by all Short Answer questions
  const finalOrderedQuestions = [...shuffledMcqs, ...shuffledShortAnswers];

  // 4. For each question, shuffle option order with guaranteed change (only for MCQs)
  return finalOrderedQuestions.map((q) => {
    const rawOptions = (q.options || []) as Array<{ key: string; text: string }>;
    if (rawOptions.length === 0 || q.questionType === 'SHORT_ANSWER') {
      return {
        questionId: q._id,
        options: [],
      };
    }
    const shuffledOpts = shuffleWithGuaranteedChange(rawOptions, (opt) => opt.key);
    const displayOptions = shuffledOpts.map((opt, idx) => ({
      displayKey: OPTION_KEYS[idx] || String.fromCharCode(65 + idx),
      originalKey: opt.key,
    }));
    return {
      questionId: q._id,
      options: displayOptions,
    };
  });
}

export function buildSanitizedQuestions(quizDoc: any, attemptDoc: any): any[] {
  const sanitizedQuestions: any[] = [];
  const questionMap = new Map<string, any>();
  ((quizDoc.questions as any[]) || []).forEach((q) => {
    if (q && q._id) questionMap.set(q._id.toString(), q);
  });

  if (attemptDoc?.shuffledQuestions && attemptDoc.shuffledQuestions.length > 0) {
    for (const sq of attemptDoc.shuffledQuestions) {
      const qDoc = questionMap.get(sq.questionId.toString());
      if (!qDoc) continue;

      const origOptions = (qDoc.options || []) as Array<{ key: string; text: string; imageUrl?: string }>;
      const origTextMap = new Map<string, string>();
      const origImageMap = new Map<string, string>();
      origOptions.forEach((o) => {
        origTextMap.set(o.key, o.text);
        if (o.imageUrl) origImageMap.set(o.key, o.imageUrl);
      });

      // Build options strictly according to this student's shuffled display options
      const displayOpts = (sq.options || []).map((opt: any) => ({
        key: opt.displayKey,
        text: origTextMap.get(opt.originalKey) || '',
        imageUrl: origImageMap.get(opt.originalKey) || undefined,
      }));

      sanitizedQuestions.push({
        _id: qDoc._id,
        questionType: qDoc.questionType || 'MCQ',
        questionText: qDoc.questionText || '',
        imageUrl: qDoc.imageUrl || '',
        imageCaption: qDoc.imageCaption || '',
        options: displayOpts.length > 0 ? displayOpts : qDoc.options || [],
        acceptableAnswers: qDoc.acceptableAnswers || [],
        marks: qDoc.marks || 1,
        difficulty: qDoc.difficulty || 'MEDIUM',
      });
    }
  }

  // If sanitizedQuestions is still empty (e.g. legacy attempt without questions), fallback
  if (sanitizedQuestions.length === 0) {
    const fallbackList = ((quizDoc.questions as any[]) || []).filter((q) => q && q._id);
    const mcqs = fallbackList.filter((q) => q.questionType !== 'SHORT_ANSWER');
    const shortAnswers = fallbackList.filter((q) => q.questionType === 'SHORT_ANSWER');
    for (const q of [...mcqs, ...shortAnswers]) {
      sanitizedQuestions.push({
        _id: q._id,
        questionType: q.questionType || 'MCQ',
        questionText: q.questionText || '',
        imageUrl: q.imageUrl || '',
        imageCaption: q.imageCaption || '',
        options: q.options || [],
        acceptableAnswers: q.acceptableAnswers || [],
        marks: q.marks || 1,
        difficulty: q.difficulty || 'MEDIUM',
      });
    }
  }

  return sanitizedQuestions;
}

export async function getQuestionImage(req: Request, res: Response, next: NextFunction) {
  try {
    const id = (req.params.id as string) || '';
    if (!id) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    const imageDoc = await QuestionImage.findById(id);
    if (!imageDoc || !imageDoc.data) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    // Safely extract raw Buffer from Mongoose/BSON Binary
    let bufferData: Buffer;
    if (Buffer.isBuffer(imageDoc.data)) {
      bufferData = imageDoc.data;
    } else if ((imageDoc.data as any)?.buffer && Buffer.isBuffer((imageDoc.data as any).buffer)) {
      bufferData = (imageDoc.data as any).buffer;
    } else if ((imageDoc.data as any)?.value && typeof (imageDoc.data as any).value === 'function') {
      bufferData = (imageDoc.data as any).value(true);
    } else {
      bufferData = Buffer.from(imageDoc.data as any);
    }

    res.setHeader('Content-Type', imageDoc.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', bufferData.length);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(imageDoc.filename || 'question-image')}"`
    );
    return res.end(bufferData);
  } catch (err) {
    next(err);
  }
}

export async function createOrGetAttemptForStudent(
  studentId: string | mongoose.Types.ObjectId,
  quizId: string | mongoose.Types.ObjectId
): Promise<{ attempt: any; isPracticeAttempt: boolean; alreadyCompleted?: boolean; autoSubmitted?: boolean; resultId?: any }> {
  let attempt = await QuizAttempt.findOne({ studentId, quizId });
  const quiz = await Quiz.findById(quizId).populate('questions');
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
  }

  // Validate student category eligibility
  if (quiz.targetCategory && quiz.targetCategory.toUpperCase() !== 'ALL' && quiz.targetCategory.toLowerCase() !== 'everyone') {
    const sp = await StudentProfile.findOne({ userId: studentId }).select('alYear').lean();
    const studentCat = (sp?.alYear || '').trim().toLowerCase();
    const requiredCat = quiz.targetCategory.trim().toLowerCase();
    if (studentCat && requiredCat && studentCat !== requiredCat) {
      throw new ApiError(
        403,
        `This quiz is only for ${quiz.targetCategory} batch students.`,
        'CATEGORY_RESTRICTED'
      );
    }
  }

  const now = new Date();
  let isPracticeAttempt = false;

  const windowStatus = getQuizWindowStatus(quiz, now);

  if (windowStatus.isEnded || quiz.status === 'ARCHIVED') {
    if (quiz.status !== 'ENDED' && quiz.status !== 'ARCHIVED') {
      quiz.status = 'ENDED';
      await quiz.save();
      await calculateAndStoreQuizRankings(quiz._id);
    }
    isPracticeAttempt = true;
  } else if (!windowStatus.isCurrentlyOpen) {
    if (windowStatus.isBetweenWindows && windowStatus.nextWindow) {
      throw new ApiError(
        400,
        `Current session closed. Next session opens on ${formatSriLankanTime(windowStatus.nextWindow.startTime)}`,
        'QUIZ_SESSION_PAUSED'
      );
    } else if (windowStatus.nextWindow) {
      throw new ApiError(
        400,
        `This quiz has not started yet. Start time: ${formatSriLankanTime(windowStatus.nextWindow.startTime)}`,
        'QUIZ_NOT_STARTED'
      );
    }
  } else {
    if (quiz.status !== 'LIVE') {
      quiz.status = 'LIVE';
      quiz.isRankingsCalculated = false;
      await quiz.save();
    }
  }

  if (attempt) {
    if (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED') {
      const resDoc = await QuizResult.findOne({ attemptId: attempt._id });
      return { attempt, isPracticeAttempt, alreadyCompleted: true, resultId: resDoc?._id };
    }

    // Verify both questions AND answer options are shuffled and persisted
    const qList = (quiz.questions as any[]) || [];
    const needsShuffle =
      !attempt.shuffledQuestions ||
      attempt.shuffledQuestions.length === 0 ||
      attempt.shuffledQuestions.some((sq: any) => {
        const qDoc = qList.find((q: any) => q._id?.toString() === sq.questionId?.toString());
        if (qDoc && (qDoc.questionType === 'SHORT_ANSWER' || !qDoc.options || qDoc.options.length === 0)) {
          return false;
        }
        return !sq.options || sq.options.length === 0;
      });

    if (needsShuffle) {
      const questions = (quiz.questions as any[]) || [];
      const shuffledQuestions = generateShuffledQuestions(questions);
      attempt.shuffledQuestions = shuffledQuestions;
      attempt.markModified('shuffledQuestions');
      const updated = await QuizAttempt.findByIdAndUpdate(
        attempt._id,
        { $set: { shuffledQuestions } },
        { new: true }
      );
      if (updated) attempt = updated;
    }
    return { attempt, isPracticeAttempt };
  }

  // Calculate server authoritative timing: INDIVIDUAL countdown per student
  // Each student gets their full quiz duration (e.g. 30 mins) starting at the moment of start
  const startTime = now;
  const durationMinutes = Math.max(1, quiz.durationMinutes || 30);
  const durationMs = durationMinutes * 60 * 1000;
  const expectedEndTime = new Date(startTime.getTime() + durationMs);

  // Generate randomized question order and randomized answer option mapping for this student
  const questions = (quiz.questions as any[]) || [];
  const shuffledQuestions = generateShuffledQuestions(questions);

  try {
    attempt = await QuizAttempt.create({
      studentId,
      quizId,
      startTime,
      expectedEndTime,
      status: 'IN_PROGRESS',
      shuffledQuestions,
    });
  } catch (err: any) {
    if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
      attempt = await QuizAttempt.findOne({ studentId, quizId });
      if (!attempt) throw err;
    } else {
      throw err;
    }
  }

  return { attempt, isPracticeAttempt };
}

export async function getQuizForStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const quiz = await memoryCache.getOrSet(
      `quiz_full_${id}`,
      () => Quiz.findById(id).populate('subjectId', 'nameSi code').populate('questions').lean(),
      60
    );
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    const windowStatus = getQuizWindowStatus(quiz, new Date());
    let attempt = await QuizAttempt.findOne({ studentId: userId, quizId: id });

    let quizNum = (quiz as any).quizNumber;
    if (!quizNum || quizNum <= 0) {
      await resequenceAllQuizNumbers();
      const refreshed = await Quiz.findById(id).select('quizNumber').lean();
      quizNum = refreshed?.quizNumber || (await ensureQuizNumber(quiz));
    }

    let hasStarted = false;
    let hasCompleted = false;
    let resultId: any = null;
    let sanitizedQuestions: any[] = [];

    // If student has already started an attempt, resume and build sanitized questions
    if (attempt) {
      hasStarted = true;
      if (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED') {
        hasCompleted = true;
        const resDoc = await QuizResult.findOne({ attemptId: attempt._id });
        resultId = resDoc?._id;
      }

      // If existing attempt needs shuffled questions fix, update it
      const qList = (quiz.questions as any[]) || [];
      const needsShuffle =
        !attempt.shuffledQuestions ||
        attempt.shuffledQuestions.length === 0 ||
        attempt.shuffledQuestions.some((sq: any) => {
          const qDoc = qList.find((q: any) => q._id?.toString() === sq.questionId?.toString());
          if (qDoc && (qDoc.questionType === 'SHORT_ANSWER' || !qDoc.options || qDoc.options.length === 0)) {
            return false;
          }
          return !sq.options || sq.options.length === 0;
        });

      if (needsShuffle) {
        const questions = (quiz.questions as any[]) || [];
        const shuffledQuestions = generateShuffledQuestions(questions);
        attempt.shuffledQuestions = shuffledQuestions;
        attempt.markModified('shuffledQuestions');
        const updated = await QuizAttempt.findByIdAndUpdate(
          attempt._id,
          { $set: { shuffledQuestions } },
          { new: true }
        );
        if (updated) attempt = updated;
      }

      sanitizedQuestions = buildSanitizedQuestions(quiz, attempt);
    }

    res.json({
      success: true,
      data: {
        _id: quiz._id,
        quizNumber: quizNum || (quiz as any).quizNumber || 1,
        title: quiz.title,
        description: quiz.description,
        subject: quiz.subjectId,
        durationMinutes: quiz.durationMinutes,
        totalMarks: quiz.totalMarks,
        instructions: quiz.instructions,
        questions: sanitizedQuestions,
        totalQuestions: ((quiz.questions as any[]) || []).length,
        startTime: quiz.startTime,
        endTime: quiz.endTime,
        scheduleWindows: (quiz as any).scheduleWindows || [],
        currentWindow: windowStatus.currentWindow,
        nextWindow: windowStatus.nextWindow,
        finalEndTime: windowStatus.finalEndTime,
        isCurrentlyOpen: windowStatus.isCurrentlyOpen,
        isBetweenWindows: windowStatus.isBetweenWindows,
        targetCategory: (quiz as any).targetCategory || 'ALL',
        hasStarted,
        hasCompleted,
        resultId,
        attemptId: attempt?._id,
        hasEssay: Boolean((quiz as any).hasEssay || (quiz as any).essayQuestionPaperFileId),
        essayTotalMarks: (quiz as any).essayTotalMarks || 0,
        essayStartTime: (quiz as any).essayStartTime,
        essayEndTime: (quiz as any).essayEndTime,
        essayDurationMinutes: (quiz as any).essayDurationMinutes,
        essayInstructions: (quiz as any).essayInstructions,
        hasQuestionPaper: Boolean((quiz as any).essayQuestionPaperFileId),
        questionPaperFilename: (quiz as any).essayQuestionPaperFilename,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getPublicQuizDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const cacheKey = `quiz_public_${id}`;
    const quizData = await memoryCache.getOrSet(cacheKey, async () => {
      const quiz = await Quiz.findById(id).populate('subjectId', 'nameSi nameEn code').lean();
      if (!quiz) {
        throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
      }

      let quizNum = (quiz as any).quizNumber;
      if (!quizNum || quizNum <= 0) {
        await resequenceAllQuizNumbers();
        const refreshed = await Quiz.findById(id).select('quizNumber').lean();
        quizNum = refreshed?.quizNumber || (await ensureQuizNumber(quiz));
      }

      const windowStatus = getQuizWindowStatus(quiz, new Date());

      return {
        _id: quiz._id,
        quizNumber: quizNum || (quiz as any).quizNumber || 1,
        title: quiz.title,
        description: quiz.description,
        subject: quiz.subjectId,
        durationMinutes: quiz.durationMinutes || 30,
        totalMarks: quiz.totalMarks || 0,
        totalQuestions: quiz.questions?.length || 0,
        status: quiz.status,
        startTime: quiz.startTime,
        endTime: quiz.endTime,
        scheduleWindows: (quiz as any).scheduleWindows || [],
        isCurrentlyOpen: windowStatus.isCurrentlyOpen,
        isBetweenWindows: windowStatus.isBetweenWindows,
        currentWindow: windowStatus.currentWindow,
        nextWindow: windowStatus.nextWindow,
        finalEndTime: windowStatus.finalEndTime,
      };
    }, 20);

    res.json({
      success: true,
      data: quizData,
    });
  } catch (err) {
    next(err);
  }
}

export async function startQuizAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const studentId = req.user!.userId;
    const { id: quizId } = req.params;

    const { attempt } = await createOrGetAttemptForStudent(studentId, quizId as string);
    const now = new Date();

    if (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED') {
      const result = await QuizResult.findOne({ attemptId: attempt._id });
      return res.json({
        success: true,
        message: 'You have already completed this quiz.',
        alreadyCompleted: true,
        resultId: result?._id,
      });
    }

    // Check if existing attempt has timed out
    if (now > attempt.expectedEndTime) {
      const gradedResult = await processAndGradeAttempt(attempt._id, 'AUTO_SUBMITTED');
      const quiz = await Quiz.findById(quizId);
      if (quiz) {
        const ws = getQuizWindowStatus(quiz, now);
        if (ws.isEnded || now >= ws.finalEndTime) {
          await calculateAndStoreQuizRankings(attempt.quizId);
        }
      }
      return res.json({
        success: true,
        message: 'Time has expired. The quiz has been automatically submitted.',
        autoSubmitted: true,
        resultId: gradedResult._id,
      });
    }

    // Fetch student's existing saved answers for this attempt (if resuming)
    // Return mapped display options so frontend highlights the exact button clicked!
    const savedAnswers = await StudentAnswer.find({ attemptId: attempt._id });
    const answerMap: Record<string, string> = {};
    savedAnswers.forEach((sa) => {
      const optKey = sa.displayOption || sa.selectedOption;
      if (optKey) answerMap[sa.questionId.toString()] = optKey;
    });

    const timeRemainingSeconds = Math.max(1, Math.floor((attempt.expectedEndTime.getTime() - now.getTime()) / 1000));

    const quizDoc = await memoryCache.getOrSet(
      `quiz_full_${quizId}`,
      () => Quiz.findById(quizId).populate('questions').lean(),
      60
    );
    const sanitizedQuestions = quizDoc ? buildSanitizedQuestions(quizDoc, attempt) : [];

    res.json({
      success: true,
      data: {
        attemptId: attempt._id,
        quizId: attempt.quizId,
        serverTime: now,
        startTime: attempt.startTime,
        expectedEndTime: attempt.expectedEndTime,
        timeRemainingSeconds,
        savedAnswers: answerMap,
        questions: sanitizedQuestions,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function saveAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const studentId = req.user!.userId;
    const { id: attemptId } = req.params;

    const attempt = await QuizAttempt.findById(attemptId);
    if (!attempt || attempt.studentId.toString() !== studentId) {
      throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND');
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return res.json({ success: true, autoSubmitted: true, message: 'Attempt already finalized' });
    }

    const now = new Date();
    // Server authoritative timer check (with 10-second network latency grace period)
    if (now.getTime() > attempt.expectedEndTime.getTime() + 10000) {
      const result = await processAndGradeAttempt(attempt._id, 'AUTO_SUBMITTED');
      const quiz = await Quiz.findById(attempt.quizId);
      if (quiz) {
        const ws = getQuizWindowStatus(quiz, now);
        if (ws.isEnded || now >= ws.finalEndTime) {
          await calculateAndStoreQuizRankings(attempt.quizId);
        }
      }
      return res.json({
        success: true,
        autoSubmitted: true,
        message: 'Time has expired. The quiz has been automatically submitted.',
        resultId: result._id,
      });
    }

    const { questionId, selectedOption, textAnswer } = req.body;
    const qObjectId = questionId.toString();

    const studentTextAnswer = typeof textAnswer === 'string'
      ? textAnswer.trim()
      : typeof selectedOption === 'string' && !['A', 'B', 'C', 'D', 'E'].includes(selectedOption)
      ? selectedOption.trim()
      : undefined;

    // Map student's display option (e.g. 'A') to the underlying original option key (e.g. 'B') for consistent scoring
    let originalOptionKey = selectedOption;
    if (attempt.shuffledQuestions && attempt.shuffledQuestions.length > 0) {
      const sq = attempt.shuffledQuestions.find(
        (item) => item.questionId.toString() === questionId.toString()
      );
      if (sq && sq.options && sq.options.length > 0) {
        const matchingOpt = sq.options.find((opt) => opt.displayKey === selectedOption);
        if (matchingOpt) {
          originalOptionKey = matchingOpt.originalKey;
        }
      }
    }

    await StudentAnswer.findOneAndUpdate(
      { attemptId: attempt._id, questionId: qObjectId },
      {
        quizId: attempt.quizId,
        studentId: attempt.studentId,
        questionId: qObjectId,
        selectedOption: originalOptionKey || studentTextAnswer || null,
        displayOption: selectedOption || studentTextAnswer || null,
        textAnswer: studentTextAnswer || null,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Answer saved successfully' });
  } catch (err) {
    next(err);
  }
}

export async function submitQuizAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const studentId = req.user!.userId;
    const { id: attemptId } = req.params;

    const attempt = await QuizAttempt.findById(attemptId);
    if (!attempt || attempt.studentId.toString() !== studentId) {
      throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND');
    }

    const result = await processAndGradeAttempt(attempt._id, 'SUBMITTED');
    const quiz = await Quiz.findById(attempt.quizId);
    if (quiz) {
      const ws = getQuizWindowStatus(quiz, new Date());
      if (ws.isEnded || new Date() >= ws.finalEndTime) {
        await calculateAndStoreQuizRankings(attempt.quizId);
      }
    }

    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      data: {
        resultId: result._id,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getQuizResult(req: Request, res: Response, next: NextFunction) {
  try {
    const resultId = String(req.params.id);
    const userId = req.user!.userId;

    let result: any = null;
    if (resultId) {
      result = await QuizResult.findById(resultId)
        .populate(
          'quizId',
          'title quizNumber description subjectId durationMinutes startTime endTime scheduleWindows status totalMarks hasEssay essayTotalMarks essayStartTime essayEndTime essayDurationMinutes essayInstructions essayQuestionPaperFileId essayQuestionPaperFilename'
        )
        .populate('attemptId');

      // If not found by direct QuizResult _id, check if resultId is a Quiz ID for this student
      if (!result) {
        result = await QuizResult.findOne({
          quizId: resultId,
          studentId: userId,
        })
          .populate(
            'quizId',
            'title quizNumber description subjectId durationMinutes startTime endTime scheduleWindows status totalMarks hasEssay essayTotalMarks essayStartTime essayEndTime essayDurationMinutes essayInstructions essayQuestionPaperFileId essayQuestionPaperFilename'
          )
          .populate('attemptId');
      }
    }

    if (!result) {
      if (resultId) {
        const quizDoc = await Quiz.findById(resultId).select('title quizNumber');
        if (quizDoc) {
          throw new ApiError(
            404,
            'You have not attempted this examination yet.',
            'ATTEMPT_NOT_FOUND'
          );
        }
      }
      throw new ApiError(404, 'Result not found', 'RESULT_NOT_FOUND');
    }

    // Security check: Ensure student can only view their own result (or admin)
    if (req.user!.role === 'STUDENT' && result.studentId.toString() !== userId) {
      throw new ApiError(403, 'You are not authorized to view this result', 'FORBIDDEN');
    }

    const quiz = result.quizId as any;
    const now = new Date();

    // Determine authoritative final end times
    const windowStatus = quiz ? getQuizWindowStatus(quiz, now) : null;
    const mcqFinalEndTime = windowStatus?.mcqFinalEndTime || (quiz?.endTime ? new Date(quiz.endTime) : null);
    const finalEndTime = windowStatus?.finalEndTime || mcqFinalEndTime;

    // Quiz MCQ ranking is finalized when the MCQ session has ended
    const isMcqEnded = Boolean(!quiz || (mcqFinalEndTime && now >= mcqFinalEndTime));
    // Entire examination (including essay) has ended when finalEndTime has elapsed
    const isQuizEnded = Boolean(!quiz || (finalEndTime && now >= finalEndTime));

    // When the MCQ session has ended, calculate and populate MCQ Quiz Rankings (Rank 1)
    if (isMcqEnded && quiz && quiz._id) {
      if (!quiz.isRankingsCalculated || !result.islandRank || result.islandRank === 0) {
        await calculateAndStoreQuizRankings(quiz._id);
        await Quiz.findByIdAndUpdate(quiz._id, { isRankingsCalculated: true });
        const refreshed = await QuizResult.findById(resultId);
        if (refreshed) {
          result.islandRank = refreshed.islandRank;
          result.provinceRank = refreshed.provinceRank;
          result.districtRank = refreshed.districtRank;
        }
      }
    } else if (!isMcqEnded && quiz && quiz._id) {
      // If MCQ session has NOT ended yet, do not reveal temporary ranks!
      if (result.islandRank && result.islandRank > 0) {
        await QuizResult.findByIdAndUpdate(resultId, { islandRank: 0, provinceRank: 0, districtRank: 0 });
        result.islandRank = 0;
        result.provinceRank = 0;
        result.districtRank = 0;
      }
    }

    if (isQuizEnded && quiz && quiz._id && quiz.status !== 'ENDED') {
      await Quiz.findByIdAndUpdate(quiz._id, { status: 'ENDED' });
    }

    const province = PROVINCES.find((p) => p.id === result.provinceId);
    const district = DISTRICTS.find((d) => d.id === result.districtId);

    // Fetch question review details reconstructed according to student's attempt shuffle
    const attemptDoc = await QuizAttempt.findById((result.attemptId as any)?._id || result.attemptId);
    const studentAnswers = await StudentAnswer.find({ attemptId: (result.attemptId as any)?._id || result.attemptId }).populate({
      path: 'questionId',
      populate: { path: 'topicId' },
    });

    const answerMap = new Map<string, any>();
    studentAnswers.forEach((sa: any) => {
      const qId = (sa.questionId?._id || sa.questionId || sa.question_id)?.toString();
      if (qId) answerMap.set(qId, sa);
    });

    let questionReview: any[] = [];
    if (attemptDoc?.shuffledQuestions && attemptDoc.shuffledQuestions.length > 0) {
      const sqQIds = (attemptDoc.shuffledQuestions || []).map((sq: any) => sq.questionId?.toString()).filter(Boolean);
      const missingQIds = sqQIds.filter((qid: string) => {
        const sa = answerMap.get(qid);
        return !sa || typeof sa.questionId !== 'object';
      });
      const fallbackQMap = new Map<string, any>();
      if (missingQIds.length > 0) {
        const fallbackQuestions = await Question.find({ _id: { $in: missingQIds } }).populate('topicId');
        fallbackQuestions.forEach((fq: any) => fallbackQMap.set(fq._id.toString(), fq));
      }

      // Review questions in the exact order student saw during the exam
      questionReview = attemptDoc.shuffledQuestions.map((sq) => {
        const qIdStr = sq.questionId.toString();
        const sa = answerMap.get(qIdStr);
        const q = (sa && typeof sa.questionId === 'object') ? sa.questionId : (fallbackQMap.get(qIdStr) || null);
        const topic = q?.topicId as any;

        const origOptions = (q?.options || []) as Array<{ key: string; text: string; imageUrl?: string }>;
        const origMap = new Map<string, string>();
        const origImageMap = new Map<string, string>();
        origOptions.forEach((o) => {
          origMap.set(o.key, o.text);
          if (o.imageUrl) origImageMap.set(o.key, o.imageUrl);
        });

        const displayOpts = sq.options.map((opt) => ({
          key: opt.displayKey,
          text: origMap.get(opt.originalKey) || '',
          imageUrl: origImageMap.get(opt.originalKey) || undefined,
        }));

        const correctDisplayItem = sq.options.find((opt) => opt.originalKey === q?.correctAnswer);
        const displayCorrectAnswer = correctDisplayItem ? correctDisplayItem.displayKey : q?.correctAnswer || '';

        return {
          questionId: q?._id || sq.questionId,
          questionType: q?.questionType || 'MCQ',
          topicName: topic?.nameSi || topic?.nameEn || '',
          questionText: q?.questionText || '',
          imageUrl: q?.imageUrl || '',
          imageCaption: q?.imageCaption || '',
          options: displayOpts,
          correctAnswer: q?.questionType === 'SHORT_ANSWER' ? (q?.correctAnswer || '') : displayCorrectAnswer,
          acceptableAnswers: q?.acceptableAnswers || [],
          selectedOption: sa?.displayOption || sa?.selectedOption,
          textAnswer: sa?.textAnswer || sa?.displayOption || sa?.selectedOption || '',
          isCorrect: sa?.isCorrect,
          marksObtained: sa?.marksObtained || 0,
          marks: q?.marks || 1,
          evaluationFeedback: sa?.evaluationFeedback || '',
          explanation: q?.explanation || '',
        };
      });
    } else {
      // Fallback for legacy attempts
      questionReview = studentAnswers.map((sa: any) => {
        const q = typeof sa.questionId === 'object' ? sa.questionId : null;
        const topic = q?.topicId as any;
        return {
          questionId: q?._id || sa.questionId,
          questionType: q?.questionType || 'MCQ',
          topicName: topic?.nameSi || topic?.nameEn || '',
          questionText: q?.questionText || '',
          imageUrl: q?.imageUrl || '',
          imageCaption: q?.imageCaption || '',
          options: q?.options || [],
          correctAnswer: q?.correctAnswer || '',
          acceptableAnswers: q?.acceptableAnswers || [],
          selectedOption: sa.displayOption || sa.selectedOption,
          textAnswer: sa.textAnswer || sa.selectedOption || '',
          isCorrect: sa.isCorrect,
          marksObtained: sa.marksObtained || 0,
          marks: q?.marks || 1,
          evaluationFeedback: sa.evaluationFeedback || '',
          explanation: q?.explanation || '',
        };
      });
    }

    if (questionReview.length === 0 && quiz) {
      const qIds = Array.isArray(quiz.questions) ? quiz.questions.map((q: any) => (q?._id || q?.id || q).toString()) : [];
      if (qIds.length > 0) {
        const quizQuestions = await Question.find({ _id: { $in: qIds } }).populate('topicId');
        const qMap = new Map<string, any>();
        quizQuestions.forEach((qd: any) => qMap.set(qd._id.toString(), qd));

        questionReview = qIds.map((qid: string) => {
          const q = qMap.get(qid);
          const sa = answerMap.get(qid);
          const topic = q?.topicId as any;
          return {
            questionId: q?._id || qid,
            questionType: q?.questionType || 'MCQ',
            topicName: topic?.nameSi || topic?.nameEn || '',
            questionText: q?.questionText || '',
            imageUrl: q?.imageUrl || '',
            imageCaption: q?.imageCaption || '',
            options: q?.options || [],
            correctAnswer: q?.correctAnswer || '',
            acceptableAnswers: q?.acceptableAnswers || [],
            selectedOption: sa?.displayOption || sa?.selectedOption || '',
            textAnswer: sa?.textAnswer || sa?.displayOption || sa?.selectedOption || '',
            isCorrect: sa ? sa.isCorrect : false,
            marksObtained: sa?.marksObtained || 0,
            marks: q?.marks || 1,
            evaluationFeedback: sa?.evaluationFeedback || '',
            explanation: q?.explanation || '',
          };
        });
      }
    }

    // If Quiz has an essay, ensure full paper rank is hydrated from FullPaperRankingSnapshot if available
    if (quiz?.hasEssay && (!result.fullPaperIslandRank || result.fullPaperIslandRank === 0)) {
      const fullSnapshot = await FullPaperRankingSnapshot.findOne({ quizId: quiz._id });
      if (fullSnapshot && fullSnapshot.rankings) {
        const myItem = fullSnapshot.rankings.find((r) => r.studentId.toString() === result.studentId.toString());
        if (myItem) {
          result.fullPaperIslandRank = myItem.islandRank;
          result.fullPaperProvinceRank = myItem.provinceRank;
          result.fullPaperDistrictRank = myItem.districtRank;
          result.fullPaperScore = myItem.totalScore;
          result.fullPaperTotalMarks = myItem.totalMarks;
          result.fullPaperPercentage = myItem.percentage;
          result.essayMarks = myItem.essayScore;
          result.isEssayMarked = true;
          await QuizResult.findByIdAndUpdate(resultId, {
            fullPaperIslandRank: myItem.islandRank,
            fullPaperProvinceRank: myItem.provinceRank,
            fullPaperDistrictRank: myItem.districtRank,
            fullPaperScore: myItem.totalScore,
            fullPaperTotalMarks: myItem.totalMarks,
            fullPaperPercentage: myItem.percentage,
            essayMarks: myItem.essayScore,
            isEssayMarked: true,
          });
        }
      }
    }

    const scheduledSriLankanEndTime = finalEndTime ? formatSriLankanTime(finalEndTime) : (quiz?.endTime ? formatSriLankanTime(quiz.endTime) : '');
    const mcqScheduledSriLankanEndTime = mcqFinalEndTime ? formatSriLankanTime(mcqFinalEndTime) : scheduledSriLankanEndTime;
    const hasQuizEssay = Boolean(quiz?.hasEssay || quiz?.essayQuestionPaperFileId);
    const isFullPaperRankingsCalculated = Boolean(quiz?.isFullPaperRankingsCalculated);
    const rankPublished = isMcqEnded && Boolean(result.islandRank && result.islandRank > 0);
    const hasStudentFpRank = Boolean(result.fullPaperIslandRank && result.fullPaperIslandRank > 0);
    const fullPaperRankPublished = Boolean(isFullPaperRankingsCalculated || hasStudentFpRank);
    const timeRemainingSeconds = finalEndTime && !isQuizEnded ? Math.max(0, Math.floor((finalEndTime.getTime() - now.getTime()) / 1000)) : 0;
    const mcqTimeRemainingSeconds = mcqFinalEndTime && !isMcqEnded ? Math.max(0, Math.floor((mcqFinalEndTime.getTime() - now.getTime()) / 1000)) : 0;
    const endTime = finalEndTime ? finalEndTime.toISOString() : (quiz?.endTime ? new Date(quiz.endTime).toISOString() : null);
    const mcqEndTime = mcqFinalEndTime ? mcqFinalEndTime.toISOString() : endTime;

    let resultQuizNum = quiz?.quizNumber;
    if (!resultQuizNum && quiz?._id) {
      const refreshed = await Quiz.findById(quiz._id).select('quizNumber').lean();
      resultQuizNum = refreshed?.quizNumber;
    }

    let essaySubmissionData: any = null;
    if (hasQuizEssay && result.studentId) {
      const sub = await EssaySubmission.findOne({
        quizId: quiz._id,
        studentId: result.studentId,
      }).lean();
      if (sub) {
        essaySubmissionData = {
          id: sub._id,
          fileName: sub.fileName,
          submittedAt: sub.submittedAt,
          isMarked: sub.isMarked,
          marksAwarded: sub.marksAwarded,
          maxMarks: sub.maxMarks || quiz.essayTotalMarks,
          feedback: sub.feedback,
        };
      }
    }

    const essayAttended = Boolean(hasStudentFpRank || essaySubmissionData || result.hasEssaySubmission || result.essayAttended);
    const isFullPaperNotAttended = Boolean(hasQuizEssay && fullPaperRankPublished && !essayAttended);

    res.json({
      success: true,
      data: {
        ...result.toObject(),
        islandRank: rankPublished && result.islandRank ? result.islandRank : null,
        provinceRank: rankPublished && result.provinceRank ? result.provinceRank : null,
        districtRank: rankPublished && result.districtRank ? result.districtRank : null,
        fullPaperIslandRank: hasStudentFpRank && result.fullPaperIslandRank ? result.fullPaperIslandRank : null,
        fullPaperProvinceRank: hasStudentFpRank && result.fullPaperProvinceRank ? result.fullPaperProvinceRank : null,
        fullPaperDistrictRank: hasStudentFpRank && result.fullPaperDistrictRank ? result.fullPaperDistrictRank : null,
        fullPaperScore: essayAttended ? result.fullPaperScore : null,
        fullPaperTotalMarks: result.fullPaperTotalMarks,
        fullPaperPercentage: essayAttended ? result.fullPaperPercentage : null,
        isFullPaperRankingsCalculated,
        essayAttended,
        isFullPaperNotAttended,
        quizNumber: resultQuizNum || quiz?.quizNumber || 1,
        isMcqEnded,
        isQuizEnded,
        rankPublished,
        fullPaperRankPublished,
        timeRemainingSeconds,
        mcqTimeRemainingSeconds,
        endTime,
        mcqEndTime,
        serverTime: now.toISOString(),
        scheduledSriLankanEndTime,
        mcqScheduledSriLankanEndTime,
        provinceName: province?.nameSi || result.provinceId,
        districtName: district?.nameSi || result.districtId,
        questionReview,
        hasEssay: hasQuizEssay,
        essayTotalMarks: quiz?.essayTotalMarks || 0,
        hasQuestionPaper: Boolean(quiz?.essayQuestionPaperFileId),
        questionPaperFilename: quiz?.essayQuestionPaperFilename,
        essaySubmission: essaySubmissionData,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getQuizRankings(req: Request, res: Response, next: NextFunction) {
  try {
    const { quizId } = req.params;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    const now = new Date();
    const windowStatus = getQuizWindowStatus(quiz, now);
    const mcqFinalEndTime = windowStatus.mcqFinalEndTime || (quiz.endTime ? new Date(quiz.endTime) : null);
    const finalEndTime = windowStatus.finalEndTime || mcqFinalEndTime;
    const isMcqEnded = Boolean(mcqFinalEndTime && now >= mcqFinalEndTime);
    const isQuizEnded = Boolean(finalEndTime && now >= finalEndTime);

    if (!isMcqEnded) {
      const timeRemainingSeconds = mcqFinalEndTime ? Math.max(0, Math.floor((mcqFinalEndTime.getTime() - now.getTime()) / 1000)) : 0;
      return res.json({
        success: true,
        data: {
          isMcqEnded: false,
          isQuizEnded: false,
          isOfficial: false,
          rankPublished: false,
          timeRemainingSeconds,
          endTime: mcqFinalEndTime ? mcqFinalEndTime.toISOString() : null,
          serverTime: now.toISOString(),
          message: 'Official quiz rankings will be published once the examination session has ended.',
          scheduledSriLankanEndTime: mcqFinalEndTime ? formatSriLankanTime(mcqFinalEndTime) : '',
          rankings: [],
        },
      });
    }

    let snapshot = await RankingSnapshot.findOne({ quizId, isOfficialSnapshot: true });
    if (!snapshot) {
      await calculateAndStoreQuizRankings(quizId as string);
      snapshot = await RankingSnapshot.findOne({ quizId, isOfficialSnapshot: true });
    }

    let fullPaperSnapshot: any = null;
    if (quiz.hasEssay) {
      fullPaperSnapshot = await FullPaperRankingSnapshot.findOne({ quizId });
      if (!fullPaperSnapshot && quiz.isFullPaperRankingsCalculated) {
        await calculateAndStoreFullPaperRankings(quizId as string);
        fullPaperSnapshot = await FullPaperRankingSnapshot.findOne({ quizId });
      }
    }

    res.json({
      success: true,
      data: {
        isMcqEnded: true,
        isQuizEnded,
        isOfficial: true,
        rankPublished: true,
        snapshot,
        fullPaperSnapshot,
        rankings: snapshot?.rankings || [],
        hasEssay: !!quiz.hasEssay,
        essayTotalMarks: quiz.essayTotalMarks || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}
