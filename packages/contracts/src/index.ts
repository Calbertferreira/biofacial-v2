import { z } from 'zod';

export const createEventSchema = z.object({
  clientId: z.uuid().optional(),
  externalId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(3).max(160),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(80),
  venue: z.string().trim().min(1).max(240),
}).refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  message: 'O término deve ocorrer após o início.',
  path: ['endsAt'],
});

export const createGuestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email().optional(),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
}).refine(value => Boolean(value.email || value.phoneE164), {
  message: 'Informe email ou telefone.',
});

export const eventIdSchema = z.uuid();
export const inviteTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const acceptInvitationSchema = z.object({
  consent: z.literal(true),
  imageBase64: z.base64().max(2_000_000).optional(),
});
export const scanSchema = z.object({ imageBase64: z.base64().min(16).max(2_000_000) });

export type CreateEvent = z.infer<typeof createEventSchema>;
export type CreateGuest = z.infer<typeof createGuestSchema>;
