import { PgModel, IBaseDoc } from '../db/pgModel.js';

export type UserRole = 'ADMIN' | 'STUDENT' | 'MARKING_PANEL';

export interface IUser extends IBaseDoc {
  username: string;
  email?: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export const User = PgModel<IUser>({
  tableName: 'users',
});
