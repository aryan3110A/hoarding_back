import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { ApiResponse } from '../lib/apiResponse';

const authService = new AuthService();

export class AuthController {
    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await authService.login({
                ...req.body,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });
            res.status(200).json(ApiResponse.success(result, 'Login successful'));
        } catch (error) {
            next(error);
        }
    }

    async refresh(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await authService.refresh(req.body.refreshToken);
            res.status(200).json(ApiResponse.success(result, 'Token refreshed'));
        } catch (error) {
            next(error);
        }
    }

    async logout(req: Request, res: Response, next: NextFunction) {
        try {
            await authService.logout(req.body.refreshToken);
            res.status(200).json(ApiResponse.success(null, 'Logout successful'));
        } catch (error) {
            next(error);
        }
    }
}
