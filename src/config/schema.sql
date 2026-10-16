-- PostgreSQL Schema for Sinhala Quiz Platform (Supabase)
-- Ultra High-Concurrency Tuning (Optimized for 2,000 - 4,000 Concurrent API Requests)

DROP TABLE IF EXISTS student_answers CASCADE;
DROP TABLE IF EXISTS quiz_results CASCADE;
DROP TABLE IF EXISTS ranking_snapshots CASCADE;
DROP TABLE IF EXISTS full_paper_ranking_snapshots CASCADE;
DROP TABLE IF EXISTS essay_submissions CASCADE;
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS essay_files CASCADE;
DROP TABLE IF EXISTS quizzes CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS topics CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS student_profiles CASCADE;
DROP TABLE IF EXISTS admin_profiles CASCADE;
DROP TABLE IF EXISTS marking_panel_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS institutes CASCADE;
DROP TABLE IF EXISTS question_images CASCADE;
DROP TABLE IF EXISTS email_otps CASCADE;
DROP TABLE IF EXISTS ai_templates CASCADE;
DROP TABLE IF EXISTS pdf_imports CASCADE;
DROP TABLE IF EXISTS monthly_quiz_statistics CASCADE;
DROP TABLE IF EXISTS monthly_student_statistics CASCADE;

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);

CREATE TABLE student_profiles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  whatsapp_number VARCHAR(50),
  school VARCHAR(255) NOT NULL,
  grade INT,
  al_year VARCHAR(50) DEFAULT '2027 A/L',
  institute VARCHAR(100) DEFAULT 'None',
  province_id VARCHAR(50) NOT NULL,
  district_id VARCHAR(50) NOT NULL,
  is_email_verified BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sp_user_id ON student_profiles (user_id);
CREATE INDEX idx_sp_username ON student_profiles (username);
CREATE INDEX idx_sp_email ON student_profiles (email);
CREATE INDEX idx_sp_al_year ON student_profiles (al_year);
CREATE INDEX idx_sp_institute ON student_profiles (institute);
CREATE INDEX idx_sp_phone ON student_profiles (phone_number);
CREATE INDEX idx_sp_geo ON student_profiles (province_id, district_id);

CREATE TABLE admin_profiles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(100) NOT NULL,
  role VARCHAR(50) DEFAULT 'SUPER_ADMIN',
  last_login TIMESTAMPTZ,
  account_status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_admin_user_id ON admin_profiles (user_id);

CREATE TABLE marking_panel_profiles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  username VARCHAR(100) NOT NULL,
  phone_number VARCHAR(50),
  assigned_quiz_ids JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mp_user_id ON marking_panel_profiles (user_id);
CREATE INDEX idx_mp_email ON marking_panel_profiles (email);

