import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';
import deviceRoutes from './device.routes';
import locationRoutes from './location.routes';
import hoardingRoutes from './hoarding.routes';
import bookingRoutes from './booking.routes';
import enquiryRoutes from './enquiry.routes';
import contractRoutes from './contract.routes';
import clientRoutes from './client.routes';

import rentRoutes from './rent.routes';
import notificationRoutes from './notification.routes';
import reminderRoutes from './reminder.routes';
import dashboardRoutes from './dashboard.routes';
import propertyRentRoutes from './propertyRent.routes';
import bookingTokenRoutes from './bookingToken.routes';
import eventsRoutes from './events.routes';
import proposalsRoutes from './proposals.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/devices', deviceRoutes);
router.use('/locations', locationRoutes);
router.use('/hoardings', hoardingRoutes);
router.use('/hoardings', rentRoutes);
router.use('/bookings', bookingRoutes);
router.use('/booking-tokens', bookingTokenRoutes);
router.use('/events', eventsRoutes);
router.use('/proposals', proposalsRoutes);
router.use('/enquiries', enquiryRoutes);
router.use('/contracts', contractRoutes);
router.use('/clients', clientRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reminders', reminderRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/', propertyRentRoutes);

export default router;
