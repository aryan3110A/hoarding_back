import { Prisma, PropertyRent, PaymentFrequency, User, IncrementType } from '@prisma/client';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';

interface SavePropertyRentInput {
  propertyGroupId: string;
  location?: string;
  landlord?: string;
  rentAmount: number | string;
  incrementCycleYears?: number; // 1/2/3
  incrementType?: IncrementType; // PERCENTAGE | AMOUNT
  incrementValue?: number | string; // percent or amount
  rentStartDate?: string; // ISO date
  paymentFrequency: PaymentFrequency;
  lastPaymentDate?: string; // ISO
  reminderDays?: number[]; // e.g. [7,14]
  landlordName?: string;
}

export class PropertyRentService {
  private repo: PropertyRentRepository;
  private hoardingRepo: HoardingRepository;
  private notificationService: NotificationService;
  private userRepository: UserRepository;

  constructor() {
    this.repo = new PropertyRentRepository();
    this.hoardingRepo = new HoardingRepository();
    this.notificationService = new NotificationService();
    this.userRepository = new UserRepository();
  }

  // Accept optional actor (authenticated user) so notifications can exclude the actor
  async save(data: SavePropertyRentInput, actor?: User & { role: { name: string } }): Promise<PropertyRent> {
    const {
      propertyGroupId,
      location,
      rentAmount,
      incrementCycleYears = 1,
      incrementType = 'PERCENTAGE',
      incrementValue,
      rentStartDate,
      paymentFrequency,
      lastPaymentDate,
      reminderDays = [14],
      landlordName,
    } = data;

    const existing = await this.repo.findByGroupId(propertyGroupId);

    const lastPaid = lastPaymentDate ? new Date(lastPaymentDate) : undefined;
    const startDate = rentStartDate ? new Date(rentStartDate) : undefined;
    const nextDueDate = lastPaid ? this.calculateNextDueDate(lastPaid, paymentFrequency) : undefined;

    const rentDecimal = new Prisma.Decimal(rentAmount);
    const incrementValueDecimal = incrementValue != null ? new Prisma.Decimal(incrementValue) : undefined;

    // Compute nextIncrementDate based on rentStartDate and cycle years
    let nextIncrementDate: Date | undefined = undefined;
    if (startDate) {
      nextIncrementDate = new Date(startDate);
      nextIncrementDate.setFullYear(nextIncrementDate.getFullYear() + (incrementCycleYears || 1));
    }

    const payload: Prisma.PropertyRentCreateInput | Prisma.PropertyRentUpdateInput = {
      propertyGroupId,
      location,
      landlord: landlordName || undefined,
      rentAmount: rentDecimal,
      incrementCycleYears,
      paymentFrequency,
      lastPaymentDate: lastPaid,
      nextDueDate,
      incrementRate: new Prisma.Decimal(0.10),
      reminderDays,
      baseRent: rentDecimal,
      rentStartDate: startDate,
      incrementType,
      incrementValue: incrementValueDecimal,
      lastIncrementDate: undefined,
      nextIncrementDate,
    };

    let result: PropertyRent;

    if (existing) {
      result = await this.repo.update(existing.id, payload as Prisma.PropertyRentUpdateInput);
    } else {
      result = await this.repo.create(payload as Prisma.PropertyRentCreateInput);
    }

    // Link hoardings to this group if they match the code pattern and aren't linked yet
    // Must be done AFTER creating PropertyRent due to foreign key constraint
    await this.hoardingRepo.linkHoardingsToGroup(propertyGroupId);

    // Update status only for hoardings linked to this group (S/L/R faces)
    await this.hoardingRepo.updateStatusByPropertyGroupId(propertyGroupId, 'on_rent');

    // Notify relevant users (owner/manager/admin) about this change
    try {
      const targetRoles = ['owner', 'manager', 'admin'];
      const recipients = await this.userRepository.findByRoles(targetRoles);
      const filtered = recipients.filter((u) => !actor || u.id !== actor.id).map(u => u.id);
      if (filtered.length > 0) {
        const amount = Number(result.rentAmount);
        const formatted = isNaN(amount) ? String(result.rentAmount) : amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
        const title = existing ? `Property ${propertyGroupId} rent updated` : `Property ${propertyGroupId} placed on rent`;
        const body = `${actor ? actor.name : 'System'} ${existing ? 'updated' : 'placed on rent'} ${propertyGroupId}${result.location ? ` (${result.location})` : ''}. Current rent ₹${formatted}.`;
        const link = `/property-rents/${encodeURIComponent(propertyGroupId)}`;
        await this.notificationService.notifyUsers(filtered, title, body, link);
      }
    } catch (err) {
      // Notification failures shouldn't block the main operation
      console.error('Failed to send property rent notifications', err);
    }

    return result;
  }

  async get(propertyGroupId: string) {
    const record = await this.repo.findByGroupId(propertyGroupId);
    if (!record) throw new NotFoundError('Property rent not found');
    return record;
  }

  async list(params: { skip?: number; take?: number } = {}) {
    return this.repo.list(params);
  }

  async upcoming(days: number) {
    return this.repo.upcomingDues(days);
  }

  async overdue() {
    return this.repo.overdueDues();
  }

  calculateNextDueDate(lastPaid: Date, freq: PaymentFrequency) {
    const d = new Date(lastPaid);
    switch (freq) {
      case 'Monthly':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'Quarterly':
        d.setMonth(d.getMonth() + 3);
        break;
      case 'HalfYearly':
        d.setMonth(d.getMonth() + 6);
        break;
      case 'Yearly':
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    return d;
  }

  // Compute expected next rent based on compounding rules
  computeNextRent(r: PropertyRent) {
    const current = Number(r.baseRent ?? r.rentAmount);
    if (!r.incrementType || r.incrementValue == null) return current;
    const incVal = Number(r.incrementValue);
    if (r.incrementType === 'PERCENTAGE') {
      return current + (current * incVal / 100);
    } else {
      return current + incVal;
    }
  }

  // Apply increments for records whose nextIncrementDate is due
  async applyDueIncrements(today = new Date()) {
    const due = await this.repo.list({});
    let count = 0;
    for (const r of due.rows) {
      if (r.nextIncrementDate && new Date(r.nextIncrementDate) <= today) {
        const next = this.computeNextRent(r);
        const nextDate = new Date(r.nextIncrementDate);
        nextDate.setFullYear(nextDate.getFullYear() + (r.incrementCycleYears || 1));
        await this.repo.update(r.id, {
          baseRent: new Prisma.Decimal(next),
          lastIncrementDate: r.nextIncrementDate,
          nextIncrementDate: nextDate,
        });
        count++;
      }
    }
    return count;
  }

  annualizeAmount(rent: PropertyRent) {
    const base = Number(rent.rentAmount);
    switch (rent.paymentFrequency) {
      case 'Monthly': return base * 12;
      case 'Quarterly': return base * 4;
      case 'HalfYearly': return base * 2;
      case 'Yearly': return base;
      default: return base;
    }
  }

  async summary() {
    const all = (await this.repo.list({})).rows;
    const totalProperties = all.length;
    let annualized = 0;
    for (const r of all) annualized += this.annualizeAmount(r);
    const monthlyLoad = annualized / 12;
    const upcoming14 = await this.upcoming(14);
    const overdue = await this.overdue();
    return { totalProperties, monthlyLoad, annualizedRent: annualized, upcoming14, overdue };
  }
}
