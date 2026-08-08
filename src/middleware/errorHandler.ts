// backend/src/middleware/errorHandler.ts
// Global Express error handler — always the LAST middleware registered.
// Normalises any thrown error into the standard API error envelope:
//   { error: { code: string, message: string } }

import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';
  const message =
    statusCode === 500 && process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message;

  if (statusCode >= 500) {
    console.error('[ErrorHandler]', err);
  }

  res.status(statusCode).json({ error: { code, message } });
}

/** Factory to create well-typed HTTP errors. */
export function createError(statusCode: number, code: string, message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
