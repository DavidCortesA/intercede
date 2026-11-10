import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, icsDate, icsFileName } from "@/features/events/ics";
import { communityFormSchema, parseInviteToken, toCommunityError } from "@/features/communities/schemas";
import messages from "@/messages/es.json";

const format = (message: string, values: Record<string, number>) => new IntlMessageFormat(message, "es").format(values);

describe("exportar eventos a calendario (.ics)", () => {
  it("las fechas van en UTC con formato de calendario", () => {
    expect(icsDate("2026-12-25T02:00:00+00:00")).toBe("20261225T020000Z");
    expect(icsDate(new Date("2026-03-08T10:30:15.123Z"))).toBe("20260308T103015Z");
  });

  it("escapa los caracteres especiales del texto", () => {
    expect(escapeIcsText("Vigilia; ayuno, oración\\paz\nsegunda línea")).toBe("Vigilia\\; ayuno\\, oración\\\\paz\\nsegunda línea");
  });

  it("dobla las líneas largas a 75 octetos sin partir caracteres", () => {
    const long = "DESCRIPTION:" + "ñ".repeat(80);
    const folded = foldIcsLine(long);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const [index, line] of physical.entries()) {
      expect(new TextEncoder().encode(line).length, `línea ${index}`).toBeLessThanOrEqual(75);
      if (index > 0) expect(line.startsWith(" ")).toBe(true);
    }
    // Al desdoblar queda el original
    expect(physical.map((line, index) => (index === 0 ? line : line.slice(1))).join("")).toBe(long);
    expect(foldIcsLine("corta")).toBe("corta");
  });

  it("arma un VCALENDAR válido con UID estable y fin de línea CRLF", () => {
    const ics = buildIcs({
      id: "abc-123",
      title: "Vigilia de ayuno",
      description: "Toda la noche; trae tu Biblia",
      startsAt: "2026-12-25T02:00:00Z",
      endsAt: "2026-12-25T04:00:00Z",
      url: "https://intercede.test/es/comunidades/x/eventos",
      stamp: new Date("2026-11-10T12:00:00Z"),
    });
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/); // ningún salto de línea suelto
    const lines = ics.split("\r\n");
    expect(lines.slice(0, 3)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//INTERCEDE//Eventos//ES"]);
    expect(lines).toContain("UID:event-abc-123@intercede");
    expect(lines).toContain("DTSTAMP:20261110T120000Z");
    expect(lines).toContain("DTSTART:20261225T020000Z");
    expect(lines).toContain("DTEND:20261225T040000Z");
    expect(lines).toContain("SUMMARY:Vigilia de ayuno");
    expect(lines).toContain("DESCRIPTION:Toda la noche\\; trae tu Biblia");
    expect(lines).toContain("URL:https://intercede.test/es/comunidades/x/eventos");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("sin descripción ni enlace no emite esas líneas", () => {
    const ics = buildIcs({ id: "1", title: "Culto", startsAt: "2026-12-25T02:00:00Z", endsAt: "2026-12-25T03:00:00Z" });
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("URL:");
  });

  it("un título con un salto de línea no puede inyectar propiedades", () => {
    const ics = buildIcs({ id: "1", title: "Culto\r\nATTENDEE:mailto:x@y.z", startsAt: "2026-12-25T02:00:00Z", endsAt: "2026-12-25T03:00:00Z" });
    expect(ics.split("\r\n").some((line) => line.startsWith("ATTENDEE"))).toBe(false);
  });

  it("el nombre del archivo es seguro", () => {
    expect(icsFileName("Vigilia de oración — ¡Gran noche!")).toBe("vigilia-de-oracion-gran-noche.ics");
    expect(icsFileName("../../etc/passwd")).toBe("etc-passwd.ics");
    expect(icsFileName("¡¡¡")).toBe("evento.ics");
  });
});

describe("invitaciones y errores de comunidades", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUv_-12";

  it("acepta el enlace completo o solo el código", () => {
    expect(parseInviteToken(token)).toBe(token);
    expect(parseInviteToken(`  ${token}  `)).toBe(token);
    expect(parseInviteToken(`https://intercede.app/es/c/${token}`)).toBe(token);
    expect(parseInviteToken(`http://localhost:3000/es/c/${token}/`)).toBe(token);
    expect(parseInviteToken(`https://intercede.app/es/c/${token}?x=1#y`)).toBe(token);
  });

  it("rechaza lo que no es un código", () => {
    for (const bad of ["", "corto", "has espacios en el medio de algo largo", "https://evil.example/", `https://x.test/es/p/${token}`, "x".repeat(65)]) {
      expect(parseInviteToken(bad), bad).toBeNull();
    }
  });

  it("traduce los errores de la base a claves conocidas", () => {
    expect(toCommunityError({ message: "last_admin" })).toBe("last_admin");
    expect(toCommunityError({ message: "not_leader" })).toBe("not_leader");
    expect(toCommunityError({ code: "23505", message: "duplicate key" })).toBe("duplicate_devotional");
    expect(toCommunityError({ message: "algo raro" })).toBe("generic");
    expect(toCommunityError(null)).toBe("generic");
  });

  it("valida el formulario de comunidad", () => {
    const ok = { name: "Vida Nueva", kind: "church", description: "" };
    expect(communityFormSchema.safeParse(ok).success).toBe(true);
    expect(communityFormSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(communityFormSchema.safeParse({ ...ok, name: "x".repeat(61) }).success).toBe(false);
    expect(communityFormSchema.safeParse({ ...ok, kind: "club" }).success).toBe(false);
    expect(communityFormSchema.safeParse({ ...ok, description: "x".repeat(501) }).success).toBe(false);
  });
});

describe("mensajes con plural de eventos", () => {
  const events = messages.Communities.events;

  it("el resumen de asistencia", () => {
    expect(format(events.rsvp.summary, { going: 0, maybe: 0 })).toBe("Nadie confirmó aún");
    expect(format(events.rsvp.summary, { going: 1, maybe: 0 })).toBe("1 persona va");
    expect(format(events.rsvp.summary, { going: 12, maybe: 3 })).toBe("12 personas van · 3 tal vez");
  });

  it("duración y recordatorio", () => {
    expect(format(events.new.durationOption, { minutes: 60 })).toBe("1 hora");
    expect(format(events.new.durationOption, { minutes: 90 })).toBe("1 hora y media");
    expect(format(events.new.durationOption, { minutes: 30 })).toBe("30 minutos");
    expect(format(events.new.reminderOption, { minutes: 0 })).toBe("Sin recordatorio");
    expect(format(events.new.reminderOption, { minutes: 15 })).toBe("15 min antes");
    expect(format(events.new.reminderOption, { minutes: 1440 })).toBe("1 día antes");
  });
});
