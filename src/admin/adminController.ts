import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { Question } from '../models/Question.js';
import { QuestionImage } from '../models/QuestionImage.js';
import { Subject } from '../models/Subject.js';
import { Topic } from '../models/Topic.js';
import { QuizAttempt } from '../models/QuizAttempt.js';
import { QuizResult } from '../models/QuizResult.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { User } from '../models/User.js';
import { PdfImport } from '../models/PdfImport.js';
import { parseQuizPdf, parseQuizText } from '../pdf/pdfParser.js';
import { extractQuizTextWithGemini } from '../pdf/geminiPdfExtractor.js';
import {
  generateQuizReportPdf,
  generateMonthlyReportPdf,
  generateRegisteredStudentsPdf,
  QuizReportData,
  MonthlyReportData,
  RegisteredStudentPdfItem,
} from '../pdf/pdfGenerator.js';
import { calculateAndStoreQuizRankings } from '../rankings/rankingService.js';
import { PROVINCES, DISTRICTS } from '../data/sriLankaData.js';
import { ApiError } from '../utils/apiError.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { AdminProfile } from '../models/AdminProfile.js';
import { RankingSnapshot } from '../models/RankingSnapshot.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { EssayFile } from '../models/EssayFile.js';
import { MonthlyStudentStatistics } from '../models/MonthlyStudentStatistics.js';
import { FullPaperRankingSnapshot } from '../models/FullPaperRankingSnapshot.js';
import { MarkingPanelProfile } from '../models/MarkingPanelProfile.js';
import { logger } from '../utils/logger.js';
import bcrypt from 'bcryptjs';
import { formatSriLankanTime, fromSriLankanInputString } from '../utils/sriLankanTime.js';
import { memoryCache } from '../utils/cache.js';
import { getNextQuizNumber, resequenceAllQuizNumbers } from '../quizzes/quizNumberService.js';
import { parseScheduleWindows, getQuizWindowStatus } from '../utils/scheduleWindows.js';
import { env } from '../config/env.js';
import { Category, ensureCategoryExists, formatCategoryName, seedDefaultCategoriesIfEmpty } from '../models/Category.js';
import { Institute, ensureInstituteExists, formatInstituteName, seedDefaultInstitutesIfEmpty } from '../models/Institute.js';

export async function getAdminDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    await resequenceAllQuizNumbers();
    const totalStudents = await User.countDocuments({ role: 'STUDENT' });
    const totalQuizzes = await Quiz.countDocuments();
    const liveQuizzes = await Quiz.countDocuments({ status: 'LIVE' });
    const upcomingQuizzes = await Quiz.countDocuments({ status: 'SCHEDULED' });
    const completedQuizzes = await Quiz.countDocuments({ status: { $in: ['ENDED', 'ARCHIVED'] } });
    const totalAttempts = await QuizAttempt.countDocuments({ status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED'] } });

    const results = await QuizResult.find();
    const averageScore = results.length > 0 ? Math.round(results.reduce((a, b) => a + b.percentage, 0) / results.length) : 0;

    const recentQuizzes = await Quiz.find().populate('subjectId', 'nameSi').sort({ createdAt: -1 }).limit(5);

    res.json({
      success: true,
      data: {
        totalStudents,
        totalQuizzes,
        liveQuizzes,
        upcomingQuizzes,
        completedQuizzes,
        totalAttempts,
        averageScore,
        recentQuizzes,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Resolves a subject by ID, exact name, or partial match.
 * Guarantees no duplicate subjects and safe unique codes without E11000 collision.
 */
async function resolveSubject(subjectIdOrName?: string, fallbackName?: string): Promise<any> {
  if (subjectIdOrName && mongoose.Types.ObjectId.isValid(subjectIdOrName)) {
    const byId = await Subject.findById(subjectIdOrName);
    if (byId) return byId;
  }

  const queryName = (subjectIdOrName || fallbackName || '').trim();

  if (queryName) {
    const escaped = queryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactMatch = await Subject.findOne({
      $or: [
        { nameSi: queryName },
        { nameEn: queryName },
        { code: queryName.toUpperCase() },
        { nameSi: new RegExp(`^${escaped}$`, 'i') },
        { nameEn: new RegExp(`^${escaped}$`, 'i') },
      ],
    });
    if (exactMatch) return exactMatch;

    // Partial / substring match
    const allSubjects = await Subject.find();
    const cleanQuery = queryName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (cleanQuery.length > 0) {
      const partialMatch = allSubjects.find((s) => {
        const sEn = s.nameEn.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const sSi = s.nameSi.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        return (
          (sEn && (sEn.includes(cleanQuery) || cleanQuery.includes(sEn))) ||
          (sSi && (sSi.includes(cleanQuery) || cleanQuery.includes(sSi)))
        );
      });
      if (partialMatch) return partialMatch;
    }
  }

  // Fallback to first subject if existing and queryName is empty
  if (!queryName) {
    const firstSubject = await Subject.findOne();
    if (firstSubject) return firstSubject;
  }

  // Generate safe non-colliding unique code
  const rawBase = (queryName || 'SUB').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const baseCode = rawBase.length >= 3 ? rawBase : 'SUB';
  let uniqueCode = baseCode;
  let counter = 1;
  while (await Subject.findOne({ code: uniqueCode })) {
    uniqueCode = `${baseCode}_${counter}`;
    counter++;
  }

  const newSubject = await Subject.create({
    nameEn: queryName || 'General',
    nameSi: queryName || 'General',
    code: uniqueCode,
  });
  memoryCache.delByPrefix('meta_');
  return newSubject;
}

/**
 * Resolves a topic under a subject. Reuses existing topic or creates a new one.
 */
async function resolveTopic(subjectId: mongoose.Types.ObjectId, topicNameInput?: string): Promise<any> {
  const topicName = (topicNameInput || 'General').trim();
  const escaped = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let topicDoc = await Topic.findOne({
    subjectId,
    $or: [
      { nameSi: topicName },
      { nameEn: topicName },
      { nameSi: new RegExp(`^${escaped}$`, 'i') },
      { nameEn: new RegExp(`^${escaped}$`, 'i') },
    ],
  });
  if (topicDoc) return topicDoc;

  // Substring check among this subject's topics
  const subjectTopics = await Topic.find({ subjectId });
  const cleanTopic = topicName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (cleanTopic.length > 0) {
    const partialMatch = subjectTopics.find((t) => {
      const tEn = t.nameEn.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const tSi = t.nameSi.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      return (
        (tEn && (tEn.includes(cleanTopic) || cleanTopic.includes(tEn))) ||
        (tSi && (tSi.includes(cleanTopic) || cleanTopic.includes(tSi)))
      );
    });
    if (partialMatch) return partialMatch;
  }

  topicDoc = await Topic.create({
    subjectId,
    nameEn: topicName,
    nameSi: topicName,
  });
  memoryCache.delByPrefix('meta_');
  return topicDoc;
}

export async function createAdminQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.userId;
    const { title, description, subjectId, topicIds, topicName, questions, instructions } = req.body;

    // Resolve subject
    const subject = await resolveSubject(subjectId);
    const resolvedSubjectId = subject._id;

    // Resolve topic(s)
    let finalTopicIds: mongoose.Types.ObjectId[] = Array.isArray(topicIds)
      ? topicIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id))
      : [];

    if (topicName && topicName.trim()) {
      const tDoc = await resolveTopic(resolvedSubjectId, topicName.trim());
      if (!finalTopicIds.some((id) => id.toString() === tDoc._id.toString())) {
        finalTopicIds.push(tDoc._id as mongoose.Types.ObjectId);
      }
    }

    if (finalTopicIds.length === 0) {
      const defaultTopic = await resolveTopic(resolvedSubjectId, 'General');
      finalTopicIds.push(defaultTopic._id as mongoose.Types.ObjectId);
    }

    // Create or reference questions
    const questionIds: mongoose.Types.ObjectId[] = [];
    let totalMarks = 0;

    // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
    const mcqQuestions = (questions || []).filter((q: any) => q.questionType !== 'SHORT_ANSWER');
    const shortAnswerQuestions = (questions || []).filter((q: any) => q.questionType === 'SHORT_ANSWER');
    const sortedQuestions = [...mcqQuestions, ...shortAnswerQuestions];

    for (const q of sortedQuestions) {
      const qMarks = Number(q.marks) > 0 ? Number(q.marks) : 1;
      if (q._id && mongoose.Types.ObjectId.isValid(q._id)) {
        questionIds.push(new mongoose.Types.ObjectId(q._id));
        totalMarks += qMarks;
      } else {
        const qTopicId = q.topicId && mongoose.Types.ObjectId.isValid(q.topicId)
          ? new mongoose.Types.ObjectId(q.topicId)
          : finalTopicIds[0];

        const createdQ = await Question.create({
          subjectId: resolvedSubjectId,
          topicId: qTopicId,
          questionType: q.questionType || 'MCQ',
          questionText: q.questionText,
          imageUrl: q.imageUrl || '',
          imageCaption: q.imageCaption || '',
          options: q.options || [],
          correctAnswer: q.correctAnswer,
          acceptableAnswers: q.acceptableAnswers || [],
          marks: qMarks,
          explanation: q.explanation || '',
          difficulty: q.difficulty || 'MEDIUM',
        });
        questionIds.push(createdQ._id as any);
        totalMarks += Number(createdQ.marks != null ? createdQ.marks : qMarks);
      }
    }

    const {
      status,
      publishMode,
      scheduledStartTime,
      scheduledEndTime,
      scheduleWindows,
      startTime,
      endTime,
      date,
      durationMinutes,
    } = req.body;

    const now = new Date();
    let qStatus = publishMode === 'SCHEDULED' ? 'SCHEDULED' : publishMode === 'LIVE' ? 'LIVE' : status || 'LIVE';

    const parsedWindows = parseScheduleWindows(scheduleWindows || []);

    let qStartTime: Date;
    let qEndTime: Date;

    if (parsedWindows.length > 0) {
      qStartTime = parsedWindows[0].startTime;
      qEndTime = parsedWindows[parsedWindows.length - 1].endTime;
    } else {
      const rawStart = scheduledStartTime || startTime;
      qStartTime = rawStart
        ? typeof rawStart === 'string' && rawStart.includes('T') && (rawStart.endsWith('Z') || rawStart.includes('+'))
          ? new Date(rawStart)
          : fromSriLankanInputString(rawStart)
        : now;

      const rawEnd = scheduledEndTime || endTime;
      if (rawEnd) {
        qEndTime =
          typeof rawEnd === 'string' && rawEnd.includes('T') && (rawEnd.endsWith('Z') || rawEnd.includes('+'))
            ? new Date(rawEnd)
            : fromSriLankanInputString(rawEnd);
      } else {
        const dMin = Number(durationMinutes) > 0 ? Number(durationMinutes) : 30;
        qEndTime = new Date(qStartTime.getTime() + dMin * 60000);
      }
    }

    let parsedDuration = Number(durationMinutes);
    if (!parsedDuration || isNaN(parsedDuration) || parsedDuration <= 0) {
      parsedDuration = 30;
    }

    let qDate = date
      ? typeof date === 'string' && date.includes('T') && (date.endsWith('Z') || date.includes('+'))
        ? new Date(date)
        : fromSriLankanInputString(date)
      : qStartTime;

    if (qStatus === 'SCHEDULED') {
      if (parsedWindows.length > 0) {
        const inActiveWindow = parsedWindows.some((w) => now >= w.startTime && now < w.endTime);
        if (inActiveWindow) {
          qStatus = 'LIVE';
        }
      } else if (qStartTime <= now && qEndTime > now) {
        qStatus = 'LIVE';
      }
    }

    let quizNumber = Number(req.body.quizNumber);
    if (!quizNumber || isNaN(quizNumber) || quizNumber <= 0) {
      quizNumber = await getNextQuizNumber();
    }

    const rawTargetCategory = (req.body.targetCategory || 'ALL').trim();
    const targetCategory = rawTargetCategory.toUpperCase() !== 'ALL' && rawTargetCategory.toLowerCase() !== 'everyone'
      ? formatCategoryName(rawTargetCategory)
      : 'ALL';
    if (targetCategory && targetCategory !== 'ALL') {
      await ensureCategoryExists(targetCategory);
    }

    const hasEssay = req.body.hasEssay === true || req.body.hasEssay === 'true';
    const essayTotalMarks = Number(req.body.essayTotalMarks) || 0;
    const essayStartTime = req.body.essayStartTime ? new Date(req.body.essayStartTime) : undefined;
    const essayEndTime = req.body.essayEndTime ? new Date(req.body.essayEndTime) : undefined;
    const essayDurationMinutes = req.body.essayDurationMinutes ? Number(req.body.essayDurationMinutes) : 120;
    const essayInstructions = req.body.essayInstructions || '';

    const quiz = await Quiz.create({
      quizNumber,
      title,
      description,
      subjectId: (resolvedSubjectId?._id || resolvedSubjectId)?.toString(),
      topicIds: finalTopicIds.map((id) => (id?._id || id).toString()),
      questions: questionIds.map((id) => (id?._id || id).toString()),
      date: qDate,
      startTime: qStartTime,
      endTime: qEndTime,
      durationMinutes: parsedDuration,
      scheduleWindows: parsedWindows.length > 0 ? parsedWindows : undefined,
      totalMarks: Number(totalMarks) || 0,
      instructions,
      status: qStatus,
      targetCategory,
      hasEssay,
      essayTotalMarks: Number(essayTotalMarks) || 0,
      essayStartTime,
      essayEndTime,
      essayDurationMinutes,
      essayInstructions,
      essayQuestionPaperFileId: req.body.essayQuestionPaperFileId || undefined,
      essayQuestionPaperFilename: req.body.essayQuestionPaperFilename || undefined,
      createdById: adminId,
    });

    memoryCache.delByPrefix('quiz_');

    res.status(201).json({
      success: true,
      message: 'Quiz created successfully',
      data: quiz,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminQuizzes(req: Request, res: Response, next: NextFunction) {
  try {
    await resequenceAllQuizNumbers();
    const quizzes = await Quiz.find().populate('subjectId', 'nameSi nameEn code').sort({ createdAt: -1 });
    res.json({ success: true, data: quizzes });
  } catch (err) {
    next(err);
  }
}

export async function getAdminQuizById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const quiz = await Quiz.findById(id)
      .populate('subjectId', 'nameSi nameEn code')
      .populate('questions');
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }
    res.json({ success: true, data: quiz });
  } catch (err) {
    next(err);
  }
}

export async function updateAdminQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const existing = await Quiz.findById(id);
    if (!existing) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    const {
      title,
      description,
      subjectId,
      durationMinutes,
      instructions,
      quizNumber,
      targetCategory,
      status,
      publishMode,
      scheduledStartTime,
      scheduledEndTime,
      scheduleWindows,
      startTime,
      endTime,
      hasEssay,
      essayTotalMarks,
      essayStartTime,
      essayEndTime,
      essayDurationMinutes,
      essayInstructions,
      questions,
    } = req.body;

    const updateData: any = {};

    if (typeof title === 'string' && title.trim()) {
      updateData.title = title.trim();
    }

    if (typeof description !== 'undefined') {
      updateData.description = description;
    }

    if (typeof instructions !== 'undefined') {
      updateData.instructions = instructions;
    }

    if (quizNumber) {
      const parsedQuizNumber = Number(quizNumber);
      if (parsedQuizNumber > 0) {
        updateData.quizNumber = parsedQuizNumber;
      }
    }

    if (subjectId) {
      const subject = await resolveSubject(subjectId);
      updateData.subjectId = subject._id;
    }

    if (targetCategory) {
      const rawTc = String(targetCategory).trim();
      const tc = rawTc.toUpperCase() !== 'ALL' && rawTc.toLowerCase() !== 'everyone'
        ? formatCategoryName(rawTc)
        : 'ALL';
      updateData.targetCategory = tc;
      if (tc !== 'ALL') {
        await ensureCategoryExists(tc);
      }
    }

    if (durationMinutes) {
      const parsedDuration = Number(durationMinutes);
      if (parsedDuration > 0) {
        updateData.durationMinutes = parsedDuration;
      }
    }

    const now = new Date();
    if (status) {
      updateData.status = status;
    } else if (publishMode === 'LIVE') {
      updateData.status = 'LIVE';
    } else if (publishMode === 'SCHEDULED') {
      updateData.status = 'SCHEDULED';
    }

    // Schedule windows or start/end times
    if (Array.isArray(scheduleWindows) && scheduleWindows.length > 0) {
      const parsedWindows = parseScheduleWindows(scheduleWindows);
      updateData.scheduleWindows = parsedWindows;
      updateData.startTime = parsedWindows[0].startTime;
      updateData.endTime = parsedWindows[parsedWindows.length - 1].endTime;
      updateData.date = updateData.startTime;
      if (updateData.status === 'SCHEDULED' || updateData.status === 'LIVE') {
        const inActiveWindow = parsedWindows.some((w) => now >= w.startTime && now < w.endTime);
        updateData.status = inActiveWindow ? 'LIVE' : (now >= updateData.endTime ? 'ENDED' : 'SCHEDULED');
      }
    } else if (scheduledStartTime || startTime) {
      const rawStart = scheduledStartTime || startTime;
      const sTime = typeof rawStart === 'string' && rawStart.includes('T') && (rawStart.endsWith('Z') || rawStart.includes('+'))
        ? new Date(rawStart)
        : fromSriLankanInputString(rawStart);

      const rawEnd = scheduledEndTime || endTime;
      let eTime: Date;
      if (rawEnd) {
        eTime = typeof rawEnd === 'string' && rawEnd.includes('T') && (rawEnd.endsWith('Z') || rawEnd.includes('+'))
          ? new Date(rawEnd)
          : fromSriLankanInputString(rawEnd);
      } else {
        const dur = updateData.durationMinutes || existing.durationMinutes || 30;
        eTime = new Date(sTime.getTime() + dur * 60000);
      }

      updateData.startTime = sTime;
      updateData.endTime = eTime;
      updateData.date = sTime;
      if (Array.isArray(scheduleWindows) && scheduleWindows.length === 0) {
        updateData.scheduleWindows = [];
      }
    }

    // Essay settings
    if (typeof hasEssay !== 'undefined') {
      updateData.hasEssay = hasEssay === true || hasEssay === 'true';
    }
    if (typeof essayTotalMarks !== 'undefined') {
      updateData.essayTotalMarks = Number(essayTotalMarks) || 0;
    }
    if (essayStartTime) {
      updateData.essayStartTime = typeof essayStartTime === 'string' && essayStartTime.includes('T')
        ? new Date(essayStartTime)
        : fromSriLankanInputString(essayStartTime);
    }
    if (essayEndTime) {
      updateData.essayEndTime = typeof essayEndTime === 'string' && essayEndTime.includes('T')
        ? new Date(essayEndTime)
        : fromSriLankanInputString(essayEndTime);
    }
    if (typeof essayDurationMinutes !== 'undefined') {
      updateData.essayDurationMinutes = Number(essayDurationMinutes) || 120;
    }
    if (typeof essayInstructions !== 'undefined') {
      updateData.essayInstructions = essayInstructions;
    }

    // Questions updating if provided
    if (Array.isArray(questions) && questions.length > 0) {
      const resolvedSubId = updateData.subjectId || existing.subjectId;
      const questionIds: mongoose.Types.ObjectId[] = [];
      let totalMarks = 0;

      // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
      const mcqQuestions = (questions || []).filter((q: any) => q.questionType !== 'SHORT_ANSWER');
      const shortAnswerQuestions = (questions || []).filter((q: any) => q.questionType === 'SHORT_ANSWER');
      const sortedQuestions = [...mcqQuestions, ...shortAnswerQuestions];

      for (const q of sortedQuestions) {
        if (q._id && mongoose.Types.ObjectId.isValid(q._id)) {
          await Question.findByIdAndUpdate(q._id, {
            questionType: q.questionType || 'MCQ',
            questionText: q.questionText,
            imageUrl: q.imageUrl || '',
            imageCaption: q.imageCaption || '',
            options: q.options || [],
            correctAnswer: q.correctAnswer,
            acceptableAnswers: q.acceptableAnswers || [],
            marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
            explanation: q.explanation || '',
          });
          questionIds.push(new mongoose.Types.ObjectId(q._id));
          totalMarks += Number(q.marks) > 0 ? Number(q.marks) : 1;
        } else {
          const qMarks = Number(q.marks) > 0 ? Number(q.marks) : 1;
          const createdQ = await Question.create({
            subjectId: resolvedSubId,
            questionType: q.questionType || 'MCQ',
            questionText: q.questionText,
            imageUrl: q.imageUrl || '',
            imageCaption: q.imageCaption || '',
            options: q.options || [],
            correctAnswer: q.correctAnswer,
            acceptableAnswers: q.acceptableAnswers || [],
            marks: qMarks,
            explanation: q.explanation || '',
          });
          questionIds.push(createdQ._id as any);
          totalMarks += Number(createdQ.marks != null ? createdQ.marks : qMarks);
        }
      }
      updateData.questions = questionIds.map((id) => (id?._id || id).toString());
      updateData.totalMarks = Number(totalMarks) || 0;
    }

    const updatedQuiz = await Quiz.findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .populate('subjectId', 'nameSi nameEn code')
      .populate('questions');

    memoryCache.delByPrefix('quiz_');

    res.json({
      success: true,
      message: 'Quiz settings updated successfully',
      data: updatedQuiz,
    });
  } catch (err) {
    next(err);
  }
}


