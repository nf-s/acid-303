import { applyProjectChanges, diffProject } from "./session-protocol";
import type { ProjectChange } from "./session-protocol";
import type { Project } from "./model";

export interface PendingEdit {
  sequence: number;
  changes: ProjectChange[];
}

/** Server order is authoritative; unacknowledged local edits remain visible. */
export class SessionSync {
  private confirmed: Project | null = null;
  private pending: PendingEdit[] = [];
  private draft: ProjectChange[] = [];
  private sequence = 0;
  revision = 0;

  welcome(project: Project, revision: number, acknowledged: number): boolean {
    this.confirmed = structuredClone(project);
    this.revision = revision;
    this.sequence = Math.max(this.sequence, acknowledged);
    this.pending = this.pending.filter((edit) => edit.sequence > acknowledged);
    if (this.view()) return true;
    this.discardPending();
    return false;
  }

  view(includeDraft = true): Project | null {
    if (!this.confirmed) return null;
    let project: Project | null = structuredClone(this.confirmed);
    for (const edit of this.pending) {
      if (!project) return null;
      project = applyProjectChanges(project, edit.changes);
    }
    if (project && includeDraft && this.draft.length)
      project = applyProjectChanges(project, this.draft);
    return project;
  }

  edit(project: Project): void {
    const base = this.view(false);
    if (base) this.draft = diffProject(base, project);
  }

  flush(): PendingEdit | null {
    if (!this.draft.length || this.pending.length >= 100) return null;
    const edit = { sequence: ++this.sequence, changes: this.draft };
    this.pending.push(edit);
    this.draft = [];
    return edit;
  }

  unacknowledged(): PendingEdit[] {
    return structuredClone(this.pending);
  }

  patch(
    revision: number,
    changes: ProjectChange[],
    ownSequence?: number,
  ): boolean {
    if (!this.confirmed || revision !== this.revision + 1) return false;
    const next = applyProjectChanges(this.confirmed, changes);
    if (!next) return false;
    this.confirmed = next;
    this.revision = revision;
    if (ownSequence !== undefined) this.acknowledge(ownSequence);
    return true;
  }

  acknowledge(sequence: number): void {
    this.pending = this.pending.filter((edit) => edit.sequence > sequence);
  }

  discardPending(): void {
    this.pending = [];
    this.draft = [];
  }
}
