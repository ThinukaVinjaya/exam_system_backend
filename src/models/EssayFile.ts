import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IEssayFile extends IBaseDoc {
  filename: string;
  originalName: string;
  contentType: string;
  data: Buffer;
  size: number;
  uploadedById?: any;
  fileRole: 'QUESTION_PAPER' | 'STUDENT_ANSWER';
  quizId?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const EssayFile = PgModel<IEssayFile>({
  tableName: 'essay_files',
});
