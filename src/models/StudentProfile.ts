import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IStudentProfile extends IBaseDoc {
  userId: any;
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  whatsappNumber?: string;
  school: string;
  grade?: number;
  alYear?: string;
  institute?: string;
  provinceId: string;
  districtId: string;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const StudentProfile = PgModel<IStudentProfile>({
  tableName: 'student_profiles',
});
