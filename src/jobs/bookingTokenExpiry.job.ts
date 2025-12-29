import { BlockHoardingService } from '../services/bookingToken.service';

const svc = new BlockHoardingService();

export function startBookingTokenExpiryJob(intervalMinutes = 10) {
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    svc.expireAndPromote().catch((e) => console.error('[BookingTokenExpiryJob] error', e));
  }, intervalMs);
}
