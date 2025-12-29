import { Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const dashboardService = new DashboardService();

export class DashboardController {
    async getOwnerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const stats = await dashboardService.getOwnerDashboardStats();
            res.status(200).json(ApiResponse.success(stats));
        } catch (error) {
            next(error);
        }
    }

    async getManagerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const stats = await dashboardService.getManagerDashboardStats();
            res.status(200).json(ApiResponse.success(stats));
        } catch (error) {
            next(error);
        }
    }

    async getSalesDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const stats = await dashboardService.getSalesDashboardStats(userId);
            res.status(200).json(ApiResponse.success(stats));
        } catch (error) {
            next(error);
        }
    }

    async getDesignerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const stats = await dashboardService.getDesignerDashboardStats(userId);
            res.status(200).json(ApiResponse.success(stats));
        } catch (error) {
            next(error);
        }
    }

    async getFitterDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const stats = await dashboardService.getFitterDashboardStats(userId);
            res.status(200).json(ApiResponse.success(stats));
        } catch (error) {
            next(error);
        }
    }
}
