import { Router } from 'express';
import { PropertyRentController } from '../controllers/propertyRent.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { savePropertyRentSchema } from '../validators/propertyRent.validators';

const router = Router();
const controller = new PropertyRentController();

router.use(authenticate);

router.get('/property-rents/summary', authorize(['owner','manager','admin']), controller.summary);
router.get('/property-rents', authorize(['owner','manager','admin']), controller.list);
router.get('/property-rents/:propertyGroupId', authorize(['owner','manager','admin']), controller.get);
router.post('/property-rents', authorize(['owner','manager','admin']), validate(savePropertyRentSchema), controller.save);

export default router;
