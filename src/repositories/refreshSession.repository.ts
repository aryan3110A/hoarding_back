import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class RefreshSessionRepository {
    async create(data: Prisma.RefreshSessionUncheckedCreateInput) {
        return prisma.refreshSession.create({
            data,
        });
    }

    async findByTokenHash(refreshTokenHash: string) {
        return prisma.refreshSession.findFirst({
            where: { refreshTokenHash },
            include: { user: { include: { role: true } } },
        });
    }

    async update(id: string, data: Prisma.RefreshSessionUpdateInput) {
        return prisma.refreshSession.update({
            where: { id },
            data,
        });
    }

    async revoke(id: string) {
        return prisma.refreshSession.update({
            where: { id },
            data: { revoked: true },
        });
    }

    async delete(id: string) {
        return prisma.refreshSession.delete({
            where: { id },
        });
    }
}