export async function publishAdminQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status, scheduledStartTime, scheduledEndTime, durationMinutes, scheduleWindows } = req.body;

    const now = new Date();
    const existing = await Quiz.findById(id);
    if (!existing) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    const updateData: any = { status: status || 'LIVE' };
    const defaultDuration = durationMinutes ? Number(durationMinutes) : (existing.durationMinutes || 30);
    updateData.durationMinutes = defaultDuration;

    const parsedWindows = Array.isArray(scheduleWindows) ? parseScheduleWindows(scheduleWindows) : [];

    if (parsedWindows.length > 0) {
      updateData.scheduleWindows = parsedWindows;
      updateData.startTime = parsedWindows[0].startTime;
      updateData.endTime = parsedWindows[parsedWindows.length - 1].endTime;
      updateData.date = updateData.startTime;

      if (updateData.status === 'SCHEDULED' || updateData.status === 'LIVE') {
        const inActiveWindow = parsedWindows.some((w) => now >= w.startTime && now < w.endTime);
        updateData.status = inActiveWindow ? 'LIVE' : (now >= updateData.endTime ? 'ENDED' : 'SCHEDULED');
      }
    } else if (existing.scheduleWindows && existing.scheduleWindows.length > 0 && !scheduleWindows) {
      // PRESERVE EXISTING MULTI-DAY SCHEDULE WINDOWS if not explicitly passed to overwrite!
      updateData.scheduleWindows = existing.scheduleWindows;
      updateData.startTime = existing.startTime;
      updateData.endTime = existing.endTime;
      updateData.date = existing.date || existing.startTime;
      if (updateData.status === 'LIVE' || updateData.status === 'SCHEDULED') {
        const inActiveWindow = existing.scheduleWindows.some((w: any) => now >= new Date(w.startTime) && now < new Date(w.endTime));
        updateData.status = inActiveWindow ? 'LIVE' : (now >= new Date(existing.endTime) ? 'ENDED' : 'SCHEDULED');
      }
    } else {
      if (Array.isArray(scheduleWindows)) {
        updateData.scheduleWindows = [];
      }
      if (updateData.status === 'SCHEDULED') {
        const startTime = scheduledStartTime
          ? fromSriLankanInputString(scheduledStartTime)
          : existing.startTime && existing.startTime > now
          ? existing.startTime
          : new Date(now.getTime() + 1800000);

        const endTime = scheduledEndTime
          ? fromSriLankanInputString(scheduledEndTime)
          : new Date(startTime.getTime() + defaultDuration * 60000);

        updateData.startTime = startTime;
        updateData.endTime = endTime;
        updateData.date = startTime;

        if (startTime <= now && endTime > now) {
          updateData.status = 'LIVE';
        }
      } else if (updateData.status === 'LIVE') {
        updateData.startTime = new Date(now.getTime() - 60000);
        if (scheduledEndTime) {
          updateData.endTime = fromSriLankanInputString(scheduledEndTime);
        } else if (existing.endTime && new Date(existing.endTime) > now) {
          updateData.endTime = existing.endTime;
        } else {
          updateData.endTime = new Date(now.getTime() + defaultDuration * 60000);
        }
      }
    }

    if (req.body.targetCategory) {
      const rawTc = (req.body.targetCategory || '').trim();
      const tc = rawTc.toUpperCase() !== 'ALL' && rawTc.toLowerCase() !== 'everyone'
        ? formatCategoryName(rawTc)
        : 'ALL';
      updateData.targetCategory = tc;
      if (tc !== 'ALL') {
        await ensureCategoryExists(tc);
      }
    }

    if (!existing.quizNumber) {
      updateData.quizNumber = await getNextQuizNumber();
    }

    if (typeof req.body.hasEssay !== 'undefined') {
      updateData.hasEssay = req.body.hasEssay === true || req.body.hasEssay === 'true';
    }
    if (typeof req.body.essayTotalMarks !== 'undefined') {
      updateData.essayTotalMarks = Number(req.body.essayTotalMarks) || 0;
    }
    if (req.body.essayStartTime) {
      updateData.essayStartTime = new Date(req.body.essayStartTime);
    }
    if (req.body.essayEndTime) {
      updateData.essayEndTime = new Date(req.body.essayEndTime);
    }
    if (req.body.essayDurationMinutes) {
      updateData.essayDurationMinutes = Number(req.body.essayDurationMinutes);
    }
    if (typeof req.body.essayInstructions !== 'undefined') {
      updateData.essayInstructions = req.body.essayInstructions;
    }

    const quiz = await Quiz.findByIdAndUpdate(id, updateData, { new: true });
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    memoryCache.delByPrefix('quiz_');

    const ws = getQuizWindowStatus(quiz, now);
    if (quiz.status === 'ENDED' || ws.isEnded) {
      await calculateAndStoreQuizRankings(quiz._id);
    }

    const statusMsg = quiz.status === 'SCHEDULED'
      ? `Quiz scheduled successfully for ${formatSriLankanTime(quiz.startTime)}`
      : `Quiz published successfully (${quiz.status})`;

    res.json({
      success: true,
      message: statusMsg,
      data: quiz,
    });
  } catch (err) {
    next(err);
  }
}

