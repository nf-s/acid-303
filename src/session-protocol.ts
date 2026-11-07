import { z } from "zod";
import { projectSchema, readProject } from "./model";
import type { Project } from "./model";

export const SESSION_PROTOCOL = "grain-session-v1";
export const MAX_SESSION_BYTES = 131072;
export const MAX_PROJECT_CHANGES = 2048;
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
    z.array(child).max(64),
    z
      .record(keySchema, child)
      .refine((value) => Object.keys(value).length <= 64),
  ]);
}
const jsonValueSchema = jsonSchema(8);
export const projectChangeSchema = z
  .object({
    path: z
      .array(z.union([keySchema, z.number().int().min(0).max(63)]))
      .min(1)
      .max(8),
    value: jsonValueSchema,
  })
  .strict();
export type ProjectChange = z.infer<typeof projectChangeSchema>;
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sequenceSchema = z.number().int().min(1).max(2147483647);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const clockFields = {
  playing: z.boolean(),
  absoluteStep: z.number().int().min(0).max(2147483647),
};
const presenceFields = {
  ...clockFields,
  hostConnected: z.boolean(),
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
export const createSessionSchema = z
  .object({ project: projectSchema })
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
  visit(jsonValueSchema.parse(before), jsonValueSchema.parse(after), []);
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
  for (const change of valid.data) {
    let target = updated;
    for (let index = 0; index < change.path.length; index++) {
      const key = change.path[index];
      const final = index === change.path.length - 1;
      if (Array.isArray(target)) {
        if (typeof key !== "number" || key >= target.length) return null;
        if (final) target[key] = change.value;
        else {
          const next = target[key];
          if (next === undefined) return null;
          target = next;
        }
      } else if (object(target)) {
        if (typeof key !== "string" || !Object.hasOwn(target, key)) return null;
        if (final) target[key] = change.value;
        else {
          const next = target[key];
          if (next === undefined) return null;
          target = next;
        }
      } else return null;
    }
  }
  return readProject(updated);
}
