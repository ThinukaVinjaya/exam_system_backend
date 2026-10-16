import { pool, query } from './pgPool.js';
import { logger } from '../utils/logger.js';
import { seedDefaultCategoriesIfEmpty } from '../models/Category.js';
import { seedDefaultInstitutesIfEmpty } from '../models/Institute.js';

export { pool, query };

export const connectDB = async () => {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW() as now, version() as v');
    client.release();

    logger.info(`Supabase PostgreSQL Connected: ${res.rows[0].v.slice(0, 45)} at ${res.rows[0].now}`);

    // Ensure essay AI question and marking breakdown columns exist in PostgreSQL
    await pool.query(`
      ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS essay_questions JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS essay_analysis_status VARCHAR(50) DEFAULT 'IDLE';
      ALTER TABLE essay_submissions ADD COLUMN IF NOT EXISTS question_marks JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE essay_submissions ADD COLUMN IF NOT EXISTS ai_evaluation JSONB DEFAULT '{}'::jsonb;
    `).catch((err) => {
      logger.warn('Failed to ensure essay question columns exist in database:', err);
    });

    // Seed default categories if none exist
    await seedDefaultCategoriesIfEmpty().catch((err) => {
      logger.warn('Failed to seed default categories:', err);
    });

    // Seed default institutes if none exist
    await seedDefaultInstitutesIfEmpty().catch((err) => {
      logger.warn('Failed to seed default institutes:', err);
    });

    return pool;
  } catch (error) {
    logger.error('Failed to connect to Supabase PostgreSQL', error);
    process.exit(1);
  }
};
