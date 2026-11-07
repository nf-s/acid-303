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
    offset: -0.16,
    width: 0.24,
    phase: 2.4,
    opacity: 0.62,
    colours: ["#202020", "#888888", "#e5e5e5", "#555555", "#bbbbbb"],
  },
  {
    offset: 0.18,
    width: 0.29,
    phase: 4.1,
    opacity: 0.72,
    colours: ["#a0a0a0", "#383838", "#fafafa", "#919191", "#333333"],
  },
  {
    offset: 0,
    width: 0.24,
    phase: 0.3,
    opacity: 0.8,
    colours: ["#303030", "#d8d8d8", "#767676", "#ededed", "#505050"],
  },
];

const EDGE_COLOURS = ["#676767", "#a4a4a4", "#dedede", "#8b8b8b", "#bfbfbf"];
const triangle = (value: number): number =>
  (2 / Math.PI) * Math.asin(Math.sin(value));

/** A prismatic fluid field: audio deforms geometry without flashing brightness. */
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
      (0.16 +
        this.intensity * 0.42 +
        this.bass * this.intensity * 0.4 +
        this.impact * this.intensity * 0.8);
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
    const smoothing = 1 - Math.exp(-seconds / 0.18);
    this.lowAverage +=
      (low - this.lowAverage) * (1 - Math.exp(-seconds / 0.75));
    const onset = Math.min(1, Math.max(0, low - this.lowAverage) * 4);
    this.impact += (onset - this.impact) * smoothing;
    this.bass += (low - this.bass) * smoothing;
    this.mid += (middle - this.mid) * smoothing;
  }

  private point(position: number, strand: number, sheet: SpectralSheet): Point {
    const angle = position * TAU;
    const energy = (this.bass * 0.4 + this.impact * 0.9) * this.intensity;
    const acid = this.mid * this.intensity;
    const twist = Math.sin(
      angle * 1.37 - this.phase * 0.42 + sheet.phase + acid * 0.8,
    );
    const width =
      sheet.width *
      (0.62 + 0.38 * Math.cos(angle + sheet.phase)) *
      (1 + energy * 0.34);
    const fracture = triangle(angle * 2.3 + this.phase * 0.22 + sheet.phase);
    const wave =
      triangle(angle * 0.86 + this.phase * 0.35 + sheet.phase) *
        (0.2 + energy * 0.18) +
      Math.sin(angle * 1.72 - this.phase * 0.18 + sheet.phase) * 0.11 +
      fracture * (0.035 + this.intensity * 0.035) +
      Math.sin(angle * 0.6 + sheet.phase) * energy * 0.11;
    const fold = Math.sin(strand * Math.PI + twist * 1.5) * width * 0.4;
    const x =
      this.sceneWidth *
      (position + Math.sin(strand * 1.8 + twist * 1.6) * 0.032);
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
        energy * 1.1 +
        acid * 0.5 +
        Math.sin(this.phase * 0.27) * 0.55);
    return {
      x: centreX + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      y: centreY + dx * Math.sin(rotation) + dy * Math.cos(rotation),
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

    const facets = this.sceneWidth < 600 ? 12 : 20;
    for (let index = 0; index < facets; index += 1) {
      const position = -0.15 + (index / facets) * 1.3;
      const next = position + 1.3 / facets;
      const a = this.point(position, -1, sheet);
      const b = this.point(next, -1, sheet);
      const c = this.point(next, 1, sheet);
      const d = this.point(position, 1, sheet);
      context.globalAlpha = 0.12;
      context.fillStyle = index % 3 === 0 ? "#111111" : "#dfdfdf";
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(index % 2 === 0 ? c.x : d.x, index % 2 === 0 ? c.y : d.y);
      context.closePath();
      context.fill();
    }

    const strands = this.sceneWidth < 600 ? 5 : 7;
    for (let index = 0; index <= strands; index += 1) {
      const strand = -1 + (index / strands) * 2;
      context.globalAlpha = index % 3 === 0 ? 0.38 : 0.16;
      context.strokeStyle = index % 4 === 0 ? "#dedede" : "#8b8b8b";
      context.lineWidth = index % 3 === 0 ? 1.6 : 1;
      context.beginPath();
      this.sheetPath(context, sheet, strand);
      context.stroke();
    }

    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.85;
    context.lineWidth = 1.5;
    for (const edge of [-1, 1]) {
      context.strokeStyle = edge < 0 ? "#d0d0d0" : "#9b9b9b";
      context.translate(edge * 2.5, edge * 1.2);
      context.beginPath();
      this.sheetPath(context, sheet, edge);
      context.stroke();
    }
    context.restore();
    context.globalAlpha = 1;
  }

  private drawPrism(
    context: CanvasRenderingContext2D,
    centre: number,
    offset: number,
  ): void {
    const push = this.impact * this.intensity;
    const centreX =
      this.sceneWidth *
      (centre + Math.cos(this.phase * 0.33 + offset) * push * 0.035);
    const centreY =
      this.sceneHeight *
      (0.5 + Math.sin(this.phase * 0.19 + offset) * (0.08 + push * 0.08));
    const radiusX =
      Math.min(this.sceneWidth * 0.22, this.sceneHeight * 0.85) *
      (1 + push * 0.16);
    const radiusY =
      Math.min(this.sceneHeight * 0.64, this.sceneWidth * 0.27) *
      (1 + push * 0.16);
    const rings = this.sceneWidth < 600 ? 5 : 7;
    const vertices = 18;
    for (let ring = rings; ring > 0; ring -= 1) {
      const radius = 0.22 + (ring / rings) * 0.82;
      const angleOffset = this.phase * 0.06 + offset + ring * 0.035;
      context.beginPath();
      for (let vertex = 0; vertex <= vertices; vertex += 1) {
        const angle = (vertex / vertices) * TAU + angleOffset;
        const tooth =
          1 + Math.sin(angle * 5 + offset) * 0.17 + (vertex % 2) * 0.13;
        const x = centreX + Math.cos(angle) * radiusX * radius * tooth;
        const y = centreY + Math.sin(angle) * radiusY * radius * tooth;
        if (vertex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      const colour =
        EDGE_COLOURS[(ring + Math.floor(offset)) % EDGE_COLOURS.length] ??
        "#a4a4a4";
      context.globalAlpha = ring % 3 === 0 ? 0.36 : 0.17;
      context.strokeStyle = colour;
      context.lineWidth = ring % 3 === 0 ? 4 : 2;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  private drawFracture(context: CanvasRenderingContext2D): void {
    const segments = this.sceneWidth < 600 ? 18 : 30;
    const gradient = context.createLinearGradient(0, 0, this.sceneWidth, 0);
    gradient.addColorStop(0, "#444444");
    gradient.addColorStop(0.22, "#bbbbbb");
    gradient.addColorStop(0.48, "#555555");
    gradient.addColorStop(0.68, "#dedede");
    gradient.addColorStop(0.84, "#777777");
    gradient.addColorStop(1, "#aaaaaa");
    const point = (index: number, edge: number): Point => {
      const position = index / segments;
      const wave =
        triangle(
          position * TAU * 1.6 +
            this.phase * 0.2 +
            this.mid * this.intensity * 0.45,
        ) *
        (0.16 + this.impact * this.intensity * 0.09);
      const notch = index % 3 === 0 ? 0.018 : -0.009;
      const breadth = 0.085 + Math.sin(position * TAU * 0.85 + 1) * 0.045;
      return {
        x: position * this.sceneWidth,
        y: this.sceneHeight * (0.54 + wave + notch + edge * breadth),
      };
    };
    context.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const vertex = point(index, -1);
      if (index === 0) context.moveTo(vertex.x, vertex.y);
      else context.lineTo(vertex.x, vertex.y);
    }
    for (let index = segments; index >= 0; index -= 1) {
      const vertex = point(index, 1);
      context.lineTo(vertex.x, vertex.y);
    }
    context.closePath();
    context.globalAlpha = 0.48;
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = gradient;
    for (let line = 0; line <= 3; line += 1) {
      context.beginPath();
      for (let index = 0; index <= segments; index += 1) {
        const vertex = point(index, (line / 3) * 2 - 1);
        if (index === 0) context.moveTo(vertex.x, vertex.y);
        else context.lineTo(vertex.x, vertex.y);
      }
      context.globalAlpha = line === 0 || line === 3 ? 0.65 : 0.2;
      context.lineWidth = line === 0 || line === 3 ? 2 : 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  private drawDigitalFragments(context: CanvasRenderingContext2D): void {
    const count = this.sceneWidth < 600 ? 15 : 30;
    for (let index = 0; index < count; index += 1) {
      const column = ((index * 137 + 41) % 997) / 997;
      const row = ((index * 73 + 29) % 197) / 197;
      const x =
        column * this.sceneWidth + Math.sin(this.phase * 0.2 + index) * 7;
      const y = this.sceneHeight * (0.14 + row * 0.73);
      const width = 7 + ((index * 19) % 43);
      context.globalAlpha = index % 3 === 0 ? 0.48 : 0.18;
      context.fillStyle =
        EDGE_COLOURS[index % EDGE_COLOURS.length] ?? "#a4a4a4";
      context.fillRect(x, y, width, index % 3 === 0 ? 2 : 1);
      if (index % 4 === 0) context.fillRect(x + width - 1, y, 1, 9);
    }
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
    this.drawPrism(context, 0.2, 0.5);
    this.drawPrism(context, 0.79, 3.5);
    this.drawFracture(context);
    for (const sheet of SHEETS) this.drawSheet(context, sheet);
    this.drawDigitalFragments(context);
    context.restore();

    output.drawImage(this.field, 0, 0, this.width, this.height);
    const slices = this.width < 600 ? 5 : 8;
    for (let index = 0; index < slices; index += 1) {
      const y = this.height * (0.19 + (index / slices) * 0.64);
      const height = Math.max(2, this.height * (index % 3 === 0 ? 0.04 : 0.02));
      const shift =
        Math.sin(this.phase * 0.31 + index * 1.7) *
        (6 +
          this.intensity * 15 +
          this.bass * this.intensity * 14 +
          this.impact * this.intensity * 32);
      const inset = Math.abs(shift) + 1;
      if (this.width <= inset * 2) continue;
      output.drawImage(
        this.field,
        inset * this.ratio,
        y * this.ratio,
        (this.width - inset * 2) * this.ratio,
        height * this.ratio,
        inset + shift,
        y,
        this.width - inset * 2,
        height,
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
