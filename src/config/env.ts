import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/sinhala_quiz'),
  DATABASE_URL: z.string().default('postgresql://postgres.qlafgbdzcdmsbenpwvcy:AvishkaUthum%40123@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres'),
  DIRECT_URL: z.string().default('postgresql://postgres:AvishkaUthum%40123@db.qlafgbdzcdmsbenpwvcy.supabase.co:5432/postgres'),
  JWT_ACCESS_SECRET: z.string().default('sinhala_quiz_access_secret_key_2026_super_secure'),
  JWT_REFRESH_SECRET: z.string().default('sinhala_quiz_refresh_secret_key_2026_super_secure'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  RAW_DATA_RETENTION_DAYS: z.string().transform(Number).default('30'),
  MAX_PDF_SIZE_MB: z.string().transform(Number).default('20'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  GEMINI_API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
