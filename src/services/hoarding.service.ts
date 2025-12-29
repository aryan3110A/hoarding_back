import { HoardingRepository } from '../repositories/hoarding.repository';
import { BookingRepository } from '../repositories/booking.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotificationService } from './notification.service';
import { Prisma } from '@prisma/client';
import { eventBus } from '../lib/eventBus';
import { prisma } from '../lib/prisma';
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from '../lib/errors';

const hoardingRepository = new HoardingRepository();
const bookingRepository = new BookingRepository();
const userRepository = new UserRepository();
const notificationService = new NotificationService();

export interface GetAllParams {
  page?: string;
  limit?: string;
  city?: string;
  area?: string;
  status?: string;
  ownership?: string;
}

export class HoardingService {
  async create(data: Prisma.HoardingCreateInput) {
    const created = await hoardingRepository.create(data);
    // Notify managers when an owner creates a hoarding/property
    try {
      if (process.env.NODE_ENV === 'test') return created;
      const managers = await userRepository.findByRole('manager');
      const managerIds = managers.map((m) => m.id);
      const title = 'New Property Created';
      const body = `A new property/hoarding (${created.code}) was created${created.city ? ` in ${created.city}` : ''}.`;
      const link = `/hoardings/${created.id}`;
      await notificationService.notifyUsers(managerIds, title, body, link);
    } catch (e) {
      // Do not block creation on notification failure
      // eslint-disable-next-line no-console
      console.error('Failed to notify managers on create:', e);
    }
    return created;
  }

  async update(id: string, data: Prisma.HoardingUpdateInput) {
    return hoardingRepository.update(id, data);
  }

  async getById(id: string) {
    return hoardingRepository.findById(id);
  }

