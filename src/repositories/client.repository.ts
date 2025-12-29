/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '../lib/prisma';

export type ClientCreateInput = {
  name: string;
  phone: string;
  email?: string | null;
  companyName?: string | null;
  createdById?: string | null;
};

export class ClientRepository {
  async findByPhone(phone: string): Promise<unknown | null> {
    return (prisma as any).client.findUnique({ where: { phone } });
  }

  async create(data: ClientCreateInput): Promise<unknown> {
    return (prisma as any).client.create({ data });
  }

  async update(id: string, data: Partial<ClientCreateInput>): Promise<unknown> {
    return (prisma as any).client.update({ where: { id }, data });
  }

  async findAll(params?: { skip?: number; take?: number; where?: any }): Promise<unknown[]> {
    const skip = params?.skip || 0;
    const take = params?.take || 100;
    const where = params?.where || { isActive: true };
    return (prisma as any).client.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
  }
}
