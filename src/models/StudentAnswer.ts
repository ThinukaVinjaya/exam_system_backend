import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IStudentAnswer extends IBaseDoc {
  attemptId: any;
  quizId: any;
  studentId: any;
  questionId: any;
  selectedOption?: string;
  displayOption?: string;
  textAnswer?: string;
  isCorrect?: boolean;
  marksObtained?: number;
  evaluationFeedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const StudentAnswer = PgModel<IStudentAnswer>({
  tableName: 'student_answers',
});
