import { z } from "zod";
import { projectSchema, readProject } from "./model";
import type { Project } from "./model";
import {
  MAX_PROJECT_BYTES,
  MAX_TRACK_STEPS,
  automationTiming,
  resizeAutomationLane,
} from "./timing";
import type { Timing, AutomationBars } from "./timing";

export const SESSION_PROTOCOL = "grain-session-v6";
export const MAX_SESSION_BYTES = MAX_PROJECT_BYTES;
export const MAX_PROJECT_CHANGES = 4096;
export const MAX_SESSION_CLIENTS = 8;
export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const HOST_REPLACED_CODE = 4009;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const keySchema = z
  .string()
  .min(1)
  .max(64)
  .refine((key) => !forbiddenKeys.has(key));
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
function jsonSchema(depth: number): z.ZodType<JsonValue> {
  const primitive = z.union([
    z.string().max(1024),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]);
  if (depth === 0) return primitive;
  const child = jsonSchema(depth - 1);
  return z.union([
    primitive,
    z.array(child).max(MAX_TRACK_STEPS),
    z
      .record(keySchema, child)
      .refine((value) => Object.keys(value).length <= 64),
  ]);
}
const jsonValueSchema = jsonSchema(8);
const pathSchema = z
  .array(
    z.union([
      keySchema,
      z
        .number()
        .int()
        .min(0)
        .max(MAX_TRACK_STEPS - 1),
    ]),
  )
  .min(1)
  .max(8);
export const projectChangeSchema = z.union([
  z.object({ path: pathSchema, value: jsonValueSchema }).strict(),
  z
    .object({
      path: pathSchema,
      entries: z
        .array(
          z.tuple([
            z
              .number()
              .int()
              .min(0)
              .max(MAX_TRACK_STEPS - 1),
            jsonValueSchema,
          ]),
        )
        .min(1)
        .max(MAX_TRACK_STEPS)
        .refine(
          (entries) =>
            new Set(entries.map(([index]) => index)).size === entries.length,
        ),
    })
    .strict(),
]);
export type ProjectChange = z.infer<typeof projectChangeSchema>;
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sequenceSchema = z.number().int().min(1).max(2147483647);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const clockFields = {
  playing: z.boolean(),
  absoluteTick: z.number().finite().min(0).max(2147483647),
};
const presenceFields = {
  ...clockFields,
  hostConnected: z.boolean(),
  supportsVocal: z.boolean(),
  supportsVocalMusic: z.boolean(),
  supportsCloud: z.boolean(),
  supportsTension: z.boolean(),
  supportsComposition: z.boolean().default(false),
  participants: z.number().int().min(0).max(MAX_SESSION_CLIENTS),
};
const actionSchema = z.enum(["play", "stop", "restart"]);
export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("patch"),
      clientId: clientIdSchema,
      sequence: sequenceSchema,
      changes: z.array(projectChangeSchema).min(1).max(MAX_PROJECT_CHANGES),
    })
    .strict(),
  z.object({ type: z.literal("clock"), ...clockFields }).strict(),
  z.object({ type: z.literal("transport"), action: actionSchema }).strict(),
  z.object({ type: z.literal("sync") }).strict(),
  z.object({ type: z.literal("end") }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export const sessionCreatedSchema = z
  .object({
    roomId: roomIdSchema,
    hostToken: sessionTokenSchema,
    guestToken: sessionTokenSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type SessionCreated = z.infer<typeof sessionCreatedSchema>;
export const sessionProjectSchema = z.unknown().transform((value, context) => {
  const project = readProject(value);
  if (!project) {
    context.addIssue({ code: "custom", message: "Invalid project" });
    return z.NEVER;
  }
  return project;
});
export const createSessionSchema = z
  .object({ project: sessionProjectSchema })
  .strict();
export const serverMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("welcome"),
      project: projectSchema,
      revision: revisionSchema,
      role: z.enum(["host", "guest"]),
      ...presenceFields,
      expiresAt: z.number().int().positive(),
      acknowledgedSequence: z.number().int().min(0).max(2147483647),
    })
    .strict(),
  z
    .object({
      type: z.literal("patch"),
      revision: revisionSchema,
      clientId: clientIdSchema,
      sequence: sequenceSchema,
      changes: z.array(projectChangeSchema).max(MAX_PROJECT_CHANGES),
    })
    .strict(),
  z
    .object({
      type: z.literal("ack"),
      revision: revisionSchema,
      clientId: clientIdSchema,
      sequence: sequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transport"),
      clientId: clientIdSchema,
      action: actionSchema,
    })
    .strict(),
  z.object({ type: z.literal("presence"), ...presenceFields }).strict(),
  z.object({ type: z.literal("clock"), ...clockFields }).strict(),
  z
    .object({ type: z.literal("ended"), reason: z.enum(["ended", "expired"]) })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().min(1).max(64),
      message: z.string().min(1).max(200),
      sequence: sequenceSchema.optional(),
    })
    .strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

