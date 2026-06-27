import { z } from 'zod';

export const identifySchema = z.object({
  userId: z.string().optional(),
  anonymousId: z.string().optional(),
  traits: z.object({}).catchall(z.unknown()) // Validate traits but avoid logging full PII
});

export const trackSchema = z.object({
  userId: z.string().optional(),
  anonymousId: z.string().optional(),
  event: z.string().min(1),
  properties: z.object({}).catchall(z.unknown()).optional(),
  timestamp: z.string().optional()
});

export const batchSchema = z.object({
  batch: z.array(z.union([
    identifySchema.extend({ type: z.literal('identify') }),
    trackSchema.extend({ type: z.literal('track') })
  ]))
});