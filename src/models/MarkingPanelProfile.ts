import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IMarkingPanelProfile extends IBaseDoc {
  userId: any;
  name: string;
  email: string;
  username: string;
  phoneNumber?: string;
  assignedQuizIds?: any[];
  isActive: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const MarkingPanelProfile = PgModel<IMarkingPanelProfile>({
  tableName: 'marking_panel_profiles',
  jsonColumns: ['assigned_quiz_ids'],
});
