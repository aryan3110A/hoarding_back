import { z } from 'zod';

export const createHoardingSchema = z.object({
    body: z.object({
        code: z.string(),
        title: z.string().optional(),
        city: z.string().optional(),
        area: z.string().optional(),
        landmark: z.string().optional(),
        roadName: z.string().optional(),
        side: z.enum(['LHS', 'RHS']).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        widthCm: z.number().optional(),
        heightCm: z.number().optional(),
        type: z.string().optional(),
        ownership: z.string().optional(),
        baseRate: z.number().optional(),
    }),
});

export const updateHoardingSchema = z.object({
    body: z.object({
        title: z.string().optional(),
        city: z.string().optional(),
        area: z.string().optional(),
        landmark: z.string().optional(),
        roadName: z.string().optional(),
        side: z.enum(['LHS', 'RHS']).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        widthCm: z.number().optional(),
        heightCm: z.number().optional(),
        type: z.string().optional(),
        ownership: z.string().optional(),
        status: z.string().optional(),
        baseRate: z.number().optional(),
    }),
});
