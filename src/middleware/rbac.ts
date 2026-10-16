import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError.js';
import { UserRole } from '../models/User.js';

export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required', 'UNAUTHORIZED'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Access denied. Insufficient permissions.', 'FORBIDDEN'));
    }

    next();
  };
};
