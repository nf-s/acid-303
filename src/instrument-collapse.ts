import { z } from "zod";

const panelId = z.enum([
  "drums-panel",
  "bass-panel",
  "keys-panel",
  "arp-panel",
  "pad-panel",
  "vocal-panel",
]);
const savedSchema = z.array(panelId).max(6);
const storageKey = "grain-collapsed-instruments-v1";

export function installInstrumentCollapse(
  root: HTMLElement,
  isBusy: () => boolean,
): void {
  const collapsed = new Set<string>();
  try {
    const saved = savedSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? "[]"),
    );
    if (saved.success) for (const id of saved.data) collapsed.add(id);
  } catch {
    // A fresh layout remains usable when storage is unavailable.
  }
  const sections = new Map<
    string,
    {
      panel: HTMLElement;
      header: HTMLElement;
      content: HTMLElement;
      button: HTMLButtonElement;
      label: string;
    }
  >();
  const apply = (id: string, close: boolean): void => {
    const section = sections.get(id);
    if (!section) return;
    if (close) collapsed.add(id);
    else collapsed.delete(id);
    section.content.hidden = close;
    section.panel.classList.toggle("instrument-collapsed", close);
    section.button.textContent = close ? "+" : "−";
    section.button.setAttribute("aria-expanded", String(!close));
    section.button.setAttribute(
      "aria-label",
      `${close ? "Expand" : "Collapse"} ${section.label}`,
    );
  };
  for (const id of panelId.options) {
    const panel = root.querySelector<HTMLElement>(`#${id}`);
    const header = panel?.querySelector<HTMLElement>(".section-header");
    const heading = header?.querySelector("h1, h2");
    if (!panel || !header || !heading) continue;
    const content = document.createElement("div");
    content.id = `${id}-content`;
    content.className = "instrument-content";
    for (const node of Array.from(panel.childNodes))
      if (node !== header) content.append(node);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "instrument-collapse-toggle";
    button.dataset.instrumentCollapse = id;
    button.setAttribute("aria-controls", content.id);
    header.append(button);
    panel.append(content);
    sections.set(id, {
      panel,
      header,
      content,
      button,
      label: heading.textContent?.trim() ?? "instrument",
    });
    apply(id, collapsed.has(id));
  }
  const remember = (): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...collapsed]));
    } catch {
      /* The layout still applies for this visit. */
    }
  };
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const jump = event.target.closest<HTMLElement>("[data-instrument-jump]")
      ?.dataset.instrumentJump;
    if (jump && sections.has(jump)) {
      apply(jump, false);
      remember();
      return;
    }
    const header = event.target.closest(".section-header");
    const section = [...sections.values()].find(
      (item) => item.header === header,
    );
    if (!section || isBusy()) return;
    const interactive = event.target.closest(
      "button, a, input, select, textarea",
    );
    if (interactive && interactive !== section.button) return;
    apply(section.panel.id, !collapsed.has(section.panel.id));
    section.button.focus({ preventScroll: true });
    remember();
  });
}
