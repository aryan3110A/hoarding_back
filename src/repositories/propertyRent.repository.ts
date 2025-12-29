import { prisma } from '../lib/prisma';
import { Prisma, PropertyRent, PaymentFrequency } from '@prisma/client';

export class PropertyRentRepository {
  async findByGroupId(propertyGroupId: string): Promise<PropertyRent | null> {
    return prisma.propertyRent.findUnique({ where: { propertyGroupId } });
  }

  async create(data: Prisma.PropertyRentCreateInput): Promise<PropertyRent> {
    return prisma.propertyRent.create({ data });
  }

  async update(id: string, data: Prisma.PropertyRentUpdateInput): Promise<PropertyRent> {
    return prisma.propertyRent.update({ where: { id }, data });
  }

  async list(params: { skip?: number; take?: number } = {}) {
    const { skip, take } = params;
    const [rows, total] = await prisma.$transaction([
      prisma.propertyRent.findMany({ 
        skip, 
        take, 
        orderBy: { nextDueDate: 'asc' },
        include: { hoardings: true }
      }),
      prisma.propertyRent.count(),
    ]);
    return { rows, total };
  }

  async upcomingDues(daysAhead: number) {
    const now = new Date();
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);
    return prisma.propertyRent.findMany({
      where: { nextDueDate: { gte: now, lte: target } },
      orderBy: { nextDueDate: 'asc' },
      include: { hoardings: true },
    });
  }

  async overdueDues() {
    const now = new Date();
    return prisma.propertyRent.findMany({
      where: { nextDueDate: { lt: now } },
      orderBy: { nextDueDate: 'asc' },
      include: { hoardings: true },
    });
  }
}
