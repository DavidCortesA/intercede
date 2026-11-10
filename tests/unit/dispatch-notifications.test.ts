import { describe, expect, it, vi } from "vitest";
import {
  DeliveryError,
  buildEmail,
  dispatchNotifications,
  safeEqual,
  type ClaimedNotification,
  type DispatchDeps,
  type FinishArgs,
} from "../../supabase/functions/dispatch-notifications/dispatch";

const sub = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, p256dh: "k", auth: "a" });

function notification(overrides: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return {
    id: "n1",
    kind: "schedule_started",
    title: "Vigilia <b>",
    body: "Ya empezó la sala de oración",
    url: "/r/abc234",
    push_pending: true,
    email_pending: false,
    email: null,
    subscriptions: [sub("a")],
    ...overrides,
  };
}

function setup(queue: ClaimedNotification[], overrides: Partial<DispatchDeps> = {}) {
  const finished: FinishArgs[] = [];
  const sendPush = vi.fn<DispatchDeps["sendPush"]>(async () => {});
  const sendEmail = vi.fn<NonNullable<DispatchDeps["sendEmail"]>>(async () => {});
  const deps: DispatchDeps = {
    claim: async () => queue,
    finish: async (args) => void finished.push(args),
    sendPush,
    sendEmail,
    siteUrl: "https://intercede.test",
    ...overrides,
  };
  return { deps, finished, sendPush, sendEmail };
}