function object(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fixed arrays merge per cell; variable-length collections replace atomically. */
export function diffProject(before: Project, after: Project): ProjectChange[] {
  const changes: ProjectChange[] = [];
  function visit(
    previous: JsonValue,
    next: JsonValue,
    path: ProjectChange["path"],
  ): void {
    if (Object.is(previous, next)) return;
    if (
      Array.isArray(previous) &&
      Array.isArray(next) &&
      previous.length === next.length
    ) {
      const primitive = (value: JsonValue): boolean =>
        value === null || typeof value !== "object";
      if (path.length && previous.every(primitive) && next.every(primitive)) {
        const entries: Array<[number, JsonValue]> = [];
        next.forEach((value, index) => {
          if (!Object.is(previous[index], value)) entries.push([index, value]);
        });
        if (entries.length === 1) {
          const entry = entries[0];
          if (entry)
            changes.push({ path: [...path, entry[0]], value: entry[1] });
        } else if (entries.length) changes.push({ path, entries });
      } else
        next.forEach((value, index) => {
          const old = previous[index];
          if (old !== undefined) visit(old, value, [...path, index]);
        });
      return;
    }
    if (object(previous) && object(next)) {
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(previous).length &&
        keys.every((key) => Object.hasOwn(previous, key))
      ) {
        for (const key of keys) {
          const old = previous[key],
            value = next[key];
          if (old !== undefined && value !== undefined)
            visit(old, value, [...path, key]);
        }
        return;
      }
    }
    if (path.length) changes.push({ path, value: next });
  }
  const previous = jsonValueSchema.parse(before),
    next = jsonValueSchema.parse(after);
  visit(previous, next, []);
  if (changes.length > MAX_PROJECT_CHANGES && object(next)) {
    const roots = new Set(changes.map((change) => change.path[0]));
    return Object.entries(next).flatMap(([key, value]) =>
      roots.has(key) ? [{ path: [key], value }] : [],
    );
  }
  return changes;
}

/** Reject unknown paths, insertion/deletion and invalid resulting musical state. */
export function applyProjectChanges(
  current: Project,
  changes: readonly ProjectChange[],
): Project | null {
  const valid = z
    .array(projectChangeSchema)
    .max(MAX_PROJECT_CHANGES)
    .safeParse(changes);
  if (!valid.success) return null;
  const parsed = jsonValueSchema.safeParse(current);
  if (!parsed.success) return null;
  const updated = parsed.data;
  function write(
    target: JsonValue,
    key: string | number | undefined,
    change: ProjectChange,
  ): boolean {
    const existing =
      Array.isArray(target) && typeof key === "number"
        ? target[key]
        : object(target) && typeof key === "string"
          ? target[key]
          : undefined;
    if (existing === undefined) return false;
    if ("entries" in change) {
      if (!Array.isArray(existing)) return false;
      for (const [index, value] of change.entries) {
        if (index >= existing.length) return false;
        existing[index] = value;
      }
    } else if (Array.isArray(target) && typeof key === "number")
      target[key] = change.value;
    else if (object(target) && typeof key === "string")
      target[key] = change.value;
    else return false;
    return true;
  }
  for (const change of valid.data) {
    let target = updated;
    for (let index = 0; index < change.path.length; index++) {
      const key = change.path[index];
      const final = index === change.path.length - 1;
      if (Array.isArray(target)) {
        if (typeof key !== "number" || key >= target.length) return null;
        if (final) {
          if (!write(target, key, change)) return null;
        } else {
          const next = target[key];
          if (next === undefined) return null;
          target = next;
        }
      } else if (object(target)) {
        if (typeof key !== "string" || !Object.hasOwn(target, key)) return null;
        if (final) {
          if (!write(target, key, change)) return null;
        } else {
          const next = target[key];
          if (next === undefined) return null;
          target = next;
        }
      } else return null;
    }
  }
  return readProject(updated);
}

