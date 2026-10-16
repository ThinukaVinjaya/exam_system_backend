import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { Quiz } from '../models/Quiz.js';
import { EssayFile } from '../models/EssayFile.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { QuizResult } from '../models/QuizResult.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { User } from '../models/User.js';
import { MarkingPanelProfile } from '../models/MarkingPanelProfile.js';
import { calculateAndStoreFullPaperRankings } from '../rankings/fullPaperRankingService.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';
import { query } from '../config/pgPool.js';
import {
  analyzeEssayQuestionPaper,
  evaluateStudentEssayWithAi,
  generateTestQuestionPaperAnalysis,
  IEssayQuestionItem,
  IEssayQuestionPaperAnalysis,
} from '../ai/essayAiService.js';

/**
 * Admin: Upload or update essay question paper for a quiz
 * Automatically triggers AI analysis of the PDF to extract questions & question marks.
 */
export async function uploadEssayQuestionPaper(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params; // quizId
    const file = req.file;

    if (!file) {
      throw new ApiError(400, 'Please upload a question paper file (PDF or document).', 'FILE_REQUIRED');
    }

    const quiz = await Quiz.findById(id);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    // Save file in EssayFile
    const originalExt = path.extname(file.originalname) || '.pdf';
    const filename = `quiz_${quiz.quizNumber || quiz._id}_essay_question_paper${originalExt}`;

    const essayFile = await EssayFile.create({
      filename,
      originalName: file.originalname,
      contentType: file.mimetype || 'application/pdf',
      data: file.buffer,
      size: file.size,
      uploadedById: req.user?.userId,
      fileRole: 'QUESTION_PAPER',
      quizId: quiz._id,
    });

    // Update Quiz
    quiz.hasEssay = true;
    quiz.essayQuestionPaperFileId = essayFile._id as any;
    quiz.essayQuestionPaperFilename = file.originalname;

    if (req.body.essayTotalMarks) {
      quiz.essayTotalMarks = Number(req.body.essayTotalMarks);
    }
    if (req.body.essayStartTime) {
      quiz.essayStartTime = new Date(req.body.essayStartTime);
    }
    if (req.body.essayEndTime) {
      quiz.essayEndTime = new Date(req.body.essayEndTime);
    }
    if (req.body.essayDurationMinutes) {
      quiz.essayDurationMinutes = Number(req.body.essayDurationMinutes);
    }
    if (req.body.essayInstructions) {
      quiz.essayInstructions = req.body.essayInstructions;
    }

    // Automatically trigger AI question paper analysis for PDF files
    const isPdf =
      (file.mimetype || '').toLowerCase().includes('pdf') ||
      file.originalname.toLowerCase().endsWith('.pdf');

    let aiAnalyzed = false;
    if (isPdf) {
      try {
        quiz.essayAnalysisStatus = 'ANALYZING';
        await quiz.save();
        const analysis = await analyzeEssayQuestionPaper(file.buffer, file.mimetype || 'application/pdf', Number(req.body.essayTotalMarks) || quiz.essayTotalMarks || 100);
        if (analysis && Array.isArray(analysis.questions) && analysis.questions.length > 0) {
          quiz.essayQuestions = analysis.questions;
          quiz.essayAnalysisStatus = 'COMPLETED';
          if (!req.body.essayTotalMarks || Number(req.body.essayTotalMarks) === 0) {
            quiz.essayTotalMarks = analysis.totalMarks;
          }
          aiAnalyzed = true;
          logger.info(
            `[EssayUpload] AI analyzed ${analysis.questions.length} questions for Quiz ${quiz.quizNumber || quiz._id} (Total Marks: ${quiz.essayTotalMarks})`
          );
        } else {
          quiz.essayAnalysisStatus = 'IDLE';
        }
      } catch (aiErr: any) {
        logger.warn(`[EssayUpload] AI question paper analysis deferred/failed: ${aiErr.message}`);
        quiz.essayAnalysisStatus = 'FAILED';
      }
    }

    await quiz.save();

    res.json({
      success: true,
      message: aiAnalyzed
        ? `Essay question paper uploaded and ${quiz.essayQuestions?.length || 0} questions successfully analyzed by AI!`
        : 'Essay question paper uploaded successfully.',
      data: {
        fileId: essayFile._id,
        filename: file.originalname,
        hasEssay: quiz.hasEssay,
        essayTotalMarks: quiz.essayTotalMarks,
        essayStartTime: quiz.essayStartTime,
        essayEndTime: quiz.essayEndTime,
        essayQuestions: quiz.essayQuestions || [],
        essayAnalysisStatus: quiz.essayAnalysisStatus,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin & Panel: Re-analyze or extract questions from an already uploaded essay question paper PDF
 */
export async function analyzeQuizEssayPaper(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = req.params.id || req.params.quizId;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    let essayFile = quiz.essayQuestionPaperFileId ? await EssayFile.findById(quiz.essayQuestionPaperFileId) : null;
    if (!essayFile) {
      essayFile = await EssayFile.findOne({ quizId: quiz._id, fileRole: 'QUESTION_PAPER' }).sort({ createdAt: -1 });
    }

    quiz.essayAnalysisStatus = 'ANALYZING';
    await quiz.save();

    let analysis: IEssayQuestionPaperAnalysis;
    if (essayFile && essayFile.data) {
      analysis = await analyzeEssayQuestionPaper(essayFile.data, essayFile.contentType || 'application/pdf', quiz.essayTotalMarks || 100);
    } else {
      analysis = generateTestQuestionPaperAnalysis(quiz.title || 'General Essay Paper', quiz.essayTotalMarks || 100);
    }

    if (!analysis || !analysis.questions || analysis.questions.length === 0) {
      quiz.essayAnalysisStatus = 'FAILED';
      await quiz.save();
      throw new ApiError(500, 'AI was unable to extract questions from this document.', 'ANALYSIS_FAILED');
    }

    quiz.essayQuestions = analysis.questions;
    quiz.essayAnalysisStatus = 'COMPLETED';
    if (!quiz.essayTotalMarks || quiz.essayTotalMarks === 0) {
      quiz.essayTotalMarks = analysis.totalMarks;
    }
    await quiz.save();

    res.json({
      success: true,
      message: `Successfully analyzed ${analysis.questions.length} questions and allocated total marks (${analysis.totalMarks}) using ${analysis.modelUsed || 'AI'}.`,
      data: {
        essayQuestions: quiz.essayQuestions,
        essayTotalMarks: quiz.essayTotalMarks,
        essayAnalysisStatus: quiz.essayAnalysisStatus,
        modelUsed: analysis.modelUsed,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Update/Edit essay questions structure and marks manually
 */
export async function updateQuizEssayQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const targetId = req.params.id || req.params.quizId;
    const { questions, essayTotalMarks } = req.body;

    const quiz = await Quiz.findById(targetId);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    if (Array.isArray(questions)) {
      quiz.essayQuestions = questions;
      quiz.essayAnalysisStatus = 'COMPLETED';
    }
    if (typeof essayTotalMarks === 'number' && essayTotalMarks > 0) {
      quiz.essayTotalMarks = essayTotalMarks;
    } else if (!quiz.essayTotalMarks || quiz.essayTotalMarks === 0) {
      quiz.essayTotalMarks = 100;
    }

    await quiz.save();

    res.json({
      success: true,
      message: 'Essay questions updated successfully.',
      data: {
        essayQuestions: quiz.essayQuestions,
        essayTotalMarks: quiz.essayTotalMarks,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: AI analyzes student answer paper against questions and suggests marks
 */
export async function aiSuggestStudentEssayMarks(req: Request, res: Response, next: NextFunction) {
  try {
    const { submissionId } = req.params;
    const submission = await EssaySubmission.findById(submissionId);
    if (!submission) {
      throw new ApiError(404, 'Submission not found.', 'NOT_FOUND');
    }

    const quiz = await Quiz.findById(submission.quizId);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    // Get student's answer file
    let studentFile = submission.fileId ? await EssayFile.findById(submission.fileId) : null;
    if (!studentFile) {
      studentFile = await EssayFile.findOne({
        quizId: submission.quizId,
        uploadedById: submission.studentId,
        fileRole: 'STUDENT_ANSWER',
      }).sort({ createdAt: -1 });
    }

    if (!studentFile || !studentFile.data) {
      throw new ApiError(404, 'Student answer file not found for AI evaluation.', 'FILE_NOT_FOUND');
    }

    // Ensure we have question rubric
    let questions = quiz.essayQuestions;
    if (!questions || questions.length === 0) {
      // Try extracting questions from question paper
      let qpFile = quiz.essayQuestionPaperFileId ? await EssayFile.findById(quiz.essayQuestionPaperFileId) : null;
      if (!qpFile) {
        qpFile = await EssayFile.findOne({ quizId: quiz._id, fileRole: 'QUESTION_PAPER' }).sort({ createdAt: -1 });
      }

      if (qpFile && qpFile.data) {
        try {
          const analysis = await analyzeEssayQuestionPaper(qpFile.data, qpFile.contentType || 'application/pdf', quiz.essayTotalMarks || 100);
          if (analysis && analysis.questions && analysis.questions.length > 0) {
            quiz.essayQuestions = analysis.questions;
            quiz.essayAnalysisStatus = 'COMPLETED';
            if (!quiz.essayTotalMarks) quiz.essayTotalMarks = analysis.totalMarks;
            await quiz.save();
            questions = analysis.questions;
          }
        } catch (e: any) {
          logger.warn(`[AiSuggest] On-the-fly question analysis failed: ${e.message}`);
        }
      }

      // If still no questions, generate structured question & mark allocation
      if (!questions || questions.length === 0) {
        const generated = generateTestQuestionPaperAnalysis(quiz.title || 'General Essay Paper', quiz.essayTotalMarks || 100);
        questions = generated.questions;
        quiz.essayQuestions = questions;
        quiz.essayAnalysisStatus = 'COMPLETED';
        if (!quiz.essayTotalMarks) quiz.essayTotalMarks = generated.totalMarks;
        await quiz.save();
      }
    }

    logger.info(
      `[AiSuggest] Starting AI evaluation for student ${submission.studentUsername} on Quiz ${quiz.quizNumber || quiz._id}...`
    );

    const evaluation = await evaluateStudentEssayWithAi(
      studentFile.data,
      studentFile.contentType || 'application/pdf',
      questions,
      submission.fileName || 'student_answer.pdf'
    );

    // Save AI evaluation to submission
    submission.aiEvaluation = evaluation;
    await submission.save();

    res.json({
      success: true,
      message: `AI suggested ${evaluation.totalSuggestedMarks}/${quiz.essayTotalMarks || 100} marks using ${evaluation.modelUsed}.`,
      data: {
        aiEvaluation: evaluation,
        totalSuggestedMarks: evaluation.totalSuggestedMarks,
        overallFeedback: evaluation.overallFeedback,
        evaluations: evaluation.evaluations,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Public or Authenticated: Download or view Essay Question Paper
 */
export async function getEssayQuestionPaper(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id || ''); // quizId or resultId

    let quiz = id ? await Quiz.findById(id) : null;
    if (!quiz && id) {
      const resDoc = await QuizResult.findById(id);
      if (resDoc && resDoc.quizId) {
        quiz = await Quiz.findById(resDoc.quizId);
      }
    }

    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    let essayFile = quiz.essayQuestionPaperFileId ? await EssayFile.findById(quiz.essayQuestionPaperFileId) : null;
    if (!essayFile) {
      essayFile = await EssayFile.findOne({ quizId: quiz._id, fileRole: 'QUESTION_PAPER' }).sort({ createdAt: -1 });
      if (essayFile && !quiz.essayQuestionPaperFileId) {
        quiz.essayQuestionPaperFileId = essayFile._id as any;
        quiz.hasEssay = true;
        await quiz.save();
      }
    }

    if (!essayFile) {
      throw new ApiError(404, 'Essay question paper file not found for this examination.', 'NOT_FOUND');
    }

    const downloadName = `Quiz_${quiz.quizNumber || 1}_Essay_Question_Paper${path.extname(essayFile.originalName) || '.pdf'}`;
    const isDownload = req.query.download === 'true' || req.query.download === '1';
    const dispositionType = isDownload ? 'attachment' : 'inline';

    // Allow in-browser PDF viewing in iframes, blobs, and new tabs
    res.removeHeader('X-Frame-Options');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', essayFile.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${downloadName}"`);
    // Note: Do NOT set manual Content-Length because compression middleware gzips the response stream
    res.status(200).send(essayFile.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Student: Get essay status & info for a quiz
 */
export async function getEssayInfoForStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id || ''); // quizId or resultId
    const studentId = req.user?.userId;

    let quiz = id ? await Quiz.findById(id) : null;
    if (!quiz && id) {
      const resDoc = await QuizResult.findById(id);
      if (resDoc && resDoc.quizId) {
        quiz = await Quiz.findById(resDoc.quizId);
      }
    }

    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    let hasQuestionPaper = Boolean(quiz.essayQuestionPaperFileId);
    if (!hasQuestionPaper) {
      const existingFile = await EssayFile.findOne({ quizId: quiz._id, fileRole: 'QUESTION_PAPER' });
      if (existingFile) {
        hasQuestionPaper = true;
        quiz.essayQuestionPaperFileId = existingFile._id as any;
        quiz.essayQuestionPaperFilename = existingFile.originalName;
        if (!quiz.hasEssay) quiz.hasEssay = true;
        await quiz.save();
      }
    }

    if (!quiz.hasEssay && !hasQuestionPaper) {
      return res.json({
        success: true,
        data: {
          hasEssay: false,
        },
      });
    }

    const now = new Date();
    const startTime = quiz.essayStartTime || quiz.startTime;
    const durationMins = quiz.essayDurationMinutes || 120;
    const endTime = quiz.essayEndTime || (quiz.endTime ? new Date(new Date(quiz.endTime).getTime() + durationMins * 60 * 1000) : null);

    const isRankingsCalculated = Boolean(quiz.isFullPaperRankingsCalculated);
    const isDeadlinePassed = Boolean(endTime && now.getTime() >= new Date(endTime).getTime());
    const isUpcoming = Boolean(startTime && now.getTime() < new Date(startTime).getTime());
    const isEnded = isRankingsCalculated || isDeadlinePassed;
    const isOpen = !isEnded && !isUpcoming;

    let submission: any = null;
    if (studentId) {
      submission = await EssaySubmission.findOne({
        quizId: quiz._id,
        studentId: studentId.toString(),
      }).lean();
    }

    res.json({
      success: true,
      data: {
        hasEssay: true,
        quizId: quiz._id,
        quizNumber: quiz.quizNumber,
        quizTitle: quiz.title,
        essayTotalMarks: quiz.essayTotalMarks || 0,
        essayStartTime: startTime,
        essayEndTime: endTime,
        essayDurationMinutes: durationMins,
        essayInstructions: quiz.essayInstructions,
        isUpcoming,
        isOpen,
        isEnded,
        isDeadlinePassed,
        hasQuestionPaper,
        questionPaperFilename: quiz.essayQuestionPaperFilename,
        hasSubmitted: !!submission,
        submission: submission
          ? {
              id: submission._id,
              fileName: submission.fileName,
              fileSize: submission.fileSize,
              submittedAt: submission.submittedAt,
              isMarked: submission.isMarked,
              // Only reveal marks if marked and quiz ranking calculated or marked
              marksAwarded: submission.isMarked ? submission.marksAwarded : null,
              feedback: submission.isMarked ? submission.feedback : null,
              questionMarks: submission.isMarked ? submission.questionMarks : null,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Student: Submit essay answer sheet
 * Rule: automatically save this file using the student username
 */
export async function submitStudentEssay(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params; // quizId
    const studentId = req.user?.userId;
    const file = req.file;

    if (!studentId) {
      throw new ApiError(401, 'Student authentication required.', 'UNAUTHORIZED');
    }

    if (!file) {
      throw new ApiError(400, 'Please select your essay answer file to upload (PDF or document).', 'FILE_REQUIRED');
    }

    const quiz = await Quiz.findById(id);
    if (!quiz || !quiz.hasEssay) {
      throw new ApiError(404, 'This examination does not have an essay paper.', 'ESSAY_NOT_FOUND');
    }

    // Check if full paper rankings are already finalized and published
    if (quiz.isFullPaperRankingsCalculated) {
      throw new ApiError(
        400,
        'Full paper rankings have already been calculated and published. Submissions are closed.',
        'RANKINGS_ALREADY_PUBLISHED'
      );
    }

    // Check if essay submission deadline has reached / expired
    const now = new Date();
    const durationMins = quiz.essayDurationMinutes || 120;
    const essayDeadline = quiz.essayEndTime
      ? new Date(quiz.essayEndTime)
      : quiz.endTime
      ? new Date(new Date(quiz.endTime).getTime() + durationMins * 60 * 1000)
      : null;

    if (essayDeadline && now.getTime() >= essayDeadline.getTime()) {
      throw new ApiError(
        400,
        'The submission deadline for this essay paper has expired. Submissions are closed.',
        'ESSAY_DEADLINE_EXPIRED'
      );
    }

    const studentUser = await User.findById(studentId);
    if (!studentUser) {
      throw new ApiError(404, 'Student account not found.', 'USER_NOT_FOUND');
    }

    const studentProfile = await StudentProfile.findOne({ userId: studentId });

    // Check if student has already been marked by the marking panel
    const existingSubmission = await EssaySubmission.findOne({
      quizId: quiz._id,
      studentId: studentUser._id,
    });
    if (existingSubmission && existingSubmission.isMarked) {
      throw new ApiError(
        400,
        'Your answer sheet has already been evaluated by the marking panel and cannot be changed.',
        'ALREADY_MARKED'
      );
    }

    // Name file automatically using student username:
    // e.g. `${username}_quiz#${quizNumber}_essay.pdf`
    const originalExt = path.extname(file.originalname) || '.pdf';
    const autoFileName = `${studentUser.username}_quiz#${quiz.quizNumber || 1}_essay${originalExt}`;

    // Store in EssayFile
    const essayFile = await EssayFile.create({
      filename: autoFileName,
      originalName: file.originalname,
      contentType: file.mimetype || 'application/pdf',
      data: file.buffer,
      size: file.size,
      uploadedById: studentUser._id,
      fileRole: 'STUDENT_ANSWER',
      quizId: quiz._id,
    });

    // Save or update EssaySubmission
    const submission = await EssaySubmission.findOneAndUpdate(
      { quizId: quiz._id, studentId: studentUser._id },
      {
        quizId: quiz._id,
        studentId: studentUser._id,
        studentUsername: studentUser.username,
        studentFullName: studentProfile?.fullName || studentUser.username,
        studentSchool: studentProfile?.school || '',
        studentProvinceId: studentProfile?.provinceId || '',
        studentDistrictId: studentProfile?.districtId || '',
        fileId: essayFile._id,
        fileName: autoFileName,
        contentType: file.mimetype || 'application/pdf',
        fileSize: file.size,
        submittedAt: new Date(),
        maxMarks: quiz.essayTotalMarks || 100,
        isMarked: false,
      },
      { upsert: true, new: true }
    );

    if (!submission) {
      throw new ApiError(500, 'Failed to save essay submission', 'SUBMISSION_FAILED');
    }

    // Update QuizResult if exists
    await QuizResult.findOneAndUpdate(
      { quizId: quiz._id, studentId: studentUser._id },
      {
        hasEssaySubmission: true,
        essayAttended: true,
        essayTotalMarks: quiz.essayTotalMarks || 100,
        isEssayMarked: false,
      }
    );

    logger.info(
      `[ESSAY_SUBMIT] Student ${studentUser.username} submitted essay for Quiz ${quiz.quizNumber || quiz._id} (${autoFileName})`
    );

    res.status(201).json({
      success: true,
      message: 'Essay answer uploaded successfully!',
      data: {
        submissionId: submission._id,
        fileName: autoFileName,
        submittedAt: submission.submittedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: List quizzes that have essays to mark
 */
export async function getPanelQuizzes(req: Request, res: Response, next: NextFunction) {
  try {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - ONE_WEEK_MS);

    // Active quizzes for markers:
    // Automatically delete/hide marker exam card 1 week (7 days) after generating rankings
    const quizzes = await Quiz.find({
      hasEssay: true,
      isMarkerExamCardArchived: { $ne: true },
      $or: [
        { isFullPaperRankingsCalculated: { $ne: true } },
        { fullPaperRankingsCalculatedAt: { $exists: false } },
        { fullPaperRankingsCalculatedAt: { $gt: oneWeekAgo } },
      ],
    })
      .populate('subjectId', 'nameEn nameSi code')
      .sort({ quizNumber: -1, createdAt: -1 })
      .lean();

    const quizIds = quizzes.map((q) => q._id);

    // Aggregate submission stats per quiz
    const submissionStats = await EssaySubmission.aggregate([
      { $match: { quizId: { $in: quizIds } } },
      {
        $group: {
          _id: '$quizId',
          totalCount: { $sum: 1 },
          markedCount: {
            $sum: { $cond: [{ $eq: ['$isMarked', true] }, 1, 0] },
          },
        },
      },
    ]);

    const statsMap = new Map<string, { totalCount: number; markedCount: number }>();
    submissionStats.forEach((s) => {
      statsMap.set(s._id.toString(), {
        totalCount: s.totalCount,
        markedCount: s.markedCount,
      });
    });

    const result = quizzes.map((q) => {
      const stats = statsMap.get(q._id.toString()) || { totalCount: 0, markedCount: 0 };
      let daysRemaining: number | null = null;
      if (q.isFullPaperRankingsCalculated && q.fullPaperRankingsCalculatedAt) {
        const expiresAt = new Date(new Date(q.fullPaperRankingsCalculatedAt).getTime() + ONE_WEEK_MS);
        const diffMs = expiresAt.getTime() - now.getTime();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }

      return {
        _id: q._id,
        quizNumber: q.quizNumber,
        title: q.title,
        subject: q.subjectId,
        date: q.date,
        essayTotalMarks: q.essayTotalMarks || 100,
        essayStartTime: q.essayStartTime || q.endTime,
        essayEndTime: q.essayEndTime,
        hasQuestionPaper: !!q.essayQuestionPaperFileId,
        questionPaperFilename: q.essayQuestionPaperFilename,
        totalSubmissions: stats.totalCount,
        markedCount: stats.markedCount,
        pendingCount: stats.totalCount - stats.markedCount,
        isFullPaperRankingsCalculated: !!q.isFullPaperRankingsCalculated,
        fullPaperRankingsCalculatedAt: q.fullPaperRankingsCalculatedAt,
        daysRemaining,
      };
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: List student submissions for a specific quiz
 */
export async function getPanelQuizSubmissions(req: Request, res: Response, next: NextFunction) {
  try {
    const { quizId } = req.params;

    const quiz = await Quiz.findById(quizId).populate('subjectId', 'nameEn nameSi code');
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    const submissions = await EssaySubmission.find({ quizId })
      .sort({ isMarked: 1, submittedAt: 1 })
      .lean();

    // Check MCQ scores from QuizResult to show side-by-side
    const studentIds = submissions.map((s) => s.studentId);
    const quizResults = await QuizResult.find({
      quizId,
      studentId: { $in: studentIds },
    }).lean();

    const mcqResultMap = new Map<string, any>();
    quizResults.forEach((r) => mcqResultMap.set(r.studentId.toString(), r));

    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const formattedSubmissions = submissions.map((s) => {
      const mcqResult = mcqResultMap.get(s.studentId.toString());
      const activeClaimId = s.isMarked
        ? (s.markedById?.toString() || s.claimedById?.toString())
        : s.claimedById?.toString();
      const isClaimedByMe = Boolean(activeClaimId && activeClaimId === currentUserId);
      const isClaimedByOther = Boolean(
        activeClaimId && activeClaimId !== currentUserId && currentUserRole !== 'ADMIN'
      );
      const assignedToName = s.isMarked
        ? (s.markedByName || s.claimedByName || null)
        : (s.claimedByName || null);

      return {
        _id: s._id,
        studentId: s.studentId,
        studentUsername: s.studentUsername,
        studentFullName: s.studentFullName,
        studentSchool: s.studentSchool || '',
        studentProvinceId: s.studentProvinceId || '',
        studentDistrictId: s.studentDistrictId || '',
        fileName: s.fileName,
        fileSize: s.fileSize,
        submittedAt: s.submittedAt,
        marksAwarded: s.marksAwarded,
        maxMarks: s.maxMarks || quiz.essayTotalMarks || 100,
        feedback: s.feedback,
        questionMarks: s.questionMarks || [],
        aiEvaluation: s.aiEvaluation || null,
        isMarked: s.isMarked,
        claimedById: s.claimedById,
        claimedByName: s.claimedByName,
        claimedAt: s.claimedAt,
        markedById: s.markedById,
        markedByName: s.markedByName,
        markedAt: s.markedAt,
        isClaimedByMe,
        isClaimedByOther,
        assignedToName,
        mcqScore: mcqResult ? mcqResult.score : null,
        mcqTotalMarks: mcqResult ? mcqResult.totalMarks : null,
      };
    });

    let daysRemaining: number | null = null;
    if (quiz.isFullPaperRankingsCalculated && quiz.fullPaperRankingsCalculatedAt) {
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(new Date(quiz.fullPaperRankingsCalculatedAt).getTime() + ONE_WEEK_MS);
      const diffMs = expiresAt.getTime() - new Date().getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    res.json({
      success: true,
      data: {
        quiz: {
          _id: quiz._id,
          quizNumber: quiz.quizNumber,
          title: quiz.title,
          subject: quiz.subjectId,
          totalMarks: quiz.totalMarks,
          essayTotalMarks: quiz.essayTotalMarks || 100,
          essayQuestions: quiz.essayQuestions || [],
          essayAnalysisStatus: quiz.essayAnalysisStatus || 'IDLE',
          isFullPaperRankingsCalculated: quiz.isFullPaperRankingsCalculated,
          fullPaperRankingsCalculatedAt: quiz.fullPaperRankingsCalculatedAt,
          daysRemaining,
        },
        submissions: formattedSubmissions,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel, Admin & Student: Download or preview student's answer file
 * Default inline preview in browser, or attachment download with ?download=true
 */
export async function downloadStudentAnswerFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { submissionId } = req.params;

    const submission = await EssaySubmission.findById(submissionId);
    if (!submission) {
      throw new ApiError(404, 'Submission not found.', 'NOT_FOUND');
    }

    // Role check: Admin, Panel, or the student themselves
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;
    if (currentUserRole === 'STUDENT' && submission.studentId.toString() !== currentUserId) {
      throw new ApiError(403, 'Unauthorized to view this answer file.', 'FORBIDDEN');
    }

    let file = submission.fileId ? await EssayFile.findById(submission.fileId) : null;
    if (!file) {
      // Fallback search in case fileId wasn't linked or was recreated
      file = await EssayFile.findOne({
        quizId: submission.quizId,
        uploadedById: submission.studentId,
        fileRole: 'STUDENT_ANSWER',
      }).sort({ createdAt: -1 });

      if (file && !submission.fileId) {
        submission.fileId = file._id as any;
        await submission.save().catch(() => {});
      }
    }

    if (!file) {
      throw new ApiError(
        404,
        'The answer file for this examination has been purged to conserve system storage. Your official marks and ranks remain permanently recorded.',
        'FILE_PURGED'
      );
    }

    // Determine content type safely
    let contentType = file.contentType;
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = path.extname(submission.fileName || file.originalName || '').toLowerCase();
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.doc') contentType = 'application/msword';
      else if (ext === '.docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else contentType = 'application/pdf';
    }

    const isDownload = req.query.download === 'true' || req.query.download === '1';
    const disposition = isDownload ? 'attachment' : 'inline';

    // Allow in-browser preview inside iframes and cross-origin embed
    res.removeHeader('X-Frame-Options');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(submission.fileName)}"`);
    res.send(file.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: Claim an answer paper so no other member can mark it
 */
export async function claimStudentEssay(req: Request, res: Response, next: NextFunction) {
  try {
    const { submissionId } = req.params;
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const submission = await EssaySubmission.findById(submissionId);
    if (!submission) {
      throw new ApiError(404, 'Essay submission not found.', 'NOT_FOUND');
    }

    const assignedUserId = submission.isMarked
      ? (submission.markedById?.toString() || submission.claimedById?.toString())
      : submission.claimedById?.toString();
    if (assignedUserId && assignedUserId !== currentUserId && currentUserRole !== 'ADMIN') {
      const assignedName = submission.markedByName || submission.claimedByName || 'Another panel member';
      throw new ApiError(
        403,
        `This answer paper is already locked to "${assignedName}". Another member cannot claim it.`,
        'LOCKED_BY_ANOTHER_MEMBER'
      );
    }

    let markerName = 'Marking Panel';
    if (req.user?.role === 'MARKING_PANEL') {
      const panelProfile = await MarkingPanelProfile.findOne({ userId: req.user.userId });
      if (panelProfile) markerName = panelProfile.name;
    } else if (req.user?.role === 'ADMIN') {
      markerName = 'Admin Panel';
    }

    const claimedAt = new Date();
    await query(
      `UPDATE "essay_submissions"
       SET "claimed_by_id" = $1,
           "claimed_by_name" = $2,
           "claimed_at" = $3,
           "updated_at" = NOW()
       WHERE id = $4`,
      [currentUserId, markerName, claimedAt, submissionId]
    );

    res.json({
      success: true,
      message: 'Paper claimed successfully for evaluation.',
      data: {
        _id: submissionId,
        claimedById: currentUserId,
        claimedByName: markerName,
        claimedAt: claimedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: Release claimed paper back to available pool
 * Allows other members to claim and mark it.
 */
export async function unclaimStudentEssay(req: Request, res: Response, next: NextFunction) {
  try {
    const { submissionId } = req.params;
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const submission = await EssaySubmission.findById(submissionId);
    if (!submission) {
      throw new ApiError(404, 'Essay submission not found.', 'NOT_FOUND');
    }

    const assignedUserId = submission.isMarked
      ? (submission.markedById?.toString() || submission.claimedById?.toString())
      : submission.claimedById?.toString();
    if (assignedUserId && assignedUserId !== currentUserId && currentUserRole !== 'ADMIN') {
      const assignedName = submission.markedByName || submission.claimedByName || 'Another panel member';
      throw new ApiError(
        403,
        `You can only release papers claimed by yourself. Currently locked to "${assignedName}".`,
        'FORBIDDEN'
      );
    }

    // Reset student's QuizResult if it was marked
    if (submission.isMarked || (submission.marksAwarded !== null && submission.marksAwarded !== undefined)) {
      const mcqResult = await QuizResult.findOne({
        quizId: submission.quizId,
        studentId: submission.studentId,
      });

      if (mcqResult) {
        mcqResult.isEssayMarked = false;
        mcqResult.essayMarks = 0;
        mcqResult.fullPaperScore = mcqResult.score;
        const fpTotal = mcqResult.fullPaperTotalMarks || 0;
        mcqResult.fullPaperPercentage =
          fpTotal > 0
            ? Math.round((mcqResult.score / fpTotal) * 10000) / 100
            : 0;
        await mcqResult.save();
      }
    }

    // Guaranteed direct database release in PostgreSQL
    await query(
      `UPDATE "essay_submissions"
       SET "claimed_by_id" = NULL,
           "claimed_by_name" = NULL,
           "claimed_at" = NULL,
           "marked_by_id" = NULL,
           "marked_by_name" = NULL,
           "marked_at" = NULL,
           "marks_awarded" = NULL,
           "question_marks" = '[]'::jsonb,
           "feedback" = '',
           "is_marked" = false,
           "updated_at" = NOW()
       WHERE id = $1`,
      [submissionId]
    );

    res.json({
      success: true,
      message: 'Paper released back to the available pool for other members.',
      data: {
        _id: submissionId,
        claimedById: null,
        claimedByName: null,
        claimedAt: null,
        markedById: null,
        markedByName: null,
        markedAt: null,
        marksAwarded: null,
        isMarked: false,
        feedback: '',
        questionMarks: [],
        isClaimedByMe: false,
        isClaimedByOther: false,
        assignedToName: null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: Mark student's essay
 * Add marks, feedback, and tick to confirm
 * Enforces that:
 * 1. Paper must be claimed before marking (cannot mark unclaimed paper).
 * 2. Only the member who claimed the paper can mark it.
 */
export async function markStudentEssay(req: Request, res: Response, next: NextFunction) {
  try {
    const { submissionId } = req.params;
    const { marksAwarded, feedback, confirmMarked, questionMarks } = req.body;
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const submission = await EssaySubmission.findById(submissionId);
    if (!submission) {
      throw new ApiError(404, 'Essay submission not found.', 'NOT_FOUND');
    }

    const assignedUserId = submission.isMarked
      ? (submission.markedById?.toString() || submission.claimedById?.toString())
      : submission.claimedById?.toString();

    // STRICT CHECK: An unclaimed paper CANNOT be marked! Must claim first!
    if (!assignedUserId && currentUserRole !== 'ADMIN') {
      throw new ApiError(
        400,
        'You must claim this paper before marking it.',
        'NOT_CLAIMED'
      );
    }

    // Exclusivity Check: If another member has claimed or marked this paper, reject!
    if (assignedUserId && assignedUserId !== currentUserId && currentUserRole !== 'ADMIN') {
      const assignedName = submission.markedByName || submission.claimedByName || 'Another panel member';
      throw new ApiError(
        403,
        `This answer paper is already locked to "${assignedName}". Another panel member cannot mark it.`,
        'LOCKED_BY_ANOTHER_MEMBER'
      );
    }

    const quiz = await Quiz.findById(submission.quizId);
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found.', 'NOT_FOUND');
    }

    const maxMarks = quiz.essayTotalMarks || 100;

    let sanitizedQuestionMarks: any[] = [];
    let totalFromQuestions = 0;
    if (Array.isArray(questionMarks)) {
      sanitizedQuestionMarks = questionMarks.map((qm: any, idx: number) => {
        const rawQNum = String(qm.questionNumber ?? '').trim();
        const extractedNum = parseInt(rawQNum.replace(/[^\d]/g, ''), 10);
        const qNum = !isNaN(extractedNum) && extractedNum > 0 ? extractedNum : idx + 1;
        const partLabel = typeof qm.partLabel === 'string' ? qm.partLabel.trim() : '';
        const title = typeof qm.title === 'string' && qm.title.trim()
          ? qm.title.trim()
          : (rawQNum ? (rawQNum.toLowerCase().startsWith('q') ? rawQNum : `Q ${rawQNum}`) : `Question ${qNum}`);
        const qMarks = Number(qm.marksAwarded) || 0;
        const qMax = Number(qm.maxMarks) || 20;
        totalFromQuestions += qMarks;
        return {
          questionNumber: qNum,
          partLabel,
          title,
          marksAwarded: qMarks,
          maxMarks: qMax,
          aiSuggestedMarks: typeof qm.aiSuggestedMarks === 'number' ? qm.aiSuggestedMarks : undefined,
          aiFeedback: typeof qm.aiFeedback === 'string' ? qm.aiFeedback.trim() : undefined,
          feedback: typeof qm.feedback === 'string' ? qm.feedback.trim() : undefined,
        };
      });
    }

    let numMarks = Number(marksAwarded);
    if ((isNaN(numMarks) || marksAwarded === undefined || marksAwarded === null) && sanitizedQuestionMarks.length > 0) {
      numMarks = totalFromQuestions;
    }

    if (isNaN(numMarks) || numMarks < 0 || numMarks > maxMarks) {
      throw new ApiError(400, `Marks must be between 0 and ${maxMarks}.`, 'INVALID_MARKS');
    }

    // Determine marker's name
    let markerName = 'Marking Panel';
    if (req.user?.role === 'MARKING_PANEL') {
      const panelProfile = await MarkingPanelProfile.findOne({ userId: req.user.userId });
      if (panelProfile) markerName = panelProfile.name;
    } else if (req.user?.role === 'ADMIN') {
      markerName = 'Admin Panel';
    }

    const isMarked = confirmMarked === true || confirmMarked === 'true';

    // If paper is unmarked (!isMarked), AUTO-UNCLAIM back to available pool
    if (!isMarked) {
      // Revert student's QuizResult if it was calculated
      const mcqResult = await QuizResult.findOne({
        quizId: quiz._id,
        studentId: submission.studentId,
      });

      if (mcqResult) {
        mcqResult.isEssayMarked = false;
        mcqResult.essayMarks = 0;
        mcqResult.fullPaperScore = mcqResult.score;
        const fpTotal = mcqResult.fullPaperTotalMarks || 0;
        mcqResult.fullPaperPercentage =
          fpTotal > 0
            ? Math.round((mcqResult.score / fpTotal) * 10000) / 100
            : 0;
        await mcqResult.save();
      }

      await query(
        `UPDATE "essay_submissions"
         SET "marks_awarded" = NULL,
             "question_marks" = '[]'::jsonb,
             "feedback" = '',
             "is_marked" = false,
             "claimed_by_id" = NULL,
             "claimed_by_name" = NULL,
             "claimed_at" = NULL,
             "marked_by_id" = NULL,
             "marked_by_name" = NULL,
             "marked_at" = NULL,
             "updated_at" = NOW()
         WHERE id = $1`,
        [submissionId]
      );

      logger.info(
        `[ESSAY_UNMARK] Paper ${submissionId} unmarked and auto-unclaimed by ${currentUserId}`
      );

      return res.json({
        success: true,
        message: 'Paper unmarked and automatically returned to the pool.',
        data: {
          submissionId: submission._id,
          _id: submission._id,
          marksAwarded: null,
          questionMarks: [],
          feedback: '',
          isMarked: false,
          markedByName: null,
          markedById: null,
          markedAt: null,
          claimedById: null,
          claimedByName: null,
          claimedAt: null,
          isClaimedByMe: false,
          isClaimedByOther: false,
          assignedToName: null,
        },
      });
    }

    const markedAt = new Date();
    const claimedAt = submission.claimedAt || new Date();

    await query(
      `UPDATE "essay_submissions"
       SET "marks_awarded" = $1,
           "question_marks" = $2::jsonb,
           "feedback" = $3,
           "is_marked" = true,
           "claimed_by_id" = $4,
           "claimed_by_name" = $5,
           "claimed_at" = $6,
           "marked_by_id" = $7,
           "marked_by_name" = $8,
           "marked_at" = $9,
           "updated_at" = NOW()
       WHERE id = $10`,
      [
        numMarks,
        JSON.stringify(sanitizedQuestionMarks),
        feedback ? String(feedback).trim() : '',
        currentUserId,
        markerName,
        claimedAt,
        currentUserId,
        markerName,
        markedAt,
        submissionId,
      ]
    );

    // Update student's QuizResult
    const mcqResult = await QuizResult.findOne({
      quizId: quiz._id,
      studentId: submission.studentId,
    });

    if (mcqResult) {
      mcqResult.hasEssaySubmission = true;
      mcqResult.essayMarks = numMarks;
      mcqResult.essayTotalMarks = maxMarks;
      mcqResult.isEssayMarked = true;
      mcqResult.fullPaperTotalMarks = mcqResult.totalMarks + maxMarks;
      mcqResult.fullPaperScore = mcqResult.score + numMarks;
      mcqResult.fullPaperPercentage =
        mcqResult.fullPaperTotalMarks > 0
          ? Math.round((mcqResult.fullPaperScore / mcqResult.fullPaperTotalMarks) * 10000) / 100
          : 0;
      await mcqResult.save();
    }

    logger.info(
      `[ESSAY_MARK] Essay marked for ${submission.studentUsername}: ${numMarks}/${maxMarks} (Confirmed: true, Questions: ${sanitizedQuestionMarks.length})`
    );

    // Auto-recalculate full paper rankings if confirmed
    calculateAndStoreFullPaperRankings(quiz._id).catch((e) =>
      logger.error(`Error auto-calculating full paper rankings: ${e.message}`)
    );

    res.json({
      success: true,
      message: 'Essay paper marked and saved successfully.',
      data: {
        submissionId: submission._id,
        _id: submission._id,
        marksAwarded: numMarks,
        questionMarks: sanitizedQuestionMarks,
        isMarked: true,
        markedByName: markerName,
        markedById: currentUserId,
        markedAt,
        claimedById: currentUserId,
        claimedByName: markerName,
        claimedAt,
        isClaimedByMe: true,
        isClaimedByOther: false,
        assignedToName: markerName,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Panel & Admin: Calculate Full Paper Rankings
 */
export async function generateFullPaperRankings(req: Request, res: Response, next: NextFunction) {
  try {
    const { quizId } = req.params;

    const quiz = await Quiz.findById(quizId);
    if (!quiz || !quiz.hasEssay) {
      throw new ApiError(400, 'This quiz does not have an essay paper.', 'INVALID_REQUEST');
    }

    // Require that all student answers are marked before generating rankings
    const totalSubmissions = await EssaySubmission.countDocuments({ quizId: quiz._id });
    if (totalSubmissions === 0) {
      throw new ApiError(
        400,
        'No student essay submissions found for this examination.',
        'NO_SUBMISSIONS'
      );
    }

    const markedCount = await EssaySubmission.countDocuments({ quizId: quiz._id, isMarked: true });
    const pendingCount = totalSubmissions - markedCount;

    if (pendingCount > 0) {
      throw new ApiError(
        400,
        `All student essay answers must be marked before generating rankings. ${pendingCount} submission(s) still pending marking!`,
        'UNMARKED_SUBMISSIONS_PENDING'
      );
    }

    if (!quiz.fullPaperRankingsCalculatedAt) {
      quiz.fullPaperRankingsCalculatedAt = new Date();
      await quiz.save();
    }

    await calculateAndStoreFullPaperRankings(quizId as string, true);

    res.json({
      success: true,
      message: 'All essay answer papers have been marked and Full Paper Rankings calculated successfully!',
      data: {
        totalSubmissions,
        markedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}
