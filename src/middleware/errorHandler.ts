import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  let statusCode = err instanceof ApiError ? err.statusCode : 500;
  let message = err.message || 'An unexpected error occurred';
  let code = err instanceof ApiError ? err.code : 'INTERNAL_SERVER_ERROR';

  if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
    statusCode = 409;
    message = 'This record already exists in the system (Duplicate entry).';
    code = 'DUPLICATE_ENTRY';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    message = `File size exceeds the maximum limit of ${env.MAX_PDF_SIZE_MB}MB.`;
    code = 'FILE_TOO_LARGE';
  }

  if (statusCode >= 500) {
    logger.error('Unhandled Server Error:', { message: err.message, stack: err.stack });
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
