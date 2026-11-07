import { describe, expect, it } from "vitest";
import { SessionSync } from "./session-sync";
import { createProject } from "./model";
import { applyProjectChanges, diffProject } from "./session-protocol";

describe("shared session edits", () => {
  it("merges simultaneous edits without losing an in-progress local gesture", () => {
    const original = createProject();
    const local = new SessionSync();
    local.welcome(original, 0, 0);
    const gesture = structuredClone(original);
    gesture.bass.cutoff = 2000;
    local.edit(gesture);
    const first = local.flush();
    if (!first) throw new Error("Missing local edit");
    gesture.bass.cutoff = 3000;
    local.edit(gesture);
    const friend = structuredClone(original);
    friend.keys.tone = 0.9;
    expect(local.patch(1, diffProject(original, friend))).toBe(true);
    expect(local.view()?.bass.cutoff).toBe(3000);
    expect(local.view()?.keys.tone).toBe(0.9);
    expect(local.patch(2, first.changes, first.sequence)).toBe(true);
    expect(local.view()?.bass.cutoff).toBe(3000);
    const final = local.flush();
    if (!final) throw new Error("Missing final gesture edit");
    expect(local.patch(3, final.changes, final.sequence)).toBe(true);
    expect(local.unacknowledged()).toEqual([]);
    expect(local.view()?.keys.tone).toBe(0.9);
  });

  it("reconnects without replaying edits already applied by the server", () => {
    const original = createProject();
    const sync = new SessionSync();
    sync.welcome(original, 0, 0);
    const edited = structuredClone(original);
    edited.arp.volume = 0.7;
    sync.edit(edited);
    const pending = sync.flush();
    if (!pending) throw new Error("Missing pending edit");
    const accepted = applyProjectChanges(original, pending.changes);
    if (!accepted) throw new Error("Invalid edit");
    sync.welcome(accepted, 1, pending.sequence);
    expect(sync.unacknowledged()).toEqual([]);
    expect(sync.view()).toEqual(edited);
    edited.pad.volume = 0.2;
    sync.edit(edited);
    expect(sync.flush()?.sequence).toBe(pending.sequence + 1);
  });

  it("requests a fresh snapshot for missing revisions", () => {
    const original = createProject();
    const sync = new SessionSync();
    sync.welcome(original, 0, 0);
    expect(sync.patch(3, [])).toBe(false);
    expect(sync.view()).toEqual(original);
  });
});
