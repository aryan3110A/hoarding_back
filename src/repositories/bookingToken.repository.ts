/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '../lib/prisma';

export class BookingTokenRepository {
  async create(data: Record<string, unknown>): Promise<unknown> {
    return (prisma as any).bookingToken.create({ data });
  }

  async findActiveOverlaps(hoardingId: string, from: Date, to: Date): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: {
        hoardingId,
        status: 'ACTIVE',
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
      },
      orderBy: { queuePosition: 'asc' },
    });
  }

  async findQueue(hoardingId: string, from: Date, to: Date): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: {
        hoardingId,
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
        status: { in: ['ACTIVE', 'CONFIRMED'] },
      },
      orderBy: { queuePosition: 'asc' },
    });
  }

  async updateStatus(
    id: string,
    status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED',
  ): Promise<unknown> {
    return (prisma as any).bookingToken.update({ where: { id }, data: { status } });
  }

  async setQueuePosition(id: string, pos: number): Promise<unknown> {
    return (prisma as any).bookingToken.update({ where: { id }, data: { queuePosition: pos } });
  }

  async listMine(userId: string): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: { salesUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async expireAndPromote(now: Date): Promise<number> {
    const expired = await (prisma as any).bookingToken.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    return expired.count;
  }

  async findExpiredActive(now: Date): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
    });
  }

  async findNextActiveInQueue(hoardingId: string, from: Date, to: Date): Promise<unknown | null> {
    return (prisma as any).bookingToken.findFirst({
      where: {
        hoardingId,
        status: 'CANCELLED',
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
      },
      orderBy: { queuePosition: 'asc' },
    });
  }

  async findActiveByHoarding(hoardingId: string): Promise<unknown[]> {
    const now = new Date();
    return (prisma as any).bookingToken.findMany({
      where: { hoardingId, status: 'ACTIVE', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveByHoardingAndSales(
    hoardingId: string,
    salesUserId: string,
  ): Promise<unknown | null> {
    const now = new Date();
    return (prisma as any).bookingToken.findFirst({
      where: { hoardingId, salesUserId, status: 'ACTIVE', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<unknown | null> {
    return (prisma as any).bookingToken.findUnique({ where: { id } });
  }

  async findDetailsById(id: string): Promise<unknown | null> {
    return (prisma as any).bookingToken.findUnique({
      where: { id },
      include: {
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true, phone: true, email: true } },
        designer: { select: { id: true, name: true, phone: true, email: true } },
        fitter: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  async listAssignedToDesigner(designerId: string): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: { designerId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      include: {
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }

  async listAssignedToFitter(fitterId: string): Promise<unknown[]> {
    return (prisma as any).bookingToken.findMany({
      where: { fitterId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      include: {
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }

  async listRecent(filters: {
    from?: Date;
    to?: Date;
    hoardingId?: string;
    salesUserId?: string;
    take?: number;
  }): Promise<unknown[]> {
    const where: any = {};
    if (filters.hoardingId) where.hoardingId = filters.hoardingId;
    if (filters.salesUserId) where.salesUserId = filters.salesUserId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    return (prisma as any).bookingToken.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: typeof filters.take === 'number' ? filters.take : 50,
      include: {
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }
}
