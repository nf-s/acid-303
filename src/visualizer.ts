import { STEP_COUNT } from "./model";
import type { DrumId, DrumTrack } from "./model";
import { createPaletteLookup } from "./visualizer-palettes";
import type { VisualizerPaletteId } from "./visualizer-palettes";

const FRAME_INTERVAL = 1000 / 30;

interface DrumPulse {
  value: number;
  target: number;
  attack: number;
  decay: number;
}

interface FluidFrame {
  phase: number;
  swirl: number;
  kick: number;
  snare: number;
  hat: number;
  clap: number;
  rim: number;
}

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FLUID_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uSize;
uniform float uPhase;
uniform vec4 uHits;
uniform float uRim;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
             mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float weight = 0.5;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    value += noise(p) * weight;
    p = turn * p * 2.04 + vec2(12.7, 5.3);
    weight *= 0.5;
  }
  return value * 1.06667;
}
vec2 whirl(vec2 p, vec2 centre, float amount) {
  vec2 delta = p - centre;
  float angle = amount * exp(-dot(delta, delta) * 0.65);
  float c = cos(angle);
  float s = sin(angle);
  return centre + mat2(c, -s, s, c) * delta;
}
void main() {
  vec2 p = (vUv - 0.5) * uSize / min(uSize.x, uSize.y);
  if (uSize.y > uSize.x) p = vec2(p.y, -p.x);
  p *= 3.5 / (1.0 + uHits.x * 0.24);
  float time = uPhase * 0.7;
  p = whirl(p, vec2(-0.65, 0.1), 1.5 * sin(time * 0.43) + uRim * 0.85);
  p = whirl(p, vec2(0.75, -0.15), -1.4 * cos(time * 0.37) - uHits.x * 0.75);
  p.x += sin(p.y * 2.2 + time) * uHits.w * 0.28;
  p.y += sin(p.x * 3.2 - time * 1.3) * uHits.y * 0.18;
  vec2 drift = vec2(time * 0.23, -time * 0.17);
  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(4.7, 1.3) - drift * 0.8));
  vec2 r = vec2(fbm(p + q * 3.1 + vec2(1.7, 8.2) + drift * 0.6),
                fbm(p + q * 3.1 + vec2(8.3, 2.8) - drift * 0.7));
  vec2 flow = p + r * (3.6 + uHits.y * 0.5) + q * 0.6;
  flow += sin(p.yx * 8.0 + time * 2.0) * uHits.z * 0.025;
  float cloud = fbm(flow);
  float wisps = pow(1.0 - abs(cloud * 2.0 - 1.0), 5.0);
  float density = (cloud * cloud * cloud + cloud * cloud * 0.6 + cloud * 0.5);
  density *= 0.42 + length(r) * 0.72;
  density = smoothstep(0.12, 0.78, density);
  float light = density * (0.65 + wisps * 0.35);
  float vignette = 1.0 - smoothstep(0.25, 0.85, abs(vUv.y - 0.5)) * 0.35;
  gl_FragColor = vec4(vec3(clamp(light * vignette, 0.0, 1.0)), 1.0);
}`;

// A separate program preserves the original shader's exact floating-point output.
const SWIRL_SHADER = FLUID_SHADER.replace(
  "uniform float uRim;",
  "uniform float uRim;\nuniform float uSwirl;",
).replace(
  "float time = uPhase * 0.7;",
  `float time = uPhase * 0.7;
  vec2 centre = vec2(sin(time * 0.36) * 0.5, cos(time * 0.29) * 0.4);
  p = whirl(p, centre, uSwirl * (3.8 + sin(time * 0.72) * 1.6));
  p = whirl(p, vec2(0.95, -0.7), -uSwirl * (2.9 + cos(time * 0.61) * 1.3));`,
);

const GRAIN_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uSize;
uniform float uPhase;
uniform sampler2D uField;
uniform sampler2D uGrain;
uniform sampler2D uPalette;
uniform float uPaletteMode;
void main() {
  float light = texture2D(uField, vUv).r;
  vec2 grainUv = vUv * uSize / 256.0 + vec2(uPhase * 0.009, uPhase * -0.006);
  float fine = texture2D(uGrain, grainUv).r - 0.5;
  float detail = texture2D(uGrain, grainUv * 0.37 + 0.23).r - 0.5;
  float grain = fine * 0.67 + detail * 0.1;
  float luminance = clamp(light + grain * (0.32 + sqrt(light) * 0.68), 0.0, 1.0);
  if (uPaletteMode < 0.5) {
    gl_FragColor = vec4(vec3(luminance), 1.0);
  } else if (uPaletteMode < 1.5) {
    gl_FragColor = vec4(texture2D(uPalette, vec2(luminance, 0.5)).rgb, 1.0);
  } else {
    float hue = fract(light * 1.35 + vUv.x * 0.28 + vUv.y * 0.22 + uPhase * 0.055);
    vec3 colour = texture2D(uPalette, vec2(hue, 0.5)).rgb;
    gl_FragColor = vec4(colour * min(1.0, pow(luminance, 0.68) * 1.12), 1.0);
  }
}`;

