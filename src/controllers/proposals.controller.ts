import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ApiResponse } from '../lib/apiResponse';
import { ProposalsService } from '../services/proposals.service';

const service = new ProposalsService();

export class ProposalsController {
  async generatePdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { hoardings, client } = req.body as { hoardings: string[]; client?: any };
      if (!Array.isArray(hoardings) || hoardings.length === 0) {
        return res.status(400).json(ApiResponse.error('No hoardings provided'));
      }

      // Service will stream a PDF buffer back
      const pdfBuffer = await service.generateProposalPdf({
        hoardingIds: hoardings,
        client,
        actorId: req.user.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=proposal.pdf');
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { client, hoardings } = req.body as {
        client: { name: string; phone: string; email?: string; companyName?: string };
        hoardings: string[];
      };
      if (!client || !client.phone || !Array.isArray(hoardings) || hoardings.length === 0) {
        return res.status(400).json(ApiResponse.error('Invalid request'));
      }
      const created = await service.createProposal({
        client,
        hoardingIds: hoardings,
        salesUserId: req.user.id,
      });
      res.status(201).json(ApiResponse.success(created));
    } catch (err) {
      next(err);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const rows = await service.listProposals({ salesUserId: req.user.id });
      res.status(200).json(ApiResponse.success(rows));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const row = await service.getProposalById(String(id));
      if (!row) return res.status(404).json(ApiResponse.error('Not found'));
      res.status(200).json(ApiResponse.success(row));
    } catch (err) {
      next(err);
    }
  }

  async generatePdfById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const proposal = await service.getProposalById(String(id));
      if (!proposal) return res.status(404).json(ApiResponse.error('Not found'));

      // Collect hoarding ids and client
      const hoardingIds = (proposal.hoardings || [])
        .map((ph: any) => ph.hoardingId || ph.hoarding?.id)
        .filter(Boolean);
      const client = proposal.client || undefined;

      const pdfBuffer = await service.generateProposalPdf({
        hoardingIds,
        client,
        actorId: req.user.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=proposal-${id}.pdf`);
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }
}
