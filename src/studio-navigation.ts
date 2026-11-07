export function installStudioNavigation(root: HTMLElement): void {
  const tools = root.querySelector<HTMLElement>("#studio-tools-panel");
  const toolsButton = root.querySelector<HTMLButtonElement>("#studio-tools");
  const view = root.querySelector<HTMLElement>(".visualizer-toolbar");
  const viewButton = root.querySelector<HTMLButtonElement>("#studio-view");
  const transport = root.querySelector<HTMLElement>(".transport");
  if (!tools || !toolsButton || !view || !viewButton || !transport) return;
  const setView = (open: boolean): void => {
    view.hidden = !open;
    viewButton.setAttribute("aria-expanded", String(open));
  };
  setView(matchMedia("(min-width: 651px)").matches);
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
    if (button === toolsButton) {
      tools.hidden = !tools.hidden;
      toolsButton.setAttribute("aria-expanded", String(!tools.hidden));
    } else if (button === viewButton) setView(view.hidden);
    else if (button?.dataset.instrumentJump) {
      const section = document.getElementById(button.dataset.instrumentJump);
      if (!section) return;
      tools.hidden = true;
      toolsButton.setAttribute("aria-expanded", "false");
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
