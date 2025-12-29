import { Response, NextFunction } from 'express';
import { PropertyRentService } from '../services/propertyRent.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const service = new PropertyRentService();

export class PropertyRentController {
  async save(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Pass the authenticated user as actor so service can omit actor from notifications
      const actor = req.user;
      const rent = await service.save(req.body, actor as any);
      res.status(200).json(ApiResponse.success(rent, 'Property rent saved'));
    } catch (e) { next(e); }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { propertyGroupId } = req.params;
      try {
        const rent = await service.get(propertyGroupId);
        return res.status(200).json(ApiResponse.success(rent));
      } catch (err: any) {
        // Soft-not-found: return empty data without logging as error
        if (err && err.name === 'NotFoundError') {
          return res.status(200).json(ApiResponse.success(null, 'Property rent not found'));
        }
        throw err;
      }
    } catch (e) { next(e); }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 100 } = req.query;
      const p = parseInt(page as string) || 1;
      const l = parseInt(limit as string) || 100;
      const skip = (p - 1) * l;
      const result = await service.list({ skip, take: l });
      res.status(200).json(ApiResponse.success(result));
    } catch (e) { next(e); }
  }

  async summary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await service.summary();
      res.status(200).json(ApiResponse.success(stats));
    } catch (e) { next(e); }
  }
}
