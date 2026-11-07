const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;

interface Point {
  x: number;
  y: number;
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

/** Two defined fluid forms follow bass; expanding outlines follow drum transients. */
export class FluidVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly field = document.createElement("canvas");
  private readonly fieldContext = this.field.getContext("2d", { alpha: false });
  private ratio = 1;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private analyser: AnalyserNode | null = null;
  private frequencies = new Uint8Array(0);
  private waveform = new Float32Array(0);
  private width = 1;
  private height = 1;
  private intensity = 0.6;
  private motionEnabled = true;
  private playing = false;
  private destroyed = false;
  private animationId = 0;
  private lastFrame = 0;
  private phase = 1.2;
  private bass = 0;
  private mid = 0;
  private lowAverage = 0;
  private impact = 0;
  private levelAverage = 0;
  private onsetPeak = 0;

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
    this.reducedMotion.addEventListener("change", this.syncAnimation);
    document.addEventListener("visibilitychange", this.syncAnimation);
    this.resize();
  }

  setAnalyser(analyser: AnalyserNode | null): void {
    this.analyser = analyser;
    this.frequencies = new Uint8Array(analyser?.frequencyBinCount ?? 0);
    this.waveform = new Float32Array(analyser?.fftSize ?? 0);
  }

  setIntensity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.intensity = Math.max(0, Math.min(1, value));
    this.draw();
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
    this.reducedMotion.removeEventListener("change", this.syncAnimation);
    document.removeEventListener("visibilitychange", this.syncAnimation);
    this.analyser = null;
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
      this.reducedMotion.matches ||
      document.hidden
    ) {
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
    this.sampleAudio(seconds);
    this.phase +=
      seconds *
      (0.3 +
        this.intensity * 0.9 +
        this.bass * this.intensity * 0.75 +
        this.impact * this.intensity * 1.5);
    this.draw();
  };

  private sampleAudio(seconds: number): void {
    const analyser = this.analyser;
    let low = 0;
    let middle = 0;
    let level = 0;
    if (analyser) {
      if (this.frequencies.length !== analyser.frequencyBinCount) {
        this.frequencies = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(this.frequencies);
      if (this.waveform.length !== analyser.fftSize) {
        this.waveform = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatTimeDomainData(this.waveform);
      for (const sample of this.waveform) level += sample * sample;
      level = Math.sqrt(level / Math.max(1, this.waveform.length));
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      let lowCount = 0;
      let midCount = 0;
      for (let index = 1; index < this.frequencies.length; index += 1) {
        const frequency = index * binHz;
        const amplitude = (this.frequencies[index] ?? 0) / 255;
        if (frequency < 250) {
          low += amplitude;
          lowCount += 1;
        } else if (frequency < 3000) {
          middle += amplitude;
          midCount += 1;
        } else {
          break;
        }
      }
      low /= Math.max(1, lowCount);
      middle /= Math.max(1, midCount);
    }
    const smoothing = 1 - Math.exp(-seconds / 0.16);
    this.lowAverage +=
      (low - this.lowAverage) * (1 - Math.exp(-seconds / 0.75));
    this.levelAverage +=
      (level - this.levelAverage) * (1 - Math.exp(-seconds / 0.6));
    const onset = Math.min(
      1,
      Math.max(0, low - this.lowAverage) * 2.5 +
        Math.max(0, level - this.levelAverage) * 20,
    );
    this.onsetPeak = Math.max(
      onset,
      this.onsetPeak * Math.exp(-seconds / 0.24),
    );
    this.impact += (this.onsetPeak - this.impact) * smoothing;
    this.bass += (low - this.bass) * smoothing;
    this.mid += (middle - this.mid) * smoothing;
  }

  private point(position: number, strand: number, sheet: SpectralSheet): Point {
    const angle = position * TAU;
    const energy = (this.bass * 0.75 + this.impact * 0.35) * this.intensity;
    const acid = Math.min(1, this.mid * 1.6) * this.intensity;
    const twist = Math.sin(
      angle * 1.37 - this.phase * 0.58 + sheet.phase + acid * 1.15,
    );
    const width =
      sheet.width *
      (0.62 + 0.38 * Math.cos(angle + sheet.phase)) *
      (1 + energy * 0.5);
    const wave =
      Math.sin(angle * 0.86 + this.phase * 0.46 + sheet.phase) *
        (0.19 + energy * 0.18) +
      Math.sin(angle * 1.72 - this.phase * 0.31 + sheet.phase) *
        (0.11 + acid * 0.035) +
      Math.sin(angle * 0.6 + sheet.phase) * energy * 0.11;
    const fold = Math.sin(strand * Math.PI + twist * 1.5) * width * 0.4;
    const x =
      this.sceneWidth *
      (position + Math.sin(strand * 1.8 + twist * 1.6) * (0.05 + acid * 0.025));
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
        this.intensity * 1.65 +
        energy * 1.35 +
        acid * 0.8 +
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
      (this.intensity * 0.42 + acid * 0.5 + energy * 0.55);
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
  ): void {
    const push = this.impact * this.intensity;
    const centreX = this.sceneWidth * centre;
    const centreY =
      this.sceneHeight * (0.5 + Math.sin(this.phase * 0.18 + offset) * 0.07);
    const radiusX =
      Math.min(this.sceneWidth * 0.24, this.sceneHeight * 0.72) *
      (0.76 + push * 0.55);
    const radiusY =
      Math.min(this.sceneHeight * 0.59, this.sceneWidth * 0.25) *
      (0.76 + push * 0.55);
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
    const punch = this.impact * this.intensity;
    context.translate(
      this.sceneWidth * (0.5 + Math.sin(this.phase * 0.8) * punch * 0.035),
      this.sceneHeight * (0.5 + Math.cos(this.phase * 0.67) * punch * 0.04),
    );
    context.rotate(Math.sin(this.phase * 0.24) * this.intensity * 0.055);
    context.scale(1 + punch * 0.09, 1 + punch * 0.09);
    context.translate(-this.sceneWidth * 0.5, -this.sceneHeight * 0.5);
    this.drawPulseRing(context, 0.22, 0.5);
    this.drawPulseRing(context, 0.78, 3.5);
    for (const sheet of SHEETS) this.drawSheet(context, sheet);
    context.restore();

    output.drawImage(this.field, 0, 0, this.width, this.height);
    const shade = output.createLinearGradient(0, 0, 0, this.height);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.65)");
    shade.addColorStop(0.22, "rgba(0, 0, 0, 0.02)");
    shade.addColorStop(0.74, "rgba(0, 0, 0, 0.01)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.7)");
    output.fillStyle = shade;
    output.fillRect(0, 0, this.width, this.height);
  }
}