type LegacyTrack<T> = Omit<T, "automationBars" | "followChords" | "recording">;
export type VersionFiveProject = Omit<
  Project,
  | "version"
  | "progression"
  | "drums"
  | "bass"
  | "keys"
  | "arp"
  | "pad"
  | "vocal"
  | "cloud"
  | "tension"
> & {
  version: 5;
  drums: LegacyTrack<Project["drums"][number]>[];
  bass: LegacyTrack<Project["bass"]>;
  keys: LegacyTrack<Project["keys"]>;
  arp: LegacyTrack<Project["arp"]>;
  pad: LegacyTrack<Project["pad"]>;
  vocal: LegacyTrack<Project["vocal"]>;
  cloud: LegacyTrack<Project["cloud"]>;
  tension: LegacyTrack<Project["tension"]>;
};
function legacyTrack<
  T extends {
    timing: Timing;
    automationBars: AutomationBars;
    automation: Record<string, number[] | null>;
    followChords?: boolean;
    recording?: Project["vocal"]["recording"];
  },
>(track: T, targetTiming: Timing = track.timing): LegacyTrack<T> {
  const {
    automationBars: _bars,
    followChords: _follow,
    recording: _recording,
    ...previous
  } = structuredClone(track);
  const automation = { ...previous.automation };
  for (const lane of Object.values(automation)) {
    if (!lane) continue;
    const resized = resizeAutomationLane(
      lane,
      automationTiming(track),
      targetTiming,
      0,
    );
    if (resized) lane.splice(0, lane.length, ...resized);
  }
  return { ...previous, automation };
}
export function versionFiveProject(project: Project): VersionFiveProject {
  const { version: _version, progression: _progression, ...previous } = project;
  return {
    ...previous,
    version: 5,
    drums: project.drums.map((track) => legacyTrack(track)),
    bass: legacyTrack(project.bass),
    keys: legacyTrack(project.keys),
    arp: {
      ...legacyTrack(project.arp),
      muted: project.arp.muted || project.arp.followChords,
    },
    pad: project.pad.followChords
      ? {
          ...legacyTrack(project.pad, project.progression.timing),
          timing: { ...project.progression.timing },
          chords: project.progression.chords.map((chord) => ({ ...chord })),
        }
      : legacyTrack(project.pad),
    vocal: {
      ...legacyTrack(project.vocal),
      ...(project.vocal.recording ? { sound: 0, muted: true } : {}),
      muted:
        project.vocal.muted ||
        Boolean(project.vocal.recording) ||
        project.vocal.followChords,
    },
    cloud: legacyTrack(project.cloud),
    tension: legacyTrack(project.tension),
  };
}
export type VersionFourProject = Omit<
  VersionFiveProject,
  "version" | "cloud" | "tension"
> & { version: 4 };
export type VersionThreeProject = Omit<
  VersionFourProject,
  "version" | "vocal"
> & { version: 3 };
export function versionFourProject(project: Project): VersionFourProject {
  const {
    cloud: _cloud,
    tension: _tension,
    version: _version,
    ...previous
  } = versionFiveProject(project);
  return {
    ...previous,
    version: 4,
    vocal:
      project.vocal.sound >= 24
        ? { ...previous.vocal, sound: 0, muted: true }
        : previous.vocal,
  };
}
export function versionThreeProject(project: Project): VersionThreeProject {
  const {
    vocal: _vocal,
    version: _version,
    ...previous
  } = versionFourProject(project);
  return { ...previous, version: 3 };
}
type LegacyWelcome = Omit<
  Extract<ServerMessage, { type: "welcome" }>,
  | "project"
  | "supportsComposition"
  | "supportsCloud"
  | "supportsTension"
  | "supportsVocalMusic"
  | "supportsVocal"
> & {
  project: VersionFiveProject | VersionFourProject | VersionThreeProject;
  supportsVocal?: boolean;
  supportsVocalMusic?: boolean;
  supportsCloud?: boolean;
  supportsTension?: boolean;
};
type LegacyPresence = Omit<
  Extract<ServerMessage, { type: "presence" }>,
  | "supportsComposition"
  | "supportsCloud"
  | "supportsTension"
  | "supportsVocalMusic"
  | "supportsVocal"
> & {
  supportsVocal?: boolean;
  supportsVocalMusic?: boolean;
  supportsCloud?: boolean;
  supportsTension?: boolean;
};
export type CompatibleServerMessage =
  ServerMessage | LegacyWelcome | LegacyPresence;
