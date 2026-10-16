import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IQuestionImage extends IBaseDoc {
  filename: string;
  contentType: string;
  data: Buffer;
  size: number;
  createdById?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const QuestionImage = PgModel<IQuestionImage>({
  tableName: 'question_images',
});
