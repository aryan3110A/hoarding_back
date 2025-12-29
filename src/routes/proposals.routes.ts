import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { ProposalsController } from '../controllers/proposals.controller';

const router = Router();
const controller = new ProposalsController();

// Sales can generate proposal PDFs
router.post(
  '/pdf',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.generatePdf,
);

// Create proposal (sales)
router.post(
  '/',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.create,
);

// List proposals (sales can see own proposals)
router.get('/', authenticate, authorize(['sales', 'owner', 'manager', 'admin']), controller.list);

// Get proposal by id
router.get(
  '/:id',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.getById,
);

// Get proposal PDF by id
router.get(
  '/:id/pdf',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.generatePdfById,
);

export default router;