interface ShaderPass {
  program: WebGLProgram;
  position: number;
  size: WebGLUniformLocation | null;
  phase: WebGLUniformLocation | null;
  hits: WebGLUniformLocation | null;
  rim: WebGLUniformLocation | null;
  swirl: WebGLUniformLocation | null;
  field: WebGLUniformLocation | null;
  grain: WebGLUniformLocation | null;
  palette: WebGLUniformLocation | null;
  paletteMode: WebGLUniformLocation | null;
}

function createPass(
  gl: WebGLRenderingContext,
  fragment: string,
): ShaderPass | null {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertexShader || !fragmentShader || !program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
    return null;
  }
  gl.shaderSource(vertexShader, VERTEX_SHADER);
  gl.shaderSource(fragmentShader, fragment);
  gl.compileShader(vertexShader);
  gl.compileShader(fragmentShader);
  if (
    gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) !== true ||
    gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS) !== true
  ) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  const position = gl.getAttribLocation(program, "aPosition");
  if (position < 0) {
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    position,
    size: gl.getUniformLocation(program, "uSize"),
    phase: gl.getUniformLocation(program, "uPhase"),
    hits: gl.getUniformLocation(program, "uHits"),
    rim: gl.getUniformLocation(program, "uRim"),
    swirl: gl.getUniformLocation(program, "uSwirl"),
    field: gl.getUniformLocation(program, "uField"),
    grain: gl.getUniformLocation(program, "uGrain"),
    palette: gl.getUniformLocation(program, "uPalette"),
    paletteMode: gl.getUniformLocation(program, "uPaletteMode"),
  };
}

