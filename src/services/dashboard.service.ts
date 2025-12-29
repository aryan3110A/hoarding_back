import { prisma } from '../lib/prisma';
import { RentRepository } from '../repositories/rent.repository';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';

const rentRepository = new RentRepository();
const propertyRentRepository = new PropertyRentRepository();

export class DashboardService {
    async getOwnerDashboardStats() {
        // Prefer property-level rent model; fallback to legacy hoarding-level rent
            const propertyRents = await propertyRentRepository.list();
            if (propertyRents.rows.length) {
                const all = propertyRents.rows as Array<any>;

                console.log("DashboardService: Calculating stats with grouping logic. Total rents found:", all.length);

                // Count properties on rent using the SAME grouping as frontend Hoardings page
                // based on hoardings that are currently on rent.
                const rentedHoardings = await prisma.hoarding.findMany({
                    where: { status: 'on_rent' },
                    select: { code: true, landmark: true, title: true, city: true, area: true }
                });
                const groups = new Set<string>();
                for (const h of rentedHoardings) {
                    const code = h.code || '';
                    const parts = code.split('-');
                    let prefix = code;
                    if (parts.length >= 2) {
                        prefix = parts.slice(0, 2).join('-');
                    }
                    const locationKey = h.landmark || h.title || ((h.city || '') + (h.area ? `, ${h.area}` : ''));
                    const key = `${prefix}|${locationKey}`;
                    groups.add(key);
                }
                const totalProperties = groups.size;

                // Financials still based on property-level rents
                let annualized = 0;
                for (const r of all) {
                    const amount = Number(r.rentAmount);
                    switch (r.paymentFrequency) {
                        case 'Monthly': annualized += amount * 12; break;
                        case 'Quarterly': annualized += amount * 4; break;
                        case 'HalfYearly': annualized += amount * 2; break;
                        case 'Yearly': annualized += amount; break;
                        default: annualized += amount;
                    }
                }
                const monthlyLoad = annualized / 12;
                const upcomingDues = await propertyRentRepository.upcomingDues(14);
                const overdue = await propertyRentRepository.overdueDues();
                return {
                    mode: 'property',
                    totalProperties,
                    totalMonthlyRentLoad: monthlyLoad,
                    totalAnnualizedRent: annualized,
                    upcomingDues,
                    overduePayments: overdue,
                };
            }

        // Legacy fallback
        const totalHoardingsOnRent = await prisma.rent.count();
        const rentSum = await prisma.rent.aggregate({ _sum: { rentAmount: true } });
        const allRents = await prisma.rent.findMany({ select: { rentAmount: true, paymentMode: true } });
        let totalAnnualizedRent = 0;
        for (const r of allRents) {
            const amount = Number(r.rentAmount);
            switch (r.paymentMode) {
                case 'Monthly': totalAnnualizedRent += amount * 12; break;
                case 'Quarterly': totalAnnualizedRent += amount * 4; break;
                case 'Half-Yearly': totalAnnualizedRent += amount * 2; break;
                case 'Yearly': totalAnnualizedRent += amount; break;
                default: totalAnnualizedRent += amount;
            }
        }
        const totalMonthlyRent = totalAnnualizedRent / 12;
        const upcomingDues = await prisma.rent.findMany({
            where: { nextDueDate: { gte: new Date() } },
            take: 5,
            orderBy: { nextDueDate: 'asc' },
            include: {
                hoarding: { select: { code: true, title: true, city: true, area: true } },
            },
        });
        return {
            mode: 'legacy-hoarding',
            totalHoardingsOnRent,
            totalRentAmount: totalMonthlyRent,
            totalAnnualizedRent,
            upcomingDues,
        };
    }

    async getManagerDashboardStats() {
        // Manager: summary + upcoming dues (no annualized normalization breakdown if we want lighter payload)
        const totalHoardingsOnRent = await prisma.rent.count();
        const rentSum = await prisma.rent.aggregate({ _sum: { rentAmount: true } });
        const totalRentAmount = rentSum._sum.rentAmount || 0;
        const upcomingDues = await prisma.rent.findMany({
            where: { nextDueDate: { gte: new Date() } },
            take: 5,
            orderBy: { nextDueDate: 'asc' },
            include: { hoarding: { select: { code: true, title: true, city: true, area: true } } },
        });
        return { totalHoardingsOnRent, totalRentAmount, upcomingDues };
    }

    async getSalesDashboardStats(userId?: string) {
        // Sales: very basic metrics – available hoardings count + own bookings count
        const availableHoardings = await prisma.hoarding.count({ where: { status: 'available' } });
        let myBookings = 0;
        if (userId) {
            myBookings = await prisma.booking.count({ where: { createdBy: userId } });
        }
        return { availableHoardings, myBookings };
    }

    async getDesignerDashboardStats(userId?: string) {
        // Placeholder: design assignments feature not implemented yet; return stub metrics
        return { assignmentsTotal: 0, assignmentsInProgress: 0, userId };
    }

    async getFitterDashboardStats(userId?: string) {
        // Placeholder: fitter jobs/tasks not implemented; return stub metrics
        return { jobsAssigned: 0, jobsCompleted: 0, userId };
    }
}
