import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { BookingTokenRepository } from '../repositories/bookingToken.repository';
import { BookingRepository } from '../repositories/booking.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotificationService } from './notification.service';
import { ClientService } from './client.service';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../lib/errors';

const EXPIRY_HOURS = 24; // configurable later via config

export class BlockHoardingService {
  private repo: BookingTokenRepository;
  private bookingRepo: BookingRepository;
  private notification: NotificationService;
  private hoardingRepo: HoardingRepository;
  private userRepo: UserRepository;
  private clientSvc: ClientService;

  constructor() {
    this.repo = new BookingTokenRepository();
    this.bookingRepo = new BookingRepository();
    this.notification = new NotificationService();
    this.hoardingRepo = new HoardingRepository();
    this.userRepo = new UserRepository();
    this.clientSvc = new ClientService();
  }

  private async getOwnerAndManagerIds(excludeUserId?: string): Promise<string[]> {
    const users = await this.userRepo.findByRoles(['owner', 'manager']);
    const ids = users.map((u) => u.id).filter((id) => !!id && id !== excludeUserId);
    return Array.from(new Set(ids));
  }

  private computeExpiresAt(): Date {
    const d = new Date();
    d.setHours(d.getHours() + EXPIRY_HOURS);
    return d;
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month rollover (e.g. Jan 31 + 1 month)
    if (d.getDate() < day) {
      d.setDate(0);
    }
    return d;
  }

