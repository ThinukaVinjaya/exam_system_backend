import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, IUser } from '../models/User.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { AdminProfile } from '../models/AdminProfile.js';
import { MarkingPanelProfile } from '../models/MarkingPanelProfile.js';
import { EmailOtp } from '../models/EmailOtp.js';
import { Category, formatCategoryName } from '../models/Category.js';
import { Institute } from '../models/Institute.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { sendOtpEmail } from '../utils/emailService.js';
import { isValidSriLankanPhone, normalizeSriLankanPhone } from '../utils/phoneValidator.js';

export const sendOtpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  fullName: z.string().optional(),
  username: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required (minimum 2 characters)'),
  username: z.string().min(3, 'Username must be at least 3 characters').regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain letters, numbers, dots, and underscores'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  email: z.string().email('Valid email address is required'),
  phoneNumber: z.string().min(9, 'Valid Sri Lankan phone number is required').optional(),
  whatsappNumber: z.string().min(9, 'Valid Sri Lankan WhatsApp number is required').optional(),
  school: z.string().min(2, 'School name is required'),
  grade: z.number().min(1).max(13).optional(),
  alYear: z.string().optional(),
  institute: z.string().optional(),
  provinceId: z.string().min(1, 'Province is required'),
  districtId: z.string().min(1, 'District is required'),
  otp: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(1, 'Password is required'),
});

function generateTokens(user: IUser) {
  const payload = { userId: user._id, username: user.username, role: user.role };
  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

export async function sendRegistrationOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, fullName, username, phoneNumber } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new ApiError(400, 'A valid email address is required.', 'INVALID_EMAIL');
    }

    // Check if email already registered
    const existingUserByEmail = await User.findOne({ email: cleanEmail });
    const existingStudentByEmail = await StudentProfile.findOne({ email: cleanEmail });
    if (existingUserByEmail || existingStudentByEmail) {
      throw new ApiError(400, 'This email address is already registered. Please sign in instead.', 'EMAIL_EXISTS');
    }

    // Check if username already registered
    if (username) {
      const cleanUsername = username.trim().toLowerCase();
      const existingUserByUsername = await User.findOne({ username: cleanUsername });
      if (existingUserByUsername) {
        throw new ApiError(400, 'This username is already taken. Please choose another username.', 'USERNAME_EXISTS');
      }
    }

    // Check phone number if provided
    if (phoneNumber && !isValidSriLankanPhone(phoneNumber)) {
      throw new ApiError(400, 'Please enter a valid Sri Lankan mobile number (e.g. 0771234567 or +94771234567).', 'INVALID_PHONE');
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store or replace OTP
    await EmailOtp.deleteMany({ email: cleanEmail });
    await EmailOtp.create({
      email: cleanEmail,
      otp,
      expiresAt,
    });

    // Send email
    await sendOtpEmail({ email: cleanEmail, otp, fullName });

    res.json({
      success: true,
      message: `Verification code sent to ${cleanEmail}. Please check your inbox.`,
      // For development convenience if SMTP is unconfigured
      devOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    });
  } catch (err) {
    next(err);
  }
}

