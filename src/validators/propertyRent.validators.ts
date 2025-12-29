import { z } from 'zod';

export const savePropertyRentSchema = z.object({
  body: z.object({
    propertyGroupId: z.string().min(1),
    location: z.string().optional(),
    rentAmount: z.number().or(z.string().transform(Number)),
    incrementCycleYears: z.number().int().min(1).max(5).optional(),
    paymentFrequency: z.enum(['Monthly','Quarterly','HalfYearly','Yearly']),
    lastPaymentDate: z.string().optional(),
    reminderDays: z.array(z.number().int().positive()).max(3).optional(),
  })
});