  async createBlock(input: {
    hoardingId: string;
    dateFrom: string;
    dateTo?: string;
    durationMonths?: number;
    notes?: string;
    client: { name: string; phone: string; email?: string; companyName?: string };
    salesUserId: string;
    actorRoleName?: string;
  }): Promise<{
    blockId: string;
    queuePosition: number;
    client: { id: string; name: string; phone: string };
  }> {
    if (!input.hoardingId) throw new BadRequestError('Hoarding is required');

    const from = new Date(input.dateFrom);
    if (isNaN(from.getTime())) throw new BadRequestError('Booking start date is required');

    // Determine durationMonths. Prefer explicit `durationMonths`, fallback to legacy `dateTo` if provided.
    let duration: number | undefined = undefined;
    if (typeof input.durationMonths === 'number' && !isNaN(input.durationMonths)) {
      duration = Number(input.durationMonths);
    } else if (typeof input.dateTo === 'string' && input.dateTo.length > 0) {
      const toFromPayload = new Date(input.dateTo);
      if (isNaN(toFromPayload.getTime())) throw new BadRequestError('Invalid booking end date');
      // compute full months between from and to
      const monthsDiff =
        (toFromPayload.getFullYear() - from.getFullYear()) * 12 +
        (toFromPayload.getMonth() - from.getMonth());
      // if day of to is before day of from, subtract one month
      const dayAdjustment = toFromPayload.getDate() < from.getDate() ? -1 : 0;
      duration = monthsDiff + dayAdjustment;
    }

    if (typeof duration !== 'number' || ![3, 6, 9, 12].includes(duration)) {
      throw new BadRequestError(
        'Invalid booking duration; allowed durations (months): 3, 6, 9, 12',
      );
    }

    const to = this.addMonths(from, duration);
    if (to.getTime() <= from.getTime()) throw new BadRequestError('Invalid date range');

    const hoarding = await this.hoardingRepo.findById(input.hoardingId);
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    const hoardingStatus = String(hoarding.status || '')
      .toLowerCase()
      .trim();
    if (hoardingStatus === 'booked') {
      throw new ConflictError('This hoarding is already booked and cannot be tokenized.');
    }
    if (hoardingStatus === 'live') {
      throw new BadRequestError('This hoarding is Live and cannot be tokenized');
    }
    if (hoardingStatus === 'under_process') {
      throw new BadRequestError('This hoarding is Under Process and cannot be tokenized');
    }

    // Create/reuse client first (phone unique)
    const clientUnknown = await this.clientSvc.findOrCreate(input.client, input.salesUserId);
    const client = clientUnknown as unknown as { id: string; name: string; phone: string };

    // Prevent duplicate tokenization by the same sales user while an ACTIVE token exists
    const existingActiveUnknown = await this.repo.findActiveByHoardingAndSales(
      input.hoardingId,
      input.salesUserId,
    );
    if (existingActiveUnknown) {
      const existing = existingActiveUnknown as unknown as { expiresAt: Date };
      const now = new Date();
      const msLeft = Math.max(0, new Date(existing.expiresAt).getTime() - now.getTime());
      const minutes = Math.floor(msLeft / 60000);
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const remaining = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      throw new BadRequestError(
        `You have already tokenized this hoarding. You can tokenize again after: ${remaining}`,
      );
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Insert token with provisional position
      const provisional = await tx.bookingToken.create({
        data: {
          hoarding: { connect: { id: input.hoardingId } },
          salesUser: { connect: { id: input.salesUserId } },
          client: { connect: { id: client.id } },
          durationMonths: duration,
          notes: input.notes || null,
          dateFrom: from,
          dateTo: to,
          status: 'ACTIVE',
          queuePosition: 999999,
          expiresAt: this.computeExpiresAt(),
        },
        select: { id: true },
      });

      // Recompute queue positions for overlapping range
      const queue = await tx.bookingToken.findMany({
        where: {
          hoardingId: input.hoardingId,
          OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
          status: { in: ['ACTIVE', 'CONFIRMED'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      let position = 1;
      for (const item of queue) {
        await tx.bookingToken.update({
          where: { id: item.id },
          data: { queuePosition: position },
        });
        position += 1;
      }

      const updated = await tx.bookingToken.findUnique({
        where: { id: provisional.id },
        select: { id: true, queuePosition: true },
      });
      return updated;
    });

    const createdLite = created as unknown as { id: string; queuePosition: number };

    let hoardingCodeForMessage = input.hoardingId;
    try {
      const hoarding = await this.hoardingRepo.findById(input.hoardingId);
      hoardingCodeForMessage = hoarding?.code || input.hoardingId;
    } catch (_) {
      // ignore
    }

    // Notify sales user
    await this.notification.notifyUsers(
      [input.salesUserId],
      'Token created',
      `You are #${createdLite.queuePosition} in queue for ${hoardingCodeForMessage}.`,
      `/booking-tokens/${createdLite.id}`,
    );

    // Notify Owner + Manager when Sales tokenizes
    try {
      if (String(input.actorRoleName || '').toLowerCase() === 'sales') {
        const recipients = await this.getOwnerAndManagerIds(input.salesUserId);
        if (recipients.length > 0) {
          const salesUser = await this.userRepo.findById(input.salesUserId);
          const salesName = salesUser?.name || 'A salesperson';
          const hoardingCode = hoardingCodeForMessage;
          await this.notification.notifyUsers(
            recipients,
            'Hoarding tokenized',
            `${hoardingCode} tokenized by ${salesName} for Client: ${client.name} (${duration} months). Queue #${createdLite.queuePosition}.`,
            `/booking-tokens/${createdLite.id}`,
          );
        }
      }
    } catch (_) {
      // notification failures should not block
    }

    // Mark hoarding as tokenized when an ACTIVE token exists
    try {
      const active = await this.repo.findActiveByHoarding(input.hoardingId);
      if ((active as unknown[]).length > 0) {
        await this.hoardingRepo.update(input.hoardingId, {
          status: 'tokenized',
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId: input.hoardingId,
          status: 'tokenized',
          hasActiveToken: true,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (_) {}

    return {
      blockId: createdLite.id,
      queuePosition: createdLite.queuePosition,
      client: { id: String(client.id), name: String(client.name), phone: String(client.phone) },
    };
  }

  async getTokenDetails(
    id: string,
    actor: { id: string; role: { name: string } },
  ): Promise<unknown> {
    const token = await this.repo.findDetailsById(id);
    if (!token) throw new NotFoundError('Token not found');

    const role = String(actor?.role?.name || '').toLowerCase();
    const tokenSalesUserId = String(
      (token as unknown as { salesUserId?: string }).salesUserId || '',
    );
    const tokenDesignerId = String((token as unknown as { designerId?: string }).designerId || '');
    const tokenFitterId = String((token as unknown as { fitterId?: string }).fitterId || '');
    if (role === 'sales' && tokenSalesUserId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    if (role === 'designer' && tokenDesignerId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    if (role === 'fitter' && tokenFitterId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    return token;
  }

  private normalizeDesignStatus(raw: string): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' {
    const s = String(raw || '')
      .trim()
      .toLowerCase();
    if (s === 'pending') return 'PENDING';
    if (s === 'in_progress' || s === 'inprogress') return 'IN_PROGRESS';
    if (s === 'completed') return 'COMPLETED';
    throw new BadRequestError('Invalid design status');
  }

  private normalizeFitterStatus(raw: string): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' {
    const s = String(raw || '')
      .trim()
      .toLowerCase();
    if (s === 'pending') return 'PENDING';
    if (s === 'in_progress' || s === 'inprogress') return 'IN_PROGRESS';
    if (s === 'completed') return 'COMPLETED';
    throw new BadRequestError('Invalid fitter status');
  }

  async listRecentTokens(filters: {
    from?: string;
    to?: string;
    hoardingId?: string;
    salesUserId?: string;
  }): Promise<unknown[]> {
    const from = filters.from ? new Date(String(filters.from)) : undefined;
    const to = filters.to ? new Date(String(filters.to)) : undefined;
    return this.repo.listRecent({
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      hoardingId: filters.hoardingId ? String(filters.hoardingId) : undefined,
      salesUserId: filters.salesUserId ? String(filters.salesUserId) : undefined,
      take: 50,
    });
  }

  async confirmToken(
    id: string,
    actorId: string,
    isAdmin = false,
    actorRoleName?: string,
    designerId?: string,
  ): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    if (roleLower === 'sales') {
      throw new ForbiddenError('Sales cannot confirm tokens');
    }

    const now = new Date();

    type UnsafeTx = Prisma.TransactionClient & {
      bookingToken: {
        findUnique: (args: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<unknown[]>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
      hoarding: {
        findUnique: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
      booking: {
        create: (args: unknown) => Promise<unknown>;
        findFirst: (args: unknown) => Promise<unknown>;
      };
      user: {
        findUnique: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<unknown[]>;
      };
    };

    type ConfirmResult = {
      tokenId: string;
      hoardingId: string;
      salesUserId: string;
      designerId: string | null;
      designerName: string | null;
      cancelledSalesUserIds: string[];
    };

    const result = (await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const unsafeTx = tx as unknown as UnsafeTx;

      const token = (await unsafeTx.bookingToken.findUnique({
        where: { id },
        select: {
          id: true,
          hoardingId: true,
          dateFrom: true,
          dateTo: true,
          status: true,
          expiresAt: true,
          salesUserId: true,
          queuePosition: true,
          designerId: true,
        },
      })) as {
        id: string;
        hoardingId: string;
        dateFrom: Date;
        dateTo: Date;
        status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
        expiresAt: Date;
        salesUserId: string;
        queuePosition: number;
        designerId: string | null;
      } | null;
      if (!token) throw new NotFoundError('Token not found');

      if (token.designerId && designerId && token.designerId !== designerId) {
        throw new BadRequestError('Token already assigned to another designer');
      }

      // If the hoarding is already under_process, always return the same message
      // (even if this particular token is no longer ACTIVE).
      const hoardingRow = (await unsafeTx.hoarding.findUnique({
        where: { id: token.hoardingId },
        select: { status: true },
      })) as { status?: unknown } | null;
      const hoardingStatusLower = String(hoardingRow?.status || '')
        .toLowerCase()
        .trim();
      if (hoardingStatusLower === 'under_process') {
        const existing = (await unsafeTx.booking.findFirst({
          where: { hoardingId: token.hoardingId, status: 'under_process' },
          orderBy: { createdAt: 'desc' },
          select: {
            createdByUser: { select: { role: { select: { name: true } } } },
          },
        })) as { createdByUser?: { role?: { name?: unknown } } } | null;
        const confirmedBy = String(existing?.createdByUser?.role?.name || '').toLowerCase();
        if (confirmedBy) {
          throw new BadRequestError(
            `This hoarding is already Under Process (confirmed by ${confirmedBy})`,
          );
        }
        throw new BadRequestError('This hoarding is already Under Process');
      }

      if (!isAdmin) {
        if (token.status !== 'ACTIVE') throw new ForbiddenError('Token not active');
        if (token.expiresAt < now) throw new ForbiddenError('Token expired');
        if (token.queuePosition !== 1) throw new ForbiddenError('Not first in queue');
      } else {
        if (token.status !== 'ACTIVE') throw new ForbiddenError('Token not active');
      }

      // Determine designer assignment
      let assignedDesignerId: string | null = null;
      let assignedDesignerName: string | null = null;
      if (typeof designerId === 'string' && designerId.trim().length > 0) {
        const designer = (await unsafeTx.user.findUnique({
          where: { id: designerId.trim() },
          select: { id: true, name: true, isActive: true, role: { select: { name: true } } },
        })) as {
          id: string;
          name: string;
          isActive: boolean;
          role?: { name?: string };
        } | null;
        if (!designer || !designer.isActive) {
          throw new BadRequestError('Selected designer is not available');
        }
        if (String(designer.role?.name || '').toLowerCase() !== 'designer') {
          throw new BadRequestError('Selected user is not a designer');
        }
        assignedDesignerId = designer.id;
        assignedDesignerName = designer.name;
      } else {
        const designers = (await unsafeTx.user.findMany({
          where: { isActive: true, role: { name: 'designer' } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        })) as Array<{ id: string }>;
        if (designers.length === 1) {
          assignedDesignerId = designers[0].id;
        } else if (designers.length === 0) {
          throw new BadRequestError('No designers available to assign');
        } else {
          throw new BadRequestError('Please select a designer to assign');
        }
      }

      // Atomically claim the hoarding: only one confirmer can move it to under_process.
      const claimed = await unsafeTx.hoarding.updateMany({
        where: {
          id: token.hoardingId,
          status: {
            notIn: ['under_process', 'on_rent', 'occupied'],
          },
        },
        data: { status: 'under_process' },
      });

      if (claimed.count === 0) {
        // Somebody already moved it to under_process (or it's already on rent/occupied).
        const existing = (await unsafeTx.booking.findFirst({
          where: { hoardingId: token.hoardingId, status: 'under_process' },
          orderBy: { createdAt: 'desc' },
          select: {
            createdByUser: { select: { role: { select: { name: true } } } },
          },
        })) as { createdByUser?: { role?: { name?: unknown } } } | null;
        const confirmedBy = String(existing?.createdByUser?.role?.name || '').toLowerCase();
        if (confirmedBy) {
          throw new BadRequestError(
            `This hoarding is already Under Process (confirmed by ${confirmedBy})`,
          );
        }
        throw new BadRequestError('This hoarding is already Under Process');
      }

      // Create booking in "under_process" state and store who confirmed.
      await unsafeTx.booking.create({
        data: {
          hoarding: { connect: { id: token.hoardingId } },
          startDate: token.dateFrom,
          endDate: token.dateTo,
          status: 'under_process',
          createdByUser: { connect: { id: actorId } },
        },
      });

      await unsafeTx.bookingToken.update({
        where: { id: token.id },
        data: {
          status: 'CONFIRMED',
          designerId: assignedDesignerId,
          designStatus: 'PENDING',
        },
      });

      // Cancel other tokens for same overlap (ACTIVE only)
      const others = (await unsafeTx.bookingToken.findMany({
        where: {
          hoardingId: token.hoardingId,
          id: { not: token.id },
          status: 'ACTIVE',
          OR: [{ AND: [{ dateFrom: { lte: token.dateTo } }, { dateTo: { gte: token.dateFrom } }] }],
        },
        select: { id: true, salesUserId: true },
      })) as Array<{ id: string; salesUserId: string }>;

      if (others.length > 0) {
        await unsafeTx.bookingToken.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { status: 'CANCELLED' },
        });
      }

      return {
        tokenId: token.id,
        hoardingId: token.hoardingId,
        salesUserId: token.salesUserId,
        designerId: assignedDesignerId,
        designerName: assignedDesignerName,
        cancelledSalesUserIds: Array.from(new Set(others.map((o) => o.salesUserId))),
      };
    })) as unknown as ConfirmResult;

    // Notify winning sales user
    try {
      await this.notification.notifyUsers(
        [result.salesUserId],
        'Token confirmed',
        'Your token was confirmed. Hoarding moved to Under Process.',
        `/booking-tokens/${result.tokenId}`,
      );
    } catch (_) {}

    // Notify cancelled sales users
    try {
      if (result.cancelledSalesUserIds.length > 0) {
        await this.notification.notifyUsers(
          result.cancelledSalesUserIds,
          'Token cancelled',
          'Another user confirmed booking. Your token was cancelled.',
          `/hoardings/${result.hoardingId}`,
        );
      }
    } catch (_) {}

    // SSE update
    try {
      eventBus.emit('hoarding-status', {
        hoardingId: result.hoardingId,
        status: 'under_process',
        hasActiveToken: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    // Notify assigned designer with details (non-blocking)
    try {
      if (result.designerId) {
        const detailsUnknown = await this.repo.findDetailsById(result.tokenId);
        const details = detailsUnknown as {
          hoardingId?: string;
          dateFrom?: Date | string;
          durationMonths?: number;
          hoarding?: {
            code?: string;
            city?: string;
            area?: string;
            landmark?: string;
            roadName?: string;
            side?: string;
            widthCm?: number;
            heightCm?: number;
          };
          client?: { name?: string; phone?: string; email?: string };
        } | null;
        const h = details?.hoarding;
        const c = details?.client;
        const size = h?.widthCm && h?.heightCm ? `${h.widthCm}cm x ${h.heightCm}cm` : 'N/A';
        const title = 'New design assigned';
        const body =
          `Hoarding: ${h?.code || details?.hoardingId || ''} | ${h?.city || ''} ${h?.area || ''}`.trim() +
          `\nLocation: ${h?.landmark || h?.roadName || 'N/A'} | Side: ${h?.side || 'N/A'} | Size: ${size}` +
          `\nClient: ${c?.name || 'N/A'} | ${c?.phone || ''} | ${c?.email || ''}` +
          `\nToken: ${details?.durationMonths || ''} months | Start: ${details?.dateFrom ? new Date(details.dateFrom).toLocaleDateString() : ''}`;
        await this.notification.notifyUsers(
          [result.designerId],
          title,
          body,
          `/booking-tokens/${result.tokenId}?from=notification`,
        );
      }
    } catch (_) {}

    // If manager confirmed, notify owners (non-blocking)
    try {
      if (roleLower === 'manager') {
        const owners = await this.userRepo.findByRoles(['owner']);
        const ownerIds = owners.map((u) => u.id).filter((uid) => uid && uid !== actorId);
        if (ownerIds.length > 0) {
          const manager = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(result.hoardingId);
          const managerName = manager?.name || 'Manager';
          const hoardingCode = hoarding?.code || result.hoardingId;
          await this.notification.notifyUsers(
            ownerIds,
            'Hoarding Under Process',
            `${managerName} marked ${hoardingCode} as Under Process (via token confirmation).`,
            `/hoardings/${result.hoardingId}`,
          );
        }
      }
    } catch (_) {}
  }

  async cancelToken(id: string, actorId: string, actorRoleName?: string): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    if (roleLower === 'sales') {
      throw new ForbiddenError('Sales cannot cancel tokens');
    }
    if (!['owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const tokenUnknown2 = await this.repo.findById(id);
    const token2 = tokenUnknown2 as unknown as {
      id: string;
      hoardingId: string;
      dateFrom: Date;
      dateTo: Date;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      expiresAt: Date;
      salesUserId: string;
    };
    if (!token2) throw new NotFoundError('Token not found');
    if (token2.status !== 'ACTIVE') throw new ForbiddenError('Only active tokens can be cancelled');

    await this.repo.updateStatus(id, 'CANCELLED');

    // Notify the sales user
    try {
      await this.notification.notifyUsers(
        [token2.salesUserId],
        'Token cancelled',
        'Your token was cancelled by management.',
        `/hoardings/${token2.hoardingId}`,
      );
    } catch (_) {}

    // Notify Owner + Manager when Sales cancels
    try {
      if (String(actorRoleName || '').toLowerCase() === 'sales') {
        const recipients = await this.getOwnerAndManagerIds(actorId);
        if (recipients.length > 0) {
          const salesUser = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(token2.hoardingId);
          const salesName = salesUser?.name || 'A salesperson';
          const hoardingCode = hoarding?.code || token2.hoardingId;
          await this.notification.notifyUsers(
            recipients,
            'Token cancelled',
            `${salesName} cancelled token for ${hoardingCode}.`,
            `/hoardings/${token2.hoardingId}`,
          );
        }
      }
    } catch (_) {
      // notification failures should not block
    }

    // Recompute hoarding status based on remaining ACTIVE tokens and bookings
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hoardingId = (token2 as any).hoardingId as string;
      const active = await this.repo.findActiveByHoarding(hoardingId);
      if ((active as unknown[]).length > 0) {
        await this.hoardingRepo.update(hoardingId, {
          status: 'tokenized',
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId,
          status: 'tokenized',
          hasActiveToken: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const bookings = await this.bookingRepo.findByHoardingId(hoardingId);
        const statuses = (bookings || []).map((b) =>
          String((b as unknown as { status?: unknown }).status || '').toLowerCase(),
        );
        const hasConfirmed = statuses.includes('confirmed');
        const hasUnderProcess = statuses.includes('under_process');
        const newStatus = hasConfirmed
          ? 'under_process'
          : hasUnderProcess
            ? 'under_process'
            : 'available';
        await this.hoardingRepo.update(hoardingId, {
          status: newStatus,
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId,
          status: newStatus,
          hasActiveToken: false,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (_) {}
  }

  async listMyTokens(userId: string) {
    return this.repo.listMine(userId);
  }

  async expireAndPromote(): Promise<void> {
    const now = new Date();
    const due = await this.repo.findExpiredActive(now);
    type TokenHead = {
      id: string;
      hoardingId: string;
      dateFrom: Date;
      dateTo: Date;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      salesUserId: string;
      queuePosition: number;
    };
    for (const dUnknown of due) {
      const d = dUnknown as unknown as TokenHead;
      // Mark expired and notify owner
      await this.repo.updateStatus(d.id, 'EXPIRED');
      await this.notification.notifyUsers(
        [d.salesUserId],
        'Token expired',
        'Your booking token expired.',
        `/hoardings/${d.hoardingId}`,
      );

      // Promote next in queue: find remaining tokens and choose smallest queuePosition not cancelled/confirmed/expired
      const remaining = await this.repo.findQueue(d.hoardingId, d.dateFrom, d.dateTo);
      const candidates = (remaining as unknown as TokenHead[]).filter(
        (t) => t.id !== d.id && !['CONFIRMED', 'CANCELLED', 'EXPIRED'].includes(t.status),
      );
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.queuePosition - b.queuePosition);
        const next = candidates[0];
        // Send promotion notice
        await this.notification.notifyUsers(
          [next.salesUserId],
          'Token promoted',
          'You are now first in queue. Please confirm before expiry.',
          `/hoardings/${d.hoardingId}`,
        );
      }

      // After processing, recompute hoarding status from remaining ACTIVE tokens and bookings
      try {
        const active = await this.repo.findActiveByHoarding(d.hoardingId);
        if ((active as unknown[]).length > 0) {
          await this.hoardingRepo.update(d.hoardingId, {
            status: 'tokenized',
          } as unknown as Prisma.HoardingUpdateInput);
          eventBus.emit('hoarding-status', {
            hoardingId: d.hoardingId,
            status: 'tokenized',
            hasActiveToken: true,
            updatedAt: new Date().toISOString(),
          });
        } else {
          const bookings = await this.bookingRepo.findByHoardingId(d.hoardingId);
          const statuses = (bookings || []).map((b) =>
            String((b as unknown as { status?: unknown }).status || '').toLowerCase(),
          );
          const hasConfirmed = statuses.includes('confirmed');
          const hasUnderProcess = statuses.includes('under_process');
          const newStatus = hasConfirmed
            ? 'under_process'
            : hasUnderProcess
              ? 'under_process'
              : 'available';
          await this.hoardingRepo.update(d.hoardingId, {
            status: newStatus,
          } as unknown as Prisma.HoardingUpdateInput);
          eventBus.emit('hoarding-status', {
            hoardingId: d.hoardingId,
            status: newStatus,
            hasActiveToken: false,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (_) {}
    }
  }

  async listAssignedToDesigner(designerId: string): Promise<unknown[]> {
    return this.repo.listAssignedToDesigner(designerId);
  }

  async listAssignedToFitter(fitterId: string): Promise<unknown[]> {
    return this.repo.listAssignedToFitter(fitterId);
  }

  async listActiveFitters(): Promise<Array<{ id: string; name: string; email?: string | null }>> {
    const fitters = await this.userRepo.findByRole('fitter');
    return (fitters || [])
      .filter((u) => !!u && u.isActive)
      .map((u) => ({ id: String(u.id), name: String(u.name || ''), email: u.email }));
  }

  async assignFitter(
    tokenId: string,
    actorId: string,
    actorRoleName?: string,
    fitterId?: string,
  ): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      hoardingId: string;
      fitterId?: string | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (token.status !== 'CONFIRMED')
      throw new BadRequestError('Installation workflow is not active');
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before assigning a fitter');
    }

    // Lock: fitter can be assigned only once
    if (token.fitterId) {
      throw new ConflictError('This hoarding has already been assigned by another user.');
    }

    let assignedFitterId: string | null = null;
    let assignedFitterName: string | null = null;

    if (typeof fitterId === 'string' && fitterId.trim().length > 0) {
      const fitter = await this.userRepo.findById(fitterId.trim());
      if (!fitter || !fitter.isActive) {
        throw new BadRequestError('Selected fitter is not available');
      }
      if (String(fitter.role?.name || '').toLowerCase() !== 'fitter') {
        throw new BadRequestError('Selected user is not a fitter');
      }
      assignedFitterId = fitter.id;
      assignedFitterName = fitter.name;
    } else {
      const fitters = await this.userRepo.findByRoles(['fitter']);
      const activeFitters = (fitters || []).filter((u) => !!u && u.isActive);
      if (activeFitters.length === 1) {
        assignedFitterId = activeFitters[0].id;
        assignedFitterName = activeFitters[0].name;
      } else if (activeFitters.length === 0) {
        throw new BadRequestError('No fitters available to assign');
      } else {
        throw new BadRequestError('Please select a fitter to assign');
      }
    }

    const now = new Date();
    // Concurrency-safe assignment: only one request wins
    const updated = await prisma.bookingToken.updateMany({
      where: { id: tokenId, fitterId: null },
      data: {
        fitterId: assignedFitterId,
        fitterStatus: 'PENDING',
        fitterAssignedAt: now,
      },
    });
    if (!updated || updated.count !== 1) {
      throw new ConflictError('This hoarding has already been assigned by another user.');
    }

    // Update hoarding workflow state (separate from availability status)
    try {
      await this.hoardingRepo.update(token.hoardingId, {
        workflowState: 'FITTER_ASSIGNED',
      } as unknown as Prisma.HoardingUpdateInput);
    } catch (_) {}

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: assignedFitterId,
        fitterStatus: 'PENDING',
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    // Notify assigned fitter with details (non-blocking)
    try {
      if (assignedFitterId) {
        const detailsUnknown = await this.repo.findDetailsById(tokenId);
        const details = detailsUnknown as {
          hoardingId?: string;
          hoarding?: {
            code?: string;
            city?: string;
            area?: string;
            landmark?: string;
            roadName?: string;
            side?: string;
            widthCm?: number;
            heightCm?: number;
          };
          client?: { name?: string; phone?: string; email?: string };
          designer?: { id?: string; name?: string };
        } | null;
        const h = details?.hoarding;
        const c = details?.client;
        const size = h?.widthCm && h?.heightCm ? `${h.widthCm}cm x ${h.heightCm}cm` : 'N/A';
        const title = 'New installation assigned';
        const body =
          `Hoarding: ${h?.code || details?.hoardingId || ''} | ${h?.city || ''} ${h?.area || ''}`.trim() +
          `\nLocation: ${h?.landmark || h?.roadName || 'N/A'} | Side: ${h?.side || 'N/A'} | Size: ${size}` +
          `\nClient: ${c?.name || 'N/A'} | ${c?.phone || ''} | ${c?.email || ''}` +
          `\nDesign: Completed${details?.designer?.name ? ` (by ${details.designer.name})` : ''}` +
          (assignedFitterName ? `\nAssigned to: ${assignedFitterName}` : '');
        // Idempotent: only one notification per hoarding + assignment type + assigned user
        const dedupeKey = `ASSIGN_FITTER:${token.hoardingId}:${assignedFitterId}`;
        await this.notification.createNotification(
          assignedFitterId,
          title,
          body,
          `/booking-tokens/${tokenId}?from=notification`,
          dedupeKey,
        );
      }
    } catch (_) {}
  }

  async completeInstallationWithProof(
    tokenId: string,
    actorId: string,
    files: Array<{ filename: string; url: string }>,
  ): Promise<void> {
    if (!files || files.length === 0) {
      throw new BadRequestError('At least one installation proof image is required');
    }

    const tokenUnknown = await this.repo.findDetailsById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      hoardingId: string;
      salesUserId: string;
      fitterId?: string | null;
      fitterStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      installationImages?: unknown;
      hoarding?: { code?: string; status?: string };
    };
    if (!token) throw new NotFoundError('Token not found');
    if (token.status !== 'CONFIRMED')
      throw new BadRequestError('Installation workflow is not active');
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before installation can start');
    }
    if (!token.fitterId || String(token.fitterId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned fitter can submit installation proof');
    }
    const current = (token.fitterStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    if (current !== 'IN_PROGRESS') {
      throw new BadRequestError(
        'Installation must be In Progress before it can be marked as Fitted',
      );
    }

    const now = new Date();
    const rawExisting = token.installationImages as unknown;
    const existing = Array.isArray(rawExisting) ? rawExisting : rawExisting ? [rawExisting] : [];
    const toAdd = files.map((f) => ({
      filename: f.filename,
      url: f.url,
      uploadedAt: now.toISOString(),
    }));
    const merged = [...existing, ...toAdd];

    const prismaUnsafe = prisma as unknown as {
      bookingToken: {
        update: (args: unknown) => Promise<unknown>;
      };
    };

    await prismaUnsafe.bookingToken.update({
      where: { id: tokenId },
      data: {
        installationImages: merged,
        fitterStatus: 'COMPLETED',
        fitterCompletedAt: now,
      },
    });

    // Update hoarding: installation done -> make LIVE
    try {
      await this.hoardingRepo.update(token.hoardingId, {
        status: 'live',
        workflowState: null,
      } as unknown as Prisma.HoardingUpdateInput);

      try {
        eventBus.emit('hoarding-status', {
          hoardingId: token.hoardingId,
          status: 'live',
          hasActiveToken: false,
          updatedAt: now.toISOString(),
        });
      } catch (_) {}
    } catch (_) {}

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: token.fitterId,
        fitterStatus: 'COMPLETED',
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    // Notify Owner + Manager + Sales (idempotent) with booking action
    try {
      const recipients = new Set<string>();
      (await this.getOwnerAndManagerIds(actorId)).forEach((id) => recipients.add(id));
      if (token.salesUserId) recipients.add(String(token.salesUserId));
      const recipientIds = Array.from(recipients).filter(Boolean);
      if (recipientIds.length > 0) {
        const hoardingCode = token.hoarding?.code || token.hoardingId;
        const title = 'Hoarding is Live';
        const body = `${hoardingCode} is now Live. Mark as Booked when ready.`;
        await this.notification.notifyUsersIdempotent(
          recipientIds,
          title,
          body,
          `/hoardings/${token.hoardingId}?from=notification`,
          `READY_TO_BOOK:${token.hoardingId}:${tokenId}`,
        );
      }
    } catch (_) {}
  }

  async updateFitterStatus(tokenId: string, actorId: string, status: string): Promise<void> {
    const next = this.normalizeFitterStatus(status);

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      hoardingId: string;
      salesUserId?: string;
      fitterId?: string | null;
      fitterStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      installationImages?: unknown;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (token.status !== 'CONFIRMED')
      throw new BadRequestError('Installation workflow is not active');
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before installation can start');
    }
    if (!token.fitterId || String(token.fitterId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned fitter can update installation status');
    }

    const current = (token.fitterStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    const allowed =
      next === current ||
      (current === 'PENDING' && next === 'IN_PROGRESS') ||
      (current === 'IN_PROGRESS' && next === 'COMPLETED');
    if (!allowed) {
      throw new BadRequestError('Invalid status transition');
    }

    // Prevent completion without proof images
    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      const raw = token.installationImages as unknown;
      const count = Array.isArray(raw) ? raw.length : raw ? 1 : 0;
      if (count < 1) {
        throw new BadRequestError(
          'Please upload installation proof image(s) before marking as Fitted',
        );
      }
    }

    const now = new Date();
    if (next !== current) {
      const prismaUnsafe = prisma as unknown as {
        bookingToken: {
          update: (args: unknown) => Promise<unknown>;
        };
      };
      const data: Record<string, unknown> = { fitterStatus: next };
      if (next === 'IN_PROGRESS') {
        data.fitterStartedAt = now;
      }
      if (next === 'COMPLETED') {
        data.fitterCompletedAt = now;
      }
      await prismaUnsafe.bookingToken.update({
        where: { id: tokenId },
        data,
      });
    }

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: token.fitterId,
        fitterStatus: next,
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      try {
        // Update hoarding: installation done -> make LIVE
        try {
          await this.hoardingRepo.update(token.hoardingId, {
            status: 'live',
            workflowState: null,
          } as unknown as Prisma.HoardingUpdateInput);

          try {
            eventBus.emit('hoarding-status', {
              hoardingId: token.hoardingId,
              status: 'live',
              hasActiveToken: false,
              updatedAt: now.toISOString(),
            });
          } catch (_) {}
        } catch (_) {}

        const recipientsSet = new Set<string>();
        (await this.getOwnerAndManagerIds(actorId)).forEach((id) => recipientsSet.add(id));
        if (token.salesUserId) recipientsSet.add(String(token.salesUserId));
        const recipients = Array.from(recipientsSet).filter(Boolean);
        if (recipients.length > 0) {
          const hoarding = await this.hoardingRepo.findById(token.hoardingId);
          const hoardingCode = hoarding?.code || token.hoardingId;
          const title = 'Hoarding is Live';
          const body = `${hoardingCode} is now Live. Mark as Booked when ready.`;
          await this.notification.notifyUsersIdempotent(
            recipients,
            title,
            body,
            `/hoardings/${token.hoardingId}?from=notification`,
            `READY_TO_BOOK:${token.hoardingId}:${tokenId}`,
          );
        }
      } catch (_) {}
    }
  }

  async updateDesignStatus(tokenId: string, actorId: string, status: string): Promise<void> {
    const next = this.normalizeDesignStatus(status);

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
      hoardingId: string;
      designerId?: string | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (token.status !== 'CONFIRMED') throw new BadRequestError('Design workflow is not active');
    if (!token.designerId || String(token.designerId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned designer can update design status');
    }

    const current = (token.designStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    const allowed =
      next === current ||
      (current === 'PENDING' && next === 'IN_PROGRESS') ||
      (current === 'IN_PROGRESS' && next === 'COMPLETED');
    if (!allowed) {
      throw new BadRequestError('Invalid status transition');
    }

    if (next !== current) {
      const prismaUnsafe = prisma as unknown as {
        bookingToken: {
          update: (args: unknown) => Promise<unknown>;
        };
      };
      await prismaUnsafe.bookingToken.update({
        where: { id: tokenId },
        data: { designStatus: next },
      });
    }

    try {
      eventBus.emit('design-status', {
        tokenId,
        hoardingId: token.hoardingId,
        designStatus: next,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      try {
        const recipients = await this.getOwnerAndManagerIds(actorId);
        if (recipients.length > 0) {
          const designer = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(token.hoardingId);
          const designerName = designer?.name || 'Designer';
          const hoardingCode = hoarding?.code || token.hoardingId;
          await this.notification.notifyUsers(
            recipients,
            'Design completed',
            `${designerName} marked design completed for ${hoardingCode}.`,
            `/booking-tokens/${tokenId}?from=notification`,
          );
        }
      } catch (_) {}
    }
  }
}