export async function republishQuizAsNew(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { date, startTime, endTime, durationMinutes } = req.body;

    const originalQuiz = await Quiz.findById(id);
    if (!originalQuiz) {
      throw new ApiError(404, 'Original quiz not found', 'ORIGINAL_QUIZ_NOT_FOUND');
    }

    const quizNumber = await getNextQuizNumber();

    // Create NEW Quiz copy
    const newQuiz = await Quiz.create({
      quizNumber,
      title: `${originalQuiz.title} (New Publication)`,
      description: originalQuiz.description,
      subjectId: originalQuiz.subjectId,
      topicIds: originalQuiz.topicIds,
      questions: originalQuiz.questions,
      date: new Date(date || Date.now()),
      startTime: new Date(startTime || Date.now()),
      endTime: new Date(endTime || Date.now() + 86400000),
      durationMinutes: durationMinutes || originalQuiz.durationMinutes,
      totalMarks: Number(originalQuiz.totalMarks) || 0,
      instructions: originalQuiz.instructions,
      status: 'SCHEDULED',
      targetCategory: originalQuiz.targetCategory || 'ALL',
      isLateQuiz: true,
      originalQuizId: originalQuiz._id,
      createdById: adminId,
    });

    memoryCache.delByPrefix('quiz_');

    res.status(201).json({
      success: true,
      message: 'Quiz published successfully as a new publication',
      data: newQuiz,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const quiz = await Quiz.findById(id);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    const quizId = quiz._id;

    // 1. Gather all question IDs associated with this quiz
    const questionIdSet = new Set<string>();
    if (quiz.questions && Array.isArray(quiz.questions)) {
      quiz.questions.forEach((qId: any) => {
        if (qId) questionIdSet.add(qId.toString());
      });
    }

    // Also collect any question IDs answered in attempts for this quiz
    const answeredQuestionIds = await StudentAnswer.distinct('questionId', { quizId });
    answeredQuestionIds.forEach((qId: any) => {
      if (qId) questionIdSet.add(qId.toString());
    });

    const allQuestionIds = Array.from(questionIdSet).map((qId) => new mongoose.Types.ObjectId(qId));

    // 2. Locate and delete all question images (QuestionImage) referenced by these questions
    let deletedImagesCount = 0;
    if (allQuestionIds.length > 0) {
      const questions = await Question.find({ _id: { $in: allQuestionIds } }).select('imageUrl options');
      const imageIdSet = new Set<string>();

      questions.forEach((q) => {
        if (q.imageUrl) {
          const match = q.imageUrl.match(/([a-f\d]{24})/i);
          if (match && mongoose.Types.ObjectId.isValid(match[1])) {
            imageIdSet.add(match[1]);
          }
        }
        if (Array.isArray(q.options)) {
          q.options.forEach((opt) => {
            if (opt.imageUrl) {
              const match = opt.imageUrl.match(/([a-f\d]{24})/i);
              if (match && mongoose.Types.ObjectId.isValid(match[1])) {
                imageIdSet.add(match[1]);
              }
            }
          });
        }
      });

      if (imageIdSet.size > 0) {
        const imageIds = Array.from(imageIdSet).map((imgId) => new mongoose.Types.ObjectId(imgId));
        const imgRes = await QuestionImage.deleteMany({ _id: { $in: imageIds } });
        deletedImagesCount = imgRes.deletedCount || 0;
      }
    }

    // 3. Delete Question documents
    let deletedQuestionsCount = 0;
    if (allQuestionIds.length > 0) {
      const qRes = await Question.deleteMany({ _id: { $in: allQuestionIds } });
      deletedQuestionsCount = qRes.deletedCount || 0;
    }

    // 4. Delete all attempts and student answers
    const ansRes = await StudentAnswer.deleteMany({ quizId });
    const attRes = await QuizAttempt.deleteMany({ quizId });

    // 5. Delete results and rankings (both MCQ Quiz and Full Paper rankings)
    const resRes = await QuizResult.deleteMany({ quizId });
    await RankingSnapshot.deleteMany({ quizId });
    await FullPaperRankingSnapshot.deleteMany({ quizId });

    // 6. Delete all essay submissions and essay files (both question paper and student answers)
    await EssaySubmission.deleteMany({ quizId });
    const fileFilters: any[] = [{ quizId }];
    if (quiz.essayQuestionPaperFileId) {
      fileFilters.push({ _id: quiz.essayQuestionPaperFileId });
    }
    const essayFileRes = await EssayFile.deleteMany({ $or: fileFilters });

    // 7. Delete associated PdfImports
    const pdfRes = await PdfImport.deleteMany({
      $or: [{ quizId }, { filename: quiz.title }],
    });

    // 8. Unlink from any marking panel assignments
    try {
      await MarkingPanelProfile.updateMany(
        { assignedQuizIds: quizId },
        { $pull: { assignedQuizIds: quizId } }
      );
    } catch (panelErr) {
      logger.warn('[QUIZ_DELETE] Warning unlinking marking panel profiles:', panelErr);
    }

    // 9. Delete the quiz itself
    await Quiz.findByIdAndDelete(id);
    await resequenceAllQuizNumbers();
    memoryCache.delByPrefix('quiz_');

    logger.info(`[QUIZ_DELETE] Quiz "${quiz.title}" (${quiz._id}) completely purged: ${deletedQuestionsCount} questions, ${deletedImagesCount} question images, ${attRes.deletedCount || 0} attempts, ${ansRes.deletedCount || 0} student answers, ${resRes.deletedCount || 0} results, ${essayFileRes.deletedCount || 0} essay files, ${pdfRes.deletedCount || 0} pdf imports.`);

    res.json({
      success: true,
      message: 'Quiz and all associated questions, question images, student answers, files, and rankings successfully deleted.',
      data: {
        quizId: id,
        deletedQuestions: deletedQuestionsCount,
        deletedImages: deletedImagesCount,
        deletedAttempts: attRes.deletedCount || 0,
        deletedAnswers: ansRes.deletedCount || 0,
        deletedResults: resRes.deletedCount || 0,
        deletedFiles: essayFileRes.deletedCount || 0,
        deletedPdfImports: pdfRes.deletedCount || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function parseRawTextForImport(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.userId;
    const { text, title } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new ApiError(400, 'Please provide question text', 'NO_TEXT');
    }

    let parseResult: any = null;
    try {
      parseResult = await extractQuizTextWithGemini(text);
    } catch (e: any) {
      console.warn('[parseRawTextForImport] Gemini text parse failed, falling back to local regex:', e?.message);
    }

    if (!parseResult || !parseResult.parsedQuestions || parseResult.parsedQuestions.length === 0) {
      parseResult = parseQuizText(text);
    }

    const pdfImport = await PdfImport.create({
      filename: title || 'Pasted_Text_Import.txt',
      subjectName: parseResult.subjectName,
      topicName: parseResult.defaultTopicName,
      parsedQuestions: parseResult.parsedQuestions,
      validationErrors: parseResult.validationErrors,
      status: 'PARSED',
      createdById: adminId,
    });

    res.json({
      success: true,
      message: 'Text parsed successfully with AI',
      data: pdfImport,
    });
  } catch (err) {
    next(err);
  }
}

export async function uploadPdfForImport(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.userId;
    if (!req.file) {
      throw new ApiError(400, 'Please select a PDF file', 'NO_FILE');
    }

    const parseResult = await parseQuizPdf(req.file.buffer);

    const pdfImport = await PdfImport.create({
      filename: req.file.originalname,
      subjectName: parseResult.subjectName,
      topicName: parseResult.defaultTopicName,
      parsedQuestions: parseResult.parsedQuestions,
      validationErrors: parseResult.validationErrors,
      status: 'PARSED',
      createdById: adminId,
    });

    res.json({
      success: true,
      message: 'PDF questions extracted successfully via AI',
      data: pdfImport,
    });
  } catch (err) {
    next(err);
  }
}

export async function getPdfImportDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const pdfImport = await PdfImport.findById(id);
    if (!pdfImport) {
      throw new ApiError(404, 'PDF record not found', 'NOT_FOUND');
    }
    res.json({ success: true, data: pdfImport });
  } catch (err) {
    next(err);
  }
}

export async function updatePdfImportQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { subjectName, topicName, parsedQuestions } = req.body;

    const pdfImport = await PdfImport.findByIdAndUpdate(
      id,
      { subjectName, topicName, parsedQuestions, status: 'REVIEWED' },
      { new: true }
    );

    res.json({ success: true, message: 'Changes saved successfully', data: pdfImport });
  } catch (err) {
    next(err);
  }
}