function createGrain(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(256, 256);
  let seed = 0x13ac6f25;
  const random = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.round((random() + random() + random()) * 85);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

class FluidGpu {
  private fieldWidth = 1;
  private fieldHeight = 1;
  private ready = false;
  private paletteMode = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly fluid: ShaderPass,
    private readonly swirlFluid: ShaderPass,
    private readonly grain: ShaderPass,
    private readonly vertices: WebGLBuffer,
    private readonly fieldTexture: WebGLTexture,
    private readonly grainTexture: WebGLTexture,
    private readonly paletteTexture: WebGLTexture,
    private readonly framebuffer: WebGLFramebuffer,
  ) {}

  static create(grainImage: HTMLCanvasElement): FluidGpu | null {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    const fluid = createPass(gl, FLUID_SHADER);
    const swirlFluid = createPass(gl, SWIRL_SHADER);
    const grain = createPass(gl, GRAIN_SHADER);
    const vertices = gl.createBuffer();
    const fieldTexture = gl.createTexture();
    const grainTexture = gl.createTexture();
    const paletteTexture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (
      !fluid ||
      !swirlFluid ||
      !grain ||
      !vertices ||
      !fieldTexture ||
      !grainTexture ||
      !paletteTexture ||
      !framebuffer
    ) {
      gl.deleteProgram(fluid?.program ?? null);
      gl.deleteProgram(swirlFluid?.program ?? null);
      gl.deleteProgram(grain?.program ?? null);
      gl.deleteBuffer(vertices);
      gl.deleteTexture(fieldTexture);
      gl.deleteTexture(grainTexture);
      gl.deleteTexture(paletteTexture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindTexture(gl.TEXTURE_2D, grainTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      grainImage,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      createPaletteLookup("mono"),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.DITHER);
    return new FluidGpu(
      canvas,
      gl,
      fluid,
      swirlFluid,
      grain,
      vertices,
      fieldTexture,
      grainTexture,
      paletteTexture,
      framebuffer,
    );
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    const scale = Math.min(1, 640 / Math.max(width, height));
    this.fieldWidth = Math.max(1, Math.round(width * scale));
    this.fieldHeight = Math.max(1, Math.round(height * scale));
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.fieldWidth,
      this.fieldHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.fieldTexture,
      0,
    );
    this.ready =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setPalette(id: VisualizerPaletteId, lookup: Uint8Array): void {
    const gl = this.gl;
    this.paletteMode = id === "mono" ? 0 : id === "rainbow" ? 2 : 1;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lookup,
    );
  }

  private use(
    pass: ShaderPass,
    width: number,
    height: number,
    frame: FluidFrame,
  ): void {
    const gl = this.gl;
    gl.useProgram(pass.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    gl.enableVertexAttribArray(pass.position);
    gl.vertexAttribPointer(pass.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pass.size, width, height);
    gl.uniform1f(pass.phase, frame.phase);
    gl.uniform4f(pass.hits, frame.kick, frame.snare, frame.hat, frame.clap);
    gl.uniform1f(pass.rim, frame.rim);
    gl.uniform1f(pass.swirl, frame.swirl);
  }

  draw(frame: FluidFrame): boolean {
    const gl = this.gl;
    if (!this.ready || gl.isContextLost()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.fieldWidth, this.fieldHeight);
    this.use(
      frame.swirl > 0 ? this.swirlFluid : this.fluid,
      this.fieldWidth,
      this.fieldHeight,
      frame,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.use(this.grain, this.canvas.width, this.canvas.height, frame);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.uniform1i(this.grain.field, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    gl.uniform1i(this.grain.grain, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.grain.palette, 2);
    gl.uniform1f(this.grain.paletteMode, this.paletteMode);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  destroy(): void {
    this.gl.deleteProgram(this.fluid.program);
    this.gl.deleteProgram(this.swirlFluid.program);
    this.gl.deleteProgram(this.grain.program);
    this.gl.deleteBuffer(this.vertices);
    this.gl.deleteTexture(this.fieldTexture);
    this.gl.deleteTexture(this.grainTexture);
    this.gl.deleteTexture(this.paletteTexture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

/** Programmed drum hits churn a continuous smoke field; opacity belongs to the UI. */
export class FluidVisualizer {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly grain = createGrain();
  private readonly gpu = FluidGpu.create(this.grain);
  private readonly fallback = document.createElement("canvas");
  private readonly fallbackContext = this.fallback.getContext("2d");
  private fallbackPixels: ImageData | null = null;
  private readonly observer: ResizeObserver;
  private readonly pulses: Record<DrumId, DrumPulse> = {
    kick: { value: 0, target: 0, attack: 0.075, decay: 0.36 },
    snare: { value: 0, target: 0, attack: 0.065, decay: 0.24 },
    hat: { value: 0, target: 0, attack: 0.04, decay: 0.12 },
    clap: { value: 0, target: 0, attack: 0.075, decay: 0.3 },
    rim: { value: 0, target: 0, attack: 0.065, decay: 0.25 },
  };
  private motionEnabled = true;
  private playing = false;
  private destroyed = false;
  private animationId = 0;
  private lastFrame = 0;
  private phase = 1.2;
  private rimDirection = 1;
  private rimTurn = 0;
  private palette: VisualizerPaletteId = "mono";
  private paletteLookup = createPaletteLookup("mono");
  private swirl = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d", { alpha: false });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
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

  setPalette(id: VisualizerPaletteId): void {
    if (this.destroyed || this.palette === id) return;
    this.palette = id;
    this.paletteLookup = createPaletteLookup(id);
    this.gpu?.setPalette(id, this.paletteLookup);
    this.draw();
  }

  setSwirl(value: number): void {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (this.destroyed || this.swirl === next) return;
    this.swirl = next;
    this.draw();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.syncAnimation);
    this.gpu?.destroy();
  }

  private readonly resize = (): void => {
    if (this.destroyed) return;
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    this.canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    this.gpu?.resize(this.canvas.width, this.canvas.height);
    const scale = Math.min(
      1,
      192 / Math.max(this.canvas.width, this.canvas.height),
    );
    this.fallback.width = Math.max(1, Math.round(this.canvas.width * scale));
    this.fallback.height = Math.max(1, Math.round(this.canvas.height * scale));
    this.fallbackPixels =
      this.fallbackContext?.createImageData(
        this.fallback.width,
        this.fallback.height,
      ) ?? null;
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
    for (const pulse of Object.values(this.pulses)) {
      const response =
        pulse.target > pulse.value ? pulse.attack : pulse.decay * 0.7;
      pulse.value +=
        (pulse.target - pulse.value) * (1 - Math.exp(-seconds / response));
      pulse.target *= Math.exp(-seconds / pulse.decay);
    }
    this.rimTurn +=
      (this.rimDirection - this.rimTurn) * (1 - Math.exp(-seconds / 0.16));
    this.phase +=
      seconds *
      (1.6 + this.pulses.kick.value * 0.9 + this.pulses.snare.value * 0.5) *
      (1 + this.swirl * 1.4);
    this.draw();
  };

  private drawFallback(frame: FluidFrame): void {
    const context = this.fallbackContext;
    const output = this.context;
    const pixels = this.fallbackPixels;
    if (!context || !output || !pixels) return;
    const width = this.fallback.width;
    const height = this.fallback.height;
    const size = Math.min(width, height);
    const zoom = 1 + frame.kick * 0.24;
    const time = frame.phase * 0.7;
    const centreX = Math.sin(time * 0.36) * 0.5;
    const centreY = Math.cos(time * 0.29) * 0.4;
    const firstTurn = frame.swirl * (3.8 + Math.sin(time * 0.72) * 1.6);
    const secondTurn = -frame.swirl * (2.9 + Math.cos(time * 0.61) * 1.3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let px = (((x - width * 0.5) / size) * 4) / zoom;
        let py = (((y - height * 0.5) / size) * 4) / zoom;
        if (frame.swirl > 0) {
          for (let vortex = 0; vortex < 2; vortex++) {
            const cx = vortex === 0 ? centreX : 0.95;
            const cy = vortex === 0 ? centreY : -0.7;
            const dx = px - cx;
            const dy = py - cy;
            const angle =
              (vortex === 0 ? firstTurn : secondTurn) *
              Math.exp(-(dx * dx + dy * dy) * 0.65);
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            px = cx + cosine * dx + sine * dy;
            py = cy - sine * dx + cosine * dy;
          }
        }
        const bend = Math.sin(py * 1.8 + time * 0.7) + frame.rim * 0.7;
        const fx = px + bend * 0.6 + Math.sin(px + time) * frame.clap * 0.3;
        const fy =
          py +
          Math.sin(px * 1.4 - time * 0.6) * 0.7 +
          frame.snare * Math.sin(px * 3) * 0.2;
        const cloud =
          (Math.sin(fx * 2 + Math.sin(fy * 2.3 + time)) +
            Math.sin(fy * 2.1 + Math.cos(fx * 1.7 - time)) +
            Math.sin(fx * 3.4 + fy * 2.8 + time * 0.3 + frame.hat * 0.08)) /
            6 +
          0.5;
        const value = Math.round(Math.pow(Math.max(0, cloud), 1.4) * 255);
        const index = (y * width + x) * 4;
        if (this.palette === "mono") {
          pixels.data[index] = value;
          pixels.data[index + 1] = value;
          pixels.data[index + 2] = value;
        } else {
          const rainbow = this.palette === "rainbow";
          const hue =
            (value / 255) * 1.35 +
            (x / width) * 0.28 +
            (1 - y / height) * 0.22 +
            frame.phase * 0.055;
          const colourIndex =
            (rainbow ? Math.floor((hue % 1) * 255) : value) * 4;
          const brightness = rainbow
            ? Math.min(1, Math.pow(value / 255, 0.68) * 1.12)
            : 1;
          pixels.data[index] =
            (this.paletteLookup[colourIndex] ?? 0) * brightness;
          pixels.data[index + 1] =
            (this.paletteLookup[colourIndex + 1] ?? 0) * brightness;
          pixels.data[index + 2] =
            (this.paletteLookup[colourIndex + 2] ?? 0) * brightness;
        }
        pixels.data[index + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    output.drawImage(
      this.fallback,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    const pattern = output.createPattern(this.grain, "repeat");
    if (pattern) {
      output.save();
      output.globalCompositeOperation = "overlay";
      output.globalAlpha = 0.85;
      output.translate(
        -((frame.phase * 2) % 256),
        -((frame.phase * 1.4) % 256),
      );
      output.fillStyle = pattern;
      output.fillRect(0, 0, this.canvas.width + 256, this.canvas.height + 256);
      output.restore();
    }
  }

  private draw(): void {
    if (!this.context || this.destroyed) return;
    const frame: FluidFrame = {
      phase: this.phase,
      swirl: this.swirl,
      kick: this.pulses.kick.value,
      snare: this.pulses.snare.value,
      hat: this.pulses.hat.value,
      clap: this.pulses.clap.value,
      rim: this.pulses.rim.value * this.rimTurn,
    };
    if (this.gpu?.draw(frame)) this.context.drawImage(this.gpu.canvas, 0, 0);
    else this.drawFallback(frame);
  }
}
