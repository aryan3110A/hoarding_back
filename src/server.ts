import app from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { getRedis } from './lib/redis';
import { cleanupSessions } from './jobs/sessionCleanup.job';
import { ReminderJob } from './jobs/reminder.job';
import { startBookingTokenExpiryJob } from './jobs/bookingTokenExpiry.job';

export const startServer = async () => {
  try {
    // Test Database Connection
    await prisma.$connect();
    logger.info('Database connected');

    // Redis connection is handled in lib/redis.ts events; quick check when enabled
    const redis = getRedis();
    if (redis) {
      try {
        await redis.ping();
        logger.info('Redis connected (ping)');
      } catch (err) {
        logger.warn('Redis enabled but ping failed, continuing without Redis');
      }
    } else {
      logger.info('Redis disabled, skipping ping');
    }

    // Start Session Cleanup Job (Run every hour)
    setInterval(
      () => {
        cleanupSessions().catch((err) => logger.error('Session cleanup error:', err));
      },
      60 * 60 * 1000,
    );

    // Start Rent Reminder Job (Run every 24 hours)
    const reminderJob = new ReminderJob();
    // Run immediately on startup for demo purposes, then every 24 hours
    reminderJob
      .sendRentReminders()
      .catch((err) => logger.error('Initial rent reminder job error:', err));

    setInterval(
      () => {
        reminderJob
          .sendRentReminders()
          .catch((err) => logger.error('Rent reminder job error:', err));
      },
      24 * 60 * 60 * 1000,
    );

    // Start Booking Token Expiry/Promotion Job (every 10 minutes)
    startBookingTokenExpiryJob(10);

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};
