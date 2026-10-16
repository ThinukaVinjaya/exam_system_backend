import { Router } from 'express';
import { getStudentProfile, updateStudentProfile, getStudentPerformance, getStudentMonthlyAnalytics } from './studentController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(authenticateToken, requireRole('STUDENT'));

router.get('/profile', getStudentProfile);
router.put('/profile', updateStudentProfile);
router.get('/performance', getStudentPerformance);
router.get('/monthly-report', getStudentMonthlyAnalytics);

export default router;
