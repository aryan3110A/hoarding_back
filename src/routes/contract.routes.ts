import { Router } from 'express';
import { ContractController } from '../controllers/contract.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const contractController = new ContractController();

router.get('/', authenticate, authorize(['owner', 'manager', 'admin']), contractController.getAll);

export default router;

