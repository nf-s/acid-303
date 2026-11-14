import type { SessionPanelState } from "./session-panel";

export interface SessionOverlayOptions {
  onRetry: () => void;
  onLeave: () => void;
  /** Content behind the overlay; it is made inert while the overlay is shown. */
  background: () => Iterable<HTMLElement>;
}

export interface SessionOverlay {
  render: (state: SessionPanelState) => void;
}

interface OverlayView {
  title: string;
  message: string;
  busy: boolean;
  retry: boolean;
  leave: string;
}

/** What a session that cannot be edited right now shows, or null when editing is open. */
export function sessionOverlayView(
  state: SessionPanelState,
): OverlayView | null {
  const joining = state.role === "guest";
  if (state.phase === "connecting")
    return {
      title: joining ? "Joining session" : "Starting session",
      message: state.message || "Connecting…",
      busy: true,
      retry: false,
      leave: joining ? "Leave session" : "Cancel",
    };
  if (state.role === null) return null;
  if (state.phase === "reconnecting")
    return {
      title: "Reconnecting to session",
      message: state.message || "Reconnecting…",
      busy: true,
      retry: false,
      leave: "Leave session",
    };
  if (state.phase === "error")
    return {
      title: "Can't connect to session",
      message: state.message || "The connection failed.",
      busy: false,
      retry: true,
      leave: "Leave session",
    };
  if (state.phase === "ended")
    return {
      title: "Session ended",
      message: `${state.message || "This session has ended."} The track stays in this browser.`,
      busy: false,
      retry: false,
      leave: "Continue solo",
    };
  if (state.phase === "connected" && joining && !state.hostConnected)
    return {
      title: "Waiting for the host",
      message: "Editing resumes when the host reconnects.",
      busy: true,
      retry: false,
      leave: "Leave session",
    };
  return null;
}

export function createSessionOverlay(
  container: HTMLElement,
  options: SessionOverlayOptions,
): SessionOverlay {
  container.classList.add("session-overlay");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-modal", "true");
  container.setAttribute("aria-labelledby", "session-overlay-title");
  container.setAttribute("aria-describedby", "session-overlay-message");
  container.innerHTML = `
    <div class="session-overlay-card">
      <span class="session-overlay-spinner" aria-hidden="true"></span>
      <h2 id="session-overlay-title" tabindex="-1"></h2>
      <p id="session-overlay-message" role="status" aria-live="polite"></p>
      <div class="session-overlay-actions">
        <button id="session-overlay-retry" type="button" class="session-overlay-primary">Retry</button>
        <button id="session-overlay-leave" type="button"></button>
      </div>
    </div>`;
  const title = container.querySelector<HTMLElement>("#session-overlay-title"),
    message = container.querySelector<HTMLElement>("#session-overlay-message"),
    spinner = container.querySelector<HTMLElement>(".session-overlay-spinner"),
    retry = container.querySelector<HTMLButtonElement>(
      "#session-overlay-retry",
    ),
    leave = container.querySelector<HTMLButtonElement>(
      "#session-overlay-leave",
    );
  if (!title || !message || !spinner || !retry || !leave)
    throw new Error("Session overlay controls are missing.");
  retry.addEventListener("click", options.onRetry);
  leave.addEventListener("click", options.onLeave);
  container.hidden = true;

  let shownTitle = "";
  return {
    render(state: SessionPanelState): void {
      const view = sessionOverlayView(state);
      const wasHidden = container.hidden;
      container.hidden = view === null;
      for (const element of options.background()) element.inert = view !== null;
      if (!view) {
        shownTitle = "";
        return;
      }
      container.dataset.busy = String(view.busy);
      title.textContent = view.title;
      message.textContent = view.message;
      spinner.hidden = !view.busy;
      retry.hidden = !view.retry;
      leave.textContent = view.leave;
      leave.classList.toggle("session-overlay-primary", !view.retry);
      if (wasHidden || shownTitle !== view.title)
        (view.retry ? retry : leave).focus({ preventScroll: true });
      shownTitle = view.title;
    },
  };
}
