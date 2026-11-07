const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;

interface Point {
  x: number;
  y: number;
}

interface Ribbon {
  offset: number;
  width: number;
  phase: number;
  opacity: number;
  colours: [string, string, string, string];
}

const RIBBONS: Ribbon[] = [
  {
    offset: -0.08,
    width: 0.24,
    phase: 1.6,
    opacity: 0.68,
    colours: ["#192738", "#4e5b83", "#7d8caf", "#29334e"],
  },
  {
    offset: 0.13,
    width: 0.18,
    phase: 3.7,
    opacity: 0.64,
    colours: ["#26314b", "#6b689b", "#a7a4ce", "#313c5c"],
  },
  {
    offset: 0,
    width: 0.29,
    phase: 0,
    opacity: 0.91,
    colours: ["#344359", "#8f9fbc", "#c8cde0", "#655e91"],
  },
];

/** A continuous ribbon field: audio changes its shape, never its brightness. */
export class FluidVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private analyser: AnalyserNode | null = null;
  private frequencies = new Uint8Array(0);
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
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
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
      (0.13 + this.intensity * 0.38 + this.bass * this.intensity * 0.2);
    this.draw();
  };

  private sampleAudio(seconds: number): void {
    const analyser = this.analyser;
    let low = 0;
    let middle = 0;
    if (analyser) {
      if (this.frequencies.length !== analyser.frequencyBinCount) {
        this.frequencies = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(this.frequencies);
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
    const smoothing = 1 - Math.exp(-seconds / 0.24);
    this.bass += (low - this.bass) * smoothing;
    this.mid += (middle - this.mid) * smoothing;
  }

  private point(position: number, strand: number, ribbon: Ribbon): Point {
    const phase = this.phase;
    const angle = position * TAU;
    const energy = this.bass * this.intensity;
    const twist = Math.sin(angle * 1.17 - phase * 0.55 + ribbon.phase);
    const width =
      ribbon.width *
      (0.54 + 0.46 * Math.cos(angle * 0.72 + ribbon.phase + phase * 0.3));
    const wave =
      Math.sin(angle * 0.92 + phase * 0.6 + ribbon.phase) *
        (0.2 + energy * 0.065) +
      Math.sin(angle * 1.91 - phase * 0.29 + ribbon.phase * 0.7) *
        (0.075 + this.mid * this.intensity * 0.025);
    const fold = Math.sin(strand * Math.PI + twist * 1.6) * width * 0.38;
    const x =
      this.width * (position + Math.sin(strand * 2.2 + twist * 1.7) * 0.027);
    const y =
      this.height *
      (0.5 + ribbon.offset + wave + strand * width * twist + fold);
    const centreX = this.width * (0.61 + Math.sin(phase * 0.21) * 0.055);
    const centreY = this.height * 0.51;
    const radius = Math.min(this.width * 0.27, this.height * 1.12);
    const dx = x - centreX;
    const dy = y - centreY;
    const distance = (dx * dx + dy * dy) / (radius * radius);
    const rotation =
      Math.exp(-distance * 1.7) *
      (0.65 +
        this.intensity * 1.8 +
        energy * 0.65 +
        Math.sin(phase * 0.37) * 0.4);
    return {
      x: centreX + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      y: centreY + dx * Math.sin(rotation) + dy * Math.cos(rotation),
    };
  }

  private drawRibbon(context: CanvasRenderingContext2D, ribbon: Ribbon): void {
    const segments = this.width < 600 ? 64 : 96;
    const strands = this.width < 600 ? 24 : 36;
    const start = -0.12;
    const length = 1.24;
    const gradient = context.createLinearGradient(
      0,
      this.height * 0.2,
      this.width,
      this.height * 0.85,
    );
    gradient.addColorStop(0, ribbon.colours[0]);
    gradient.addColorStop(0.32, ribbon.colours[1]);
    gradient.addColorStop(0.62, ribbon.colours[2]);
    gradient.addColorStop(1, ribbon.colours[3]);

    context.globalAlpha = ribbon.opacity;
    context.fillStyle = gradient;
    context.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const point = this.point(start + (index / segments) * length, -1, ribbon);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    for (let index = segments; index >= 0; index -= 1) {
      const point = this.point(start + (index / segments) * length, 1, ribbon);
      context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.fill();

    for (let line = 0; line <= strands; line += 1) {
      const strand = -1 + (line / strands) * 2;
      const ridge = Math.pow(
        Math.max(0, Math.sin((line / strands) * Math.PI)),
        3,
      );
      context.globalAlpha = ribbon.opacity * (0.12 + ridge * 0.29);
      context.strokeStyle = line % 3 === 0 ? "#e2e7f5" : "#b4badd";
      context.lineWidth = line % 3 === 0 ? 0.8 : 0.45;
      context.beginPath();
      for (let index = 0; index <= segments; index += 1) {
        const point = this.point(
          start + (index / segments) * length,
          strand,
          ribbon,
        );
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  private draw(): void {
    const context = this.context;
    if (!context || this.destroyed) return;
    const background = context.createLinearGradient(
      0,
      0,
      this.width,
      this.height,
    );
    background.addColorStop(0, "#172231");
    background.addColorStop(0.5, "#20283e");
    background.addColorStop(1, "#141d2b");
    context.fillStyle = background;
    context.fillRect(0, 0, this.width, this.height);

    const haze = context.createRadialGradient(
      this.width * 0.58,
      this.height * 0.46,
      0,
      this.width * 0.58,
      this.height * 0.46,
      this.width * 0.55,
    );
    haze.addColorStop(0, "rgba(104, 100, 151, 0.2)");
    haze.addColorStop(1, "rgba(22, 31, 46, 0)");
    context.fillStyle = haze;
    context.fillRect(0, 0, this.width, this.height);

    for (const ribbon of RIBBONS) this.drawRibbon(context, ribbon);

    const vignette = context.createLinearGradient(0, 0, this.width, 0);
    vignette.addColorStop(0, "rgba(17, 26, 40, 0.74)");
    vignette.addColorStop(0.18, "rgba(17, 26, 40, 0.05)");
    vignette.addColorStop(0.8, "rgba(17, 26, 40, 0.02)");
    vignette.addColorStop(1, "rgba(17, 26, 40, 0.6)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.width, this.height);
  }
}