const extendedFields = new Set([
  "automationBars",
  "followChords",
  "recording",
  "progression",
]);
function containsExtended(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsExtended);
  return (
    object(value) &&
    Object.entries(value).some(
      ([key, child]) => extendedFields.has(key) || containsExtended(child),
    )
  );
}
export function sessionCanChange(
  protocol: number,
  change: ProjectChange,
): boolean {
  const field = change.path[0];
  if (
    protocol < 6 &&
    (change.path.some(
      (key) => typeof key === "string" && extendedFields.has(key),
    ) ||
      ("value" in change
        ? containsExtended(change.value)
        : change.entries.some(([, value]) => containsExtended(value))))
  )
    return false;
  if (protocol === 4 && field === "vocal" && "value" in change) {
    const sound =
      change.path.length === 2 && change.path[1] === "sound"
        ? change.value
        : change.path.length === 1 && object(change.value)
          ? change.value.sound
          : undefined;
    if (typeof sound === "number" && sound >= 24) return false;
  }
  return (
    field !== "version" &&
    (protocol >= 4 || field !== "vocal") &&
    (protocol >= 5 || (field !== "cloud" && field !== "tension"))
  );
}
function legacyProject(
  project: Project,
  protocol: number,
): VersionFiveProject | VersionFourProject | VersionThreeProject {
  return protocol >= 5
    ? versionFiveProject(project)
    : protocol === 4
      ? versionFourProject(project)
      : versionThreeProject(project);
}
/** Legacy peers receive valid projected tracks and every revision, including empty ones. */
export function sessionMessageForProtocol(
  message: ServerMessage,
  protocol: number,
  project?: Project,
): CompatibleServerMessage {
  if (protocol >= 6) return message;
  if (message.type === "welcome" || message.type === "presence") {
    const {
      supportsComposition: _composition,
      supportsVocalMusic,
      supportsCloud,
      supportsTension,
      supportsVocal,
      ...previous
    } = message;
    const capabilities = {
      ...(protocol >= 4 ? { supportsVocal } : {}),
      ...(protocol >= 5
        ? { supportsVocalMusic, supportsCloud, supportsTension }
        : {}),
    };
    if (previous.type === "welcome")
      return {
        ...previous,
        ...capabilities,
        project: legacyProject(previous.project, protocol),
      };
    return { ...previous, ...capabilities };
  }
  if (message.type !== "patch") return message;
  if (!project)
    return {
      ...message,
      changes: message.changes.filter((change) =>
        sessionCanChange(protocol, change),
      ),
    };
  const projected = jsonValueSchema.parse(legacyProject(project, protocol));
  if (!object(projected)) return { ...message, changes: [] };
  const roots = new Set(message.changes.map((change) => change.path[0]));
  if (roots.has("progression") && project.pad.followChords) roots.add("pad");
  const changes: ProjectChange[] = [];
  for (const root of roots) {
    if (
      typeof root !== "string" ||
      root === "version" ||
      !Object.hasOwn(projected, root)
    )
      continue;
    const value = projected[root];
    if (value !== undefined) changes.push({ path: [root], value });
  }
  return { ...message, changes };
}

