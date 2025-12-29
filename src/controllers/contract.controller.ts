import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

export class ContractController {
    async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            // Placeholder - return empty array for now
            res.status(200).json(ApiResponse.success([], 'Contracts retrieved'));
        } catch (error) {
            next(error);
        }
    }
}

