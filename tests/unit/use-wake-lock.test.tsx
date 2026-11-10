import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "@/features/audio/use-wake-lock";

function makeSentinel() {
  return { released: false, release: vi.fn(async function (this: { released: boolean }) { this.released = true; }) };
}

describe("useWakeLock", () => {
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  });

  afterEach(() => {
    // @ts-expect-error se limpia el simulacro para las demás pruebas
    delete navigator.wakeLock;
  });

  it("pide mantener la pantalla encendida mientras está activo y la libera al salir", async () => {
    const sentinel = makeSentinel();
    request.mockResolvedValue(sentinel);
    const { unmount } = renderHook(() => useWakeLock(true));

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    unmount();
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  it("no hace nada si está desactivado", () => {
    renderHook(() => useWakeLock(false));
    expect(request).not.toHaveBeenCalled();
  });

  it("lo vuelve a pedir al volver a la pestaña (el navegador lo libera al ocultarla)", async () => {
    const first = makeSentinel();
    const second = makeSentinel();
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    renderHook(() => useWakeLock(true));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    first.released = true; // el navegador lo soltó al ocultar la pestaña
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("si el dispositivo lo niega, la sala sigue funcionando (sin errores)", async () => {
    request.mockRejectedValue(new DOMException("denegado", "NotAllowedError"));
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
  });

  it("sin soporte del navegador no falla", () => {
    // @ts-expect-error simula un navegador sin Wake Lock
    delete navigator.wakeLock;
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
