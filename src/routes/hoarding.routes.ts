import { Router } from 'express';
import { HoardingController } from '../controllers/hoarding.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { createHoardingSchema, updateHoardingSchema } from '../validators/hoarding.validators';

const router = Router();
const hoardingController = new HoardingController();

router.get('/', authenticate, hoardingController.getAll);
router.get('/:id/availability', authenticate, hoardingController.getAvailability);
router.get('/:id', authenticate, hoardingController.getById);

// CRUD operations - Owner and Manager can create, update, delete
// Sales can only view (filtered by territory)
router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  validate(createHoardingSchema),
  hoardingController.create,
);

// Add image metadata (filenames) for a hoarding
router.post(
  '/:id/images',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.addImages,
);

// Manager marks hoarding Under Process after token payment received
router.post(
  '/:id/under-process',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.markUnderProcess,
);

// Finalize operational workflow after fitting
router.post(
  '/:id/finalize-status',
  authenticate,
  authorize(['owner', 'manager', 'sales']),
  hoardingController.finalizeStatus,
);

router.put(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  validate(updateHoardingSchema),
  hoardingController.update,
);

router.delete(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.delete,
);

export default router;
