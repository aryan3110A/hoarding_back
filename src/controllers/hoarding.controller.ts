import { Request, Response, NextFunction } from 'express';
import { HoardingService } from '../services/hoarding.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const hoardingService = new HoardingService();

export class HoardingController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const hoarding = await hoardingService.create(req.body);
      res.status(201).json(ApiResponse.success(hoarding, 'Hoarding created'));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const hoarding = await hoardingService.update(id, req.body);
      res.status(200).json(ApiResponse.success(hoarding, 'Hoarding updated'));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const hoarding = await hoardingService.getById(id);
      if (!hoarding) {
        return res.status(404).json(ApiResponse.error('Hoarding not found'));
      }
      res.status(200).json(ApiResponse.success(hoarding));
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Pass user for territory filtering (sales users)
      const result = await hoardingService.getAll(req.query, req.user);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  async getAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const availability = await hoardingService.getAvailability(id);
      res.status(200).json(ApiResponse.success(availability));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await hoardingService.delete(id);
      res.status(200).json(ApiResponse.success(null, 'Hoarding deleted'));
    } catch (error) {
      next(error);
    }
  }

  async addImages(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { type, filenames } = req.body as { type?: string; filenames?: string[] };
      if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json(ApiResponse.error('No filenames provided'));
      }
      const result = await hoardingService.addImageMetadata(id, {
        type: type || 'default',
        filenames,
      });
      res.status(200).json(ApiResponse.success(result, 'Image metadata added'));
    } catch (error) {
      next(error);
    }
  }

  async markUnderProcess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updated = await hoardingService.markUnderProcess(id, {
        id: req.user?.id,
        roleName: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Status updated'));
    } catch (error) {
      next(error);
    }
  }

  async finalizeStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body as { status?: string };
      if (!status) return res.status(400).json(ApiResponse.error('Status is required'));
      const updated = await hoardingService.finalizeWorkflowStatus(id, String(status), {
        id: req.user?.id,
        roleName: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Status updated'));
    } catch (error) {
      next(error);
    }
  }
}
