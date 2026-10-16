import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IAdminProfile extends IBaseDoc {
  userId: any;
  name: string;
  username: string;
  role: string;
  lastLogin?: Date;
  accountStatus: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export const AdminProfile = PgModel<IAdminProfile>({
  tableName: 'admin_profiles',
});
