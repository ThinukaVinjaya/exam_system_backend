import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IParsedQuestionItem {
  questionNumber: number;
  questionType?: 'MCQ' | 'SHORT_ANSWER';
  topicName?: string;
  questionText: string;
  imageUrl?: string;
  imageCaption?: string;
  options: { key: string; text: string; imageUrl?: string }[];
  correctAnswer: string;
  acceptableAnswers?: string[];
  marks?: number;
  explanation?: string;
  errors: string[];
}

export interface IPdfImport extends IBaseDoc {
  filename: string;
  subjectName?: string;
  topicName?: string;
  parsedQuestions: IParsedQuestionItem[];
  validationErrors: string[];
  status: 'PARSED' | 'REVIEWED' | 'PUBLISHED';
  quizId?: any;
  createdById: any;
  createdAt: Date;
  updatedAt: Date;
}

export const PdfImport = PgModel<IPdfImport>({
  tableName: 'pdf_imports',
  jsonColumns: ['parsed_questions', 'validation_errors'],
});
