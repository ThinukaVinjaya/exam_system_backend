import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IEmailOtp extends IBaseDoc {
  email: string;
  otp: string;
  expiresAt: Date;
  verified: boolean;
  createdAt: Date;
}

export const EmailOtp = PgModel<IEmailOtp>({
  tableName: 'email_otps',
});
