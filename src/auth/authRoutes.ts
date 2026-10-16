import { Router } from 'express';
import {
  registerStudent,
  login,
  refreshToken,
  sendRegistrationOtp,
  changePassword,
  registerSchema,
  loginSchema,
  sendOtpSchema,
} from './authController.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticateToken } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 10000, // Accommodate 2000-4000+ students logging in simultaneously from the same school / exam hall NAT IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a few minutes and try again.', code: 'RATE_LIMITED' },
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification requests. Please wait a few minutes.', code: 'RATE_LIMITED' },
});

router.post('/send-registration-otp', otpLimiter, validateRequest(sendOtpSchema), sendRegistrationOtp);
router.post('/register', validateRequest(registerSchema), registerStudent);
router.post('/login', loginLimiter, validateRequest(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/change-password', authenticateToken, changePassword);

export default router;
