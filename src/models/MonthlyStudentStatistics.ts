import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IMonthlyStudentStatistics extends IBaseDoc {
  studentId: any;
  year: number;
  month: number;
  quizzesAttended: number;
  quizzesAvailable: number;
  quizzesMissed: number;
  averagePercentage: number;
  bestPercentage: number;
  totalTimeTakenSeconds: number;
  topicPerformance: Array<{
    topicId: any;
    topicName: string;
    attemptsCount: number;
    averagePercentage: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export const MonthlyStudentStatistics = PgModel<IMonthlyStudentStatistics>({
  tableName: 'monthly_student_statistics',
  jsonColumns: ['topic_performance'],
});
