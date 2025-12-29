import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { ApiResponse } from '../lib/apiResponse';
import { logger } from '../lib/logger';
import { config } from '../config';

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error(err);

    if (err instanceof AppError) {
        return res.status(err.statusCode).json(
            ApiResponse.error(err.message, err.details)
        );
    }

    return res.status(500).json(
        ApiResponse.error('Internal Server Error', config.nodeEnv === 'development' ? err : undefined)
    );
};
