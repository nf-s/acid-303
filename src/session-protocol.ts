import { z } from "zod";
import { projectSchema, readProject } from "./model";
import type { Project } from "./model";
import { MAX_PROJECT_BYTES, MAX_TRACK_STEPS } from "./timing";

export const SESSION_PROTOCOL = "grain-session-v5";
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

export type VersionFourProject = Omit<
  Project,
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
  } = project;
  return {
    ...previous,
    version: 4,
    vocal:
      project.vocal.sound >= 24
        ? { ...project.vocal, sound: 0, muted: true }
        : { ...project.vocal },
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
type VersionFourWelcome = Omit<
  Extract<ServerMessage, { type: "welcome" }>,
  "project" | "supportsCloud" | "supportsTension" | "supportsVocalMusic"
> & { project: VersionFourProject };
type VersionThreeWelcome = Omit<
  VersionFourWelcome,
  "project" | "supportsVocal"
> & { project: VersionThreeProject };
type VersionFourPresence = Omit<
  Extract<ServerMessage, { type: "presence" }>,
  "supportsCloud" | "supportsTension" | "supportsVocalMusic"
>;
type VersionThreePresence = Omit<VersionFourPresence, "supportsVocal">;
export type CompatibleServerMessage =
  | ServerMessage
  | VersionThreeWelcome
  | VersionThreePresence
  | VersionFourWelcome
  | VersionFourPresence;
export function sessionCanChange(
  protocol: number,
  change: ProjectChange,
): boolean {
  const field = change.path[0];
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
/** Every peer receives every revision, including empty patches for hidden instruments. */
export function sessionMessageForProtocol(
  message: ServerMessage,
  protocol: number,
  project?: Project,
): CompatibleServerMessage {
  if (protocol >= 5) return message;
  if (message.type === "welcome") {
    const {
      supportsVocalMusic: _vocalMusic,
      supportsCloud: _cloud,
      supportsTension: _tension,
      project,
      ...previous
    } = message;
    if (protocol === 4)
      return { ...previous, project: versionFourProject(project) };
    const { supportsVocal: _vocal, ...legacy } = previous;
    return { ...legacy, project: versionThreeProject(project) };
  }
  if (message.type === "presence") {
    const {
      supportsVocalMusic: _vocalMusic,
      supportsCloud: _cloud,
      supportsTension: _tension,
      ...previous
    } = message;
    if (protocol === 4) return previous;
    const { supportsVocal: _vocal, ...legacy } = previous;
    return legacy;
  }
  if (
    message.type === "patch" &&
    protocol === 4 &&
    project &&
    message.changes.some((change) => change.path[0] === "vocal")
  )
    return {
      ...message,
      changes: [
        ...message.changes.filter(
          (change) =>
            change.path[0] !== "vocal" && sessionCanChange(protocol, change),
        ),
        { path: ["vocal"], value: versionFourProject(project).vocal },
      ],
    };
  if (message.type === "patch")
    return {
      ...message,
      changes: message.changes.filter((change) =>
        sessionCanChange(protocol, change),
      ),
    };
  return message;
}

/** Older full-track edits must not erase the musical sample that their projection cannot represent. */
export function applySessionProjectChanges(
  current: Project,
  changes: readonly ProjectChange[],
  protocol: number,
): Project | null {
  if (changes.some((change) => !sessionCanChange(protocol, change)))
    return null;
  if (protocol !== 4 || current.vocal.sound < 24)
    return applyProjectChanges(current, changes);
  const selectedSupportedSound = changes.some((change) => {
    if (!("value" in change) || change.path[0] !== "vocal") return false;
    const value =
      change.path.length === 2 && change.path[1] === "sound"
        ? change.value
        : change.path.length === 1 &&
            object(change.value) &&
            !(change.value.sound === 0 && change.value.muted === true)
          ? change.value.sound
          : undefined;
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < 24
    );
  });
  if (
    !selectedSupportedSound &&
    changes.some(
      (change) =>
        change.path[0] === "vocal" &&
        change.path[1] === "muted" &&
        "value" in change &&
        change.value === false,
    )
  )
    return null;
  const compatible = changes.map((change) => {
    if (
      change.path.length === 1 &&
      change.path[0] === "vocal" &&
      "value" in change &&
      object(change.value) &&
      change.value.sound === 0 &&
      change.value.muted === true
    )
      return {
        ...change,
        value: {
          ...change.value,
          sound: current.vocal.sound,
          muted: current.vocal.muted,
        },
      };
    return change;
  });
  return applyProjectChanges(current, compatible);
}