  async getAll(
    params: GetAllParams,
    user?: {
      id?: string;
      role: { name: string };
      territories?: { territory: { city: string | null } }[];
    },
  ) {
    const { page = 1, limit = 10, city, area, status, ownership } = params;
    const pageNum = parseInt(page as string) || 1;
    // For Sales users, prefer a larger page size (50) by default to reduce paging frequency
    const parsedLimit = parseInt(limit as string);
    const limitNum =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : user && user.role.name === 'sales'
          ? 50
          : 10;
    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;

    const where: Prisma.HoardingWhereInput = {};
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (area) where.area = { contains: area, mode: 'insensitive' };
    if (ownership) where.ownership = ownership; // Exact match for ownership
    // Delay applying hoarding-level status; Sales 'available' is handled specially below

    // Sales view: show hoardings across the system. We will still apply territory-based city
    // filtering (if the user has territories) but DO NOT restrict sales to only hoardings that
    // belong to properties currently on rent — sales should be able to view all faces.
    if (user && user.role.name === 'sales') {
      const territories = user.territories || [];
      const allowedCities = territories
        .map((ut: { territory: { city: string | null } }) => ut.territory.city)
        .filter((c: string | null): c is string => !!c);
      if (allowedCities.length > 0) {
        where.city = { in: allowedCities, mode: 'insensitive' };
      }
      // For Sales 'available' we will post-filter; skip adding where.status here
    }

    // For non-Sales or other statuses, apply status filter directly
    const isSalesAvailable =
      !!(user && user.role.name === 'sales') && (status || '').toLowerCase() === 'available';
    if (status && !isSalesAvailable) {
      where.status = status;
    }

    const result = await hoardingRepository.findAll({ skip, take, where });
    // Compute hasActiveToken flag per hoarding using included tokens
    const now = new Date();

    // For Sales users, compute whether *this* salesperson already has an active token per hoarding.
    // This is used by the UI to disable the Book(Token) button and must persist across refresh.
    let myActiveTokenSet = new Set<string>();
    if (user && user.role.name === 'sales' && user.id) {
      const ids = (result.hoardings as unknown as Array<{ id?: string }>)
        .map((h) => String(h.id || ''))
        .filter(Boolean);
      if (ids.length > 0) {
        const mine = await prisma.bookingToken.findMany({
          where: {
            hoardingId: { in: ids },
            salesUserId: user.id,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: { hoardingId: true },
        });
        myActiveTokenSet = new Set(mine.map((t) => String(t.hoardingId)));
      }
    }
    type TokenLite = {
      status?: string;
      expiresAt?: Date | string | null;
      dateFrom?: Date | string | null;
      dateTo?: Date | string | null;
    };
    type HoardingRow = {
      id?: string;
      status?: string;
      propertyRent?: unknown;
      tokens?: TokenLite[];
    } & Record<string, unknown>;
    const isSales = !!(user && user.role.name === 'sales');
    const hoardingsWithFlag = (result.hoardings as unknown as HoardingRow[]).map((h) => {
      const tokens: TokenLite[] = Array.isArray(h.tokens) ? h.tokens : [];
      const hasActiveToken = tokens.some((t: TokenLite) => {
        const st = (t.status || '').toUpperCase();
        if (st !== 'ACTIVE') return false;
        const exp = t.expiresAt ? new Date(t.expiresAt as Date) : null;
        if (exp && exp <= now) return false;
        return true;
      });
      // Normalize hoarding status for Sales: treat property-level rent as making faces available, not 'on_rent'
      let normalizedStatus = String(h.status || '').toLowerCase();
      const hasPropertyRent = !!h.propertyRent;
      if (isSales && hasPropertyRent && normalizedStatus === 'on_rent') {
        normalizedStatus = 'available';
      }

      const myActiveToken = isSales && user?.id ? myActiveTokenSet.has(String(h.id)) : false;
      return Object.assign({}, h, { hasActiveToken, myActiveToken, status: normalizedStatus });
    });
    // Apply Sales 'available' post-filter if requested
    if (user && user.role.name === 'sales' && (status || '').toLowerCase() === 'available') {
      const filtered = hoardingsWithFlag.filter((h: HoardingRow & { hasActiveToken?: boolean }) => {
        const s = String(h.status || '').toLowerCase();
        return s === 'available' || h.hasActiveToken === true;
      });
      return { hoardings: filtered, total: filtered.length };
    }
    return { hoardings: hoardingsWithFlag, total: result.total };
  }

  async getAvailability(id: string) {
    const bookings = await bookingRepository.findByHoardingId(id);
    return bookings.map((b) => ({
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
    }));
  }

  async delete(id: string) {
    const hoarding = await hoardingRepository.findById(id);
    const deleted = await hoardingRepository.delete(id);
    // Notify managers when an owner deletes a property/hoarding
    try {
      if (process.env.NODE_ENV === 'test') return deleted;
      const managers = await userRepository.findByRole('manager');
      const managerIds = managers.map((m) => m.id);
      const title = 'Property Deleted';
      const body = `Property/hoarding ${hoarding?.code || id} has been deleted.`;
      const link = undefined;
      await notificationService.notifyUsers(managerIds, title, body, link);
    } catch (e) {
      // Do not block deletion on notification failure
      // eslint-disable-next-line no-console
      console.error('Failed to notify managers on delete:', e);
    }
    return deleted;
  }

  async addImageMetadata(hoardingId: string, args: { type: string; filenames: string[] }) {
    const hoarding = await hoardingRepository.findById(hoardingId);
    if (!hoarding) throw new Error('Hoarding not found');

    // existing images stored in JSON field; normalize to array (use unknown to avoid `any` lint)
    const rawImages = hoarding.images as unknown;
    let existing: unknown[] = [];
    if (Array.isArray(rawImages)) existing = rawImages as unknown[];
    else if (rawImages) existing = [rawImages];
    const now = new Date();
    const toAdd = args.filenames.map((fn, idx) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${idx}`,
      filename: fn,
      type: args.type,
      createdAt: now,
    }));
    const updatedImages = [...existing, ...toAdd];
    const updated = await hoardingRepository.update(hoardingId, {
      images: updatedImages as Prisma.InputJsonValue,
    });
    return updated;
  }

  async markUnderProcess(id: string, actor?: { id?: string; roleName?: string }) {
    const updated = await hoardingRepository.update(id, {
      status: 'under_process',
    } as unknown as Prisma.HoardingUpdateInput);

    try {
      eventBus.emit('hoarding-status', {
        hoardingId: id,
        status: 'under_process',
        hasActiveToken: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    // Notify owners when a manager marks under_process (non-blocking)
    try {
      if (process.env.NODE_ENV === 'test') return updated;
      if ((actor?.roleName || '').toLowerCase() === 'manager') {
        const owners = await userRepository.findByRole('owner');
        const ownerIds = owners.map((o) => o.id).filter((uid) => uid && uid !== actor?.id);
        if (ownerIds.length > 0) {
          const manager = actor?.id ? await userRepository.findById(actor.id) : null;
          const hoarding = await hoardingRepository.findById(id);
          const title = 'Hoarding Under Process';
          const body = `${manager?.name || 'Manager'} marked ${hoarding?.code || id} as Under Process.`;
          const link = `/hoardings/${id}`;
          await notificationService.notifyUsers(ownerIds, title, body, link);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to notify owners on under-process:', e);
    }

    return updated;
  }

  async finalizeWorkflowStatus(
    id: string,
    nextStatusRaw: string,
    actor?: { id?: string; roleName?: string },
  ) {
    const roleLower = String(actor?.roleName || '').toLowerCase();
    if (!['owner', 'manager', 'sales'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const next = String(nextStatusRaw || '')
      .toLowerCase()
      .trim();
    if (next !== 'booked') {
      throw new BadRequestError('Invalid final status');
    }

    // Fetch with bookedBy for helpful idempotency messaging
    type HoardingBookedByShape = {
      status?: string | null;
      bookedBy?: { role?: { name?: string | null } | null } | null;
    };
    const prismaUnsafe = prisma as unknown as {
      hoarding: {
        findUnique: (args: unknown) => Promise<HoardingBookedByShape | null>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
    };

    const currentRow = await prismaUnsafe.hoarding.findUnique({
      where: { id },
      include: { bookedBy: { include: { role: true } } },
    });
    if (!currentRow) throw new NotFoundError('Hoarding not found');

    const current = String(currentRow.status || '')
      .toLowerCase()
      .trim();
    if (current === 'booked') {
      const byRole = currentRow.bookedBy?.role?.name
        ? String(currentRow.bookedBy.role.name)
        : 'User';
      throw new ConflictError(`Already marked as booked by ${byRole}`);
    }
    if (current !== 'live') {
      throw new BadRequestError('Only Live hoardings can be marked as Booked');
    }

    const now = new Date();
    const updatedCount = await prismaUnsafe.hoarding.updateMany({
      where: { id, status: 'live' },
      data: {
        status: 'booked',
        workflowState: null,
        bookedById: actor?.id || null,
        bookedAt: now,
      },
    });

    if (!updatedCount || updatedCount.count !== 1) {
      const after = await prismaUnsafe.hoarding.findUnique({
        where: { id },
        include: { bookedBy: { include: { role: true } } },
      });
      if (!after) throw new NotFoundError('Hoarding not found');
      const st = String(after.status || '')
        .toLowerCase()
        .trim();
      if (st === 'booked') {
        const byRole = after.bookedBy?.role?.name ? String(after.bookedBy.role.name) : 'User';
        throw new ConflictError(`Already marked as booked by ${byRole}`);
      }
      throw new ConflictError('This hoarding has already been updated by another user.');
    }

    const updated = await hoardingRepository.findById(id);

    try {
      eventBus.emit('hoarding-status', {
        hoardingId: id,
        status: 'booked',
        hasActiveToken: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    return updated;
  }
}
