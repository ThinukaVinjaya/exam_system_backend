import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IAiTemplate extends IBaseDoc {
  title: string;
  description?: string;
  subjectName: string;
  defaultTopicName?: string;
  targetCategory: string;
  questionFormat?: 'MCQ_ONLY' | 'SHORT_ANSWER_ONLY' | 'MIXED';
  shortAnswerCount?: number;
  questionCount: number;
  optionsCount: number;
  marksPerQuestion: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
  language: 'SINHALA' | 'ENGLISH' | 'BILINGUAL';
  customInstructions?: string;
  isPreset: boolean;
  createdById?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const AiTemplate = PgModel<IAiTemplate>({
  tableName: 'ai_templates',
});
