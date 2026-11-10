import { z } from "zod";

/** Lo que entrega `PushSubscription.toJSON()` en el navegador. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(2048) });

/** Hora local "HH:MM" del recordatorio del devocional. */
export const reminderTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
