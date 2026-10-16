import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IRankingItem {
  studentId: any;
  fullName: string;
  school: string;
  provinceId: string;
  districtId: string;
  score: number;
  percentage: number;
  timeTakenSeconds: number;
  submittedAt: Date;
  islandRank: number;
  provinceRank: number;
  districtRank: number;
}

export interface IRankingSnapshot extends IBaseDoc {
  quizId: any;
  isOfficialSnapshot: boolean;
  totalParticipants: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  rankings: IRankingItem[];
  createdAt: Date;
  updatedAt: Date;
}

export const RankingSnapshot = PgModel<IRankingSnapshot>({
  tableName: 'ranking_snapshots',
  jsonColumns: ['rankings'],
});
