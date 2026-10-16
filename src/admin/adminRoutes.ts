import { Router } from 'express';
import multer from 'multer';
import {
  getAdminDashboard,
  createAdminQuiz,
  getAdminQuizzes,
  getAdminQuizById,
  updateAdminQuiz,
  publishAdminQuiz,
  republishQuizAsNew,
  deleteAdminQuiz,
  uploadPdfForImport,
  parseRawTextForImport,
  getPdfImportDetails,
  updatePdfImportQuestions,
  convertPdfImportToQuiz,
  getQuizAnalyticsReport,
  downloadQuizReportPdf,
  downloadMonthlyReportPdf,
  getAdminProfile,
  updateAdminProfile,
  getStorageInfo,
  getPdfUploadConfig,
  triggerManualCleanup,
  getAdminCategories,
  createAdminCategory,
  deleteAdminCategory,
  getAdminInstitutes,
  createAdminInstitute,
  deleteAdminInstitute,
  downloadRegisteredStudentsPdf,
  getRegisteredStudentsList,
  resetUserPassword,
  uploadQuestionImage,
  createAdminSubject,
  getAdminSubjects,
  deleteAdminSubject,
  updateAdminQuizNumber,
  triggerTop100SmsForQuiz,
  sendTestSms,
  getTextLkBalance,
} from './adminController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { env } from '../config/env.js';

import {
  getMarkingPanelMembers,
  createMarkingPanelMember,
  deleteMarkingPanelMember,
  resetMarkingPanelPassword,
  getMarkingPanelWorkloadReport,
  clearPaperWorkloadCount,
  clearMarkerPaperWorkloadCount,
  restorePaperWorkloadCount,
  restoreMarkerPaperWorkloadCount,
} from './markingPanelController.js';
import {
  uploadEssayQuestionPaper,
  analyzeQuizEssayPaper,
  updateQuizEssayQuestions,
  generateFullPaperRankings,
} from '../quizzes/essayController.js';
import {
  getAiTemplates,
  createAiTemplate,
  updateAiTemplate,
  deleteAiTemplate,
  generateQuizWithAi,
} from './aiGeneratorController.js';

const upload = multer({
  limits: { fileSize: env.MAX_PDF_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max for question diagram
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (PNG, JPG, WebP, GIF, SVG)'));
    }
  },
});

const essayUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for essay question paper & student submissions
});

const syllabusUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for syllabus documents
});

const router = Router();

router.use(authenticateToken, requireRole('ADMIN'));

router.get('/dashboard', getAdminDashboard);
router.get('/profile', getAdminProfile);
router.put('/profile', updateAdminProfile);
router.get('/system/storage-info', getStorageInfo);
router.post('/system/monthly-cleanup', triggerManualCleanup);
router.post('/quizzes', createAdminQuiz);
router.get('/quizzes', getAdminQuizzes);
router.get('/quizzes/:id', getAdminQuizById);
router.put('/quizzes/:id', updateAdminQuiz);
router.patch('/quizzes/:id', updateAdminQuiz);
router.put('/quizzes/:id/settings', updateAdminQuiz);
router.patch('/quizzes/:id/settings', updateAdminQuiz);
router.post('/quizzes/:id/publish', publishAdminQuiz);
router.post('/quizzes/:id/republish', republishQuizAsNew);
router.delete('/quizzes/:id', deleteAdminQuiz);
router.patch('/quizzes/:id/quiz-number', updateAdminQuizNumber);
router.put('/quizzes/:id/quiz-number', updateAdminQuizNumber);

// Question image upload endpoint
router.post('/questions/upload-image', imageUpload.single('image'), uploadQuestionImage);

router.get('/pdf/config', getPdfUploadConfig);
router.post('/pdf/upload', upload.single('pdf'), uploadPdfForImport);
router.post('/pdf/text', parseRawTextForImport);
router.get('/pdf/:id', getPdfImportDetails);
router.put('/pdf/:id/questions', updatePdfImportQuestions);
router.post('/pdf/:id/publish-quiz', convertPdfImportToQuiz);

// AI Automated Quiz & Template Generation Routes
router.get('/ai-templates', getAiTemplates);
router.post('/ai-templates', createAiTemplate);
router.put('/ai-templates/:id', updateAiTemplate);
router.delete('/ai-templates/:id', deleteAiTemplate);
router.post('/ai-generator/generate', syllabusUpload.single('syllabusFile'), generateQuizWithAi);

router.get('/quizzes/:id/report', getQuizAnalyticsReport);
router.get('/reports/:quizId/pdf', downloadQuizReportPdf);
router.get('/reports/monthly/:year/:month/pdf', downloadMonthlyReportPdf);

router.get('/categories', getAdminCategories);
router.post('/categories', createAdminCategory);
router.delete('/categories/:id', deleteAdminCategory);

router.get('/institutes', getAdminInstitutes);
router.post('/institutes', createAdminInstitute);
router.delete('/institutes/:id', deleteAdminInstitute);

router.get('/subjects', getAdminSubjects);
router.post('/subjects', createAdminSubject);
router.delete('/subjects/:id', deleteAdminSubject);

router.get('/students/pdf', downloadRegisteredStudentsPdf);
router.get('/students', getRegisteredStudentsList);
router.post('/users/reset-password', resetUserPassword);
router.post('/users/:id/reset-password', (req, res, next) => {
  req.body.userId = req.params.id;
  return resetUserPassword(req, res, next);
});

// Marking Panel Management Routes
router.get('/panel-members/workload-report', getMarkingPanelWorkloadReport);
router.post('/panel-members/workload/paper/:quizId/clear', clearPaperWorkloadCount);
router.delete('/panel-members/workload/paper/:quizId', clearPaperWorkloadCount);
router.post('/panel-members/workload/paper/:quizId/marker/:memberId/clear', clearMarkerPaperWorkloadCount);
router.delete('/panel-members/workload/paper/:quizId/marker/:memberId', clearMarkerPaperWorkloadCount);
router.post('/panel-members/workload/paper/:quizId/restore', restorePaperWorkloadCount);
router.post('/panel-members/workload/paper/:quizId/marker/:memberId/restore', restoreMarkerPaperWorkloadCount);
router.get('/panel-members', getMarkingPanelMembers);
router.post('/panel-members', createMarkingPanelMember);
router.delete('/panel-members/:id', deleteMarkingPanelMember);
router.post('/panel-members/:id/reset-password', resetMarkingPanelPassword);

// Quiz Essay Configuration & Full Paper Routes
router.post('/quizzes/:id/essay-paper', essayUpload.single('file'), uploadEssayQuestionPaper);
router.post('/quizzes/:id/analyze-essay-paper', analyzeQuizEssayPaper);
router.put('/quizzes/:id/essay-questions', updateQuizEssayQuestions);
router.post('/quizzes/:quizId/full-paper-rankings', generateFullPaperRankings);

// Text.lk Automated & Manual SMS Routes
router.post('/quizzes/:id/send-top100-sms', triggerTop100SmsForQuiz);
router.post('/sms/test', sendTestSms);
router.get('/sms/balance', getTextLkBalance);

export default router;
