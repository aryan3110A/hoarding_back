import { Router } from 'express';
import { ClientController } from '../controllers/client.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const clientController = new ClientController();

router.get('/', authenticate, authorize(['owner', 'manager', 'sales', 'admin']), clientController.getAll);

export default router;

