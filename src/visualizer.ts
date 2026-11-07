import { STEP_COUNT } from "./model";
import type { DrumId, DrumTrack } from "./model";

const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;

interface Point {
  x: number;
  y: number;
}

interface DrumPulse {
  value: number;
  target: number;
  attack: number;
  decay: number;
}

interface SpectralSheet {
  offset: number;
  width: number;
  phase: number;
  opacity: number;
  colours: [string, string, string, string, string];
}

const SHEETS: SpectralSheet[] = [
  {
    offset: -0.13,
    width: 0.2,
    phase: 2.4,
    opacity: 0.78,
    colours: ["#242424", "#747474", "#ababab", "#515151", "#8e8e8e"],
  },
  {
    offset: 0.08,
    width: 0.23,
    phase: 0.3,
    opacity: 0.96,
    colours: ["#454545", "#d7d7d7", "#f2f2f2", "#929292", "#c5c5c5"],
  },
];

/** Drum steps drive distinct geometric impulses; the interface owns opacity. */
export class FluidVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly field = document.createElement("canvas");
  private readonly fieldContext = this.field.getContext("2d", { alpha: false });
  private ratio = 1;
  private readonly resizeObserver: ResizeObserver;
  private readonly pulses: Record<DrumId, DrumPulse> = {
    kick: { value: 0, target: 0, attack: 0.075, decay: 0.36 },
    snare: { value: 0, target: 0, attack: 0.065, decay: 0.24 },
    hat: { value: 0, target: 0, attack: 0.04, decay: 0.12 },
    clap: { value: 0, target: 0, attack: 0.075, decay: 0.3 },
    rim: { value: 0, target: 0, attack: 0.065, decay: 0.25 },
  };
  private width = 1;
  private height = 1;
  private motionEnabled = true;
  private playing = false;
  private destroyed = false;
  private animationId = 0;
  private lastFrame = 0;
  private phase = 1.2;
  private rimDirection = 1;
  private rimTurn = 0;

  private get portrait(): boolean {
    return this.height > this.width * 1.15;
  }

  private get sceneWidth(): number {
    return this.portrait ? this.height : this.width;
  }

  private get sceneHeight(): number {
    return this.portrait ? this.width : this.height;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", this.syncAnimation);
    this.resize();
  }

  triggerStep(drums: ReadonlyArray<DrumTrack>, step: number): void {
    if (
      this.destroyed ||
      !this.playing ||
      !this.motionEnabled ||
      document.hidden ||
      !Number.isInteger(step) ||
      step < 0 ||
      step >= STEP_COUNT
    )
      return;
    for (const drum of drums) {
      if (drum.muted || !drum.steps[step]) continue;
      this.pulses[drum.id].target = 1;
      if (drum.id === "rim") this.rimDirection *= -1;
    }
  }

  setMotion(enabled: boolean): void {
    this.motionEnabled = enabled;
    this.syncAnimation();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.syncAnimation();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.syncAnimation);
  }

  private readonly resize = (): void => {
    if (this.destroyed) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.field.width = this.canvas.width;
    this.field.height = this.canvas.height;
    this.context?.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.fieldContext?.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.draw();
  };

  private readonly syncAnimation = (): void => {
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
    this.lastFrame = 0;
    if (
      this.destroyed ||
      !this.context ||
      !this.playing ||
      !this.motionEnabled ||
      document.hidden
    ) {
      for (const pulse of Object.values(this.pulses)) pulse.target = 0;
      return;
    }
    this.animationId = requestAnimationFrame(this.animate);
  };

  private readonly animate = (now: number): void => {
    if (this.destroyed) return;
    this.animationId = requestAnimationFrame(this.animate);
    const elapsed =
      this.lastFrame === 0 ? FRAME_INTERVAL : now - this.lastFrame;
    if (elapsed < FRAME_INTERVAL - 1) return;
    const seconds = Math.min(elapsed / 1000, 0.08);
    this.lastFrame = now;
    this.advancePulses(seconds);
    this.phase +=
      seconds *
      (1.6 + this.pulses.kick.value * 0.9 + this.pulses.snare.value * 0.5);
    this.draw();
  };

  private advancePulses(seconds: number): void {
    for (const pulse of Object.values(this.pulses)) {
      const response =
        pulse.target > pulse.value ? pulse.attack : pulse.decay * 0.7;
      pulse.value +=
        (pulse.target - pulse.value) * (1 - Math.exp(-seconds / response));
      pulse.target *= Math.exp(-seconds / pulse.decay);
    }
    this.rimTurn +=
      (this.rimDirection - this.rimTurn) * (1 - Math.exp(-seconds / 0.16));
  }

  private point(position: number, strand: number, sheet: SpectralSheet): Point {
    const angle = position * TAU;
    const kick = this.pulses.kick.value;
    const snare = this.pulses.snare.value;
    const clap = this.pulses.clap.value;
    const hat = this.pulses.hat.value;
    const rim = this.pulses.rim.value * this.rimTurn;
    const energy = 0.3 + kick * 0.95;
    const ripple = snare * 0.8 + clap * 0.6;
    const twist = Math.sin(
      angle * 1.37 -
        this.phase * 0.58 +
        sheet.phase +
        ripple * 1.2 +
        rim * 0.45,
    );
    const width =
      sheet.width *
      (0.62 + 0.38 * Math.cos(angle + sheet.phase)) *
      (1 + energy * 0.5);
    const wave =
      Math.sin(angle * 0.86 + this.phase * 0.46 + sheet.phase) *
        (0.19 + energy * 0.18) +
      Math.sin(angle * 1.72 - this.phase * 0.31 + sheet.phase) *
        (0.11 + ripple * 0.08) +
      Math.sin(angle * 0.6 + sheet.phase) * energy * 0.11 +
      Math.sin(angle * 2.8 - this.phase * 1.4) * snare * 0.08 +
      Math.sin(angle * 7 + this.phase * 3) * hat * 0.012;
    const fold = Math.sin(strand * Math.PI + twist * 1.5) * width * 0.4;
    const x =
      this.sceneWidth *
      (position +
        Math.sin(strand * 1.8 + twist * 1.6) * (0.05 + ripple * 0.025) +
        Math.sin(angle * 0.8 + sheet.phase) * rim * 0.075);
    const y =
      this.sceneHeight *
      (0.5 + sheet.offset + wave + strand * width * twist + fold);
    const centreX =
      this.sceneWidth *
      (0.57 +
        Math.sin(this.phase * 0.17) * 0.08 +
        Math.sin(this.phase * 0.55) * energy * 0.07);
    const centreY =
      this.sceneHeight * (0.51 + Math.cos(this.phase * 0.46) * energy * 0.09);
    const radius = Math.min(this.sceneWidth * 0.31, this.sceneHeight * 1.6);
    const dx = x - centreX;
    const dy = y - centreY;
    const distance = (dx * dx + dy * dy) / (radius * radius);
    const rotation =
      Math.exp(-distance * 1.4) *
      (1.2 +
        1.1 +
        energy * 1.35 +
        ripple * 0.8 +
        Math.sin(this.phase * 0.27) * 0.55);
    const warpedX = centreX + dx * Math.cos(rotation) - dy * Math.sin(rotation);
    const warpedY = centreY + dx * Math.sin(rotation) + dy * Math.cos(rotation);
    const counterX = this.sceneWidth * 0.22;
    const counterY =
      this.sceneHeight * (0.5 + Math.sin(this.phase * 0.43) * 0.11);
    const offsetX = warpedX - counterX;
    const offsetY = warpedY - counterY;
    const counterRadius = Math.min(
      this.sceneWidth * 0.36,
      this.sceneHeight * 1.2,
    );
    const influence = Math.exp(
      -(offsetX * offsetX + offsetY * offsetY) /
        (counterRadius * counterRadius),
    );
    const counterRotation =
      -influence *
      Math.sin(this.phase * 0.52 + sheet.phase * 0.45) *
      (0.3 + ripple * 0.5 + energy * 0.55);
    return {
      x:
        counterX +
        offsetX * Math.cos(counterRotation) -
        offsetY * Math.sin(counterRotation),
      y:
        counterY +
        offsetX * Math.sin(counterRotation) +
        offsetY * Math.cos(counterRotation),
    };
  }

  private sheetPath(
    context: CanvasRenderingContext2D,
    sheet: SpectralSheet,
    strand: number,
    reverse = false,
  ): void {
    const segments = this.sceneWidth < 600 ? 24 : 40;
    for (let step = 0; step <= segments; step += 1) {
      const index = reverse ? segments - step : step;
      const point = this.point(-0.15 + (index / segments) * 1.3, strand, sheet);
      if (step === 0 && !reverse) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
  }

  private drawSheet(
    context: CanvasRenderingContext2D,
    sheet: SpectralSheet,
  ): void {
    const gradient = context.createLinearGradient(
      0,
      this.sceneHeight * 0.18,
      this.sceneWidth,
      this.sceneHeight * 0.85,
    );
    sheet.colours.forEach((colour, index) =>
      gradient.addColorStop(index / 4, colour),
    );
    context.globalAlpha = sheet.opacity;
    context.fillStyle = gradient;
    context.beginPath();
    this.sheetPath(context, sheet, -1);
    this.sheetPath(context, sheet, 1, true);
    context.closePath();
    context.fill();

    context.globalAlpha = 0.22;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.beginPath();
    this.sheetPath(context, sheet, -0.2);
    context.stroke();

    for (const edge of [-1, 1]) {
      context.globalAlpha = 0.9;
      context.strokeStyle = "#000000";
      context.lineWidth = 5;
      context.beginPath();
      this.sheetPath(context, sheet, edge);
      context.stroke();
      context.strokeStyle = edge < 0 ? "#eeeeee" : "#aaaaaa";
      context.lineWidth = edge < 0 ? 1.8 : 1.3;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  private drawPulseRing(
    context: CanvasRenderingContext2D,
    centre: number,
    offset: number,
    push: number,
  ): void {
    const centreX = this.sceneWidth * centre;
    const centreY =
      this.sceneHeight * (0.5 + Math.sin(this.phase * 0.18 + offset) * 0.07);
    const radiusX =
      Math.min(this.sceneWidth * 0.24, this.sceneHeight * 0.72) *
      (0.7 + push * 0.85);
    const radiusY =
      Math.min(this.sceneHeight * 0.59, this.sceneWidth * 0.25) *
      (0.7 + push * 0.85);
    const vertices = 16;
    context.beginPath();
    for (let vertex = 0; vertex <= vertices; vertex += 1) {
      const angle = (vertex / vertices) * TAU + this.phase * 0.08 + offset;
      const radius = 1 + Math.sin(angle * 3 + offset) * 0.035;
      const x = centreX + Math.cos(angle) * radiusX * radius;
      const y = centreY + Math.sin(angle) * radiusY * radius;
      if (vertex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.globalAlpha = 0.68;
    context.strokeStyle = "#bdbdbd";
    context.lineWidth = 2.5;
    context.stroke();
    context.globalAlpha = 1;
  }

  private draw(): void {
    const context = this.fieldContext;
    const output = this.context;
    if (!context || !output || this.destroyed) return;
    context.fillStyle = "#000000";
    context.fillRect(0, 0, this.width, this.height);
    context.save();
    if (this.portrait) {
      context.translate(this.width, 0);
      context.rotate(Math.PI / 2);
    }
    const punch = this.pulses.kick.value;
    context.translate(
      this.sceneWidth * (0.5 + Math.sin(this.phase * 0.8) * punch * 0.035),
      this.sceneHeight * (0.5 + Math.cos(this.phase * 0.67) * punch * 0.04),
    );
    context.rotate(
      Math.sin(this.phase * 0.24) * 0.045 +
        this.pulses.rim.value * this.rimTurn * 0.06,
    );
    context.scale(1 + punch * 0.22, 1 + punch * 0.22);
    context.translate(-this.sceneWidth * 0.5, -this.sceneHeight * 0.5);
    this.drawPulseRing(context, 0.22, 0.5, this.pulses.kick.value);
    this.drawPulseRing(
      context,
      0.78,
      3.5,
      Math.max(this.pulses.snare.value, this.pulses.clap.value),
    );
    for (const sheet of SHEETS) this.drawSheet(context, sheet);
    context.restore();

    output.drawImage(this.field, 0, 0, this.width, this.height);
    const clapShift = this.pulses.clap.value * Math.min(this.width * 0.055, 60);
    if (clapShift > 0.5 && this.width > clapShift * 2) {
      const y = this.height * 0.56;
      const bandHeight = this.height * 0.1;
      output.drawImage(
        this.field,
        clapShift * this.ratio,
        y * this.ratio,
        (this.width - clapShift * 2) * this.ratio,
        bandHeight * this.ratio,
        clapShift * (1 + Math.sin(this.phase)),
        y,
        this.width - clapShift * 2,
        bandHeight,
      );
    }
    const shade = output.createLinearGradient(0, 0, 0, this.height);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.65)");
    shade.addColorStop(0.22, "rgba(0, 0, 0, 0.02)");
    shade.addColorStop(0.74, "rgba(0, 0, 0, 0.01)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.7)");
    output.fillStyle = shade;
    output.fillRect(0, 0, this.width, this.height);
  }
}
