import { Prisma, Hoarding } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class HoardingRepository {
    async create(data: Prisma.HoardingCreateInput): Promise<Hoarding> {
        // Guard against FK violation on propertyGroupId -> PropertyRent.propertyGroupId
        // Use UncheckedCreateInput to allow scalar FK assignment when valid
        const finalData = { ...data } as Prisma.HoardingUncheckedCreateInput;

        if (finalData.propertyGroupId) {
            const existingPropertyRent = await prisma.propertyRent.findUnique({
                where: { propertyGroupId: finalData.propertyGroupId },
            });
            if (!existingPropertyRent) {
                // Omit propertyGroupId to avoid FK constraint violation
                delete finalData.propertyGroupId;
            }
        }

        return prisma.hoarding.create({ data: finalData });
    }

    async update(id: string, data: Prisma.HoardingUpdateInput): Promise<Hoarding> {
        return prisma.hoarding.update({
            where: { id },
            data,
        });
    }

    async findById(id: string): Promise<Hoarding | null> {
        return prisma.hoarding.findUnique({ where: { id } });
    }

    async findAll(params: {
        skip?: number;
        take?: number;
        where?: Prisma.HoardingWhereInput;
    }): Promise<{ hoardings: Hoarding[]; total: number }> {
        const { skip, take, where } = params;
        const [hoardings, total] = await prisma.$transaction([
            prisma.hoarding.findMany({
                skip,
                take,
                where,
                orderBy: { createdAt: 'asc' }, // Order by creation time ASC to match CSV import sequence
                include: {
                    rent: true, // Include hoarding-level rent details
                    propertyRent: true, // Include property-level rent if linked via propertyGroupId
                    tokens: {
                        where: { status: 'ACTIVE' },
                        select: { id: true, status: true, expiresAt: true, dateFrom: true, dateTo: true }
                    }
                },
            }),
            prisma.hoarding.count({ where }),
        ]);
        return { hoardings, total };
    }

    async delete(id: string): Promise<Hoarding> {
        return prisma.hoarding.delete({
            where: { id },
        });
    }

    async updateStatusByPropertyGroupId(propertyGroupId: string, status: string): Promise<Prisma.BatchPayload> {
        // When a property-level rent exists, reflect 'on_rent' across all hoardings in the group
        // Update any hoarding in the group that is not already marked 'on_rent'
        return prisma.hoarding.updateMany({
            where: {
                propertyGroupId,
                NOT: { status: 'on_rent' }
            },
            data: { status },
        });
    }

    // Safer update: use code prefix matching to avoid accidental cross-linking.
    // This does not rely on propertyGroupId having been set; it matches by canonical prefix in hoarding.code.
    async updateStatusByCodePrefix(prefix: string, status: string): Promise<Prisma.BatchPayload> {
        return prisma.hoarding.updateMany({
            where: {
                OR: [
                    { code: prefix },
                    { code: { startsWith: `${prefix}-` } }
                ],
                NOT: { status: 'on_rent' }
            },
            data: { status },
        });
    }

    async linkHoardingsToGroup(propertyGroupId: string): Promise<Prisma.BatchPayload> {
        // Link only canonical faces: Solo (S) and lateral pairs (L/R).
        // Do not auto-link upper/lower/middle variants to avoid over-grouping.
        return prisma.hoarding.updateMany({
            where: {
                OR: [
                    { code: propertyGroupId },
                    { code: { startsWith: `${propertyGroupId}-S` } },
                    { code: { startsWith: `${propertyGroupId}-L` } },
                    { code: { startsWith: `${propertyGroupId}-R` } }
                ],
                propertyGroupId: null
            },
            data: { propertyGroupId }
        });
    }
}
