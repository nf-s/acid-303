import { instrumentIdSchema } from "./model";
import type { InstrumentId, Project } from "./model";

/**
 * Solo is local monitoring state, like Record: it is neither saved nor shared.
 * When any track is soloed, every other track is silenced; saved mutes still apply.
 */
export function soloSilenced(
  soloed: ReadonlySet<InstrumentId>,
  id: InstrumentId,
): boolean {
  return soloed.size > 0 && !soloed.has(id);
}

/** Audio's view of the project. Unsilenced tracks keep their identity. */
export function audibleProject(
  project: Project,
  soloed: ReadonlySet<InstrumentId>,
): Project {
  if (!soloed.size) return project;
  const silence = <Track extends { muted: boolean }>(
    track: Track,
    id: InstrumentId,
  ): Track =>
    !track.muted && soloSilenced(soloed, id)
      ? { ...track, muted: true }
      : track;
  return {
    ...project,
    drums: project.drums.map((track) => silence(track, track.id)),
    bass: silence(project.bass, "bass"),
    keys: silence(project.keys, "keys"),
    arp: silence(project.arp, "arp"),
    pad: silence(project.pad, "pad"),
    vocal: silence(project.vocal, "vocal"),
    cloud: silence(project.cloud, "cloud"),
    tension: silence(project.tension, "tension"),
  };
}

/** Additive toggle; returns the next set without changing the current one. */
export function toggleSolo(
  soloed: ReadonlySet<InstrumentId>,
  value: unknown,
): Set<InstrumentId> {
  const next = new Set(soloed);
  const id = instrumentIdSchema.safeParse(value);
  if (!id.success) return next;
  if (next.has(id.data)) next.delete(id.data);
  else next.add(id.data);
  return next;
}
