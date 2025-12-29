import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { BlockHoardingController } from '../controllers/bookingToken.controller';
import { installationProofUpload } from '../middleware/upload.middleware';

const router = Router();
const controller = new BlockHoardingController();

// Sales can create blocks; admins can confirm; sales can cancel own
router.post(
  '/',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.create,
);
router.get('/recent', authenticate, authorize(['owner', 'manager', 'admin']), controller.recent);

// NOTE: keep fixed routes above '/:id' to avoid shadowing
router.get(
  '/mine',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.mine,
);

router.get('/assigned', authenticate, authorize(['designer']), controller.assignedToMe);

// Owner/Manager can list fitters for assignment
router.get('/fitters', authenticate, authorize(['owner', 'manager', 'admin']), controller.fitters);

// Fitter can list assigned installation jobs
router.get(
  '/assigned-installations',
  authenticate,
  authorize(['fitter']),
  controller.assignedInstallations,
);

router.get(
  '/:id',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin', 'designer', 'fitter']),
  controller.getById,
);
router.post(
  '/:id/confirm',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales']),
  controller.confirm,
);

// Designer can update design status for an assigned token
router.put(
  '/:id/design-status',
  authenticate,
  authorize(['designer']),
  controller.updateDesignStatus,
);

// Owner/Manager assigns fitter after design completion
router.put(
  '/:id/assign-fitter',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  controller.assignFitter,
);

// Fitter updates installation status
router.put(
  '/:id/fitter-status',
  authenticate,
  authorize(['fitter']),
  controller.updateFitterStatus,
);

// Fitter submits completion with proof images (required)
router.post(
  '/:id/complete-installation',
  authenticate,
  authorize(['fitter']),
  installationProofUpload.array('images', 10),
  controller.completeInstallation,
);
router.post(
  '/:id/cancel',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.cancel,
);

export default router;
