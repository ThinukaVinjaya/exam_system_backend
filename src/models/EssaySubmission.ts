import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IQuestionMarkItem {
  questionNumber: number;
  partLabel?: string;
  title?: string;
  marksAwarded: number;
  maxMarks: number;
  aiSuggestedMarks?: number;
  aiFeedback?: string;
  feedback?: string;
}

export interface IEssaySubmission extends IBaseDoc {
  quizId: any;
  studentId: any;
  studentUsername: string;
  studentFullName: string;
  studentSchool?: string;
  studentProvinceId?: string;
  studentDistrictId?: string;
  fileId: any;
  fileName: string;
  contentType: string;
  fileSize: number;
  submittedAt: Date;
  marksAwarded?: number;
  maxMarks?: number;
  feedback?: string;
  isMarked: boolean;
  questionMarks?: IQuestionMarkItem[];
  aiEvaluation?: any;
  claimedById?: any;
  claimedByName?: string;
  claimedAt?: Date;
  markedById?: any;
  markedByName?: string;
  markedAt?: Date;
  isWorkloadSettled?: boolean;
  workloadSettledAt?: Date;
  workloadSettledBy?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const EssaySubmission = PgModel<IEssaySubmission>({
  tableName: 'essay_submissions',
  jsonColumns: ['question_marks', 'ai_evaluation'],
});