export async function convertPdfImportToQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;

    const pdfImport = await PdfImport.findById(id);
    if (!pdfImport) {
      throw new ApiError(404, 'PDF Import record not found', 'NOT_FOUND');
    }

    // Subject resolution (find or create via robust matching)
    const subject = await resolveSubject(req.body.subjectId, pdfImport.subjectName);

    // Cache of topics for this subject: topicName -> Topic ObjectId
    const topicMap = new Map<string, mongoose.Types.ObjectId>();
    const createdQuestionIds: mongoose.Types.ObjectId[] = [];
    const quizTopicIds = new Set<string>();
    let totalMarks = 0;

    // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
    const mcqParsed = (pdfImport.parsedQuestions || []).filter((pq: any) => pq.questionType !== 'SHORT_ANSWER');
    const shortAnswerParsed = (pdfImport.parsedQuestions || []).filter((pq: any) => pq.questionType === 'SHORT_ANSWER');
    const sortedParsedQuestions = [...mcqParsed, ...shortAnswerParsed];

    for (const pq of sortedParsedQuestions) {
      const topicName = (pq.topicName || pdfImport.topicName || 'General').trim();
      const topicKey = topicName.toLowerCase();

      let topicId = topicMap.get(topicKey);
      if (!topicId) {
        const topicDoc = await resolveTopic(subject._id, topicName);
        topicId = topicDoc._id as mongoose.Types.ObjectId;
        topicMap.set(topicKey, topicId);
      }

      quizTopicIds.add(topicId.toString());

      const pqMarks = Number(pq.marks) > 0 ? Number(pq.marks) : 1;

      const q = await Question.create({
        subjectId: subject._id,
        topicId: topicId,
        questionType: pq.questionType || 'MCQ',
        questionText: pq.questionText,
        imageUrl: pq.imageUrl || '',
        imageCaption: pq.imageCaption || '',
        options: pq.options || [],
        correctAnswer: pq.correctAnswer || (pq.questionType === 'SHORT_ANSWER' ? '' : 'A'),
        acceptableAnswers: pq.acceptableAnswers || [],
        marks: pqMarks,
        explanation: pq.explanation || '',
        difficulty: 'MEDIUM',
      });
      createdQuestionIds.push(q._id as any);
      totalMarks += Number(q.marks != null ? q.marks : pqMarks);
    }

    const {
      title,
      status,
      publishMode,
      scheduledStartTime,
      scheduledEndTime,
      scheduleWindows,
      startTime,
      endTime,
      date,
      durationMinutes,
      instructions,
    } = req.body;

    const now = new Date();
    let qStatus = publishMode === 'SCHEDULED' ? 'SCHEDULED' : publishMode === 'LIVE' ? 'LIVE' : status || 'LIVE';

    const parsedWindows = parseScheduleWindows(scheduleWindows || []);

    let qStartTime: Date;
    let qEndTime: Date;

    if (parsedWindows.length > 0) {
      qStartTime = parsedWindows[0].startTime;
      qEndTime = parsedWindows[parsedWindows.length - 1].endTime;
    } else {
      const rawStart = scheduledStartTime || startTime;
      qStartTime = rawStart
        ? typeof rawStart === 'string' && rawStart.includes('T') && (rawStart.endsWith('Z') || rawStart.includes('+'))
          ? new Date(rawStart)
          : fromSriLankanInputString(rawStart)
        : now;

      const rawEnd = scheduledEndTime || endTime;
      if (rawEnd) {
        qEndTime =
          typeof rawEnd === 'string' && rawEnd.includes('T') && (rawEnd.endsWith('Z') || rawEnd.includes('+'))
            ? new Date(rawEnd)
            : fromSriLankanInputString(rawEnd);
      } else {
        const dMin = Number(durationMinutes) > 0 ? Number(durationMinutes) : 30;
        qEndTime = new Date(qStartTime.getTime() + dMin * 60000);
      }
    }

    let parsedDuration = Number(durationMinutes);
    if (!parsedDuration || isNaN(parsedDuration) || parsedDuration <= 0) {
      parsedDuration = 30;
    }

    let qDate = date
      ? typeof date === 'string' && date.includes('T') && (date.endsWith('Z') || date.includes('+'))
        ? new Date(date)
        : fromSriLankanInputString(date)
      : qStartTime;

    if (qStatus === 'SCHEDULED') {
      if (parsedWindows.length > 0) {
        const inActiveWindow = parsedWindows.some((w) => now >= w.startTime && now < w.endTime);
        if (inActiveWindow) {
          qStatus = 'LIVE';
        }
      } else if (qStartTime <= now && qEndTime > now) {
        qStatus = 'LIVE';
      }
    }

    let quizNumber = Number(req.body.quizNumber);
    if (!quizNumber || isNaN(quizNumber) || quizNumber <= 0) {
      quizNumber = await getNextQuizNumber();
    }

    const rawTargetCategory = (req.body.targetCategory || 'ALL').trim();
    const targetCategory = rawTargetCategory.toUpperCase() !== 'ALL' && rawTargetCategory.toLowerCase() !== 'everyone'
      ? formatCategoryName(rawTargetCategory)
      : 'ALL';
    if (targetCategory && targetCategory !== 'ALL') {
      await ensureCategoryExists(targetCategory);
    }

    const hasEssay = req.body.hasEssay === true || req.body.hasEssay === 'true';
    const essayTotalMarks = Number(req.body.essayTotalMarks) || 0;
    const essayStartTime = req.body.essayStartTime ? new Date(req.body.essayStartTime) : undefined;
    const essayEndTime = req.body.essayEndTime ? new Date(req.body.essayEndTime) : undefined;
    const essayDurationMinutes = req.body.essayDurationMinutes ? Number(req.body.essayDurationMinutes) : 120;
    const essayInstructions = req.body.essayInstructions || '';

    const quiz = await Quiz.create({
      quizNumber,
      title: title || `${subject.nameEn || subject.nameSi || 'Assessment'} - ${pdfImport.topicName || 'Quiz'}`,
      subjectId: subject._id,
      topicIds: Array.from(quizTopicIds).map((id) => new mongoose.Types.ObjectId(id)),
      questions: createdQuestionIds,
      date: qDate,
      startTime: qStartTime,
      endTime: qEndTime,
      durationMinutes: parsedDuration,
      scheduleWindows: parsedWindows.length > 0 ? parsedWindows : undefined,
      totalMarks: Number(totalMarks) || 0,
      instructions: instructions || 'Select the most accurate answer for each question.',
      status: qStatus,
      targetCategory,
      hasEssay,
      essayTotalMarks: Number(essayTotalMarks) || 0,
      essayStartTime,
      essayEndTime,
      essayDurationMinutes,
      essayInstructions,
      essayQuestionPaperFileId: req.body.essayQuestionPaperFileId || undefined,
      essayQuestionPaperFilename: req.body.essayQuestionPaperFilename || undefined,
      createdById: adminId,
    });

    pdfImport.quizId = quiz._id as any;
    pdfImport.status = 'PUBLISHED';
    await pdfImport.save();

    memoryCache.delByPrefix('quiz_');

    const successMsg = qStatus === 'SCHEDULED'
      ? `Quiz scheduled successfully for ${formatSriLankanTime(qStartTime)}`
      : 'Quiz published live successfully';

    res.status(201).json({
      success: true,
      message: successMsg,
      data: quiz,
    });
  } catch (err) {
    next(err);
  }
}

