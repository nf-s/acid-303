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
  private readonly summary: HTMLElement;
  private readonly strip: HTMLDivElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly follow: HTMLButtonElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: PatternOptions,
  ) {
    container.classList.add("pattern-controls");
    const details = document.createElement("details");
    details.className = "pattern-timing";
    this.summary = document.createElement("summary");
    this.summary.setAttribute("aria-label", `${options.label} timing`);
    details.append(this.summary);
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
    details.append(settings);
    const navigation = document.createElement("div");
    navigation.className = "pattern-navigation";
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
    navigation.append(this.previous, this.strip, this.next, this.follow);
    container.replaceChildren(details, navigation);
    container.addEventListener("click", this.click);
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
    if (position && this.following) this.changePage(position.page);
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
    const button = this.strip.children[next];
    if (button instanceof HTMLElement) {
      const left = button.offsetLeft;
      if (left < this.strip.scrollLeft) this.strip.scrollLeft = left;
      else if (
        left + button.offsetWidth >
        this.strip.scrollLeft + this.strip.clientWidth
      )
        this.strip.scrollLeft =
          left + button.offsetWidth - this.strip.clientWidth;
    }
  }
  private renderPages(): void {
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
  }
  private renderState(): void {
    this.summary.textContent = `${this.timing.bars} ${this.timing.bars === 1 ? "bar" : "bars"} · ${this.timing.meter} · ${this.timing.grid === "triplet" ? "1/16 triplet" : "1/16"}`;
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
  private readonly click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (
      !(button instanceof HTMLButtonElement) ||
      !this.container.contains(button)
    )
      return;
    const action = button.dataset.patternAction;
    if (action === "follow") {
      if (this.options.isBusy()) return;
      this.following = true;
      this.renderState();
      if (this.tick >= 0)
        this.changePage(trackPosition(this.timing, this.tick, this.swing).page);
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
