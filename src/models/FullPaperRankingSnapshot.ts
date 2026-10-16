import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IFullPaperRankingItem {
  studentId: any;
  fullName: string;
  username: string;
  school: string;
  provinceId: string;
  districtId: string;
  mcqScore: number;
  mcqTotalMarks: number;
  essayScore: number;
  essayTotalMarks: number;
  totalScore: number;
  totalMarks: number;
  percentage: number;
  timeTakenSeconds: number;
  submittedAt: Date;
  islandRank: number;
  provinceRank: number;
  districtRank: number;
}

export interface IFullPaperRankingSnapshot extends IBaseDoc {
  quizId: any;
  totalParticipants: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  isAllMarked: boolean;
  rankings: IFullPaperRankingItem[];
  createdAt: Date;
  updatedAt: Date;
}

export const FullPaperRankingSnapshot = PgModel<IFullPaperRankingSnapshot>({
  tableName: 'full_paper_ranking_snapshots',
  jsonColumns: ['rankings'],
});
