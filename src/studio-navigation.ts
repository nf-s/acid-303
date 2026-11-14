/** The transport's tool row: each button opens one panel below it, one at a time. */
export const STUDIO_PANELS = ["mixer", "tempo", "scale", "session"] as const;
export type StudioPanel = (typeof STUDIO_PANELS)[number];

function isStudioPanel(value: string | undefined): value is StudioPanel {
  return STUDIO_PANELS.some((panel) => panel === value);
}

export function openStudioPanel(
  root: ParentNode,
  panel: StudioPanel | null,
): void {
  const tools = root.querySelector<HTMLElement>("#studio-tools-panel");
  if (!tools) return;
  root
    .querySelectorAll<HTMLElement>("[data-studio-section]")
    .forEach((section) => {
      section.hidden = section.dataset.studioSection !== panel;
    });
  root
    .querySelectorAll<HTMLButtonElement>("[data-studio-panel]")
    .forEach((button) =>
      button.setAttribute(
        "aria-expanded",
        String(button.dataset.studioPanel === panel),
      ),
    );
  tools.hidden = panel === null;
}

function openedStudioPanel(root: ParentNode): StudioPanel | null {
  const open = root.querySelector<HTMLElement>(
    "[data-studio-section]:not([hidden])",
  )?.dataset.studioSection;
  return isStudioPanel(open) ? open : null;
}

export function installStudioNavigation(root: HTMLElement): void {
  const view = root.querySelector<HTMLElement>(".visualizer-toolbar");
  const viewButton = root.querySelector<HTMLButtonElement>("#studio-view");
  const transport = root.querySelector<HTMLElement>(".transport");
  if (!view || !viewButton || !transport) return;
  const header = root.querySelector<HTMLElement>(".app-header");
  if (header) {
    const slot = document.createElement("div");
    slot.id = "header-visuals";
    slot.append(view);
    header.append(slot);
  }
  view.hidden = false;
  viewButton.removeAttribute("aria-expanded");
  const resize = new ResizeObserver(() => {
    document.documentElement.style.setProperty(
      "--transport-height",
      `${transport.getBoundingClientRect().height}px`,
    );
  });
  resize.observe(transport);
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button");
    const panel = button?.dataset.studioPanel;
    if (isStudioPanel(panel)) {
      openStudioPanel(root, openedStudioPanel(root) === panel ? null : panel);
    } else if (button === viewButton) {
      openStudioPanel(root, null);
      view.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (button?.dataset.instrumentJump) {
      const section = document.getElementById(button.dataset.instrumentJump);
      if (!section) return;
      openStudioPanel(root, null);
      requestAnimationFrame(() =>
        section.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  });
  const jumps = root.querySelectorAll<HTMLButtonElement>(
    "[data-instrument-jump]",
  );
  const sections = Array.from(jumps, (button) =>
    document.getElementById(button.dataset.instrumentJump ?? ""),
  ).filter((element) => element !== null);
  let queued = false;
  const updateActive = (): void => {
    queued = false;
    const top = transport.getBoundingClientRect().bottom + 60;
    let active = sections[0];
    for (const section of sections)
      if (section.getBoundingClientRect().top <= top) active = section;
    for (const button of jumps)
      button.setAttribute(
        "aria-current",
        button.dataset.instrumentJump === active?.id ? "location" : "false",
      );
  };
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(updateActive);
    },
    { passive: true },
  );
  updateActive();
}
