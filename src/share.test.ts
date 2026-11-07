import { describe, expect, it } from "vitest";
import { createProject } from "./model";
import { encodeTrack, decodeTrack } from "./share";

describe("track links", () => {
  it("round-trips musical state, all automation, and unicode names", async () => {
    const track = createProject();
    track.name = "Night 🐈 café";
    for (const drum of track.drums)
      drum.automation.tone = Array.from({ length: 16 }, (_, step) => step / 15);
    track.bass.automation.cutoff = Array.from(
      { length: 16 },
      (_, step) => 1 - step / 15,
    );
    const link = await encodeTrack(track);
    expect(link).toMatch(/^v1\.[\w-]+$/);
    expect(link.length).toBeLessThan(6000);
    expect(await decodeTrack(link)).toEqual(track);
  });
  it("rejects unsupported, damaged, oversized and invalid payloads", async () => {
    for (const value of [
      "v2.abc",
      "v1.!",
      "v1.abc",
      "v1." + "a".repeat(200001),
    ])
      expect(await decodeTrack(value)).toBeNull();
    const data = await new Response(
      new Blob(['{"version":2,"bpm":-10}'])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const binary = Array.from(new Uint8Array(data), (byte) =>
      String.fromCharCode(byte),
    ).join("");
    expect(
      await decodeTrack(
        "v1." +
          btoa(binary)
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", ""),
      ),
    ).toBeNull();
  });
});
