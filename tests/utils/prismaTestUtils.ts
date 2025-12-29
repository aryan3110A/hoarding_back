import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';

export async function resetDatabase() {
  // Truncate tables in correct order (respecting foreign keys)
  const tables = [
    'AuditLog',
    'Booking',
    'LocationLog',
    'RefreshSession',
    'UserDevice',
    'UserTerritory',
    'Hoarding',
    'Territory',
    'User',
    'Role',
  ];

  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
}

export async function seedTestData() {
  // Create roles
  await prisma.role.createMany({
    data: [
      { id: 1, name: 'admin' },
      { id: 2, name: 'sales' },
      { id: 3, name: 'accounts' },
      { id: 4, name: 'ops' },
    ],
    skipDuplicates: true,
  });

  // Create admin user (password: Admin@123)
  const bcrypt = require('bcrypt');
  const hashedPassword = await bcrypt.hash('Admin@123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@hoarding.local' },
    update: {},
    create: {
      name: 'System Admin',
      email: 'admin@hoarding.local',
      password: hashedPassword,
      roleId: 1,
      isActive: true,
    },
  });
}

export async function cleanupTestData() {
  await prisma.$disconnect();
  const r = redis as unknown as {
    quit?: () => Promise<unknown> | unknown;
    disconnect?: () => Promise<unknown> | unknown;
  };
  if (typeof r.quit === 'function') {
    await r.quit();
    return;
  }
  if (typeof r.disconnect === 'function') {
    await r.disconnect();
  }
}
