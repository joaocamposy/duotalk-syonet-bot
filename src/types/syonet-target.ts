import { z } from 'zod';

export const syonetTargetSchema = z.object({
  companyId: z.number().int().positive(),
});

export type SyonetTarget = z.infer<typeof syonetTargetSchema>;
