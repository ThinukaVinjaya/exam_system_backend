import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  getStudentQuizzes,
  getQuizForStudent,
  getPublicQuizDetails,
  startQuizAttempt,
  saveAnswer,
  submitQuizAttempt,
  getQuizResult,
  getQuizRankings,
  getQuestionImage,
} from './quizController.js';
import {
  getEssayQuestionPaper,
  getEssayInfoForStudent,
  submitStudentEssay,
  downloadStudentAnswerFile,
} from './essayController.js';
import { authenticateToken } from '../middleware/auth.js';
import { getNextQuizNumber, resequenceAllQuizNumbers } from './quizNumberService.js';

const essayUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

const router = Router();

// Public route to download essay question paper
router.get('/:id/essay-paper', getEssayQuestionPaper);

// Public route to serve question images
router.get('/images/:id', getQuestionImage);

// Route to get next sequential quiz number for creators
router.get('/next-number', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const nextNumber = await getNextQuizNumber();
    res.json({ success: true, data: { nextQuizNumber: nextNumber } });
  } catch (err) {
    next(err);
  }
});

// Route to resequence all quiz numbers
router.post('/resequence', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await resequenceAllQuizNumbers();
    res.json({ success: true, message: 'All quizzes resequenced successfully.' });
  } catch (err) {
    next(err);
  }
});

// Public route for shared link preview
router.get('/public/:id', getPublicQuizDetails);

router.use(authenticateToken);

router.get('/', getStudentQuizzes);
router.get('/:id', getQuizForStudent);
router.post('/:id/attempt', startQuizAttempt);
router.post('/attempts/:id/answer', saveAnswer);
router.post('/attempts/:id/submit', submitQuizAttempt);
router.get('/results/:id', getQuizResult);
router.get('/:quizId/rankings', getQuizRankings);

// Student Essay Routes
router.get('/:id/essay-info', getEssayInfoForStudent);
router.post('/:id/essay-submit', essayUpload.single('file'), submitStudentEssay);
router.get('/essay-submissions/:submissionId/file', downloadStudentAnswerFile);

export default router;
