export interface SessionPanelState {
  phase:
    "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "error";
  role: "host" | "guest" | null;
  participants: number;
  hostConnected: boolean;
  supportsComposition?: boolean;
  inviteLink: string | null;
  message: string;
}

export interface SessionPanelOptions {
  onCreate: () => void;
  onJoin: (link: string) => void;
  onLeave: () => void;
  onEnd: () => void;
  onCopy: () => void;
}

export interface SessionPanel {
  render: (state: SessionPanelState) => void;
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
}

export function createSessionPanel(
  container: HTMLElement,
  options: SessionPanelOptions,
): SessionPanel {
  let state: SessionPanelState = {
    phase: "idle",
    role: null,
    participants: 0,
    hostConnected: false,
    inviteLink: null,
    message: "",
  };
  container.classList.add("session-panel");
  container.setAttribute("role", "region");
  container.setAttribute("aria-labelledby", "session-title");
  container.innerHTML = `
    <div class="session-heading"><h2 id="session-title">Session</h2><div class="session-summary" role="status" aria-live="polite"><span id="session-status" tabindex="-1"></span><span id="session-participants"></span></div></div>
    <p id="session-message" class="session-message" role="status" aria-live="polite" hidden></p>
    <p id="session-host-status" class="session-message" role="status" aria-live="polite" hidden>Host disconnected. Waiting to reconnect.</p>
    <div id="session-start" class="session-start">
      <button id="session-create" type="button" class="session-primary">Create session</button>
      <form id="session-join-form" class="session-link-row">
        <label for="session-join-link">Invite link</label>
        <input id="session-join-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        <button id="session-join" type="submit">Join</button>
      </form>
      <p class="session-help">Audio plays on the host. Anyone with the invite can edit.</p>
    </div>
    <div id="session-active" class="session-active" hidden>
      <p id="session-audio" class="session-help">Audio plays on the host.</p>
      <p id="session-composition-status" class="session-help" hidden>The host is using an older version. Custom recordings, chord followers and independent automation need the current version on the host.</p>
      <div id="session-invite" class="session-link-row" hidden>
        <label for="session-invite-link">Invite link</label>
        <input id="session-invite-link" type="text" readonly autocomplete="off" spellcheck="false">
        <button id="session-copy" type="button">Copy invite</button>
      </div>
      <div class="session-actions">
        <button id="session-retry" type="button" hidden>Retry</button>
        <button id="session-leave" type="button" hidden>Leave</button>
        <button id="session-end" type="button" hidden>End session</button>
      </div>
    </div>`;

  const status = container.querySelector<HTMLElement>("#session-status"),
    participants = container.querySelector<HTMLElement>(
      "#session-participants",
    ),
    message = container.querySelector<HTMLElement>("#session-message"),
    hostStatus = container.querySelector<HTMLElement>("#session-host-status"),
    start = container.querySelector<HTMLElement>("#session-start"),
    create = container.querySelector<HTMLButtonElement>("#session-create"),
    joinForm = container.querySelector<HTMLFormElement>("#session-join-form"),
    joinLink = container.querySelector<HTMLInputElement>("#session-join-link"),
    join = container.querySelector<HTMLButtonElement>("#session-join"),
    active = container.querySelector<HTMLElement>("#session-active"),
    audio = container.querySelector<HTMLElement>("#session-audio"),
    compositionStatus = container.querySelector<HTMLElement>(
      "#session-composition-status",
    ),
    invite = container.querySelector<HTMLElement>("#session-invite"),
    inviteLink = container.querySelector<HTMLInputElement>(
      "#session-invite-link",
    ),
    copy = container.querySelector<HTMLButtonElement>("#session-copy"),
    retry = container.querySelector<HTMLButtonElement>("#session-retry"),
    leave = container.querySelector<HTMLButtonElement>("#session-leave"),
    end = container.querySelector<HTMLButtonElement>("#session-end");
  if (
    !status ||
    !participants ||
    !message ||
    !hostStatus ||
    !start ||
    !create ||
    !joinForm ||
    !joinLink ||
    !join ||
    !active ||
    !audio ||
    !compositionStatus ||
    !invite ||
    !inviteLink ||
    !copy ||
    !retry ||
    !leave ||
    !end
  )
    throw new Error("Session panel controls are missing.");

  const busy = (): boolean =>
    state.phase === "connecting" || state.phase === "reconnecting";
  const retryLink = (): string => state.inviteLink ?? joinLink.value.trim();

  const render = (next: SessionPanelState): void => {
    const focused = document.activeElement;
    state = next;
    const inSession = state.role !== null && state.phase !== "idle";
    const ended = state.phase === "ended";
    const showActive = inSession || busy();
    container.dataset.phase = state.phase;
    container.dataset.role = state.role ?? "none";
    status.textContent =
      state.phase === "connected"
        ? state.role === "host"
          ? "Hosting"
          : "Connected"
        : state.phase === "connecting"
          ? "Connecting"
          : state.phase === "reconnecting"
            ? "Reconnecting"
            : ended
              ? "Session ended"
              : state.phase === "error"
                ? "Connection error"
                : "";
    status.hidden = state.phase === "idle";
    participants.hidden = !showActive || state.participants < 1;
    participants.textContent = `${state.participants} ${state.participants === 1 ? "participant" : "participants"}`;
    message.textContent = state.message;
    message.hidden = !state.message;
    hostStatus.hidden =
      state.role !== "guest" ||
      state.hostConnected ||
      !showActive ||
      ended ||
      state.phase === "connecting";
    start.hidden = showActive;
    create.disabled = busy();
    join.disabled = busy() || !joinLink.value.trim();
    active.hidden = !showActive;
    audio.hidden = !inSession;
    compositionStatus.hidden =
      state.role !== "guest" ||
      !state.hostConnected ||
      state.supportsComposition !== false;
    invite.hidden = ended || state.role !== "host" || !state.inviteLink;
    if (inviteLink.value !== (state.inviteLink ?? ""))
      inviteLink.value = state.inviteLink ?? "";
    copy.disabled = !state.inviteLink;
    retry.hidden = state.phase !== "error" || state.role === null;
    retry.disabled = state.role === "guest" && !retryLink();
    leave.hidden = !showActive || (state.role === "host" && !ended);
    leave.textContent = state.role === null ? "Cancel" : "Leave";
    end.hidden = !showActive || state.role !== "host" || ended;
    if (
      !container.hidden &&
      focused instanceof HTMLElement &&
      container.contains(focused) &&
      focused.closest("[hidden]")
    )
      (status.hidden ? create : status).focus({ preventScroll: true });
  };

  create.addEventListener("click", () => {
    if (!busy()) options.onCreate();
  });
  joinLink.addEventListener("input", () => {
    join.disabled = busy() || !joinLink.value.trim();
  });
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const link = joinLink.value.trim();
    if (!busy() && link) options.onJoin(link);
  });
  copy.addEventListener("click", () => {
    if (state.inviteLink) options.onCopy();
  });
  retry.addEventListener("click", () => {
    if (state.phase !== "error") return;
    if (state.role === "host") options.onCreate();
    else if (state.role === "guest" && retryLink()) options.onJoin(retryLink());
  });
  leave.addEventListener("click", options.onLeave);
  end.addEventListener("click", options.onEnd);

  render(state);
  container.hidden = true;
  return {
    render,
    setOpen(open: boolean): void {
      container.hidden = !open;
    },
    isOpen(): boolean {
      return !container.hidden;
    },
  };
}
