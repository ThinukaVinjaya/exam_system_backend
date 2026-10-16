import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IMonthlyQuizStatistics extends IBaseDoc {
  year: number;
  month: number;
  totalQuizzes: number;
  totalParticipants: number;
  totalAttempts: number;
  overallAveragePercentage: number;
  subjectBreakdown: Array<{
    subjectId: any;
    subjectName: string;
    quizCount: number;
    averagePercentage: number;
  }>;
  provinceBreakdown: Array<{
    provinceId: string;
    provinceName: string;
    participantCount: number;
    averagePercentage: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export const MonthlyQuizStatistics = PgModel<IMonthlyQuizStatistics>({
  tableName: 'monthly_quiz_statistics',
  jsonColumns: ['subject_breakdown', 'province_breakdown'],
});
