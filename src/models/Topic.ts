import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface ITopic extends IBaseDoc {
  subjectId: any;
  nameEn: string;
  nameSi: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const Topic = PgModel<ITopic>({
  tableName: 'topics',
});
