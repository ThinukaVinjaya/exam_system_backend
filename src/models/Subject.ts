import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface ISubject extends IBaseDoc {
  nameEn: string;
  nameSi: string;
  code: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const Subject = PgModel<ISubject>({
  tableName: 'subjects',
});