CREATE TABLE subjects (
  id VARCHAR(36) PRIMARY KEY,
  name_en VARCHAR(255) NOT NULL,
  name_si VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_subjects_code ON subjects (code);

CREATE TABLE topics (
  id VARCHAR(36) PRIMARY KEY,
  subject_id VARCHAR(36) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  name_si VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_topics_subject ON topics (subject_id);

CREATE TABLE categories (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_categories_norm ON categories (normalized_name);

CREATE TABLE institutes (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_institutes_norm ON institutes (normalized_name);

CREATE TABLE quizzes (
  id VARCHAR(36) PRIMARY KEY,
  quiz_number INT,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  subject_id VARCHAR(36) NOT NULL,
  topic_ids JSONB DEFAULT '[]'::jsonb,
  questions JSONB DEFAULT '[]'::jsonb,
  date TIMESTAMPTZ NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  schedule_windows JSONB DEFAULT '[]'::jsonb,
  total_marks NUMERIC(8,2) DEFAULT 0,
  instructions TEXT DEFAULT '',
  status VARCHAR(30) DEFAULT 'DRAFT',
  target_category VARCHAR(100) DEFAULT 'ALL',
  is_late_quiz BOOLEAN DEFAULT FALSE,
  is_rankings_calculated BOOLEAN DEFAULT FALSE,
  has_essay BOOLEAN DEFAULT FALSE,
  essay_question_paper_file_id VARCHAR(36),
  essay_question_paper_filename VARCHAR(255),
  essay_total_marks NUMERIC(8,2) DEFAULT 0,
  essay_start_time TIMESTAMPTZ,
  essay_end_time TIMESTAMPTZ,
  essay_duration_minutes INT DEFAULT 120,
  essay_instructions TEXT DEFAULT '',
  essay_questions JSONB DEFAULT '[]'::jsonb,
  essay_analysis_status VARCHAR(50) DEFAULT 'IDLE',
  is_full_paper_rankings_calculated BOOLEAN DEFAULT FALSE,
  full_paper_rankings_calculated_at TIMESTAMPTZ,
  is_marker_exam_card_archived BOOLEAN DEFAULT FALSE,
  essay_files_purged BOOLEAN DEFAULT FALSE,
  original_quiz_id VARCHAR(36),
  is_mcq_top100_sms_sent BOOLEAN DEFAULT FALSE,
  mcq_top100_sms_sent_at TIMESTAMPTZ,
  mcq_top100_sms_recipient_count INT DEFAULT 0,
  is_full_paper_top100_sms_sent BOOLEAN DEFAULT FALSE,
  full_paper_top100_sms_sent_at TIMESTAMPTZ,
  full_paper_top100_sms_recipient_count INT DEFAULT 0,
  created_by_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_quizzes_status_time ON quizzes (status, start_time, end_time);
CREATE INDEX idx_quizzes_quiz_number ON quizzes (quiz_number);
CREATE INDEX idx_quizzes_target_cat ON quizzes (target_category);

CREATE TABLE questions (
  id VARCHAR(36) PRIMARY KEY,
  subject_id VARCHAR(36) NOT NULL,
  topic_id VARCHAR(36) NOT NULL,
  question_type VARCHAR(30) DEFAULT 'MCQ',
  question_text TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  image_caption TEXT DEFAULT '',
  options JSONB DEFAULT '[]'::jsonb,
  correct_answer TEXT NOT NULL,
  acceptable_answers JSONB DEFAULT '[]'::jsonb,
  marks NUMERIC(8,2) DEFAULT 1,
  explanation TEXT DEFAULT '',
  difficulty VARCHAR(20) DEFAULT 'MEDIUM',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_questions_sub_top ON questions (subject_id, topic_id);

CREATE TABLE quiz_attempts (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  quiz_id VARCHAR(36) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  expected_end_time TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  status VARCHAR(30) DEFAULT 'IN_PROGRESS',
  time_taken_seconds INT DEFAULT 0,
  shuffled_questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_attempt_student_quiz UNIQUE (student_id, quiz_id)
);
CREATE INDEX idx_attempts_quiz_student ON quiz_attempts (quiz_id, student_id);
CREATE INDEX idx_attempts_status_end ON quiz_attempts (status, expected_end_time);

CREATE TABLE student_answers (
  id VARCHAR(36) PRIMARY KEY,
  attempt_id VARCHAR(36) NOT NULL,
  quiz_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  question_id VARCHAR(36) NOT NULL,
  selected_option TEXT,
  display_option TEXT,
  text_answer TEXT,
  is_correct BOOLEAN DEFAULT FALSE,
  marks_obtained NUMERIC(8,2) DEFAULT 0,
  evaluation_feedback TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_answer_attempt_question UNIQUE (attempt_id, question_id)
);
CREATE INDEX idx_answers_attempt_q ON student_answers (attempt_id, question_id);
CREATE INDEX idx_answers_quiz_student ON student_answers (quiz_id, student_id);

CREATE TABLE quiz_results (
  id VARCHAR(36) PRIMARY KEY,
  attempt_id VARCHAR(36) UNIQUE NOT NULL,
  quiz_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  province_id VARCHAR(50) NOT NULL,
  district_id VARCHAR(50) NOT NULL,
  total_marks NUMERIC(8,2) NOT NULL,
  score NUMERIC(8,2) NOT NULL,
  percentage NUMERIC(8,2) NOT NULL,
  correct_count INT NOT NULL,
  incorrect_count INT NOT NULL,
  unanswered_count INT NOT NULL,
  time_taken_seconds INT NOT NULL,
  island_rank INT DEFAULT 0,
  province_rank INT DEFAULT 0,
  district_rank INT DEFAULT 0,
  is_late_attempt BOOLEAN DEFAULT FALSE,
  has_essay_submission BOOLEAN DEFAULT FALSE,
  essay_attended BOOLEAN DEFAULT FALSE,
  essay_marks NUMERIC(8,2),
  essay_total_marks NUMERIC(8,2),
  is_essay_marked BOOLEAN DEFAULT FALSE,
  full_paper_total_marks NUMERIC(8,2),
  full_paper_score NUMERIC(8,2),
  full_paper_percentage NUMERIC(8,2),
  full_paper_island_rank INT DEFAULT 0,
  full_paper_province_rank INT DEFAULT 0,
  full_paper_district_rank INT DEFAULT 0,
  topic_breakdown JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_results_quiz_score ON quiz_results (quiz_id, score DESC, time_taken_seconds ASC);
CREATE INDEX idx_results_student ON quiz_results (student_id, created_at DESC);
CREATE INDEX idx_results_attempt ON quiz_results (attempt_id);

CREATE TABLE ranking_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  quiz_id VARCHAR(36) NOT NULL,
  is_official_snapshot BOOLEAN DEFAULT TRUE,
  total_participants INT DEFAULT 0,
  average_score NUMERIC(8,2) DEFAULT 0,
  highest_score NUMERIC(8,2) DEFAULT 0,
  lowest_score NUMERIC(8,2) DEFAULT 0,
  rankings JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rank_snapshot_quiz ON ranking_snapshots (quiz_id);

CREATE TABLE full_paper_ranking_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  quiz_id VARCHAR(36) NOT NULL,
  total_participants INT DEFAULT 0,
  average_score NUMERIC(8,2) DEFAULT 0,
  highest_score NUMERIC(8,2) DEFAULT 0,
  lowest_score NUMERIC(8,2) DEFAULT 0,
  is_all_marked BOOLEAN DEFAULT FALSE,
  rankings JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fp_rank_snapshot_quiz ON full_paper_ranking_snapshots (quiz_id);

CREATE TABLE essay_files (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  size INT NOT NULL,
  uploaded_by_id VARCHAR(36),
  file_role VARCHAR(50) NOT NULL,
  quiz_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_essay_files_quiz ON essay_files (quiz_id);

CREATE TABLE essay_submissions (
  id VARCHAR(36) PRIMARY KEY,
  quiz_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  student_username VARCHAR(100) NOT NULL,
  student_full_name VARCHAR(255) NOT NULL,
  student_school VARCHAR(255),
  student_province_id VARCHAR(50),
  student_district_id VARCHAR(50),
  file_id VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) DEFAULT 'application/pdf',
  file_size INT DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  marks_awarded NUMERIC(8,2),
  max_marks NUMERIC(8,2) DEFAULT 0,
  feedback TEXT DEFAULT '',
  question_marks JSONB DEFAULT '[]'::jsonb,
  ai_evaluation JSONB DEFAULT '{}'::jsonb,
  is_marked BOOLEAN DEFAULT FALSE,
  claimed_by_id VARCHAR(36),
  claimed_by_name VARCHAR(255),
  claimed_at TIMESTAMPTZ,
  marked_by_id VARCHAR(36),
  marked_by_name VARCHAR(255),
  marked_at TIMESTAMPTZ,
  is_workload_settled BOOLEAN DEFAULT FALSE,
  workload_settled_at TIMESTAMPTZ,
  workload_settled_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_essay_quiz_student UNIQUE (quiz_id, student_id)
);
CREATE INDEX idx_essay_sub_quiz_marked ON essay_submissions (quiz_id, is_marked);

CREATE TABLE question_images (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  size INT NOT NULL,
  created_by_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE email_otps (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp VARCHAR(20) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_otps_email ON email_otps (email);

CREATE TABLE ai_templates (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  subject_name VARCHAR(255) NOT NULL,
  default_topic_name VARCHAR(255) DEFAULT '',
  target_category VARCHAR(100) DEFAULT 'ALL',
  question_format VARCHAR(50) DEFAULT 'MCQ_ONLY',
  short_answer_count INT DEFAULT 0,
  question_count INT DEFAULT 10,
  options_count INT DEFAULT 5,
  marks_per_question NUMERIC(8,2) DEFAULT 1,
  difficulty VARCHAR(30) DEFAULT 'MIXED',
  language VARCHAR(30) DEFAULT 'SINHALA',
  custom_instructions TEXT DEFAULT '',
  is_preset BOOLEAN DEFAULT FALSE,
  created_by_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pdf_imports (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  subject_name VARCHAR(255) DEFAULT '',
  topic_name VARCHAR(255) DEFAULT '',
  parsed_questions JSONB DEFAULT '[]'::jsonb,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(30) DEFAULT 'PARSED',
  quiz_id VARCHAR(36),
  created_by_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE monthly_quiz_statistics (
  id VARCHAR(36) PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL,
  total_quizzes INT DEFAULT 0,
  total_participants INT DEFAULT 0,
  total_attempts INT DEFAULT 0,
  overall_average_percentage NUMERIC(8,2) DEFAULT 0,
  subject_breakdown JSONB DEFAULT '[]'::jsonb,
  province_breakdown JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_monthly_quiz_stat UNIQUE (year, month)
);

CREATE TABLE monthly_student_statistics (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  quizzes_attended INT DEFAULT 0,
  quizzes_available INT DEFAULT 0,
  quizzes_missed INT DEFAULT 0,
  average_percentage NUMERIC(8,2) DEFAULT 0,
  best_percentage NUMERIC(8,2) DEFAULT 0,
  total_time_taken_seconds INT DEFAULT 0,
  topic_performance JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_monthly_student_stat UNIQUE (student_id, year, month)
);