export async function computeQuizAnalyticsData(quizId: string) {
  const quiz = await Quiz.findById(quizId).populate('subjectId', 'nameSi nameEn code').populate('questions');

  if (!quiz) {
    throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
  }

  const results = await QuizResult.find({ quizId: quiz._id }).lean();
  const totalParticipants = results.length;
  const scores = results.map((r) => r.score);
  const percentages = results.map((r) => r.percentage);
  const averageScore = totalParticipants > 0 ? Math.round(percentages.reduce((a, b) => a + b, 0) / totalParticipants) : 0;
  const highestScore = totalParticipants > 0 ? Math.max(...scores) : 0;
  const highestPercentage = totalParticipants > 0 ? Math.max(...percentages) : 0;
  const lowestScore = totalParticipants > 0 ? Math.min(...scores) : 0;
  const lowestPercentage = totalParticipants > 0 ? Math.min(...percentages) : 0;
  const passCount = results.filter((r) => r.percentage >= 35).length;
  const passRate = totalParticipants > 0 ? Math.round((passCount / totalParticipants) * 100) : 0;

  // Median score calculation
  const sortedPercentages = [...percentages].sort((a, b) => a - b);
  const medianScore = totalParticipants > 0
    ? sortedPercentages[Math.floor(totalParticipants / 2)]
    : 0;

  // Time metrics
  const times = results.map((r) => r.timeTakenSeconds || 0);
  const avgTimeSeconds = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const minTimeSeconds = times.length > 0 ? Math.min(...times) : 0;
  const maxTimeSeconds = times.length > 0 ? Math.max(...times) : 0;

  // Score Buckets for Histogram Chart
  const scoreBuckets = [
    { range: '0 - 20%', count: 0, label: '0-20%', description: 'Needs Remedial Focus' },
    { range: '21 - 40%', count: 0, label: '21-40%', description: 'Developing' },
    { range: '41 - 60%', count: 0, label: '41-60%', description: 'Average Pass' },
    { range: '61 - 80%', count: 0, label: '61-80%', description: 'Merit Pass' },
    { range: '81 - 100%', count: 0, label: '81-100%', description: 'High Distinction' },
  ];
  percentages.forEach((p) => {
    if (p <= 20) scoreBuckets[0].count++;
    else if (p <= 40) scoreBuckets[1].count++;
    else if (p <= 60) scoreBuckets[2].count++;
    else if (p <= 80) scoreBuckets[3].count++;
    else scoreBuckets[4].count++;
  });

  // Sri Lankan G.C.E A/L Grade Scheme Breakdown
  let gradeA = 0; // >= 75
  let gradeB = 0; // 65-74
  let gradeC = 0; // 50-64
  let gradeS = 0; // 35-49
  let gradeF = 0; // < 35
  percentages.forEach((p) => {
    if (p >= 75) gradeA++;
    else if (p >= 65) gradeB++;
    else if (p >= 50) gradeC++;
    else if (p >= 35) gradeS++;
    else gradeF++;
  });

  const gradeBreakdown = [
    { grade: 'A', name: 'Distinction (A ≥ 75%)', count: gradeA, percentage: totalParticipants > 0 ? Math.round((gradeA / totalParticipants) * 100) : 0, color: '#059669' },
    { grade: 'B', name: 'Very Good (B: 65-74%)', count: gradeB, percentage: totalParticipants > 0 ? Math.round((gradeB / totalParticipants) * 100) : 0, color: '#2563EB' },
    { grade: 'C', name: 'Credit Pass (C: 50-64%)', count: gradeC, percentage: totalParticipants > 0 ? Math.round((gradeC / totalParticipants) * 100) : 0, color: '#7C3AED' },
    { grade: 'S', name: 'Ordinary Pass (S: 35-49%)', count: gradeS, percentage: totalParticipants > 0 ? Math.round((gradeS / totalParticipants) * 100) : 0, color: '#D97706' },
    { grade: 'F', name: 'Fail (F: < 35%)', count: gradeF, percentage: totalParticipants > 0 ? Math.round((gradeF / totalParticipants) * 100) : 0, color: '#DC2626' },
  ];

  // High performance question analytics aggregation
  const questionAgg = await StudentAnswer.aggregate([
    { $match: { quizId: quiz._id } },
    {
      $group: {
        _id: '$questionId',
        totalAttempts: { $sum: 1 },
        correctCount: { $sum: { $cond: ['$isCorrect', 1, 0] } },
      },
    },
  ]);

  const qAggMap = new Map<string, { totalAttempts: number; correctCount: number }>();
  questionAgg.forEach((qa) => {
    if (qa._id) {
      qAggMap.set(qa._id.toString(), {
        totalAttempts: qa.totalAttempts,
        correctCount: qa.correctCount,
      });
    }
  });

  // Load questions safely with fallback for unpopulated or ID-only arrays
  const rawQuestions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const missingQIds = rawQuestions
    .map((q: any) => (typeof q === 'string' ? q : (q && !q.questionText ? (q._id || q.id || '').toString() : '')))
    .filter(Boolean);

  const fallbackQMap = new Map<string, any>();
  if (missingQIds.length > 0) {
    try {
      const fetchedQs = await Question.find({ _id: { $in: missingQIds } }).lean();
      fetchedQs.forEach((fq: any) => {
        const idStr = (fq._id || fq.id || '').toString();
        if (idStr) fallbackQMap.set(idStr, fq);
      });
    } catch (_) {}
  }

  const questionStats: any[] = [];
  let qNumber = 1;
  for (const q of rawQuestions) {
    const qIdStr = (q?._id || q?.id || (typeof q === 'string' ? q : '')).toString();
    const resolvedQ = typeof q === 'object' && q?.questionText ? q : (fallbackQMap.get(qIdStr) || (typeof q === 'object' ? q : {}));
    const qStats = qAggMap.get(qIdStr) || { totalAttempts: 0, correctCount: 0 };
    const totalAnswers = qStats.totalAttempts || 0;
    const correctAnswers = qStats.correctCount || 0;
    const correctPct = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

    let difficultyRating: 'EASY' | 'MODERATE' | 'HARD' = 'MODERATE';
    if (correctPct >= 70) difficultyRating = 'EASY';
    else if (correctPct < 40) difficultyRating = 'HARD';

    questionStats.push({
      questionId: qIdStr || String(qNumber),
      questionNumber: qNumber++,
      questionText: resolvedQ.questionText || `Question ${qNumber - 1}`,
      imageUrl: resolvedQ.imageUrl || '',
      imageCaption: resolvedQ.imageCaption || '',
      options: resolvedQ.options || [],
      correctAnswer: resolvedQ.correctAnswer || '',
      marks: Number(resolvedQ.marks) || 1,
      totalAttempts: totalAnswers,
      correctCount: correctAnswers,
      accuracyRate: correctPct,
      correctPercentage: correctPct,
      difficultyRating,
    });
  }

  // Hardest & Easiest Questions
  const questionsWithAttempts = questionStats.filter((q) => q.totalAttempts > 0);
  const hardestQuestion = questionsWithAttempts.length > 0
    ? [...questionsWithAttempts].sort((a, b) => a.accuracyRate - b.accuracyRate)[0]
    : null;
  const easiestQuestion = questionsWithAttempts.length > 0
    ? [...questionsWithAttempts].sort((a, b) => b.accuracyRate - a.accuracyRate)[0]
    : null;

  // Student Profiles and Users for demographics & rankings safely handled
  const studentIds = Array.from(
    new Set(results.map((r) => (r.studentId?._id || r.studentId?.id || r.studentId || '').toString()).filter(Boolean))
  );
  const [profiles, users] = await Promise.all([
    studentIds.length > 0 ? StudentProfile.find({ userId: { $in: studentIds } }).lean() : [],
    studentIds.length > 0 ? User.find({ _id: { $in: studentIds } }).select('fullName school').lean() : [],
  ]);

  const profileMap = new Map<string, any>();
  profiles.forEach((p) => {
    const uId = (p.userId?._id || p.userId?.id || p.userId || '').toString();
    if (uId) profileMap.set(uId, p);
  });
  const userMap = new Map<string, any>();
  users.forEach((u) => {
    const uId = (u._id || u.id || '').toString();
    if (uId) userMap.set(uId, u);
  });

  // Provincial Performance Analytics
  const provinceMap = new Map<string, { name: string; count: number; totalPct: number; passCount: number }>();
  PROVINCES.forEach((p) => provinceMap.set(p.id, { name: p.nameSi, count: 0, totalPct: 0, passCount: 0 }));

  // Batch / Category Breakdown (e.g. 2027 A/L, 2028 A/L)
  const batchMap = new Map<string, { count: number; totalPct: number; passCount: number }>();

  results.forEach((r) => {
    // Province stats
    const p = provinceMap.get(r.provinceId);
    if (p) {
      p.count += 1;
      p.totalPct += r.percentage;
      if (r.percentage >= 35) p.passCount += 1;
    }

    // Batch stats
    const sId = (r.studentId?._id || r.studentId?.id || r.studentId || '').toString();
    const prof = profileMap.get(sId);
    const bKey = prof?.alYear || 'General';
    if (!batchMap.has(bKey)) {
      batchMap.set(bKey, { count: 0, totalPct: 0, passCount: 0 });
    }
    const b = batchMap.get(bKey)!;
    b.count += 1;
    b.totalPct += r.percentage;
    if (r.percentage >= 35) b.passCount += 1;
  });

  const provinceStats = Array.from(provinceMap.values())
    .filter((p) => p.count > 0)
    .map((p) => ({
      provinceName: p.name,
      participantCount: p.count,
      participants: p.count,
      averageScore: Math.round(p.totalPct / p.count),
      passRate: Math.round((p.passCount / p.count) * 100),
    }));

  const batchStats = Array.from(batchMap.entries()).map(([batchName, b]) => ({
    batchName,
    participantCount: b.count,
    averageScore: Math.round(b.totalPct / b.count),
    passRate: Math.round((b.passCount / b.count) * 100),
  }));

  const now = new Date();
  const windowStatus = getQuizWindowStatus(quiz, now);
  const mcqFinalEndTime = windowStatus.mcqFinalEndTime || (quiz.endTime ? new Date(quiz.endTime) : null);
  const finalEndTime = windowStatus.finalEndTime || mcqFinalEndTime;
  const isMcqEnded = Boolean((mcqFinalEndTime && now >= mcqFinalEndTime) || quiz.status === 'ARCHIVED');
  const isQuizEnded = Boolean((finalEndTime && now >= finalEndTime) || quiz.status === 'ARCHIVED');
  const scheduledSriLankanEndTime = finalEndTime ? formatSriLankanTime(finalEndTime) : (quiz.endTime ? formatSriLankanTime(quiz.endTime) : '');
  const mcqScheduledSriLankanEndTime = mcqFinalEndTime ? formatSriLankanTime(mcqFinalEndTime) : scheduledSriLankanEndTime;

  // If MCQ session has ended and rankings were not calculated yet, calculate now safely
  if (isMcqEnded && !quiz.isRankingsCalculated) {
    try {
      await calculateAndStoreQuizRankings(quiz._id);
      await Quiz.findByIdAndUpdate(quiz._id, { isRankingsCalculated: true });
    } catch (rankErr) {
      logger.error(`[REPORT] Failed to calculate rankings during analytics generation for Quiz ${quiz._id}:`, rankErr);
    }
  }

  if (isQuizEnded && quiz.status !== 'ENDED') {
    try {
      await Quiz.findByIdAndUpdate(quiz._id, { status: 'ENDED' });
    } catch (_) {}
  }

  const sortedResults = [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.timeTakenSeconds - b.timeTakenSeconds;
  });

  const rankings = sortedResults.map((r, idx) => {
    const sId = (r.studentId?._id || r.studentId?.id || r.studentId || '').toString();
    const prof = profileMap.get(sId);
    const usr = userMap.get(sId);
    const district = DISTRICTS.find((d) => d.id === r.districtId);
    const province = PROVINCES.find((p) => p.id === r.provinceId);
    return {
      rank: isMcqEnded ? (r.islandRank || idx + 1) : null,
      fullName: prof?.fullName || usr?.fullName || 'Student',
      alYear: prof?.alYear || '2027 A/L',
      school: prof?.school || usr?.school || '-',
      districtName: district?.nameEn || r.districtId,
      provinceName: province?.nameEn || r.provinceId,
      score: r.score,
      percentage: r.percentage,
      timeTakenSeconds: r.timeTakenSeconds,
    };
  });

  // Full Paper & Essay Deep Analytics Aggregation
  let essayStats: any = null;
  let fullPaperStats: any = null;
  let fullPaperRankingsList: any[] = [];

  const hasEssayQuiz = Boolean(quiz.hasEssay || quiz.essayQuestionPaperFileId);
  if (hasEssayQuiz) {
    const [essaySubs, fullPaperSnapshot] = await Promise.all([
      EssaySubmission.find({ quizId: quiz._id }).lean(),
      FullPaperRankingSnapshot.findOne({ quizId: quiz._id }).lean(),
    ]);

    const totalEssaySubmissions = essaySubs.length;
    const markedEssays = essaySubs.filter((s) => s.isMarked && s.marksAwarded != null);
    const markedEssayCount = markedEssays.length;
    const pendingEssayCount = Math.max(0, totalEssaySubmissions - markedEssayCount);
    const essayTotalMarks = quiz.essayTotalMarks || 100;

    const essayMarksList = markedEssays.map((s) => s.marksAwarded || 0);
    const essayPctsList = markedEssays.map((s) => {
      const max = s.maxMarks || essayTotalMarks;
      return max > 0 ? Math.round(((s.marksAwarded || 0) / max) * 100) : 0;
    });

    const avgEssayMarks = markedEssayCount > 0 ? Math.round((essayMarksList.reduce((a, b) => a + b, 0) / markedEssayCount) * 10) / 10 : 0;
    const avgEssayPct = markedEssayCount > 0 ? Math.round(essayPctsList.reduce((a, b) => a + b, 0) / markedEssayCount) : 0;
    const highestEssayMark = markedEssayCount > 0 ? Math.max(...essayMarksList) : 0;
    const lowestEssayMark = markedEssayCount > 0 ? Math.min(...essayMarksList) : 0;
    const highestEssayPct = markedEssayCount > 0 ? Math.max(...essayPctsList) : 0;
    const lowestEssayPct = markedEssayCount > 0 ? Math.min(...essayPctsList) : 0;
    const essayPassCount = essayPctsList.filter((p) => p >= 35).length;
    const essayPassRate = markedEssayCount > 0 ? Math.round((essayPassCount / markedEssayCount) * 100) : 0;

    let eA = 0, eB = 0, eC = 0, eS = 0, eF = 0;
    essayPctsList.forEach((p) => {
      if (p >= 75) eA++;
      else if (p >= 65) eB++;
      else if (p >= 50) eC++;
      else if (p >= 35) eS++;
      else eF++;
    });

    const essayGradeBreakdown = [
      { grade: 'A', name: 'Distinction (A ≥ 75%)', count: eA, percentage: markedEssayCount > 0 ? Math.round((eA / markedEssayCount) * 100) : 0, color: '#10b981' },
      { grade: 'B', name: 'Very Good (B: 65-74%)', count: eB, percentage: markedEssayCount > 0 ? Math.round((eB / markedEssayCount) * 100) : 0, color: '#3b82f6' },
      { grade: 'C', name: 'Credit Pass (C: 50-64%)', count: eC, percentage: markedEssayCount > 0 ? Math.round((eC / markedEssayCount) * 100) : 0, color: '#8b5cf6' },
      { grade: 'S', name: 'Ordinary Pass (S: 35-49%)', count: eS, percentage: markedEssayCount > 0 ? Math.round((eS / markedEssayCount) * 100) : 0, color: '#f59e0b' },
      { grade: 'F', name: 'Fail (F: < 35%)', count: eF, percentage: markedEssayCount > 0 ? Math.round((eF / markedEssayCount) * 100) : 0, color: '#ef4444' },
    ];

    const essayScoreBuckets = [
      { range: '0 - 20%', count: 0, label: '0-20%' },
      { range: '21 - 40%', count: 0, label: '21-40%' },
      { range: '41 - 60%', count: 0, label: '41-60%' },
      { range: '61 - 80%', count: 0, label: '61-80%' },
      { range: '81 - 100%', count: 0, label: '81-100%' },
    ];
    essayPctsList.forEach((p) => {
      if (p <= 20) essayScoreBuckets[0].count++;
      else if (p <= 40) essayScoreBuckets[1].count++;
      else if (p <= 60) essayScoreBuckets[2].count++;
      else if (p <= 80) essayScoreBuckets[3].count++;
      else essayScoreBuckets[4].count++;
    });

    essayStats = {
      totalSubmissions: totalEssaySubmissions,
      markedCount: markedEssayCount,
      pendingCount: pendingEssayCount,
      essayTotalMarks,
      averageMarks: avgEssayMarks,
      averagePercentage: avgEssayPct,
      highestMarks: highestEssayMark,
      highestPercentage: highestEssayPct,
      lowestMarks: lowestEssayMark,
      lowestPercentage: lowestEssayPct,
      passRate: essayPassRate,
      passCount: essayPassCount,
      distinctionCount: eA,
      gradeBreakdown: essayGradeBreakdown,
      scoreBuckets: essayScoreBuckets,
    };

    // Full Paper Rankings & Aggregates
    if (fullPaperSnapshot && fullPaperSnapshot.rankings && fullPaperSnapshot.rankings.length > 0) {
      fullPaperRankingsList = fullPaperSnapshot.rankings;
    } else {
      const markedEssayMap = new Map<string, any>();
      markedEssays.forEach((s) => {
        const sId = (s.studentId?._id || s.studentId?.id || s.studentId || '').toString();
        if (sId) markedEssayMap.set(sId, s);
      });

      const fpCandidates: any[] = [];
      results.forEach((r) => {
        const sId = (r.studentId?._id || r.studentId?.id || r.studentId || '').toString();
        const s = markedEssayMap.get(sId);
        if (s) {
          const mcqScore = r.score;
          const mcqTotal = quiz.totalMarks;
          const essayScore = s.marksAwarded || 0;
          const essayTotal = s.maxMarks || essayTotalMarks;
          const totalScore = mcqScore + essayScore;
          const totalMarks = mcqTotal + essayTotal;
          const percentage = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 100) : 0;
          const prof = profileMap.get(sId);
          const usr = userMap.get(sId);

          fpCandidates.push({
            studentId: r.studentId,
            fullName: prof?.fullName || usr?.fullName || 'Student',
            username: s.studentUsername || '',
            school: prof?.school || usr?.school || '',
            provinceId: r.provinceId,
            districtId: r.districtId,
            mcqScore,
            mcqTotalMarks: mcqTotal,
            essayScore,
            essayTotalMarks: essayTotal,
            totalScore,
            totalMarks,
            percentage,
            timeTakenSeconds: r.timeTakenSeconds,
            submittedAt: r.createdAt,
            islandRank: r.fullPaperIslandRank || 0,
            provinceRank: r.fullPaperProvinceRank || 0,
            districtRank: r.fullPaperDistrictRank || 0,
          });
        }
      });

      fpCandidates.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return a.timeTakenSeconds - b.timeTakenSeconds;
      });

      fullPaperRankingsList = fpCandidates.map((c, i) => ({
        ...c,
        islandRank: c.islandRank > 0 ? c.islandRank : i + 1,
      }));
    }

    // Compute Full Paper statistics from fullPaperRankingsList
    const fpTotal = fullPaperRankingsList.length;
    const fpScores = fullPaperRankingsList.map((r) => r.totalScore);
    const fpPcts = fullPaperRankingsList.map((r) => r.percentage);
    const fpTotalMarks = quiz.totalMarks + essayTotalMarks;

    const fpAvgScore = fpTotal > 0 ? Math.round((fpScores.reduce((a, b) => a + b, 0) / fpTotal) * 10) / 10 : 0;
    const fpAvgPct = fpTotal > 0 ? Math.round(fpPcts.reduce((a, b) => a + b, 0) / fpTotal) : 0;
    const fpSortedPcts = [...fpPcts].sort((a, b) => a - b);
    const fpMedianPct = fpTotal > 0 ? fpSortedPcts[Math.floor(fpTotal / 2)] : 0;
    const fpHighestScore = fpTotal > 0 ? Math.max(...fpScores) : 0;
    const fpHighestPct = fpTotal > 0 ? Math.max(...fpPcts) : 0;
    const fpLowestScore = fpTotal > 0 ? Math.min(...fpScores) : 0;
    const fpLowestPct = fpTotal > 0 ? Math.min(...fpPcts) : 0;
    const fpPassCount = fpPcts.filter((p) => p >= 35).length;
    const fpPassRate = fpTotal > 0 ? Math.round((fpPassCount / fpTotal) * 100) : 0;

    let fpA = 0, fpB = 0, fpC = 0, fpS = 0, fpF = 0;
    fpPcts.forEach((p) => {
      if (p >= 75) fpA++;
      else if (p >= 65) fpB++;
      else if (p >= 50) fpC++;
      else if (p >= 35) fpS++;
      else fpF++;
    });

    const fpGradeBreakdown = [
      { grade: 'A', name: 'Distinction (A ≥ 75%)', count: fpA, percentage: fpTotal > 0 ? Math.round((fpA / fpTotal) * 100) : 0, color: '#10b981' },
      { grade: 'B', name: 'Very Good (B: 65-74%)', count: fpB, percentage: fpTotal > 0 ? Math.round((fpB / fpTotal) * 100) : 0, color: '#3b82f6' },
      { grade: 'C', name: 'Credit Pass (C: 50-64%)', count: fpC, percentage: fpTotal > 0 ? Math.round((fpC / fpTotal) * 100) : 0, color: '#8b5cf6' },
      { grade: 'S', name: 'Ordinary Pass (S: 35-49%)', count: fpS, percentage: fpTotal > 0 ? Math.round((fpS / fpTotal) * 100) : 0, color: '#f59e0b' },
      { grade: 'F', name: 'Fail (F: < 35%)', count: fpF, percentage: fpTotal > 0 ? Math.round((fpF / fpTotal) * 100) : 0, color: '#ef4444' },
    ];

    const fpScoreBuckets = [
      { range: '0 - 20%', count: 0, label: '0-20%' },
      { range: '21 - 40%', count: 0, label: '21-40%' },
      { range: '41 - 60%', count: 0, label: '41-60%' },
      { range: '61 - 80%', count: 0, label: '61-80%' },
      { range: '81 - 100%', count: 0, label: '81-100%' },
    ];
    fpPcts.forEach((p) => {
      if (p <= 20) fpScoreBuckets[0].count++;
      else if (p <= 40) fpScoreBuckets[1].count++;
      else if (p <= 60) fpScoreBuckets[2].count++;
      else if (p <= 80) fpScoreBuckets[3].count++;
      else fpScoreBuckets[4].count++;
    });

    // Provincial & Batch stats for Full Paper
    const fpProvinceMap = new Map<string, { name: string; count: number; totalPct: number; passCount: number }>();
    PROVINCES.forEach((p) => fpProvinceMap.set(p.id, { name: p.nameSi, count: 0, totalPct: 0, passCount: 0 }));

    const fpBatchMap = new Map<string, { count: number; totalPct: number; passCount: number }>();

    fullPaperRankingsList.forEach((r) => {
      const p = fpProvinceMap.get(r.provinceId);
      if (p) {
        p.count += 1;
        p.totalPct += r.percentage;
        if (r.percentage >= 35) p.passCount += 1;
      }

      const sId = (r.studentId?._id || r.studentId?.id || r.studentId || '').toString();
      const prof = profileMap.get(sId);
      const bKey = prof?.alYear || 'General';
      if (!fpBatchMap.has(bKey)) {
        fpBatchMap.set(bKey, { count: 0, totalPct: 0, passCount: 0 });
      }
      const b = fpBatchMap.get(bKey)!;
      b.count += 1;
      b.totalPct += r.percentage;
      if (r.percentage >= 35) b.passCount += 1;
    });

    const fpProvinceStats = Array.from(fpProvinceMap.values())
      .filter((p) => p.count > 0)
      .map((p) => ({
        provinceName: p.name,
        participantCount: p.count,
        averageScore: Math.round(p.totalPct / p.count),
        passRate: Math.round((p.passCount / p.count) * 100),
      }));

    const fpBatchStats = Array.from(fpBatchMap.entries()).map(([batchName, b]) => ({
      batchName,
      participantCount: b.count,
      averageScore: Math.round(b.totalPct / b.count),
      passRate: Math.round((b.passCount / b.count) * 100),
    }));

    // MCQ vs Essay comparison
    const mcqScoresForFp = fullPaperRankingsList.map((r) => r.mcqScore);
    const essayScoresForFp = fullPaperRankingsList.map((r) => r.essayScore);
    const avgFpMcqScore = fpTotal > 0 ? Math.round((mcqScoresForFp.reduce((a, b) => a + b, 0) / fpTotal) * 10) / 10 : 0;
    const avgFpEssayScore = fpTotal > 0 ? Math.round((essayScoresForFp.reduce((a, b) => a + b, 0) / fpTotal) * 10) / 10 : 0;
    const avgFpMcqPct = quiz.totalMarks > 0 ? Math.round((avgFpMcqScore / quiz.totalMarks) * 100) : 0;
    const avgFpEssayPct = essayTotalMarks > 0 ? Math.round((avgFpEssayScore / essayTotalMarks) * 100) : 0;

    fullPaperStats = {
      isCalculated: Boolean(quiz.isFullPaperRankingsCalculated),
      totalParticipants: fpTotal,
      totalMarks: fpTotalMarks,
      averageScore: fpAvgScore,
      averagePercentage: fpAvgPct,
      medianPercentage: fpMedianPct,
      highestScore: fpHighestScore,
      highestPercentage: fpHighestPct,
      lowestScore: fpLowestScore,
      lowestPercentage: fpLowestPct,
      passRate: fpPassRate,
      passCount: fpPassCount,
      distinctionCount: fpA,
      gradeBreakdown: fpGradeBreakdown,
      scoreBuckets: fpScoreBuckets,
      provinceStats: fpProvinceStats,
      batchStats: fpBatchStats,
      markComparison: {
        mcqTotalMarks: quiz.totalMarks,
        essayTotalMarks,
        mcqAverageScore: avgFpMcqScore,
        mcqAveragePercentage: avgFpMcqPct,
        essayAverageScore: avgFpEssayScore,
        essayAveragePercentage: avgFpEssayPct,
        mcqWeightPercentage: fpTotalMarks > 0 ? Math.round((quiz.totalMarks / fpTotalMarks) * 100) : 50,
        essayWeightPercentage: fpTotalMarks > 0 ? Math.round((essayTotalMarks / fpTotalMarks) * 100) : 50,
      },
    };
  }

  return {
    quiz,
    isMcqEnded,
    isQuizEnded,
    rankPublished: isMcqEnded,
    mcqFinalEndTime: mcqFinalEndTime ? mcqFinalEndTime.toISOString() : null,
    finalEndTime: finalEndTime ? finalEndTime.toISOString() : null,
    scheduledSriLankanEndTime,
    mcqScheduledSriLankanEndTime,
    hasEssay: hasEssayQuiz,
    summary: {
      totalParticipants,
      averageScore,
      medianScore,
      highestScore,
      highestPercentage,
      lowestScore,
      lowestPercentage,
      totalMarks: quiz.totalMarks,
      passRate,
      passCount,
      distinctionCount: gradeA,
      avgTimeSeconds,
      minTimeSeconds,
      maxTimeSeconds,
    },
    scoreBuckets,
    gradeBreakdown,
    batchStats,
    provinceStats,
    questionStats,
    hardestQuestion,
    easiestQuestion,
    rankings,
    essayStats,
    fullPaperStats,
    fullPaperRankings: fullPaperRankingsList,
  };
}

