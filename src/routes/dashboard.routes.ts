import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const dashboardController = new DashboardController();

router.use(authenticate);

// Owner full dashboard (restrict to owner/admin only per spec)
router.get(
    '/owner',
    authorize(['admin', 'owner']),
    dashboardController.getOwnerDashboard
);

// Manager dashboard (summary + due list)
router.get(
    '/manager',
    authorize(['admin', 'owner', 'manager']),
    dashboardController.getManagerDashboard
);

// Sales basic dashboard
router.get(
    '/sales',
    authorize(['admin', 'owner', 'manager', 'sales']),
    dashboardController.getSalesDashboard
);

// Designer minimal dashboard
router.get(
    '/designer',
    authorize(['admin', 'owner', 'manager', 'designer']),
    dashboardController.getDesignerDashboard
);

// Fitter minimal dashboard
router.get(
    '/fitter',
    authorize(['admin', 'owner', 'manager', 'fitter']),
    dashboardController.getFitterDashboard
);

export default router;
