const mongoose = require('mongoose');
const { Pool } = require('pg');

const MONGO_URI = 'mongodb+srv://quizebs885_db_user:cDHeqGbqb5zSSbK0@cluster0.c8nbric.mongodb.net/sinhala_quiz?retryWrites=true&w=majority&appName=Cluster0';
const PG_CONN = 'postgresql://postgres.qlafgbdzcdmsbenpwvcy:AvishkaUthum%40123@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

function toId(val) {
  if (!val) return null;
  return val.toString();
}

function toJson(val) {
  if (val === undefined || val === null) return JSON.stringify([]);
  return JSON.stringify(val);
}

async function runDataMigration() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGO_URI);
  const mdb = mongoose.connection.db;
  console.log('MongoDB connected.');

  console.log('Connecting to Supabase PostgreSQL...');
  const pool = new Pool({
    connectionString: PG_CONN,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  console.log('PostgreSQL connected.');

  try {
    // 1. Users
    const users = await mdb.collection('users').find({}).toArray();
    console.log(`Migrating ${users.length} users...`);
    for (const u of users) {
      await pool.query(`
        INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
      `, [toId(u._id), u.username, u.email || null, u.passwordHash, u.role, u.createdAt || new Date(), u.updatedAt || new Date()]);
    }

    // 2. StudentProfiles
    const studentProfiles = await mdb.collection('studentprofiles').find({}).toArray();
    console.log(`Migrating ${studentProfiles.length} student profiles...`);
    for (const sp of studentProfiles) {
      await pool.query(`
        INSERT INTO student_profiles (id, user_id, full_name, username, email, phone_number, whatsapp_number, school, grade, al_year, institute, province_id, district_id, is_email_verified, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          username = EXCLUDED.username,
          email = EXCLUDED.email,
          phone_number = EXCLUDED.phone_number,
          whatsapp_number = EXCLUDED.whatsapp_number,
          school = EXCLUDED.school,
          grade = EXCLUDED.grade,
          al_year = EXCLUDED.al_year,
          institute = EXCLUDED.institute,
          province_id = EXCLUDED.province_id,
          district_id = EXCLUDED.district_id,
          is_email_verified = EXCLUDED.is_email_verified,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(sp._id), toId(sp.userId), sp.fullName, sp.username, sp.email,
        sp.phoneNumber, sp.whatsappNumber || null, sp.school, sp.grade || null,
        sp.alYear || '2027 A/L', sp.institute || 'None', sp.provinceId, sp.districtId,
        sp.isEmailVerified ?? true, sp.createdAt || new Date(), sp.updatedAt || new Date()
      ]);
    }

    // 3. AdminProfiles
    const adminProfiles = await mdb.collection('adminprofiles').find({}).toArray();
    console.log(`Migrating ${adminProfiles.length} admin profiles...`);
    for (const ap of adminProfiles) {
      await pool.query(`
        INSERT INTO admin_profiles (id, user_id, name, username, role, last_login, account_status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          username = EXCLUDED.username,
          role = EXCLUDED.role,
          last_login = EXCLUDED.last_login,
          account_status = EXCLUDED.account_status,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(ap._id), toId(ap.userId), ap.name, ap.username, ap.role || 'SUPER_ADMIN',
        ap.lastLogin || null, ap.accountStatus || 'ACTIVE', ap.createdAt || new Date(), ap.updatedAt || new Date()
      ]);
    }

    // 4. MarkingPanelProfiles
    const markingProfiles = await mdb.collection('markingpanelprofiles').find({}).toArray();
    console.log(`Migrating ${markingProfiles.length} marking panel profiles...`);
    for (const mp of markingProfiles) {
      const assignedIds = (mp.assignedQuizIds || []).map(id => toId(id));
      await pool.query(`
        INSERT INTO marking_panel_profiles (id, user_id, name, email, username, phone_number, assigned_quiz_ids, is_active, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          username = EXCLUDED.username,
          phone_number = EXCLUDED.phone_number,
          assigned_quiz_ids = EXCLUDED.assigned_quiz_ids,
          is_active = EXCLUDED.is_active,
          notes = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(mp._id), toId(mp.userId), mp.name, mp.email, mp.username,
        mp.phoneNumber || null, toJson(assignedIds), mp.isActive ?? true,
        mp.notes || '', mp.createdAt || new Date(), mp.updatedAt || new Date()
      ]);
    }

    // 5. Subjects
    const subjects = await mdb.collection('subjects').find({}).toArray();
    console.log(`Migrating ${subjects.length} subjects...`);
    for (const s of subjects) {
      await pool.query(`
        INSERT INTO subjects (id, name_en, name_si, code, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name_en = EXCLUDED.name_en,
          name_si = EXCLUDED.name_si,
          code = EXCLUDED.code,
          description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at
      `, [toId(s._id), s.nameEn, s.nameSi, s.code, s.description || '', s.createdAt || new Date(), s.updatedAt || new Date()]);
    }

    // 6. Topics
    const topics = await mdb.collection('topics').find({}).toArray();
    console.log(`Migrating ${topics.length} topics...`);
    for (const t of topics) {
      await pool.query(`
        INSERT INTO topics (id, subject_id, name_en, name_si, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          subject_id = EXCLUDED.subject_id,
          name_en = EXCLUDED.name_en,
          name_si = EXCLUDED.name_si,
          description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at
      `, [toId(t._id), toId(t.subjectId), t.nameEn, t.nameSi, t.description || '', t.createdAt || new Date(), t.updatedAt || new Date()]);
    }

    // 7. Categories
    const categories = await mdb.collection('categories').find({}).toArray();
    console.log(`Migrating ${categories.length} categories...`);
    for (const c of categories) {
      await pool.query(`
        INSERT INTO categories (id, name, normalized_name, description, isActive, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          description = EXCLUDED.description,
          isActive = EXCLUDED.isActive,
          updated_at = EXCLUDED.updated_at
      `, [toId(c._id), c.name, c.normalizedName, c.description || '', c.isActive ?? true, c.createdAt || new Date(), c.updatedAt || new Date()]);
    }

    // 8. Institutes
    const institutes = await mdb.collection('institutes').find({}).toArray();
    console.log(`Migrating ${institutes.length} institutes...`);
    for (const inst of institutes) {
      await pool.query(`
        INSERT INTO institutes (id, name, normalized_name, description, isActive, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          description = EXCLUDED.description,
          isActive = EXCLUDED.isActive,
          updated_at = EXCLUDED.updated_at
      `, [toId(inst._id), inst.name, inst.normalizedName, inst.description || '', inst.isActive ?? true, inst.createdAt || new Date(), inst.updatedAt || new Date()]);
    }

    // 9. Questions
    const questions = await mdb.collection('questions').find({}).toArray();
    console.log(`Migrating ${questions.length} questions...`);
    for (const q of questions) {
      await pool.query(`
        INSERT INTO questions (id, subject_id, topic_id, question_type, question_text, image_url, image_caption, options, correct_answer, acceptable_answers, marks, explanation, difficulty, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          subject_id = EXCLUDED.subject_id,
          topic_id = EXCLUDED.topic_id,
          question_type = EXCLUDED.question_type,
          question_text = EXCLUDED.question_text,
          image_url = EXCLUDED.image_url,
          image_caption = EXCLUDED.image_caption,
          options = EXCLUDED.options,
          correct_answer = EXCLUDED.correct_answer,
          acceptable_answers = EXCLUDED.acceptable_answers,
          marks = EXCLUDED.marks,
          explanation = EXCLUDED.explanation,
          difficulty = EXCLUDED.difficulty,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(q._id), toId(q.subjectId), toId(q.topicId), q.questionType || 'MCQ',
        q.questionText, q.imageUrl || '', q.imageCaption || '',
        toJson(q.options), q.correctAnswer, toJson(q.acceptableAnswers || []),
        q.marks || 1, q.explanation || '', q.difficulty || 'MEDIUM',
        q.createdAt || new Date(), q.updatedAt || new Date()
      ]);
    }

    // 10. Quizzes
    const quizzes = await mdb.collection('quizzes').find({}).toArray();
    console.log(`Migrating ${quizzes.length} quizzes...`);
    for (const qz of quizzes) {
      const topicIds = (qz.topicIds || []).map(id => toId(id));
      const qIds = (qz.questions || []).map(id => toId(id));
      await pool.query(`
        INSERT INTO quizzes (
          id, quiz_number, title, description, subject_id, topic_ids, questions, date, start_time, end_time,
          duration_minutes, schedule_windows, total_marks, instructions, status, target_category, is_late_quiz,
          is_rankings_calculated, has_essay, essay_question_paper_file_id, essay_question_paper_filename,
          essay_total_marks, essay_start_time, essay_end_time, essay_duration_minutes, essay_instructions,
          is_full_paper_rankings_calculated, full_paper_rankings_calculated_at, is_marker_exam_card_archived,
          essay_files_purged, original_quiz_id, is_mcq_top100_sms_sent, mcq_top100_sms_sent_at,
          mcq_top100_sms_recipient_count, is_full_paper_top100_sms_sent, full_paper_top100_sms_sent_at,
          full_paper_top100_sms_recipient_count, created_by_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29,
          $30, $31, $32, $33,
          $34, $35, $36,
          $37, $38, $39, $40
        )
        ON CONFLICT (id) DO UPDATE SET
          quiz_number = EXCLUDED.quiz_number,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          subject_id = EXCLUDED.subject_id,
          topic_ids = EXCLUDED.topic_ids,
          questions = EXCLUDED.questions,
          date = EXCLUDED.date,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          duration_minutes = EXCLUDED.duration_minutes,
          schedule_windows = EXCLUDED.schedule_windows,
          total_marks = EXCLUDED.total_marks,
          instructions = EXCLUDED.instructions,
          status = EXCLUDED.status,
          target_category = EXCLUDED.target_category,
          is_late_quiz = EXCLUDED.is_late_quiz,
          is_rankings_calculated = EXCLUDED.is_rankings_calculated,
          has_essay = EXCLUDED.has_essay,
          essay_question_paper_file_id = EXCLUDED.essay_question_paper_file_id,
          essay_question_paper_filename = EXCLUDED.essay_question_paper_filename,
          essay_total_marks = EXCLUDED.essay_total_marks,
          essay_start_time = EXCLUDED.essay_start_time,
          essay_end_time = EXCLUDED.essay_end_time,
          essay_duration_minutes = EXCLUDED.essay_duration_minutes,
          essay_instructions = EXCLUDED.essay_instructions,
          is_full_paper_rankings_calculated = EXCLUDED.is_full_paper_rankings_calculated,
          full_paper_rankings_calculated_at = EXCLUDED.full_paper_rankings_calculated_at,
          is_marker_exam_card_archived = EXCLUDED.is_marker_exam_card_archived,
          essay_files_purged = EXCLUDED.essay_files_purged,
          original_quiz_id = EXCLUDED.original_quiz_id,
          is_mcq_top100_sms_sent = EXCLUDED.is_mcq_top100_sms_sent,
          mcq_top100_sms_sent_at = EXCLUDED.mcq_top100_sms_sent_at,
          mcq_top100_sms_recipient_count = EXCLUDED.mcq_top100_sms_recipient_count,
          is_full_paper_top100_sms_sent = EXCLUDED.is_full_paper_top100_sms_sent,
          full_paper_top100_sms_sent_at = EXCLUDED.full_paper_top100_sms_sent_at,
          full_paper_top100_sms_recipient_count = EXCLUDED.full_paper_top100_sms_recipient_count,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(qz._id), qz.quizNumber || 1, qz.title, qz.description || '', toId(qz.subjectId),
        toJson(topicIds), toJson(qIds), qz.date, qz.startTime, qz.endTime,
        qz.durationMinutes || 30, toJson(qz.scheduleWindows || []), qz.totalMarks || 0,
        qz.instructions || '', qz.status || 'DRAFT', qz.targetCategory || 'ALL',
        qz.isLateQuiz ?? false, qz.isRankingsCalculated ?? false,
        qz.hasEssay ?? false, toId(qz.essayQuestionPaperFileId), qz.essayQuestionPaperFilename || null,
        qz.essayTotalMarks || 0, qz.essayStartTime || null, qz.essayEndTime || null,
        qz.essayDurationMinutes || 120, qz.essayInstructions || '',
        qz.isFullPaperRankingsCalculated ?? false, qz.fullPaperRankingsCalculatedAt || null,
        qz.isMarkerExamCardArchived ?? false, qz.essayFilesPurged ?? false,
        toId(qz.originalQuizId), qz.isMcqTop100SmsSent ?? false, qz.mcqTop100SmsSentAt || null,
        qz.mcqTop100SmsRecipientCount || 0, qz.isFullPaperTop100SmsSent ?? false,
        qz.fullPaperTop100SmsSentAt || null, qz.fullPaperTop100SmsRecipientCount || 0,
        toId(qz.createdById), qz.createdAt || new Date(), qz.updatedAt || new Date()
      ]);
    }

    // 11. QuizAttempts
    const attempts = await mdb.collection('quizattempts').find({}).toArray();
    console.log(`Migrating ${attempts.length} quiz attempts...`);
    for (const att of attempts) {
      await pool.query(`
        INSERT INTO quiz_attempts (id, student_id, quiz_id, start_time, expected_end_time, submitted_at, status, time_taken_seconds, shuffled_questions, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          submitted_at = EXCLUDED.submitted_at,
          time_taken_seconds = EXCLUDED.time_taken_seconds,
          shuffled_questions = EXCLUDED.shuffled_questions,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(att._id), toId(att.studentId), toId(att.quizId), att.startTime, att.expectedEndTime,
        att.submittedAt || null, att.status || 'IN_PROGRESS', att.timeTakenSeconds || 0,
        toJson(att.shuffledQuestions || []), att.createdAt || new Date(), att.updatedAt || new Date()
      ]);
    }

    // 12. StudentAnswers
    const answers = await mdb.collection('studentanswers').find({}).toArray();
    console.log(`Migrating ${answers.length} student answers...`);
    for (const sa of answers) {
      await pool.query(`
        INSERT INTO student_answers (id, attempt_id, quiz_id, student_id, question_id, selected_option, display_option, text_answer, is_correct, marks_obtained, evaluation_feedback, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          selected_option = EXCLUDED.selected_option,
          display_option = EXCLUDED.display_option,
          text_answer = EXCLUDED.text_answer,
          is_correct = EXCLUDED.is_correct,
          marks_obtained = EXCLUDED.marks_obtained,
          evaluation_feedback = EXCLUDED.evaluation_feedback,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(sa._id), toId(sa.attemptId), toId(sa.quizId), toId(sa.studentId), toId(sa.questionId),
        sa.selectedOption || null, sa.displayOption || null, sa.textAnswer || null,
        sa.isCorrect ?? false, sa.marksObtained || 0, sa.evaluationFeedback || '',
        sa.createdAt || new Date(), sa.updatedAt || new Date()
      ]);
    }

    // 13. QuizResults
    const results = await mdb.collection('quizresults').find({}).toArray();
    console.log(`Migrating ${results.length} quiz results...`);
    for (const qr of results) {
      await pool.query(`
        INSERT INTO quiz_results (
          id, attempt_id, quiz_id, student_id, province_id, district_id, total_marks, score, percentage,
          correct_count, incorrect_count, unanswered_count, time_taken_seconds, island_rank, province_rank,
          district_rank, is_late_attempt, has_essay_submission, essay_attended, essay_marks, essay_total_marks,
          is_essay_marked, full_paper_total_marks, full_paper_score, full_paper_percentage, full_paper_island_rank,
          full_paper_province_rank, full_paper_district_rank, topic_breakdown, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31
        )
        ON CONFLICT (id) DO UPDATE SET
          score = EXCLUDED.score,
          percentage = EXCLUDED.percentage,
          island_rank = EXCLUDED.island_rank,
          province_rank = EXCLUDED.province_rank,
          district_rank = EXCLUDED.district_rank,
          topic_breakdown = EXCLUDED.topic_breakdown,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(qr._id), toId(qr.attemptId), toId(qr.quizId), toId(qr.studentId), qr.provinceId, qr.districtId,
        qr.totalMarks, qr.score, qr.percentage, qr.correctCount, qr.incorrectCount, qr.unansweredCount,
        qr.timeTakenSeconds, qr.islandRank || 0, qr.provinceRank || 0, qr.districtRank || 0,
        qr.isLateAttempt ?? false, qr.hasEssaySubmission ?? false, qr.essayAttended ?? false,
        qr.essayMarks || null, qr.essayTotalMarks || null, qr.isEssayMarked ?? false,
        qr.fullPaperTotalMarks || null, qr.fullPaperScore || null, qr.fullPaperPercentage || null,
        qr.fullPaperIslandRank || 0, qr.fullPaperProvinceRank || 0, qr.fullPaperDistrictRank || 0,
        toJson(qr.topicBreakdown || []), qr.createdAt || new Date(), qr.updatedAt || new Date()
      ]);
    }

    // 14. RankingSnapshots
    const rankingSnapshots = await mdb.collection('rankingsnapshots').find({}).toArray();
    console.log(`Migrating ${rankingSnapshots.length} ranking snapshots...`);
    for (const rs of rankingSnapshots) {
      await pool.query(`
        INSERT INTO ranking_snapshots (id, quiz_id, is_official_snapshot, total_participants, average_score, highest_score, lowest_score, rankings, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          rankings = EXCLUDED.rankings,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(rs._id), toId(rs.quizId), rs.isOfficialSnapshot ?? true,
        rs.totalParticipants || 0, rs.averageScore || 0, rs.highestScore || 0, rs.lowestScore || 0,
        toJson(rs.rankings || []), rs.createdAt || new Date(), rs.updatedAt || new Date()
      ]);
    }

    // 15. FullPaperRankingSnapshots
    const fpRankings = await mdb.collection('fullpaperrankingsnapshots').find({}).toArray();
    console.log(`Migrating ${fpRankings.length} full paper ranking snapshots...`);
    for (const fp of fpRankings) {
      await pool.query(`
        INSERT INTO full_paper_ranking_snapshots (id, quiz_id, total_participants, average_score, highest_score, lowest_score, is_all_marked, rankings, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          rankings = EXCLUDED.rankings,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(fp._id), toId(fp.quizId), fp.totalParticipants || 0,
        fp.averageScore || 0, fp.highestScore || 0, fp.lowestScore || 0,
        fp.isAllMarked ?? false, toJson(fp.rankings || []),
        fp.createdAt || new Date(), fp.updatedAt || new Date()
      ]);
    }

    // 16. EssayFiles
    const essayFiles = await mdb.collection('essayfiles').find({}).toArray();
    console.log(`Migrating ${essayFiles.length} essay files...`);
    for (const ef of essayFiles) {
      let buf = Buffer.isBuffer(ef.data) ? ef.data : ef.data?.buffer ? Buffer.from(ef.data.buffer) : Buffer.from(ef.data || '');
      await pool.query(`
        INSERT INTO essay_files (id, filename, original_name, content_type, data, size, uploaded_by_id, file_role, quiz_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          filename = EXCLUDED.filename,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(ef._id), ef.filename, ef.originalName, ef.contentType, buf, ef.size || buf.length,
        toId(ef.uploadedById), ef.fileRole, toId(ef.quizId), ef.createdAt || new Date(), ef.updatedAt || new Date()
      ]);
    }

    // 17. EssaySubmissions
    const essaySubmissions = await mdb.collection('essaysubmissions').find({}).toArray();
    console.log(`Migrating ${essaySubmissions.length} essay submissions...`);
    for (const es of essaySubmissions) {
      await pool.query(`
        INSERT INTO essay_submissions (
          id, quiz_id, student_id, student_username, student_full_name, student_school, student_province_id,
          student_district_id, file_id, file_name, content_type, file_size, submitted_at, marks_awarded,
          max_marks, feedback, is_marked, claimed_by_id, claimed_by_name, claimed_at, marked_by_id,
          marked_by_name, marked_at, is_workload_settled, workload_settled_at, workload_settled_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27, $28
        )
        ON CONFLICT (id) DO UPDATE SET
          marks_awarded = EXCLUDED.marks_awarded,
          is_marked = EXCLUDED.is_marked,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(es._id), toId(es.quizId), toId(es.studentId), es.studentUsername, es.studentFullName,
        es.studentSchool || '', es.studentProvinceId || '', es.studentDistrictId || '',
        toId(es.fileId), es.fileName, es.contentType || 'application/pdf', es.fileSize || 0,
        es.submittedAt || new Date(), es.marksAwarded || null, es.maxMarks || 0, es.feedback || '',
        es.isMarked ?? false, toId(es.claimedById), es.claimedByName || null, es.claimedAt || null,
        toId(es.markedById), es.markedByName || null, es.markedAt || null,
        es.isWorkloadSettled ?? false, es.workloadSettledAt || null, toId(es.workloadSettledBy),
        es.createdAt || new Date(), es.updatedAt || new Date()
      ]);
    }

    // 18. QuestionImages
    const questionImages = await mdb.collection('questionimages').find({}).toArray();
    console.log(`Migrating ${questionImages.length} question images...`);
    for (const qi of questionImages) {
      let buf = Buffer.isBuffer(qi.data) ? qi.data : qi.data?.buffer ? Buffer.from(qi.data.buffer) : Buffer.from(qi.data || '');
      await pool.query(`
        INSERT INTO question_images (id, filename, content_type, data, size, created_by_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          filename = EXCLUDED.filename,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(qi._id), qi.filename, qi.contentType, buf, qi.size || buf.length,
        toId(qi.createdById), qi.createdAt || new Date(), qi.updatedAt || new Date()
      ]);
    }

    // 19. AiTemplates
    const aiTemplates = await mdb.collection('aitemplates').find({}).toArray();
    console.log(`Migrating ${aiTemplates.length} AI templates...`);
    for (const at of aiTemplates) {
      await pool.query(`
        INSERT INTO ai_templates (id, title, description, subject_name, default_topic_name, target_category, question_format, short_answer_count, question_count, options_count, marks_per_question, difficulty, language, custom_instructions, is_preset, created_by_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(at._id), at.title, at.description || '', at.subjectName, at.defaultTopicName || '',
        at.targetCategory || 'ALL', at.questionFormat || 'MCQ_ONLY', at.shortAnswerCount || 0,
        at.questionCount || 10, at.optionsCount || 5, at.marksPerQuestion || 1,
        at.difficulty || 'MIXED', at.language || 'SINHALA', at.customInstructions || '',
        at.isPreset ?? false, toId(at.createdById), at.createdAt || new Date(), at.updatedAt || new Date()
      ]);
    }

    // 20. PdfImports
    const pdfImports = await mdb.collection('pdfimports').find({}).toArray();
    console.log(`Migrating ${pdfImports.length} PDF imports...`);
    for (const pi of pdfImports) {
      await pool.query(`
        INSERT INTO pdf_imports (id, filename, subject_name, topic_name, parsed_questions, validation_errors, status, quiz_id, created_by_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `, [
        toId(pi._id), pi.filename, pi.subjectName || '', pi.topicName || '',
        toJson(pi.parsedQuestions || []), toJson(pi.validationErrors || []),
        pi.status || 'PARSED', toId(pi.quizId), toId(pi.createdById),
        pi.createdAt || new Date(), pi.updatedAt || new Date()
      ]);
    }

    console.log('SUCCESS! ALL MongoDB documents have been successfully migrated to Supabase PostgreSQL!');
  } catch (err) {
    console.error('Data migration error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    await pool.end();
  }
}

runDataMigration();
