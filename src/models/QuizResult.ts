import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IQuizResult extends IBaseDoc {
  attemptId: any;
  quizId: any;
  studentId: any;
  provinceId: string;
  districtId: string;
  totalMarks: number;
  score: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  timeTakenSeconds: number;
  islandRank: number;
  provinceRank: number;
  districtRank: number;
  isLateAttempt: boolean;
  hasEssaySubmission?: boolean;
  essayAttended?: boolean;
  essayMarks?: number;
  essayTotalMarks?: number;
  isEssayMarked?: boolean;
  fullPaperTotalMarks?: number;
  fullPaperScore?: number;
  fullPaperPercentage?: number;
  fullPaperIslandRank?: number;
  fullPaperProvinceRank?: number;
  fullPaperDistrictRank?: number;
  topicBreakdown: Array<{
    topicId: any;
    topicName: string;
    totalQuestions: number;
    correctCount: number;
    percentage: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export const QuizResult = PgModel<IQuizResult>({
  tableName: 'quiz_results',
  jsonColumns: ['topic_breakdown'],
});
