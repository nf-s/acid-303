import {
  createTiming,
  timingSchema,
  trackPages,
  trackPosition,
} from "./timing";
import type { Timing, TrackPage } from "./timing";
import "./pattern-controls.css";

export interface PatternViewport {
  start: number;
  count: number;
  groupSize?: number;
}
interface PatternOptions {
  label: string;
  onTimingChange: (timing: Timing) => void;
  onViewportChange: (viewport: PatternViewport) => void;
  isBusy: () => boolean;
  allowedBars?: ReadonlyArray<Timing["bars"]>;
}

let nextDialogId = 0;

/** Timing and page navigation stay outside the drawing surface. */
export class PatternControls {
  private timing: Timing = createTiming();
  private pages: TrackPage[] = trackPages(this.timing);
  private page = 0;
  private following = true;
  private initialized = false;
  private tick = -1;
  private swing = 0;
  private playingPage = -1;
  private lastFocused: HTMLElement | null = null;
  private mirrorFrame = 0;
  private readonly mirror: HTMLCanvasElement;
  private readonly mirrorContext: CanvasRenderingContext2D | null;
  private readonly summary: HTMLButtonElement;
  private readonly dialog: HTMLDialogElement;
  private readonly pageLabel: HTMLElement;
  private readonly strip: HTMLDivElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly follow: HTMLButtonElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: PatternOptions,
  ) {
    container.classList.add("pattern-controls");
    this.summary = this.button("", "open", `${options.label} timing`);
    this.summary.className = "pattern-trigger";
    this.summary.setAttribute("aria-haspopup", "dialog");
    this.summary.setAttribute("aria-expanded", "false");
    this.dialog = document.createElement("dialog");
    this.dialog.className = "pattern-dialog";
    this.mirror = document.createElement("canvas");
    this.mirror.className = "pattern-fluid-mirror";
    this.mirror.setAttribute("aria-hidden", "true");
    this.mirrorContext = this.mirror.getContext("2d");
    this.dialog.id = `pattern-dialog-${++nextDialogId}`;
    this.dialog.setAttribute("aria-label", `${options.label} timing and pages`);
    this.summary.setAttribute("aria-controls", this.dialog.id);
    const header = document.createElement("div");
    header.className = "pattern-dialog-header";
    const title = document.createElement("h2");
    title.textContent = `${options.label} timing`;
    const close = this.button("×", "close", `Close ${options.label} timing`);
    header.append(title, close);
    const settings = document.createElement("div");
    settings.className = "pattern-settings";
    const groups: Array<{
      name: string;
      key: string;
      values: ReadonlyArray<string | number>;
    }> = [
      {
        name: "Bars",
        key: "bars",
        values: options.allowedBars ?? [1, 2, 4, 8],
      },
      {
        name: "Meter",
        key: "meter",
        values: ["4/4", "3/4", "5/4", "6/8", "7/8"],
      },
      { name: "Grid", key: "grid", values: ["straight", "triplet"] },
    ];
    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "pattern-setting";
      row.setAttribute("role", "group");
      row.setAttribute(
        "aria-label",
        `${options.label} ${group.name.toLowerCase()}`,
      );
      const label = document.createElement("span");
      label.textContent = group.name;
      row.append(label);
      for (const value of group.values) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.patternSetting = group.key;
        button.dataset.patternValue = String(value);
        button.textContent =
          value === "straight"
            ? "1/16"
            : value === "triplet"
              ? "1/16 triplet"
              : String(value);
        row.append(button);
      }
      settings.append(row);
    }
    const navigation = document.createElement("div");
    navigation.className = "pattern-navigation";
    this.pageLabel = document.createElement("p");
    this.pageLabel.className = "pattern-page-label";
    this.previous = this.button(
      "Prev",
      "previous",
      `${options.label} previous page`,
    );
    this.next = this.button("Next", "next", `${options.label} next page`);
    this.follow = this.button(
      "Follow",
      "follow",
      `${options.label} follow playback`,
    );
    this.strip = document.createElement("div");
    this.strip.className = "pattern-pages";
    this.strip.setAttribute("role", "group");
    this.strip.setAttribute("aria-label", `${options.label} pattern pages`);
    navigation.append(this.pageLabel, this.strip);
    const actions = document.createElement("div");
    actions.className = "pattern-dialog-actions";
    actions.append(
      this.previous,
      this.next,
      this.follow,
      this.button("Done", "done", `Done editing ${options.label} timing`),
    );
    this.dialog.append(header, settings, navigation, actions, this.mirror);
    container.replaceChildren(this.summary, this.dialog);
    container.addEventListener("click", this.click);
    this.dialog.addEventListener("close", this.closed);
    this.dialog.addEventListener("click", this.backdrop);
    this.dialog.addEventListener("keydown", this.trapFocus);
    this.dialog.addEventListener("focusin", this.rememberFocus);
    this.renderPages();
    this.renderState();
  }

  get viewport(): PatternViewport {
    const page = this.pages[this.page] ?? this.pages[0];
    const groupSize =
      this.timing.grid === "triplet"
        ? this.timing.meter.endsWith("/8")
          ? 3
          : 6
        : this.timing.meter.endsWith("/8")
          ? 2
          : 4;
    return page
      ? { start: page.start, count: page.count, groupSize }
      : { start: 0, count: 1 };
  }
  update(timing: Timing): void {
    this.restoreModal();
    const changed =
      !this.initialized ||
      this.timing.bars !== timing.bars ||
      this.timing.meter !== timing.meter ||
      this.timing.grid !== timing.grid;
    if (!changed) return;
    this.initialized = true;
    this.timing = { ...timing };
    this.pages = trackPages(timing);
    this.page = Math.min(this.page, this.pages.length - 1);
    this.playingPage =
      this.tick < 0 ? -1 : trackPosition(timing, this.tick, this.swing).page;
    this.renderPages();
    this.renderState();
    this.options.onViewportChange(this.viewport);
  }
  setTick(absoluteTick: number, swing = 0): void {
    this.tick = Number.isFinite(absoluteTick) ? absoluteTick : -1;
    this.swing = Number.isFinite(swing) ? swing : 0;
    const position =
      this.tick < 0 ? null : trackPosition(this.timing, this.tick, this.swing);
    if (this.options.isBusy()) this.freezeFollow();
    if (position && this.following && !this.dialog.open)
      this.changePage(position.page);
    if (this.playingPage !== (position?.page ?? -1)) {
      this.playingPage = position?.page ?? -1;
      this.renderState();
    }
  }
  freezeFollow(): void {
    if (!this.following) return;
    this.following = false;
    this.renderState();
  }
  destroy(): void {
    this.stopMirror();
    this.dialog.removeEventListener("close", this.closed);
    this.dialog.removeEventListener("click", this.backdrop);
    this.dialog.removeEventListener("keydown", this.trapFocus);
    this.dialog.removeEventListener("focusin", this.rememberFocus);
    if (this.dialog.open) this.dialog.close();
    this.container.removeEventListener("click", this.click);
    this.container.replaceChildren();
  }

  private button(
    text: string,
    action: string,
    label: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.patternAction = action;
    button.setAttribute("aria-label", label);
    return button;
  }
  private changePage(index: number): void {
    const next = Math.max(0, Math.min(this.pages.length - 1, index));
    if (this.page === next) return;
    this.page = next;
    this.renderState();
    this.options.onViewportChange(this.viewport);
    this.scrollCurrentPage();
  }
  private scrollCurrentPage(): void {
    if (!this.dialog.open) return;
    const button = this.strip.children[this.page];
    if (!(button instanceof HTMLElement)) return;
    const top = button.offsetTop;
    if (top < this.strip.scrollTop) this.strip.scrollTop = top;
    else if (
      top + button.offsetHeight >
      this.strip.scrollTop + this.strip.clientHeight
    )
      this.strip.scrollTop =
        top + button.offsetHeight - this.strip.clientHeight;
  }
  private renderPages(): void {
    const active = document.activeElement;
    const focused =
      active instanceof HTMLButtonElement && this.strip.contains(active)
        ? Number(active.dataset.patternPage)
        : null;
    this.strip.replaceChildren();
    this.pages.forEach((page, index) => {
      const split = this.pages.some(
        (candidate) => candidate.bar === page.bar && candidate.pageInBar > 0,
      );
      const button = this.button(
        split ? `${page.bar + 1}.${page.pageInBar + 1}` : String(page.bar + 1),
        "page",
        `${this.options.label} bar ${page.bar + 1}, steps ${page.start + 1} to ${page.start + page.count}`,
      );
      button.dataset.patternPage = String(index);
      this.strip.append(button);
    });
    if (focused !== null && Number.isInteger(focused)) {
      const replacement =
        this.strip.children[Math.min(focused, this.pages.length - 1)];
      if (replacement instanceof HTMLButtonElement)
        replacement.focus({ preventScroll: true });
    }
  }
  private renderState(): void {
    const timing = `${this.timing.bars} ${this.timing.bars === 1 ? "bar" : "bars"} · ${this.timing.meter} · ${this.timing.grid === "triplet" ? "1/16T" : "1/16"}`;
    this.summary.textContent = `${timing} · Page ${this.page + 1}/${this.pages.length}`;
    this.summary.setAttribute("aria-description", this.summary.textContent);
    this.pageLabel.textContent = `Page ${this.page + 1} of ${this.pages.length}`;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page === this.pages.length - 1;
    this.follow.setAttribute("aria-pressed", String(this.following));
    this.strip
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button, index) => {
        button.setAttribute("aria-pressed", String(index === this.page));
        button.dataset.playing = String(index === this.playingPage);
      });
    this.container
      .querySelectorAll<HTMLButtonElement>("[data-pattern-setting]")
      .forEach((button) => {
        const key = button.dataset.patternSetting;
        const selected =
          key === "bars"
            ? this.timing.bars
            : key === "meter"
              ? this.timing.meter
              : this.timing.grid;
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.patternValue === String(selected)),
        );
      });
  }
  private open(): void {
    if (this.dialog.open || this.options.isBusy()) return;
    this.dialog.showModal();
    this.summary.setAttribute("aria-expanded", "true");
    this.scrollCurrentPage();
    this.startMirror();
  }
  private startMirror(): void {
    if (!this.mirrorFrame && this.mirrorContext) this.drawMirror();
  }
  private stopMirror(): void {
    cancelAnimationFrame(this.mirrorFrame);
    this.mirrorFrame = 0;
  }
  private readonly drawMirror = (): void => {
    this.mirrorFrame = 0;
    const context = this.mirrorContext;
    if (!this.dialog.open || !this.dialog.isConnected || !context) return;
    const source = document.getElementById("fluid-canvas");
    const panel = document.getElementById("visualizer-panel");
    if (source instanceof HTMLCanvasElement && panel) {
      const style = getComputedStyle(panel);
      this.mirror.style.opacity = style.opacity;
      this.mirror.style.visibility =
        style.display === "none" ? "hidden" : style.visibility;
      const sourceBounds = source.getBoundingClientRect();
      const bounds = this.dialog.getBoundingClientRect();
      const width = this.dialog.clientWidth,
        height = this.dialog.clientHeight;
      if (
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        source.width > 0 &&
        source.height > 0 &&
        sourceBounds.width > 0 &&
        sourceBounds.height > 0 &&
        width > 0 &&
        height > 0
      ) {
        const scaleX = source.width / sourceBounds.width,
          scaleY = source.height / sourceBounds.height;
        const pixelWidth = Math.max(1, Math.round(width * scaleX)),
          pixelHeight = Math.max(1, Math.round(height * scaleY));
        if (this.mirror.width !== pixelWidth) this.mirror.width = pixelWidth;
        if (this.mirror.height !== pixelHeight)
          this.mirror.height = pixelHeight;
        this.mirror.style.width = `${width}px`;
        this.mirror.style.height = `${height}px`;
        this.mirror.style.left = `${this.dialog.scrollLeft}px`;
        this.mirror.style.top = `${this.dialog.scrollTop}px`;
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        context.drawImage(
          source,
          (bounds.left + this.dialog.clientLeft - sourceBounds.left) * scaleX,
          (bounds.top + this.dialog.clientTop - sourceBounds.top) * scaleY,
          width * scaleX,
          height * scaleY,
          0,
          0,
          pixelWidth,
          pixelHeight,
        );
      }
    } else this.mirror.style.visibility = "hidden";
    this.mirrorFrame = requestAnimationFrame(this.drawMirror);
  };
  private restoreModal(): void {
    if (
      !this.dialog.open ||
      !this.dialog.isConnected ||
      this.dialog.matches(":modal")
    )
      return;
    const focused = this.lastFocused;
    this.dialog.close();
    this.dialog.showModal();
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    this.summary.setAttribute("aria-expanded", "true");
    this.startMirror();
  }
  private readonly rememberFocus = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement) this.lastFocused = event.target;
  };
  private readonly closed = (): void => {
    if (this.dialog.open) return;
    this.stopMirror();
    this.summary.setAttribute("aria-expanded", "false");
    this.summary.focus({ preventScroll: true });
    if (this.following && this.tick >= 0 && !this.options.isBusy())
      this.changePage(trackPosition(this.timing, this.tick, this.swing).page);
  };
  private readonly trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const buttons = this.dialog.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const first = buttons.item(0),
      last = buttons.item(buttons.length - 1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  private readonly backdrop = (event: MouseEvent): void => {
    if (event.target !== this.dialog) return;
    const bounds = this.dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      this.dialog.close();
  };
  private readonly click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (
      !(button instanceof HTMLButtonElement) ||
      !this.container.contains(button)
    )
      return;
    const action = button.dataset.patternAction;
    if (action === "open") {
      this.open();
      return;
    }
    if (action === "close" || action === "done") {
      this.dialog.close();
      return;
    }
    if (action === "follow") {
      if (this.options.isBusy()) return;
      this.following = true;
      this.renderState();
      if (this.tick >= 0)
        this.changePage(trackPosition(this.timing, this.tick, this.swing).page);
      this.dialog.close();
    } else if (
      action === "previous" ||
      action === "next" ||
      action === "page"
    ) {
      this.freezeFollow();
      const index =
        action === "page"
          ? Number(button.dataset.patternPage)
          : this.page + (action === "next" ? 1 : -1);
      if (Number.isInteger(index)) this.changePage(index);
      this.dialog.close();
    }
    const key = button.dataset.patternSetting;
    if (key !== "bars" && key !== "meter" && key !== "grid") return;
    const value =
      key === "bars"
        ? Number(button.dataset.patternValue)
        : button.dataset.patternValue;
    const result = timingSchema.safeParse({ ...this.timing, [key]: value });
    if (
      !result.success ||
      !(this.options.allowedBars ?? [1, 2, 4, 8]).includes(result.data.bars)
    )
      return;
    if (
      result.data.bars === this.timing.bars &&
      result.data.meter === this.timing.meter &&
      result.data.grid === this.timing.grid
    )
      return;
    this.freezeFollow();
    this.options.onTimingChange(result.data);
  };
}
