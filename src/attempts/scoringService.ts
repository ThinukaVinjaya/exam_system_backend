import mongoose from 'mongoose';
import { QuizAttempt, IQuizAttempt } from '../models/QuizAttempt.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { Question } from '../models/Question.js';
import { Quiz } from '../models/Quiz.js';
import { QuizResult, IQuizResult } from '../models/QuizResult.js';
import { ApiError } from '../utils/apiError.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Topic } from '../models/Topic.js';
import { evaluateShortAnswersBatch, IShortAnswerEvalItem } from '../ai/shortAnswerEvaluator.js';

export async function processAndGradeAttempt(attemptId: string | mongoose.Types.ObjectId, autoSubmitReason?: string): Promise<IQuizResult> {
  const attempt = await QuizAttempt.findById(attemptId);
  if (!attempt) {
    throw new ApiError(404, 'Quiz attempt not found', 'ATTEMPT_NOT_FOUND');
  }

  if (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED') {
    const existingResult = await QuizResult.findOne({ attemptId: attempt._id });
    if (existingResult) return existingResult;
  }

  const quiz = await Quiz.findById(attempt.quizId).populate('questions');
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND');
  }

  const now = new Date();
  attempt.submittedAt = now;
  attempt.status = autoSubmitReason ? (autoSubmitReason as any) : 'SUBMITTED';

  const timeTakenSeconds = Math.max(1, Math.floor((now.getTime() - attempt.startTime.getTime()) / 1000));
  attempt.timeTakenSeconds = timeTakenSeconds;
  await attempt.save();

  // Fetch all questions (reuse populated questions from quiz if present) and student answers
  const questions: any[] = Array.isArray(quiz.questions) && quiz.questions.length > 0 && typeof quiz.questions[0] === 'object' && (quiz.questions[0] as any).questionText
    ? (quiz.questions as any[])
    : await Question.find({ _id: { $in: quiz.questions } }).lean();
  const studentAnswers = await StudentAnswer.find({ attemptId: attempt._id }).lean();
  const answerMap = new Map<string, any>(); // questionId -> StudentAnswer
  studentAnswers.forEach((sa) => {
    answerMap.set(sa.questionId.toString(), sa);
  });

  // Prepare Short Answer items to evaluate via AI/multilingual matching
  const shortAnswerItemsToEval: IShortAnswerEvalItem[] = [];
  for (const q of questions) {
    if (q.questionType === 'SHORT_ANSWER') {
      const sa = answerMap.get(q._id.toString());
      const studentText = (sa?.textAnswer || sa?.selectedOption || '').trim();
      shortAnswerItemsToEval.push({
        questionId: q._id.toString(),
        questionText: q.questionText,
        expectedAnswer: q.correctAnswer,
        acceptableAnswers: (q as any).acceptableAnswers || [],
        studentAnswer: studentText,
        marks: q.marks || 1,
      });
    }
  }

  const shortAnswerEvalMap = await evaluateShortAnswersBatch(shortAnswerItemsToEval);

  let totalMarks = 0;
  let score = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  // Topic tracking
  const topicStatsMap = new Map<
    string,
    { topicId: mongoose.Types.ObjectId; total: number; correct: number }
  >();

  const bulkAnswerOps: any[] = [];

  for (const q of questions) {
    const qMarks = Number(q.marks) > 0 ? Number(q.marks) : 1;
    totalMarks += qMarks;

    const tId = q.topicId.toString();
    if (!topicStatsMap.has(tId)) {
      topicStatsMap.set(tId, { topicId: q.topicId, total: 0, correct: 0 });
    }
    const tStat = topicStatsMap.get(tId)!;
    tStat.total += 1;

    const sa = answerMap.get(q._id.toString());

    if (q.questionType === 'SHORT_ANSWER') {
      const evalResult = shortAnswerEvalMap.get(q._id.toString());
      const studentText = (sa?.textAnswer || sa?.selectedOption || '').trim();
      const isAnswered = Boolean(studentText);
      const isCorrect = Boolean(evalResult?.isCorrect);
      const marksObtained = Number(evalResult?.marksAwarded ?? (isCorrect ? qMarks : 0)) || 0;
      const feedback = evalResult?.feedback || '';

      if (!isAnswered) {
        unansweredCount++;
      } else if (isCorrect) {
        correctCount++;
        score += marksObtained;
        tStat.correct += 1;
      } else {
        incorrectCount++;
      }

      bulkAnswerOps.push({
        updateOne: {
          filter: { attemptId: attempt._id, questionId: q._id },
          update: {
            $set: {
              quizId: quiz._id,
              studentId: attempt.studentId,
              selectedOption: studentText || null,
              textAnswer: studentText || null,
              isCorrect,
              marksObtained,
              evaluationFeedback: feedback,
            },
          },
          upsert: true,
        },
      });
    } else {
      // Standard MCQ Question
      const selectedOpt = sa?.selectedOption;
      const isCorrect = selectedOpt === q.correctAnswer;

      if (!selectedOpt) {
        unansweredCount++;
      } else if (isCorrect) {
        correctCount++;
        score += qMarks;
        tStat.correct += 1;
      } else {
        incorrectCount++;
      }

      bulkAnswerOps.push({
        updateOne: {
          filter: { attemptId: attempt._id, questionId: q._id },
          update: {
            $set: {
              quizId: quiz._id,
              studentId: attempt.studentId,
              selectedOption: selectedOpt || null,
              isCorrect,
              marksObtained: isCorrect ? qMarks : 0,
            },
          },
          upsert: true,
        },
      });
    }
  }

  // Execute all answer updates in a single atomic bulk write instead of 50 individual round trips
  if (bulkAnswerOps.length > 0) {
    await StudentAnswer.bulkWrite(bulkAnswerOps, { ordered: false });
  }

  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;

  // Build topic breakdown
  const topics = await Topic.find({ _id: { $in: Array.from(topicStatsMap.keys()) } }).lean();
  const topicNameMap = new Map<string, string>();
  topics.forEach((t) => topicNameMap.set(t._id.toString(), t.nameEn || t.nameSi));

  const topicBreakdown = Array.from(topicStatsMap.values()).map((ts) => ({
    topicId: ts.topicId,
    topicName: topicNameMap.get(ts.topicId.toString()) || 'General Topic',
    totalQuestions: ts.total,
    correctCount: ts.correct,
    percentage: ts.total > 0 ? Math.round((ts.correct / ts.total) * 100) : 0,
  }));

  // Fetch student profile for province/district
  const profile = await StudentProfile.findOne({ userId: attempt.studentId }).lean();
  const provinceId = profile?.provinceId || 'western';
  const districtId = profile?.districtId || 'colombo';

  // Create temporary result doc for rank computation
  const resultData = {
    attemptId: attempt._id,
    quizId: quiz._id,
    studentId: attempt.studentId,
    provinceId,
    districtId,
    totalMarks,
    score,
    percentage,
    correctCount,
    incorrectCount,
    unansweredCount,
    timeTakenSeconds,
    isLateAttempt: quiz.isLateQuiz,
    topicBreakdown,
  };

  const tempDoc = new QuizResult(resultData);
  // STRICT RULE: Rankings are ONLY calculated across all participants on the final day.
  // Never assign temporary ranks (1, 2, etc.) to an individual submission.
  tempDoc.islandRank = 0;
  tempDoc.provinceRank = 0;
  tempDoc.districtRank = 0;

  try {
    await tempDoc.save();
    return tempDoc;
  } catch (err: any) {
    if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
      const existing = await QuizResult.findOne({ attemptId: attempt._id });
      if (existing) return existing;
    }
    throw err;
  }
}
