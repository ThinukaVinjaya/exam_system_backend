import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { UserRole } from '../models/User.js';

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const authenticateToken = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token =
    (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) ||
    (typeof req.query.token === 'string' ? req.query.token : null);

  if (!token) {
    return next(new ApiError(401, 'Authentication token required', 'UNAUTHORIZED'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Token expired', 'TOKEN_EXPIRED'));
    }
    return next(new ApiError(403, 'Invalid token', 'INVALID_TOKEN'));
  }
};
