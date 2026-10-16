import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IQuestionOption {
  key: string;
  text: string;
  imageUrl?: string;
}

export interface IQuestion extends IBaseDoc {
  subjectId: any;
  topicId: any;
  questionType?: 'MCQ' | 'SHORT_ANSWER';
  questionText: string;
  imageUrl?: string;
  imageCaption?: string;
  options: IQuestionOption[];
  correctAnswer: string;
  acceptableAnswers?: string[];
  marks: number;
  explanation?: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  createdAt: Date;
  updatedAt: Date;
}

export const Question = PgModel<IQuestion>({
  tableName: 'questions',
  jsonColumns: ['options', 'acceptable_answers'],
});
