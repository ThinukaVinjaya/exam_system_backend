import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getPanelQuizzes,
  getPanelQuizSubmissions,
  downloadStudentAnswerFile,
  markStudentEssay,
  claimStudentEssay,
  unclaimStudentEssay,
  generateFullPaperRankings,
  analyzeQuizEssayPaper,
  aiSuggestStudentEssayMarks,
  updateQuizEssayQuestions,
} from '../quizzes/essayController.js';

const router = Router();

// Panel members and Admins have access
router.use(authenticateToken, requireRole('MARKING_PANEL', 'ADMIN'));

router.get('/quizzes', getPanelQuizzes);
router.get('/quizzes/:quizId/submissions', getPanelQuizSubmissions);
router.post('/quizzes/:quizId/analyze-essay-paper', analyzeQuizEssayPaper);
router.put('/quizzes/:quizId/essay-questions', updateQuizEssayQuestions);
router.get('/submissions/:submissionId/file', downloadStudentAnswerFile);
router.post('/submissions/:submissionId/claim', claimStudentEssay);
router.post('/submissions/:submissionId/unclaim', unclaimStudentEssay);
router.post('/submissions/:submissionId/ai-suggest', aiSuggestStudentEssayMarks);
router.post('/submissions/:submissionId/mark', markStudentEssay);
router.post('/quizzes/:quizId/calculate-full-paper-rankings', generateFullPaperRankings);

export default router;
