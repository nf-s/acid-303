import { describe, expect, it } from "vitest";
import { createProject, exportPlan } from "./model";
import type { InstrumentId } from "./model";
import { audibleProject, soloSilenced, toggleSolo } from "./solo";

function project() {
  const value = createProject();
  value.arp.muted = false;
  value.pad.muted = false;
  value.vocal.muted = false;
  value.cloud.muted = false;
  value.tension.muted = false;
  return value;
}
function mutes(value: ReturnType<typeof createProject>) {
  return {
    ...Object.fromEntries(value.drums.map((track) => [track.id, track.muted])),
    bass: value.bass.muted,
    keys: value.keys.muted,
    arp: value.arp.muted,
    pad: value.pad.muted,
    vocal: value.vocal.muted,
    cloud: value.cloud.muted,
    tension: value.tension.muted,
  };
}

describe("solo", () => {
  it("returns the same project when nothing is soloed", () => {
    const source = project();
    expect(audibleProject(source, new Set())).toBe(source);
    expect(soloSilenced(new Set(), "bass")).toBe(false);
  });

  it("silences every unsoloed track without changing saved mutes", () => {
    const source = project();
    const before = structuredClone(source);
    const audible = audibleProject(source, new Set<InstrumentId>(["kick"]));
    expect(mutes(audible)).toEqual({
      kick: false,
      snare: true,
      hat: true,
      clap: true,
      rim: true,
      bass: true,
      keys: true,
      arp: true,
      pad: true,
      vocal: true,
      cloud: true,
      tension: true,
    });
    expect(source).toEqual(before);
    expect(audible.drums[0]).toBe(source.drums[0]);
    expect(audible.drums[1]?.steps).toBe(source.drums[1]?.steps);
  });

  it("is additive and keeps a muted soloed track muted", () => {
    const source = project();
    source.bass.muted = true;
    let soloed = toggleSolo(new Set(), "bass");
    soloed = toggleSolo(soloed, "pad");
    soloed = toggleSolo(soloed, "hat");
    const audible = audibleProject(source, soloed);
    expect(audible.bass.muted).toBe(true);
    expect(audible.pad.muted).toBe(false);
    expect(audible.drums.find((track) => track.id === "hat")?.muted).toBe(
      false,
    );
    expect(audible.keys.muted).toBe(true);
  });

  it("restores the underlying mutes when solo is cleared", () => {
    const source = project();
    source.keys.muted = true;
    const soloed = toggleSolo(toggleSolo(new Set(), "bass"), "bass");
    expect(soloed.size).toBe(0);
    expect(mutes(audibleProject(source, soloed))).toEqual(mutes(source));
  });

  it("ignores unknown ids", () => {
    expect(toggleSolo(new Set(), "cowbell").size).toBe(0);
    expect(toggleSolo(new Set(), undefined).size).toBe(0);
  });

  it("excludes solo-silenced loops from the export cycle", () => {
    const source = project();
    source.cloud.timing = { bars: 16, meter: "4/4", grid: "straight" };
    source.cloud.steps = Array.from({ length: 256 }, (_, index) => ({
      note: 48,
      on: index % 16 === 0,
      velocity: 0.75,
    }));
    expect(exportPlan(source).ticks).toBe(16 * 96);
    expect(
      exportPlan(audibleProject(source, new Set<InstrumentId>(["kick"]))).ticks,
    ).toBeLessThan(16 * 96);
  });
});
