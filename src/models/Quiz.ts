import { PgModel, IBaseDoc } from '../db/pgModel.js';
import { IEssayQuestionItem } from '../ai/essayAiService.js';

export type QuizStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'ARCHIVED';

export interface IScheduleWindow {
  startTime: Date;
  endTime: Date;
  label?: string;
}

export interface IQuiz extends IBaseDoc {
  quizNumber: number;
  title: string;
  description?: string;
  subjectId: any;
  topicIds: any[];
  questions: any[];
  date: Date;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  scheduleWindows?: IScheduleWindow[];
  totalMarks: number;
  instructions?: string;
  status: QuizStatus;
  targetCategory?: string;
  isLateQuiz: boolean;
  isRankingsCalculated?: boolean;
  hasEssay?: boolean;
  essayQuestionPaperFileId?: any;
  essayQuestionPaperFilename?: string;
  essayTotalMarks?: number;
  essayStartTime?: Date;
  essayEndTime?: Date;
  essayDurationMinutes?: number;
  essayInstructions?: string;
  essayQuestions?: IEssayQuestionItem[];
  essayAnalysisStatus?: 'IDLE' | 'ANALYZING' | 'COMPLETED' | 'FAILED';
  isFullPaperRankingsCalculated?: boolean;
  fullPaperRankingsCalculatedAt?: Date;
  isMarkerExamCardArchived?: boolean;
  essayFilesPurged?: boolean;
  originalQuizId?: any;
  isMcqTop100SmsSent?: boolean;
  mcqTop100SmsSentAt?: Date;
  mcqTop100SmsRecipientCount?: number;
  isFullPaperTop100SmsSent?: boolean;
  fullPaperTop100SmsSentAt?: Date;
  fullPaperTop100SmsRecipientCount?: number;
  createdById: any;
  createdAt: Date;
  updatedAt: Date;
}

export const Quiz = PgModel<IQuiz>({
  tableName: 'quizzes',
  jsonColumns: ['topic_ids', 'questions', 'schedule_windows', 'essay_questions'],
});
