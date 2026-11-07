import fixture from "../public/vocals/catalog-v2.json?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("bounded vocal metadata loading", () => {
  it("validates and caches waveform metadata without creating audio", async () => {
    const audio = vi.fn(() => {
      throw new Error("Audio must not be created");
    });
    vi.stubGlobal("AudioContext", audio);
    const fetcher = vi.fn(async () => new Response(fixture));
    vi.stubGlobal("fetch", fetcher);
    const { loadVocalCatalog } = await import("./vocal-samples");
    const catalog = await loadVocalCatalog();
    expect(catalog.samples).toHaveLength(48);
    expect(
      catalog.samples.every(
        (sample) =>
          sample.rootNote >= 36 &&
          sample.rootNote <= 84 &&
          sample.peaks.length === 128,
      ),
    ).toBe(true);
    expect(await loadVocalCatalog()).toBe(catalog);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(audio).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed metadata without trusting absent content length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(256 * 1024 + 1))),
    );
    const { loadVocalCatalog } = await import("./vocal-samples");
    await expect(loadVocalCatalog()).rejects.toThrow("too large");
  });
  it("rejects invalid catalogs and retries a failed request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1,"samples":[]}'))
      .mockResolvedValueOnce(new Response(fixture));
    vi.stubGlobal("fetch", fetcher);
    const { loadVocalCatalog } = await import("./vocal-samples");
    await expect(loadVocalCatalog()).rejects.toThrow("catalog is invalid");
    expect((await loadVocalCatalog()).samples).toHaveLength(48);
  });
  it("cancels an in-flight download and reports timeouts distinctly", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            ),
          ),
      ),
    );
    const { loadVocalCatalog } = await import("./vocal-samples");
    const controller = new AbortController();
    const cancelled = expect(
      loadVocalCatalog(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelled;
    const timeout = expect(loadVocalCatalog()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(8000);
    await timeout;
  });
});
