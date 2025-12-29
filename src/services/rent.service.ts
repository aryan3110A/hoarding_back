import { RentRepository } from '../repositories/rent.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { Prisma, Rent, Hoarding, User } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';

export class RentService {
  private rentRepository: RentRepository;
  private hoardingRepository: HoardingRepository;
  private userRepository: UserRepository;
  private notificationService: NotificationService;

  constructor() {
    this.rentRepository = new RentRepository();
    this.hoardingRepository = new HoardingRepository();
    this.userRepository = new UserRepository();
    this.notificationService = new NotificationService();
  }

  async getRentDetails(hoardingId: string) {
    const hoarding = await this.hoardingRepository.findById(hoardingId);
    if (!hoarding) {
      throw new NotFoundError('Hoarding not found');
    }
    return this.rentRepository.findByHoardingId(hoardingId);
  }

  async saveRent(
    hoardingId: string,
    data: Partial<{
      partyType: string;
      rentAmount: Prisma.Decimal | number | string;
      incrementYear?: number | null;
      paymentMode: string;
      lastPaymentDate?: string | Date | null;
    }>,
    actor?: User & { role: { name: string } },
  ) {
    const hoarding = await this.hoardingRepository.findById(hoardingId);
    if (!hoarding) {
      throw new NotFoundError('Hoarding not found');
    }

    const { partyType, rentAmount, incrementYear, paymentMode, lastPaymentDate } = data;
    if (!partyType || !paymentMode || typeof rentAmount === 'undefined' || rentAmount === null) {
      throw new BadRequestError('Missing required rent fields');
    }

    // Calculate nextDueDate
    let nextDueDate: Date | null = null;
    if (lastPaymentDate && paymentMode) {
      const date = new Date(lastPaymentDate);
      switch (paymentMode) {
        case 'Monthly':
          date.setMonth(date.getMonth() + 1);
          break;
        case 'Quarterly':
          date.setMonth(date.getMonth() + 3);
          break;
        case 'Half-Yearly':
          date.setMonth(date.getMonth() + 6);
          break;
        case 'Yearly':
          date.setFullYear(date.getFullYear() + 1);
          break;
      }
      nextDueDate = date;
    }

    const rentAmountValue =
      rentAmount instanceof Prisma.Decimal ? rentAmount : new Prisma.Decimal(String(rentAmount));

    const rentUpdateData: Prisma.RentUpdateInput = {
      partyType,
      rentAmount: rentAmountValue,
      incrementYear,
      paymentMode,
      lastPaymentDate: lastPaymentDate ? new Date(lastPaymentDate) : null,
      nextDueDate,
    };

    const rentCreateData: Prisma.RentCreateInput = {
      partyType,
      rentAmount: rentAmountValue,
      incrementYear: incrementYear ?? null,
      paymentMode,
      lastPaymentDate: lastPaymentDate ? new Date(lastPaymentDate) : null,
      nextDueDate,
      hoarding: { connect: { id: hoardingId } },
    };

    const existingRent = await this.rentRepository.findByHoardingId(hoardingId);
    let savedRent: Rent;

    if (existingRent) {
      savedRent = await this.rentRepository.update(existingRent.id, rentUpdateData);
    } else {
      savedRent = await this.rentRepository.create(rentCreateData);
    }

    await this.updateHoardingStatusIfNeeded(hoarding);
    await this.notifyRentChange({ hoarding, rent: savedRent, actor, isNew: !existingRent });

    return savedRent;
  }

  async recalculateRent(hoardingId: string) {
    const rent = await this.rentRepository.findByHoardingId(hoardingId);
    if (!rent) {
      throw new NotFoundError('Rent record not found');
    }

    const currentYear = new Date().getFullYear();

    // Logic: If incrementYear is reached OR manual trigger
    // For manual trigger, we just do it.
    // New rent = old rent + 10%

    const oldRent = Number(rent.rentAmount);
    const newRent = oldRent + oldRent * 0.1;

    return this.rentRepository.update(rent.id, {
      rentAmount: new Prisma.Decimal(newRent),
      // Optionally update incrementYear to next year or +N years?
      // Spec doesn't say, but usually it's +1 or +3 years.
      // Let's assume we update incrementYear to avoid double increment in same year if auto-job runs.
      incrementYear: (rent.incrementYear || currentYear) + 1,
    });
  }

  async getAllRents(params: { skip?: number; take?: number }) {
    return this.rentRepository.findAll(params);
  }

  private async updateHoardingStatusIfNeeded(hoarding: Hoarding) {
    if (!hoarding.status || hoarding.status.toLowerCase() !== 'on_rent') {
      await this.hoardingRepository.update(hoarding.id, { status: 'on_rent' });
    }
  }

  private async notifyRentChange(context: RentNotificationContext) {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const { hoarding, rent, actor, isNew } = context;
    const targetRoles = ['owner', 'manager', 'admin'];
    const recipients = await this.userRepository.findByRoles(targetRoles);
    const filteredRecipients = recipients.filter((user) => !actor || user.id !== actor.id);

    if (!filteredRecipients.length) {
      return;
    }

    const actionVerb = isNew ? 'placed on rent' : 'updated';
    const actorLabel = actor ? `${actor.name} (${actor.role?.name || 'User'})` : 'System';
    const locationParts = [hoarding.city, hoarding.area].filter(Boolean).join(', ');
    const amountNumber = Number(rent.rentAmount);
    const formattedAmount = isNaN(amountNumber)
      ? rent.rentAmount.toString()
      : amountNumber.toLocaleString('en-IN', { maximumFractionDigits: 2 });

    const title = isNew
      ? `Hoarding ${hoarding.code} placed on rent`
      : `Rent updated for ${hoarding.code}`;
    const body = `${actorLabel} ${actionVerb} ${hoarding.code}${locationParts ? ` (${locationParts})` : ''}. Current rent ₹${formattedAmount}.`;
    const link = `/hoardings/${hoarding.id}/rent`;

    await this.notificationService.notifyUsers(
      filteredRecipients.map((user) => user.id),
      title,
      body,
      link,
    );
  }

  async processAnnualIncrements() {
    const currentYear = new Date().getFullYear();

    // Find rents that are due for increment
    const rentsToIncrement = await this.rentRepository.findDueForIncrement(currentYear);

    console.log(`Found ${rentsToIncrement.length} rents due for annual increment.`);

    let count = 0;
    for (const rent of rentsToIncrement) {
      try {
        await this.recalculateRent(rent.hoardingId);
        count++;
      } catch (error) {
        console.error(`Failed to increment rent for hoarding ${rent.hoardingId}`, error);
      }
    }

    return count;
  }
}

interface RentNotificationContext {
  hoarding: Hoarding;
  rent: Rent;
  actor?: User & { role: { name: string } };
  isNew: boolean;
}
