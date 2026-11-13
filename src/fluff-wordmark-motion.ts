import type { FluffLevels } from "./visualizer";

interface Letter {
  element: SVGGElement;
  x: number;
  swell: number;
  rock: number;
}

const PIVOT_Y = 60;
const HALO_WIDTH = 4.5;
const HALO_OPACITY = 0.4;
const SETTLE_TIME = 0.32;

/**
 * Moves the FLUFF puffs with the visualizer's eased drum levels: the kick swells each letter
 * in a ripple from left to right, snare and clap rock them, hats lighten their undersides and
 * overall energy sets how far they drift and billow. Reduced motion leaves the title still.
 */
export class FluffWordmarkMotion {
  private svg: SVGSVGElement | null = null;
  private letters: Letter[] = [];
  private halo: SVGUseElement | null = null;
  private billowMap: SVGFEDisplacementMapElement | null = null;
  private belly: SVGRectElement | null = null;
  private billow = 0;
  private shimmer = 0;
  private energy = 0;
  private phase = 0;
  private lastTime = 0;
  private settleId = 0;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly host: Element) {}

  update(levels: FluffLevels | null): void {
    cancelAnimationFrame(this.settleId);
    this.settleId = 0;
    if (!this.bind()) return;
    if (this.reduced.matches) {
      this.rest();
      return;
    }
    if (!levels) {
      this.lastTime = 0;
      this.settleId = requestAnimationFrame(this.settle);
      return;
    }
    this.step(levels);
    this.phase = levels.phase;
    this.apply();
  }

  private readonly settle = (): void => {
    if (!this.bind()) return;
    this.step(null);
    this.apply();
    const moving =
      this.energy > 0.002 ||
      this.shimmer > 0.002 ||
      this.letters.some(
        (letter) => letter.swell > 0.002 || letter.rock > 0.002,
      );
    if (moving) this.settleId = requestAnimationFrame(this.settle);
    else this.rest();
  };

  /** Eases towards the levels, or back to rest when they are null. */
  private step(levels: FluffLevels | null): void {
    const now = performance.now();
    const seconds =
      this.lastTime === 0
        ? 1 / 30
        : Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const ease = (value: number, target: number, time: number): number =>
      value + (target - value) * (1 - Math.exp(-seconds / time));
    const settling = levels === null;
    const swell = levels?.swell ?? 0;
    const billow = levels?.billow ?? 0;
    const shimmer = levels?.shimmer ?? 0;
    const energy = levels?.energy ?? 0;
    this.letters.forEach((letter, index) => {
      letter.swell = ease(
        letter.swell,
        swell,
        settling ? SETTLE_TIME : 0.05 + index * 0.045,
      );
      letter.rock = ease(
        letter.rock,
        billow,
        settling ? SETTLE_TIME : 0.08 + index * 0.03,
      );
    });
    this.billow = ease(this.billow, billow, settling ? SETTLE_TIME : 0.12);
    this.shimmer = ease(this.shimmer, shimmer, settling ? SETTLE_TIME : 0.1);
    this.energy = ease(this.energy, energy, settling ? SETTLE_TIME : 0.3);
  }

  private apply(): void {
    let swellTotal = 0;
    this.letters.forEach((letter, index) => {
      const sway = Math.sin(this.phase * 1.1 + index * 1.3) * this.energy;
      const bob = Math.cos(this.phase * 0.9 + index * 1.9) * this.energy;
      const side = index % 2 === 0 ? 1 : -1;
      const scale = 1 + letter.swell * 0.16 + letter.rock * 0.04;
      const x = letter.x + sway * 4;
      const y = PIVOT_Y - letter.swell * 6 - bob * 3;
      const angle = side * letter.rock * 5 + sway * 2;
      letter.element.setAttribute(
        "transform",
        `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-letter.x} ${-PIVOT_Y})`,
      );
      swellTotal += letter.swell;
    });
    const swell = this.letters.length ? swellTotal / this.letters.length : 0;
    this.halo?.setAttribute(
      "stroke-width",
      (HALO_WIDTH + swell * 9).toFixed(2),
    );
    this.halo?.setAttribute(
      "opacity",
      (HALO_OPACITY + swell * 0.15).toFixed(3),
    );
    this.billowMap?.setAttribute(
      "scale",
      (this.energy * 6 + this.billow * 10).toFixed(2),
    );
    this.belly?.setAttribute("opacity", (1 - this.shimmer * 0.45).toFixed(3));
  }

  private rest(): void {
    for (const letter of this.letters) {
      letter.swell = 0;
      letter.rock = 0;
      letter.element.removeAttribute("transform");
    }
    this.billow = 0;
    this.shimmer = 0;
    this.energy = 0;
    this.lastTime = 0;
    this.halo?.setAttribute("stroke-width", String(HALO_WIDTH));
    this.halo?.setAttribute("opacity", String(HALO_OPACITY));
    this.billowMap?.setAttribute("scale", "0");
    this.belly?.removeAttribute("opacity");
  }

  /** The title is replaced when the mode changes, so the parts are looked up again. */
  private bind(): boolean {
    if (this.svg?.isConnected) return this.letters.length > 0;
    const svg = this.host.querySelector("svg");
    this.svg = svg instanceof SVGSVGElement ? svg : null;
    this.letters = [];
    this.halo = null;
    this.billowMap = null;
    this.belly = null;
    this.lastTime = 0;
    if (!this.svg) return false;
    for (const element of this.svg.querySelectorAll(".fluff-letter")) {
      if (!(element instanceof SVGGElement)) continue;
      let left = Infinity;
      let right = -Infinity;
      for (const circle of element.querySelectorAll("circle")) {
        left = Math.min(left, circle.cx.baseVal.value - circle.r.baseVal.value);
        right = Math.max(
          right,
          circle.cx.baseVal.value + circle.r.baseVal.value,
        );
      }
      if (Number.isFinite(left))
        this.letters.push({
          element,
          x: (left + right) / 2,
          swell: 0,
          rock: 0,
        });
    }
    const halo = this.svg.querySelector(".fluff-letter-halo");
    this.halo = halo instanceof SVGUseElement ? halo : null;
    const billowMap = this.svg.querySelector(".fluff-letter-billow");
    this.billowMap =
      billowMap instanceof SVGFEDisplacementMapElement ? billowMap : null;
    const belly = this.svg.querySelector(".fluff-letter-belly");
    this.belly = belly instanceof SVGRectElement ? belly : null;
    return this.letters.length > 0;
  }
}
