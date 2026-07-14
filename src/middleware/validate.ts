// backend/src/middleware/validate.ts
// Zod request validation middleware factory.
// Usage: router.post('/route', validate({ body: MySchema }), controller)
// Controllers never see malformed data — validation errors are returned as 400.

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidateSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          },
        });
      } else {
        next(err);
      }
    }
  };
}