describe("dispatchNotifications", () => {
  it("envía el push con el enlace en el idioma y lo marca como enviado", async () => {
    const { deps, finished, sendPush } = setup([notification()]);
    const summary = await dispatchNotifications(deps);

    expect(summary).toMatchObject({ claimed: 1, pushSent: 1, pushFailed: 0 });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendPush.mock.calls[0]![1]);
    expect(payload).toEqual({ title: "Vigilia <b>", body: "Ya empezó la sala de oración", url: "/es/r/abc234", tag: "n1" });
    expect(finished).toEqual([{ id: "n1", pushState: "sent", emailState: "skipped", error: null, deadEndpoints: [] }]);
  });

  it("no hace nada si la cola está vacía", async () => {
    const { deps, finished, sendPush } = setup([]);
    expect(await dispatchNotifications(deps)).toMatchObject({ claimed: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(finished).toEqual([]);
  });

  it("quita los dispositivos dados de baja (404/410) y sigue con los demás", async () => {
    const { deps, finished } = setup([notification({ subscriptions: [sub("viva"), sub("muerta404"), sub("muerta410")] })], {
      sendPush: async (s) => {
        if (s.endpoint.endsWith("muerta404")) throw new DeliveryError("not found", 404);
        if (s.endpoint.endsWith("muerta410")) throw new DeliveryError("gone", 410);
      },
    });
    const summary = await dispatchNotifications(deps);

    expect(summary).toMatchObject({ pushSent: 1, removedEndpoints: 2 });
    expect(finished[0]).toMatchObject({ pushState: "sent", deadEndpoints: [sub("muerta404").endpoint, sub("muerta410").endpoint] });
  });

  it("si todos los dispositivos están dados de baja, falla sin reintentar", async () => {
    const { deps, finished } = setup([notification({ subscriptions: [sub("a"), sub("b")] })], {
      sendPush: async () => {
        throw new DeliveryError("gone", 410);
      },
    });
    await dispatchNotifications(deps);
    expect(finished[0]).toMatchObject({ pushState: "failed", deadEndpoints: [sub("a").endpoint, sub("b").endpoint], error: null });
  });

  it("deja pendiente (para reintentar) si el fallo es de red, límite de uso o del servicio", async () => {
    for (const status of [undefined, 429, 500, 503]) {
      const { deps, finished } = setup([notification()], {
        sendPush: async () => {
          throw new DeliveryError("fallo", status);
        },
      });
      await dispatchNotifications(deps);
      expect(finished[0], String(status)).toMatchObject({ pushState: "pending", deadEndpoints: [] });
      expect(finished[0]?.error).toContain("fallo");
    }
  });

  it("un rechazo definitivo (400/401/403) no se reintenta", async () => {
    for (const status of [400, 401, 403]) {
      const { deps, finished } = setup([notification()], {
        sendPush: async () => {
          throw new DeliveryError("rechazado", status);
        },
      });
      await dispatchNotifications(deps);
      expect(finished[0], String(status)).toMatchObject({ pushState: "failed", deadEndpoints: [] });
    }
  });

  it("basta un dispositivo alcanzado para darlo por enviado, aunque otro falle por un error temporal", async () => {
    const { deps, finished } = setup([notification({ subscriptions: [sub("ok"), sub("lento")] })], {
      sendPush: async (s) => {
        if (s.endpoint.endsWith("lento")) throw new DeliveryError("timeout");
      },
    });
    await dispatchNotifications(deps);
    expect(finished[0]).toMatchObject({ pushState: "sent" });
  });

  it("envía el correo con el aviso y el enlace, y escapa el HTML del título", async () => {
    const { deps, finished, sendEmail, sendPush } = setup([notification({ push_pending: false, email_pending: true, email: "ana@example.test", subscriptions: [] })]);
    const summary = await dispatchNotifications(deps);

    expect(sendPush).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ emailSent: 1 });
    const message = sendEmail.mock.calls[0]![0];
    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("Vigilia <b>");
    expect(message.text).toContain("https://intercede.test/es/r/abc234");
    expect(message.text).toContain("https://intercede.test/es/avisos");
    expect(message.html).toContain("Vigilia &lt;b&gt;");
    expect(message.html).not.toContain("<b>");
    expect(finished[0]).toMatchObject({ pushState: "skipped", emailState: "sent" });
  });

  it("omite el correo si no está configurado", async () => {
    const { deps, finished } = setup([notification({ push_pending: false, email_pending: true, email: "ana@example.test" })], { sendEmail: null });
    await dispatchNotifications(deps);
    expect(finished[0]).toMatchObject({ emailState: "skipped" });
  });

  it("reintenta el correo en fallos temporales y no en rechazos", async () => {
    const run = async (status: number) => {
      const { deps, finished } = setup([notification({ push_pending: false, email_pending: true, email: "ana@example.test" })], {
        sendEmail: async () => {
          throw new DeliveryError("Resend", status);
        },
      });
      await dispatchNotifications(deps);
      return finished[0]?.emailState;
    };
    expect(await run(503)).toBe("pending");
    expect(await run(429)).toBe("pending");
    expect(await run(422)).toBe("failed");
  });

  it("un fallo en un canal no impide el otro", async () => {
    const { deps, finished } = setup([notification({ email_pending: true, email: "ana@example.test" })], {
      sendPush: async () => {
        throw new DeliveryError("rechazado", 403);
      },
    });
    await dispatchNotifications(deps);
    expect(finished[0]).toMatchObject({ pushState: "failed", emailState: "sent" });
  });

  it("procesa cada aviso por separado", async () => {
    const { deps, finished } = setup([notification({ id: "a" }), notification({ id: "b" }), notification({ id: "c" })]);
    const summary = await dispatchNotifications(deps);
    expect(summary.claimed).toBe(3);
    expect(finished.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildEmail y safeEqual", () => {
  it("escapa el HTML del cuerpo y de las comillas del enlace", () => {
    const message = buildEmail(notification({ body: "<script>x</script>" }), "a@b.test", 'https://x.test/"', "https://x.test/es/avisos");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("&quot;");
  });

  it("compara el secreto sin importar el largo ni dónde difiere", () => {
    expect(safeEqual("secreto", "secreto")).toBe(true);
    expect(safeEqual("secreto", "secretO")).toBe(false);
    expect(safeEqual("secreto", "secret")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