export async function registerStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body;
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const cleanUsername = (data.username || '').trim().toLowerCase();
    const rawWhatsapp = (data.whatsappNumber || '').trim();
    const rawPhone = (data.phoneNumber || data.whatsappNumber || '').trim();

    if (!cleanEmail) {
      throw new ApiError(400, 'Email address is required', 'EMAIL_REQUIRED');
    }

    if (!rawWhatsapp && !rawPhone) {
      throw new ApiError(400, 'WhatsApp number and SMS contact number are required.', 'PHONE_REQUIRED');
    }

    if (rawWhatsapp && !isValidSriLankanPhone(rawWhatsapp)) {
      throw new ApiError(400, 'Please enter a valid Sri Lankan WhatsApp number (e.g. 0771234567 or +94771234567)', 'INVALID_WHATSAPP_PHONE');
    }

    if (rawPhone && !isValidSriLankanPhone(rawPhone)) {
      throw new ApiError(400, 'Please enter a valid Sri Lankan SMS contact number (e.g. 0771234567 or +94771234567)', 'INVALID_SMS_PHONE');
    }

    const cleanWhatsapp = rawWhatsapp ? normalizeSriLankanPhone(rawWhatsapp) : normalizeSriLankanPhone(rawPhone);
    const cleanPhone = rawPhone ? normalizeSriLankanPhone(rawPhone) : cleanWhatsapp;

    // Check duplicate username or email
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }],
    });
    if (existingUser) {
      throw new ApiError(400, 'Username or email already in use. Please sign in.', 'USER_EXISTS');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      role: 'STUDENT',
    });

    const rawAlYear = (data.alYear || '').trim();
    if (!rawAlYear) {
      throw new ApiError(400, 'Please select your A/L Examination Year.', 'CATEGORY_REQUIRED');
    }

    const formattedAlYear = formatCategoryName(rawAlYear) || rawAlYear;
    // Students can only select from categories added by admin
    const existingCategory = await Category.findOne({
      $or: [{ name: formattedAlYear }, { name: rawAlYear }, { normalizedName: formattedAlYear.toLowerCase() }],
      isActive: true,
    });

    if (!existingCategory) {
      throw new ApiError(400, `Selected category "${rawAlYear}" is invalid. Students can only select existing categories.`, 'INVALID_CATEGORY');
    }

    const finalAlYear = existingCategory.name;

    const rawInstitute = (data.institute || 'None').trim();
    let finalInstitute = 'None';
    if (rawInstitute) {
      const existingInst = await Institute.findOne({
        $or: [
          { name: rawInstitute },
          { normalizedName: rawInstitute.toLowerCase() },
        ],
        isActive: true,
      });
      finalInstitute = existingInst ? existingInst.name : (rawInstitute || 'None');
    }

    const studentProfile = await StudentProfile.create({
      userId: user._id,
      fullName: data.fullName.trim(),
      username: cleanUsername,
      email: cleanEmail,
      phoneNumber: cleanPhone,
      whatsappNumber: cleanWhatsapp,
      school: data.school ? data.school.trim() : '',
      grade: data.grade ? Number(data.grade) : undefined,
      alYear: finalAlYear,
      institute: finalInstitute,
      provinceId: data.provinceId,
      districtId: data.districtId,
      isEmailVerified: true,
    });

    const tokens = generateTokens(user);

    res.status(201).json({
      success: true,
      message: 'Student account created successfully!',
      data: {
        tokens,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          fullName: studentProfile.fullName,
          alYear: studentProfile.alYear,
          phoneNumber: studentProfile.phoneNumber,
          whatsappNumber: studentProfile.whatsappNumber,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const identifier = (req.body.username || req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!identifier) {
      throw new ApiError(400, 'Username or Email is required', 'MISSING_CREDENTIALS');
    }

    // Find user by username or email
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    if (!user) {
      throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
    }

    let fullName = user.username;
    let alYear: string | undefined;
    let phoneNumber: string | undefined;
    let whatsappNumber: string | undefined;
    if (user.role === 'STUDENT') {
      const sp = await StudentProfile.findOne({ userId: user._id });
      if (sp) {
        fullName = sp.fullName;
        alYear = sp.alYear;
        phoneNumber = sp.phoneNumber;
        whatsappNumber = sp.whatsappNumber || sp.phoneNumber;
      }
    } else if (user.role === 'ADMIN') {
      const ap = await AdminProfile.findOne({ userId: user._id });
      if (ap) {
        fullName = ap.name;
        ap.lastLogin = new Date();
        await ap.save();
      }
    } else if (user.role === 'MARKING_PANEL') {
      const mp = await MarkingPanelProfile.findOne({ userId: user._id });
      if (mp) {
        fullName = mp.name;
        phoneNumber = mp.phoneNumber;
      }
    }

    const tokens = generateTokens(user);

    res.json({
      success: true,
      message: 'Sign in successful',
      data: {
        tokens,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          fullName,
          alYear,
          phoneNumber,
          whatsappNumber,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body;
    if (!token) {
      throw new ApiError(400, 'Refresh token is required', 'TOKEN_REQUIRED');
    }

    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as any;
    const user = await User.findById(payload.userId);
    if (!user) {
      throw new ApiError(401, 'User not found or inactive', 'USER_NOT_FOUND');
    }

    const tokens = generateTokens(user);
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN'));
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'Both current and new password are required.', 'MISSING_FIELDS');
    }

    if (newPassword.length < 6) {
      throw new ApiError(400, 'New password must be at least 6 characters long.', 'PASSWORD_TOO_SHORT');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User account not found.', 'USER_NOT_FOUND');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(400, 'Current password is incorrect.', 'INCORRECT_PASSWORD');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully!',
    });
  } catch (err) {
    next(err);
  }
}
