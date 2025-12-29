import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ClientRepository } from '../repositories/client.repository';

const clientRepo = new ClientRepository();

export class ClientController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '100' } = req.query as Record<string, string | undefined>;
      const pageNum = parseInt(page || '1') || 1;
      const take = Math.min(Math.max(parseInt(limit || '100') || 50, 1), 1000);
      const skip = (pageNum - 1) * take;
      const clients = await clientRepo.findAll({ skip, take });
      res.status(200).json(ApiResponse.success(clients, 'Clients retrieved'));
    } catch (error) {
      next(error);
    }
  }
}
