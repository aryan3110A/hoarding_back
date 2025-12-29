import { Router } from 'express';
import { LocationController } from '../controllers/location.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const locationController = new LocationController();

router.post('/', authenticate, locationController.log);

export default router;
