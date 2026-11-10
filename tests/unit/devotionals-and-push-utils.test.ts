import { describe, expect, it } from "vitest";
import { todayIn } from "@/features/devotionals/dates";
import { devotionalImportSchema, toDevotionalRow } from "@/features/devotionals/import-schema";
import { pushSubscriptionSchema, reminderTimeSchema } from "@/features/notifications/schemas";
import { urlBase64ToBytes } from "@/features/notifications/push-client";
import { scheduleFormSchema, toScheduleErrorKey } from "@/features/schedules/schemas";

const item = {
  date: "2027-01-01",
  passage_reference: "Texto 1:1",
  passage_text: "Texto de prueba.",
  bible_version: "Prueba",
  reflection: "Reflexión.",
  question: "¿Pregunta?",
};

describe("todayIn", () => {
  it("usa la fecha local de la zona, no la de UTC", () => {
    const instant = new Date("2026-06-01T03:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-06-01");
    expect(todayIn("America/Mexico_City", instant)).toBe("2026-05-31");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-06-01");
  });

  it("con una zona inválida cae en UTC", () => {
    expect(todayIn("Marte/Olimpo", new Date("2026-06-01T03:30:00Z"))).toBe("2026-06-01");
  });
});

describe("importador de devocionales", () => {
  it("acepta el formato y arma la fila de la base", () => {
    const parsed = devotionalImportSchema.parse([{ ...item, suggested_prayer: "Señor…" }, { ...item, date: "2027-01-02" }]);
    expect(toDevotionalRow(parsed[0]!)).toEqual({
      devotional_date: "2027-01-01",
      passage_reference: "Texto 1:1",
      passage_text: "Texto de prueba.",
      bible_version: "Prueba",
      reflection: "Reflexión.",
      question: "¿Pregunta?",
      suggested_prayer: "Señor…",
    });
    expect(toDevotionalRow(parsed[1]!).suggested_prayer).toBeNull();
  });

  it("rechaza archivos vacíos, fechas repetidas o inválidas y campos vacíos", () => {
    expect(devotionalImportSchema.safeParse([]).success).toBe(false);
    expect(devotionalImportSchema.safeParse([item, item]).success).toBe(false);
    expect(devotionalImportSchema.safeParse([{ ...item, date: "01/01/2027" }]).success).toBe(false);
    expect(devotionalImportSchema.safeParse([{ ...item, date: "2027-02-30" }]).success).toBe(false);
    expect(devotionalImportSchema.safeParse([{ ...item, passage_text: "   " }]).success).toBe(false);
    expect(devotionalImportSchema.safeParse([{ ...item, question: "x".repeat(501) }]).success).toBe(false);
    expect(devotionalImportSchema.safeParse({ date: "2027-01-01" }).success).toBe(false);
  });
});

describe("validaciones de avisos", () => {
  it("la suscripción push exige URL y claves", () => {
    const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "k", auth: "a" } };
    expect(pushSubscriptionSchema.safeParse(ok).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ ...ok, endpoint: "no es url" }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...ok, keys: { p256dh: "k" } }).success).toBe(false);
  });

  it("la hora del recordatorio es HH:MM", () => {
    for (const good of ["00:00", "07:30", "23:59"]) expect(reminderTimeSchema.safeParse(good).success, good).toBe(true);
    for (const bad of ["24:00", "7:30", "07:60", "07:30:00", ""]) expect(reminderTimeSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("la clave VAPID base64url se convierte en bytes", () => {
    // "AQID" = [1, 2, 3]; los caracteres - y _ equivalen a + y /
    expect(Array.from(urlBase64ToBytes("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToBytes("-_-_"))).toEqual([251, 255, 191]);
    expect(Array.from(urlBase64ToBytes("AQ"))).toEqual([1]);
  });
});

describe("formulario de salas programadas", () => {
  const form = { name: "Mañana", recurrence: "daily", date: "2027-01-01", time: "06:00", weekdays: [], timezone: "UTC", reminderMinutes: 10 };

  it("acepta un formulario válido", () => {
    expect(scheduleFormSchema.safeParse(form).success).toBe(true);
    expect(scheduleFormSchema.safeParse({ ...form, recurrence: "weekly", weekdays: [1, 3] }).success).toBe(true);
  });

  it("devuelve claves de error que la pantalla sabe traducir", () => {
    const first = (input: unknown) => toScheduleErrorKey(scheduleFormSchema.safeParse(input).error?.issues[0]?.message);
    expect(first({ ...form, name: "   " })).toBe("invalid_name");
    expect(first({ ...form, name: "x".repeat(61) })).toBe("invalid_name");
    expect(first({ ...form, recurrence: "weekly", weekdays: [] })).toBe("invalid_weekdays");
    expect(first({ ...form, timezone: "" })).toBe("invalid_timezone");
    expect(first({ ...form, date: "" })).toBe("schedule_in_past");
    expect(first({ ...form, time: "25:00" })).toBe("generic");
    expect(first({ ...form, reminderMinutes: 7 })).toBe("generic");
  });

  it("toScheduleErrorKey conoce los códigos de la base y cae en generic con el resto", () => {
    expect(toScheduleErrorKey("too_many_schedules")).toBe("too_many_schedules");
    expect(toScheduleErrorKey("schedule_in_past")).toBe("schedule_in_past");
    expect(toScheduleErrorKey("algo raro")).toBe("generic");
    expect(toScheduleErrorKey(undefined)).toBe("generic");
  });
});
