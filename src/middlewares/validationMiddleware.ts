import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Request, Response, NextFunction } from 'express';

export const validationMiddleware = (type: any) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const input = plainToInstance(type, req.body);
    const errors = await validate(input);

    if (errors.length > 0) {
      return res.status(400).json({ errors: errors.map(err => err.constraints) });
    }

    next();
  };
};