/** Old clients may edit known fields without erasing state they cannot represent. */
export function applySessionProjectChanges(
  current: Project,
  changes: readonly ProjectChange[],
  protocol: number,
): Project | null {
  if (changes.some((change) => !sessionCanChange(protocol, change)))
    return null;
  if (protocol >= 6) {
    const next = applyProjectChanges(current, changes);
    return next?.vocal.recording?.kind === "local" ? null : next;
  }
  const canonical = jsonValueSchema.parse(current);
  const projected = jsonValueSchema.parse(legacyProject(current, protocol));
  if (!object(canonical) || !object(projected)) return null;
  const compatible: ProjectChange[] = [];
  const supportedSound = changes.some((change) => {
    if (change.path[0] !== "vocal" || !("value" in change)) return false;
    const direct = change.path.length === 2 && change.path[1] === "sound";
    const sound = direct
      ? change.value
      : change.path.length === 1 && object(change.value)
        ? change.value.sound
        : undefined;
    const previousVocal = projected.vocal;
    // A whole legacy track carries its masked default even when only volume changed.
    const changedSound =
      previousVocal !== undefined &&
      object(previousVocal) &&
      sound !== previousVocal.sound;
    return (
      (direct || changedSound) &&
      typeof sound === "number" &&
      Number.isInteger(sound) &&
      sound >= 0 &&
      sound < (protocol === 4 ? 24 : 48)
    );
  });
  const maskedVocal =
    Boolean(current.vocal.recording) ||
    current.vocal.followChords ||
    (protocol === 4 && current.vocal.sound >= 24);
  function mergeTrack(
    previous: JsonValue,
    incoming: JsonValue,
  ): JsonValue | null {
    if (!object(previous) || !object(incoming)) return null;
    const merged = { ...previous, ...incoming };
    if (
      previous.automationBars !== null &&
      previous.automationBars !== undefined
    ) {
      if (JSON.stringify(previous.timing) !== JSON.stringify(incoming.timing))
        return null;
      merged.automation = previous.automation ?? null;
    }
    return merged;
  }
  const replacements = changes.flatMap((change): ProjectChange[] =>
    change.path.length === 1 &&
    change.path[0] === "drums" &&
    "entries" in change
      ? change.entries.map(([index, value]) => ({
          path: ["drums", index],
          value,
        }))
      : [change],
  );
  for (const change of replacements) {
    const root = change.path[0];
    if (typeof root !== "string") return null;
    const previous = canonical[root];
    if (root === "pad" && current.pad.followChords) {
      if (change.path[1] === "chords" || change.path[1] === "timing") {
        compatible.push({
          ...change,
          path: ["progression", ...change.path.slice(1)],
        });
        continue;
      }
      if (
        change.path[1] === "automation" &&
        (current.pad.automationBars !== null ||
          JSON.stringify(current.pad.timing) !==
            JSON.stringify(current.progression.timing))
      )
        return null;
      if (
        change.path.length === 1 &&
        "value" in change &&
        object(change.value) &&
        previous !== undefined &&
        object(previous)
      ) {
        const incoming = change.value;
        if (incoming.chords !== undefined)
          compatible.push({
            path: ["progression", "chords"],
            value: incoming.chords,
          });
        if (incoming.timing !== undefined)
          compatible.push({
            path: ["progression", "timing"],
            value: incoming.timing,
          });
        const keepAutomation =
          current.pad.automationBars !== null ||
          JSON.stringify(current.pad.timing) !==
            JSON.stringify(incoming.timing);
        compatible.push({
          ...change,
          value: {
            ...previous,
            ...incoming,
            timing: previous.timing ?? null,
            chords: previous.chords ?? null,
            ...(keepAutomation
              ? { automation: previous.automation ?? null }
              : {}),
          },
        });
        continue;
      }
    }
    if (
      root === "arp" &&
      current.arp.followChords &&
      change.path[1] === "muted" &&
      "value" in change &&
      change.value === false
    )
      return null;
    if (
      root === "drums" &&
      change.path.length === 1 &&
      "value" in change &&
      Array.isArray(change.value) &&
      Array.isArray(previous)
    ) {
      const drums: JsonValue[] = [];
      for (let index = 0; index < previous.length; index++) {
        const old = previous[index],
          incoming = change.value[index];
        if (old === undefined || incoming === undefined) return null;
        const merged = mergeTrack(old, incoming);
        if (!merged) return null;
        drums.push(merged);
      }
      compatible.push({ path: [root], value: drums });
      continue;
    }
    const track =
      root === "drums" &&
      typeof change.path[1] === "number" &&
      Array.isArray(previous)
        ? previous[change.path[1]]
        : previous;
    const offset = root === "drums" ? 2 : 1;
    if (track !== undefined && object(track)) {
      if (
        track.automationBars !== null &&
        track.automationBars !== undefined &&
        (change.path[offset] === "automation" ||
          change.path[offset] === "timing")
      )
        return null;
      if (
        change.path.length === offset &&
        "value" in change &&
        Object.hasOwn(track, "automation")
      ) {
        const merged = mergeTrack(track, change.value);
        if (!merged || !object(merged)) return null;
        if (root === "arp" && current.arp.followChords)
          merged.muted = current.arp.muted;
        if (root === "vocal" && maskedVocal && !supportedSound) {
          merged.sound = current.vocal.sound;
          merged.muted = current.vocal.muted;
        }
        compatible.push({ ...change, value: merged });
        continue;
      }
    }
    if (
      root === "vocal" &&
      maskedVocal &&
      !supportedSound &&
      change.path[1] === "muted" &&
      "value" in change &&
      change.value === false
    )
      return null;
    compatible.push(change);
  }
  if (supportedSound)
    compatible.push(
      { path: ["vocal", "recording"], value: null },
      { path: ["vocal", "followChords"], value: false },
    );
  return applyProjectChanges(current, compatible);
}
