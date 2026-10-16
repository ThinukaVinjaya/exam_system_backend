import { PgModel, IBaseDoc } from '../db/pgModel.js';

export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED' | 'TIMED_OUT';

export interface IShuffledOption {
  displayKey: string;
  originalKey: string;
}

export interface IShuffledQuestion {
  questionId: any;
  options: IShuffledOption[];
}

export interface IQuizAttempt extends IBaseDoc {
  studentId: any;
  quizId: any;
  startTime: Date;
  expectedEndTime: Date;
  submittedAt?: Date;
  status: AttemptStatus;
  timeTakenSeconds?: number;
  shuffledQuestions?: IShuffledQuestion[];
  createdAt: Date;
  updatedAt: Date;
}

export const QuizAttempt = PgModel<IQuizAttempt>({
  tableName: 'quiz_attempts',
  jsonColumns: ['shuffled_questions'],
});