export async function getQuizAnalyticsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = String(req.params.id);
    const analytics = await computeQuizAnalyticsData(quizId);
    res.json({
      success: true,
      data: analytics,
    });
  } catch (err) {
    next(err);
  }
}

export async function downloadQuizReportPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = String(req.params.quizId);
    const analytics = await computeQuizAnalyticsData(quizId);
    const {
      quiz,
      summary,
      scoreBuckets,
      gradeBreakdown,
      batchStats,
      provinceStats,
      questionStats,
      hardestQuestion,
      easiestQuestion,
      rankings,
      essayStats,
      fullPaperStats,
      fullPaperRankings,
      isMcqEnded,
      isQuizEnded,
      scheduledSriLankanEndTime,
    } = analytics;

    const reportData: QuizReportData = {
      quizTitle: quiz.title,
      quizNumber: quiz.quizNumber || 1,
      subjectName: (quiz.subjectId as any)?.nameEn || (quiz.subjectId as any)?.nameSi || 'General',
      targetCategory: quiz.targetCategory || 'ALL',
      durationMinutes: quiz.durationMinutes || 0,
      totalQuestions: (quiz.questions || []).length,
      totalMarks: quiz.totalMarks || summary.totalMarks || 100,
      dateStr: new Date(quiz.date || quiz.createdAt).toLocaleDateString('en-US'),
      generatedDateStr: `${new Date().toLocaleDateString('en-US')} ${new Date().toLocaleTimeString('en-US')}`,
      status: quiz.status,
      isQuizEnded,
      isMcqEnded,
      scheduledSriLankanEndTime,

      totalRegistered: summary.totalParticipants,
      totalParticipants: summary.totalParticipants,
      completedAttempts: summary.totalParticipants,
      completionRate: 100,
      averageScore: summary.averageScore,
      medianScore: summary.medianScore,
      highestScore: summary.highestScore,
      highestPercentage: summary.highestPercentage,
      lowestScore: summary.lowestScore,
      lowestPercentage: summary.lowestPercentage,
      passRate: summary.passRate,
      passCount: summary.passCount,
      distinctionRate: summary.totalParticipants > 0 ? Math.round((summary.distinctionCount / summary.totalParticipants) * 100) : 0,
      distinctionCount: summary.distinctionCount,

      avgTimeSeconds: summary.avgTimeSeconds,
      minTimeSeconds: summary.minTimeSeconds,
      maxTimeSeconds: summary.maxTimeSeconds,

      gradeBreakdown,
      scoreBuckets,
      batchStats,
      provinceStats,
      questionStats,
      hardestQuestion,
      easiestQuestion,

      hasEssay: Boolean(quiz.hasEssay || quiz.essayQuestionPaperFileId),
      essayStats,
      fullPaperStats,

      topRankers: (rankings || []).slice(0, 20).map((r: any) => ({
        rank: r.rank != null ? r.rank : null,
        fullName: r.fullName || '-',
        school: r.school || '-',
        districtName: r.districtName || '-',
        provinceName: r.provinceName || '-',
        score: Number(r.score) || 0,
        percentage: Number(r.percentage) || 0,
        timeTakenStr: `${Math.floor((Number(r.timeTakenSeconds) || 0) / 60)}m ${(Number(r.timeTakenSeconds) || 0) % 60}s`,
      })),

      fullPaperTopRankers: (fullPaperRankings || []).slice(0, 20).map((r: any) => ({
        rank: r.islandRank != null ? r.islandRank : null,
        fullName: r.fullName || '-',
        school: r.school || '-',
        districtName: r.districtId || '-',
        mcqScore: Number(r.mcqScore) || 0,
        essayScore: Number(r.essayScore) || 0,
        totalScore: Number(r.totalScore) || 0,
        totalMarks: Number(r.totalMarks) || 0,
        percentage: Number(r.percentage) || 0,
        timeTakenStr: `${Math.floor((Number(r.timeTakenSeconds) || 0) / 60)}m ${(Number(r.timeTakenSeconds) || 0) % 60}s`,
      })),
    };

    const pdfBuffer = await generateQuizReportPdf(reportData);

    const safeFilename = `Quiz_${quiz.quizNumber || 1}_Analytics_Report.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function downloadMonthlyReportPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const year = parseInt(req.params.year as string, 10) || new Date().getFullYear();
    const month = parseInt(req.params.month as string, 10) || new Date().getMonth() + 1;

    const totalQuizzes = await Quiz.countDocuments();
    const results = await QuizResult.find();
    const totalParticipants = results.length;
    const averagePercentage = totalParticipants > 0 ? results.reduce((a, b) => a + b.percentage, 0) / totalParticipants : 0;

    const monthlyData: MonthlyReportData = {
      title: `Monthly Examination Report ${year}/${month}`,
      year,
      month,
      totalQuizzes,
      totalParticipants,
      totalAttempts: totalParticipants,
      averagePercentage,
      topStudents: [],
      subjectBreakdown: [
        { subjectName: 'General Science', quizCount: totalQuizzes, averagePercentage },
      ],
    };

    const pdfBuffer = await generateMonthlyReportPdf(monthlyData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Monthly_Report_${year}_${month}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function getAdminProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const adminProfile = await AdminProfile.findOne({ userId });
    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(404, 'Admin user account not found.', 'NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        id: user._id,
        name: adminProfile?.name || 'Administrator',
        username: user.username,
        role: adminProfile?.role || 'SUPER_ADMIN',
        accountStatus: adminProfile?.accountStatus || 'ACTIVE',
        lastLogin: adminProfile?.lastLogin,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateAdminProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { name, username, currentPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'Admin user not found.', 'NOT_FOUND');
    }

    let adminProfile = await AdminProfile.findOne({ userId });
    if (!adminProfile) {
      adminProfile = await AdminProfile.create({
        userId: user._id,
        name: name || user.username,
        username: user.username,
        role: 'SUPER_ADMIN',
      });
    }
    if (!adminProfile) {
      throw new ApiError(500, 'Admin profile not found', 'ADMIN_PROFILE_NOT_FOUND');
    }

    if (name) {
      adminProfile.name = name.trim();
    }

    if (username) {
      const cleanUsername = username.trim().toLowerCase();
      const existing = await User.findOne({ username: cleanUsername, _id: { $ne: userId } });
      if (existing) {
        throw new ApiError(400, 'This username/email is already in use by another account.', 'USERNAME_EXISTS');
      }
      user.username = cleanUsername;
      adminProfile.username = cleanUsername;
    }

    if (currentPassword && newPassword) {
      if (newPassword.length < 6) {
        throw new ApiError(400, 'New password must be at least 6 characters long.', 'PASSWORD_TOO_SHORT');
      }
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        throw new ApiError(400, 'Current password is incorrect.', 'INCORRECT_PASSWORD');
      }
      user.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    await adminProfile.save();

    res.json({
      success: true,
      message: 'Admin profile updated successfully.',
      data: {
        name: adminProfile.name,
        username: user.username,
      },
    });
  } catch (err) {
    next(err);
  }
}

import { runMonthlyStudentDataCleanup } from '../jobs/cleanupJob.js';

export async function getStorageInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextCleanupStr = nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const [
      studentAccounts,
      totalQuizzes,
      currentMonthAttempts,
      previousMonthAttempts,
      currentMonthAnswers,
      previousMonthAnswers,
    ] = await Promise.all([
      StudentProfile.countDocuments(),
      Quiz.countDocuments(),
      QuizAttempt.countDocuments({ createdAt: { $gte: startOfCurrentMonth } }),
      QuizAttempt.countDocuments({ createdAt: { $lt: startOfCurrentMonth } }),
      StudentAnswer.countDocuments({ createdAt: { $gte: startOfCurrentMonth } }),
      StudentAnswer.countDocuments({ createdAt: { $lt: startOfCurrentMonth } }),
    ]);

    res.json({
      success: true,
      data: {
        storageLimitMb: 500,
        studentAccounts,
        totalQuizzes,
        currentMonthAttempts,
        previousMonthAttempts,
        currentMonthAnswers,
        previousMonthAnswers,
        nextCleanupDate: `1st of ${nextCleanupStr}`,
        policy: 'Student accounts are permanently preserved. Previous month student quiz attempts, answers, and monthly analysis are automatically erased on the 1st of each month to keep within MongoDB Atlas 500MB free tier.',
        maxPdfSizeMb: env.MAX_PDF_SIZE_MB,
        geminiConfigured: !!env.GEMINI_API_KEY,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getPdfUploadConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      success: true,
      data: {
        maxPdfSizeMb: env.MAX_PDF_SIZE_MB,
        aiConfigured: !!env.GEMINI_API_KEY,
        limits: {
          adminUploadLimitMb: env.MAX_PDF_SIZE_MB,
          aiStandardTier: {
            maxPayloadMb: 20,
            requestsPerMinute: 15,
            requestsPerDay: 1500,
            recommendedPages: '1 - 30 pages per exam paper',
            notes: 'Standard AI API keys have 15 RPM and 1,500 RPD quotas.'
          },
          aiHighVolumeTier: {
            requestsPerMinute: '1000+',
            requestsPerDay: 'Unlimited pay-as-you-go',
            recommendedPages: 'Up to 50+ pages per exam paper',
            notes: 'High-volume AI accounts have higher throughput with no daily cap.'
          },
          rawTextImportAlternative: 'You can also paste raw question text directly without any PDF size restrictions.'
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function triggerManualCleanup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await runMonthlyStudentDataCleanup();
    res.json({
      success: true,
      message: 'Monthly cleanup executed successfully! Student accounts remain preserved.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminCategories(req: Request, res: Response, next: NextFunction) {
  try {
    await seedDefaultCategoriesIfEmpty();
    const categories = await Category.find().sort({ name: 1 }).lean();

    // Group student counts by alYear
    const studentCounts = await StudentProfile.aggregate([
      { $group: { _id: '$alYear', count: { $sum: 1 } } },
    ]);

    // Group quiz counts by targetCategory
    const quizCounts = await Quiz.aggregate([
      { $group: { _id: '$targetCategory', count: { $sum: 1 } } },
    ]);

    const sMap = new Map<string, number>();
    studentCounts.forEach((s) => {
      if (s._id) sMap.set(s._id.toString().toLowerCase().trim(), s.count);
    });

    const qMap = new Map<string, number>();
    let allQuizCount = 0;
    quizCounts.forEach((q) => {
      if (q._id) {
        const key = q._id.toString().toLowerCase().trim();
        qMap.set(key, q.count);
        if (key === 'all') {
          allQuizCount = q.count;
        }
      }
    });

    const enriched = categories.map((c: any) => {
      const key = (c.name || '').toLowerCase().trim();
      const normKey = (c.normalizedName || c.normalized_name || '').toLowerCase().trim();
      const cohortQuizCount = qMap.get(key) || qMap.get(normKey) || 0;
      return {
        ...c,
        _id: (c._id || c.id || '').toString(),
        id: (c.id || c._id || '').toString(),
        studentCount: sMap.get(key) || sMap.get(normKey) || 0,
        quizCount: cohortQuizCount + allQuizCount,
      };
    });

    res.json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
}

export async function createAdminCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ApiError(400, 'Category name is required', 'NAME_REQUIRED');
    }

    const formatted = formatCategoryName(name);
    const normalized = formatted.toLowerCase();

    const existing = await Category.findOne({ normalizedName: normalized });
    if (existing) {
      throw new ApiError(400, `Category "${formatted}" already exists`, 'CATEGORY_EXISTS');
    }

    const category = await Category.create({
      name: formatted,
      normalizedName: normalized,
      description: (description || '').trim(),
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: `Category "${formatted}" created successfully`,
      data: category,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const cat = await Category.findById(id);
    if (!cat) {
      throw new ApiError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
    }

    const catName = cat.name.trim();
    const catNorm = cat.normalizedName.trim();

    // 1. Find all student profiles belonging to this batch / category
    const studentProfiles = await StudentProfile.find({
      $or: [
        { alYear: catName },
        { alYear: catNorm },
        { alYear: { $regex: new RegExp(`^${catName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      ],
    }).select('userId');

    const userIds = studentProfiles.map((p) => p.userId).filter(Boolean);

    let deletedUsersCount = 0;
    let deletedResultsCount = 0;
    let deletedAttemptsCount = 0;
    let deletedAnswersCount = 0;
    let deletedSubmissionsCount = 0;
    let deletedFilesCount = 0;

    if (userIds.length > 0) {
      // Find all essay submissions for these students to locate and purge any stored files
      const userSubmissions = await EssaySubmission.find({ studentId: { $in: userIds } }).select('fileId');
      const fileIds = userSubmissions.map((s) => s.fileId).filter(Boolean);

      // Delete answer files
      const fileRes = await EssayFile.deleteMany({
        $or: [
          { _id: { $in: fileIds } },
          { uploadedById: { $in: userIds } },
        ],
      });
      deletedFilesCount = fileRes.deletedCount || 0;

      // Delete essay submissions
      const subRes = await EssaySubmission.deleteMany({ studentId: { $in: userIds } });
      deletedSubmissionsCount = subRes.deletedCount || 0;

      // Delete raw student answers
      const ansRes = await StudentAnswer.deleteMany({ studentId: { $in: userIds } });
      deletedAnswersCount = ansRes.deletedCount || 0;

      // Delete quiz attempts
      const attRes = await QuizAttempt.deleteMany({ studentId: { $in: userIds } });
      deletedAttemptsCount = attRes.deletedCount || 0;

      // Delete quiz results
      const resRes = await QuizResult.deleteMany({ studentId: { $in: userIds } });
      deletedResultsCount = resRes.deletedCount || 0;

      // Delete monthly statistics
      await MonthlyStudentStatistics.deleteMany({ studentId: { $in: userIds } });

      // Clean ranking snapshots by pulling these deleted students from ranking arrays
      await RankingSnapshot.updateMany(
        {},
        { $pull: { rankings: { studentId: { $in: userIds } } } }
      );
      await FullPaperRankingSnapshot.updateMany(
        {},
        { $pull: { rankings: { studentId: { $in: userIds } } } }
      );

      // Delete student profiles
      await StudentProfile.deleteMany({ userId: { $in: userIds } });

      // Delete user accounts
      const userRes = await User.deleteMany({ _id: { $in: userIds } });
      deletedUsersCount = userRes.deletedCount || 0;
    }

    // 2. Update any quizzes assigned specifically to this category so they remain open/accessible
    await Quiz.updateMany(
      {
        $or: [
          { targetCategory: catName },
          { targetCategory: catNorm },
          { targetCategory: { $regex: new RegExp(`^${catName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ],
      },
      { $set: { targetCategory: 'ALL' } }
    );

    // 3. Delete the category itself
    await Category.findByIdAndDelete(id);

    logger.info(`[CATEGORY_DELETE] Category "${catName}" purged along with ${deletedUsersCount} student accounts and all related records.`);

    res.json({
      success: true,
      message: `Category "${catName}" and all associated student accounts (${deletedUsersCount}), records, and marks successfully purged.`,
      data: {
        category: catName,
        deletedStudents: deletedUsersCount,
        deletedResults: deletedResultsCount,
        deletedAttempts: deletedAttemptsCount,
        deletedAnswers: deletedAnswersCount,
        deletedSubmissions: deletedSubmissionsCount,
        deletedFiles: deletedFilesCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminInstitutes(req: Request, res: Response, next: NextFunction) {
  try {
    await seedDefaultInstitutesIfEmpty();
    const institutes = await Institute.find().sort({ name: 1 }).lean();

    const studentCounts = await StudentProfile.aggregate([
      {
        $group: {
          _id: '$institute',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map<string, number>();
    studentCounts.forEach((sc) => {
      if (sc._id) {
        countMap.set(sc._id.toString().toLowerCase().trim(), sc.count);
      }
    });

    const enriched = institutes.map((inst: any) => {
      const key = (inst.name || '').toLowerCase().trim();
      const normKey = (inst.normalizedName || inst.normalized_name || '').toLowerCase().trim();
      const c = countMap.get(key) || countMap.get(normKey) || 0;
      return {
        ...inst,
        _id: (inst._id || inst.id || '').toString(),
        id: (inst.id || inst._id || '').toString(),
        studentCount: c,
      };
    });

    res.json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
}

export async function createAdminInstitute(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ApiError(400, 'Institute name is required', 'NAME_REQUIRED');
    }

    const formatted = formatInstituteName(name);
    const normalized = formatted.toLowerCase();

    const existing = await Institute.findOne({ normalizedName: normalized });
    if (existing) {
      throw new ApiError(400, `Institute "${formatted}" already exists`, 'INSTITUTE_EXISTS');
    }

    const institute = await Institute.create({
      name: formatted,
      normalizedName: normalized,
      description: (description || '').trim(),
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: `Institute "${formatted}" created successfully`,
      data: institute,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminInstitute(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const inst = await Institute.findById(id);
    if (!inst) {
      throw new ApiError(404, 'Institute not found', 'INSTITUTE_NOT_FOUND');
    }

    const instName = inst.name.trim();

    // Reassign any students with this institute to 'None' so their accounts remain intact
    await StudentProfile.updateMany(
      {
        $or: [
          { institute: instName },
          { institute: inst.normalizedName },
          { institute: { $regex: new RegExp(`^${instName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ],
      },
      { $set: { institute: 'None' } }
    );

    await Institute.findByIdAndDelete(id);

    res.json({
      success: true,
      message: `Institute "${instName}" removed successfully.`,
    });
  } catch (err) {
    next(err);
  }
}

export async function createAdminSubject(req: Request, res: Response, next: NextFunction) {
  try {
    const { nameSi, nameEn, code, description } = req.body;
    const cleanNameSi = (nameSi || '').trim();
    const cleanNameEn = (nameEn || cleanNameSi || '').trim();

    if (!cleanNameSi && !cleanNameEn) {
      throw new ApiError(400, 'Subject name is required', 'SUBJECT_NAME_REQUIRED');
    }

    // Check if subject with exact same name already exists
    const existing = await Subject.findOne({
      $or: [
        { nameSi: cleanNameSi },
        { nameEn: cleanNameEn },
        ...(cleanNameEn ? [{ nameSi: cleanNameEn }, { nameEn: cleanNameSi }] : []),
      ],
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        message: `Subject "${existing.nameEn || existing.nameSi}" already exists`,
        data: existing,
      });
    }

    // Generate safe unique code if not provided
    let uniqueCode = (code || '').trim().toUpperCase();
    if (!uniqueCode) {
      const rawBase = (cleanNameEn || cleanNameSi || 'SUB').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
      uniqueCode = rawBase.length >= 2 ? rawBase : 'SUB';
    }

    let candidateCode = uniqueCode;
    let counter = 1;
    while (await Subject.findOne({ code: candidateCode })) {
      candidateCode = `${uniqueCode}_${counter}`;
      counter++;
    }

    const newSubject = await Subject.create({
      nameSi: cleanNameSi || cleanNameEn,
      nameEn: cleanNameEn || cleanNameSi,
      code: candidateCode,
      description: (description || '').trim(),
    });

    memoryCache.delByPrefix('meta_');

    res.status(201).json({
      success: true,
      message: `Curriculum subject "${newSubject.nameEn || newSubject.nameSi}" created successfully`,
      data: newSubject,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminSubjects(req: Request, res: Response, next: NextFunction) {
  try {
    const subjects = await Subject.find().sort({ nameEn: 1, nameSi: 1 }).lean();
    res.json({ success: true, data: subjects });
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminSubject(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const subject = await Subject.findById(id);
    if (!subject) {
      throw new ApiError(404, 'Subject not found', 'SUBJECT_NOT_FOUND');
    }

    const quizCount = await Quiz.countDocuments({ subjectId: subject._id });
    if (quizCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete subject with ${quizCount} existing quizzes`,
        'SUBJECT_IN_USE'
      );
    }

    await Subject.findByIdAndDelete(id);
    memoryCache.delByPrefix('meta_');

    res.json({
      success: true,
      message: `Subject "${subject.nameEn || subject.nameSi}" deleted successfully`,
    });
  } catch (err) {
    next(err);
  }
}

export async function downloadRegisteredStudentsPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const category = (req.query.category || req.query.batch || req.query.alYear || '') as string;
    const institute = (req.query.institute || '') as string;
    const filter: any = {};
    if (category && category !== 'ALL') {
      const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.alYear = { $regex: `^${escaped}$`, $options: 'i' };
    }
    if (institute && institute !== 'ALL') {
      const escaped = institute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.institute = { $regex: `^${escaped}$`, $options: 'i' };
    }

    const profiles = await StudentProfile.find(filter)
      .sort({ alYear: 1, institute: 1, fullName: 1 })
      .lean();

    const pdfStudents: RegisteredStudentPdfItem[] = profiles.map((p) => {
      const district = DISTRICTS.find((d) => d.id === p.districtId);
      const province = PROVINCES.find((pr) => pr.id === p.provinceId);
      return {
        fullName: p.fullName || 'Student',
        school: p.school || '-',
        username: p.username || '-',
        email: p.email || '-',
        whatsappNumber: p.whatsappNumber || p.phoneNumber || '-',
        phoneNumber: p.phoneNumber || p.whatsappNumber || '-',
        alYear: p.alYear || 'General',
        institute: p.institute || 'None',
        districtName: district?.nameSi || p.districtId,
        provinceName: province?.nameSi || p.provinceId,
        createdAt: p.createdAt,
      };
    });

    const pdfBuffer = await generateRegisteredStudentsPdf(pdfStudents, {
      filterCategory: category,
      filterInstitute: institute,
    });

    const safeBatch = category && category !== 'ALL' ? `_${category.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const safeInstitute = institute && institute !== 'ALL' ? `_${institute.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=BS_Registered_Students${safeBatch}${safeInstitute}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function getRegisteredStudentsList(req: Request, res: Response, next: NextFunction) {
  try {
    const category = (req.query.category || req.query.batch || req.query.alYear || '') as string;
    const institute = (req.query.institute || '') as string;
    const search = ((req.query.search || '') as string).trim();
    const isExport = req.query.export === 'true' || req.query.limit === 'all' || req.query.limit === '0';
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = isExport
      ? 10000
      : Math.min(250, Math.max(10, parseInt((req.query.limit as string) || '50', 10)));
    const sortBy = ((req.query.sortBy as string) || 'createdAt').trim();
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1;

    const filter: any = {};
    if (category && category !== 'ALL') {
      const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.alYear = { $regex: `^${escaped}$`, $options: 'i' };
    }
    if (institute && institute !== 'ALL') {
      const escaped = institute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.institute = { $regex: `^${escaped}$`, $options: 'i' };
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { username: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { school: { $regex: escaped, $options: 'i' } },
        { phoneNumber: { $regex: escaped, $options: 'i' } },
        { whatsappNumber: { $regex: escaped, $options: 'i' } },
        { institute: { $regex: escaped, $options: 'i' } },
      ];
    }

    // Build sort object
    const sortObj: any = {};
    if (['fullName', 'username', 'school', 'alYear', 'institute', 'createdAt'].includes(sortBy)) {
      sortObj[sortBy] = sortOrder;
    } else {
      sortObj.createdAt = -1;
    }

    const [total, totalOverall, students] = await Promise.all([
      StudentProfile.countDocuments(filter),
      StudentProfile.estimatedDocumentCount(),
      StudentProfile.find(filter)
        .sort(sortObj)
        .skip(isExport ? 0 : (page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = isExport ? 1 : Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      data: {
        total,
        totalOverall,
        page: isExport ? 1 : page,
        limit: isExport ? total : limit,
        totalPages,
        students: students.map((s) => ({
          _id: s._id,
          userId: s.userId,
          fullName: s.fullName,
          school: s.school,
          username: s.username,
          email: s.email,
          whatsappNumber: s.whatsappNumber || s.phoneNumber || '-',
          phoneNumber: s.phoneNumber || '-',
          alYear: s.alYear || 'General',
          institute: s.institute || 'None',
          provinceId: s.provinceId,
          districtId: s.districtId,
          createdAt: s.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin direct password reset for any user or student without requiring their previous password.
 */
export async function resetUserPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, studentId, username, email, newPassword } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      throw new ApiError(400, 'New password must be at least 6 characters long.', 'INVALID_PASSWORD');
    }

    let targetUser: any = null;

    if (userId) {
      targetUser = await User.findById(userId);
    }

    if (!targetUser && studentId) {
      const profile = await StudentProfile.findById(studentId);
      if (profile?.userId) {
        targetUser = await User.findById(profile.userId);
      }
    }

    if (!targetUser && username) {
      const cleanUsername = username.trim().toLowerCase();
      targetUser = await User.findOne({ username: cleanUsername });
    }

    if (!targetUser && email) {
      const cleanEmail = email.trim().toLowerCase();
      targetUser = await User.findOne({ email: cleanEmail });
    }

    if (!targetUser) {
      throw new ApiError(404, 'User not found. Please verify the user ID, username, or email.', 'USER_NOT_FOUND');
    }

    // Hash and update the password directly without asking for old/previous password
    const passwordHash = await bcrypt.hash(newPassword.trim(), 10);
    targetUser.passwordHash = passwordHash;
    await targetUser.save();

    res.json({
      success: true,
      message: `Password for user "${targetUser.username}" was reset successfully.`,
      data: {
        userId: targetUser._id,
        username: targetUser.username,
        email: targetUser.email,
        role: targetUser.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function uploadQuestionImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      throw new ApiError(400, 'Please select an image file to upload', 'IMAGE_REQUIRED');
    }
    const adminId = req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined;
    const doc = await QuestionImage.create({
      filename: req.file.originalname || 'question-image.jpg',
      contentType: req.file.mimetype || 'image/jpeg',
      data: req.file.buffer,
      size: req.file.size,
      createdById: adminId,
    });

    const imageUrl = `/api/quizzes/images/${doc._id}`;
    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        id: doc._id,
        imageUrl,
        filename: doc.filename,
        size: doc.size,
        contentType: doc.contentType,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateAdminQuizNumber(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { quizNumber } = req.body;
    const parsedNumber = Number(quizNumber);

    if (!parsedNumber || isNaN(parsedNumber) || parsedNumber <= 0) {
      throw new ApiError(400, 'Please enter a valid positive quiz number', 'INVALID_QUIZ_NUMBER');
    }

    const quiz = await Quiz.findById(id);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
    }

    quiz.quizNumber = parsedNumber;
    await quiz.save();
    memoryCache.delByPrefix('quiz_');

    res.json({
      success: true,
      message: `Quiz number updated to #${parsedNumber} successfully`,
      data: {
        quizId: quiz._id,
        quizNumber: parsedNumber,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Trigger or re-send Top 100 SMS for a Quiz (Disabled)
 */
export async function triggerTop100SmsForQuiz(req: Request, res: Response, next: NextFunction) {
  res.json({
    success: true,
    message: 'Message sender is disabled on this platform.',
    data: { sentCount: 0, failedCount: 0, skippedCount: 0, totalCandidates: 0 },
  });
}

/**
 * Admin: Send a test SMS to verify Text.lk gateway integration (Disabled)
 */
export async function sendTestSms(req: Request, res: Response, next: NextFunction) {
  res.json({
    success: true,
    message: 'Message sender is disabled on this platform.',
    data: { status: 'disabled' },
  });
}

/**
 * Admin: Fetch Text.lk SMS account balance and expiration (Disabled)
 */
export async function getTextLkBalance(req: Request, res: Response, next: NextFunction) {
  res.json({
    success: true,
    data: { status: 'disabled', balance: 0, currency: 'LKR' },
  });
}



