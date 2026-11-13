import type { DrumId, DrumTrack } from "./model";
import {
  VISUALIZER_PALETTES,
  createPaletteLookup,
} from "./visualizer-palettes";
import type { VisualizerPaletteId } from "./visualizer-palettes";
import type { ProjectMode } from "./mode";

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

// Fluff draws soft pastel clouds and drifting bokeh straight into colour, with no film grain.
const FLUFF_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uSize;
uniform float uPhase;
uniform vec4 uHits;
uniform float uRim;
uniform float uSwirl;
uniform sampler2D uPalette;
uniform float uPaletteMode;

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
    p = turn * p * 2.02 + vec2(12.7, 5.3);
    weight *= 0.5;
  }
  return value * 1.06667;
}
vec2 whirl(vec2 p, vec2 centre, float amount) {
  vec2 delta = p - centre;
  float angle = amount * exp(-dot(delta, delta) * 0.9);
  float c = cos(angle);
  float s = sin(angle);
  return centre + mat2(c, -s, s, c) * delta;
}
vec3 tone(float t, float shift) {
  float position = uPaletteMode > 0.5 ? fract(t * 0.7 + shift) : clamp(t, 0.0, 1.0);
  return texture2D(uPalette, vec2(position, 0.5)).rgb;
}
vec3 glow(float shift) {
  vec3 colour = tone(1.0, shift);
  return uPaletteMode > 0.5 ? mix(colour, vec3(1.0), 0.6) : colour;
}
void main() {
  vec2 aspect = uSize / min(uSize.x, uSize.y);
  vec2 uv = (vUv - 0.5) * aspect;
  float time = uPhase * 0.22;
  float kick = uHits.x;
  float hat = uHits.z;
  float puff = max(uHits.y, uHits.w);
  float shift = time * 0.18 + vUv.x * 0.12;
  vec2 p = uv * (1.5 / (1.0 + kick * 0.1));
  vec2 centre = vec2(sin(time * 0.53) * 0.45, cos(time * 0.41) * 0.3);
  p = whirl(p, centre, uSwirl * (2.6 + sin(time * 0.9) * 0.9));
  p = whirl(p, vec2(0.0), uRim * 0.7);
  vec2 drift = vec2(time * 0.32, -time * 0.1);
  vec2 q = vec2(fbm(p * 0.8 + drift), fbm(p * 0.8 + vec2(5.2, 1.3) - drift * 0.7));
  vec2 flow = p * 1.15 + q * 1.0 + vec2(-time * 0.18, time * 0.07);
  float billow = fbm(flow);
  float above = fbm(flow + vec2(0.0, 0.07));
  float back = fbm(p * 0.5 + q * 0.7 - drift * 0.45 + 3.0);
  vec2 puffCentre = vec2(sin(time * 0.31) * 0.35, cos(time * 0.27) * 0.18);
  float puffRadius = mix(0.95, 0.35, puff);
  float puffGlow = exp(-dot(uv - puffCentre, uv - puffCentre) / (puffRadius * puffRadius)) * puff;
  float cloud = smoothstep(0.43, 0.74, billow + puffGlow * 0.22);
  float lit = clamp((billow - above) * 7.0 + 0.45 + kick * 0.15, 0.0, 1.0);
  float haze = smoothstep(0.3, 0.8, back);
  vec3 sky = tone(0.02 + vUv.y * 0.14 + haze * 0.2, shift);
  vec3 body = mix(tone(0.5 + haze * 0.1, shift + 0.15), glow(shift + 0.3), lit);
  vec3 colour = mix(sky, body, cloud * 0.94);
  colour += cloud * lit * hat * 0.06;
  float bokeh = 0.0;
  for (int i = 0; i < 12; i++) {
    float index = float(i);
    vec2 seed = vec2(index * 1.37 + 0.4, index * 2.71 + 1.1);
    float rise = time * 0.05 * (0.6 + hash(seed + 7.0));
    vec2 spot = vec2(hash(seed) - 0.5, fract(hash(seed + 3.1) + rise) - 0.5) * aspect * 1.1;
    spot += vec2(sin(time * 0.6 + index * 1.7), cos(time * 0.5 + index * 2.3)) * 0.05;
    float radius = mix(0.03, 0.1, hash(seed + 11.0)) * (1.0 + kick * 0.3);
    float gap = length(uv - spot);
    float disc = 1.0 - smoothstep(radius * 0.82, radius, gap);
    float ring = smoothstep(radius * 0.55, radius * 0.9, gap) * disc;
    float sparkle = 0.16 + hat * 0.6 * hash(seed + 5.0);
    bokeh += (disc * 0.6 + ring * 0.4) * sparkle;
  }
  colour = mix(colour, glow(shift + 0.4), clamp(bokeh, 0.0, 0.8));
  float bloom = kick * 0.22 * (1.0 - smoothstep(0.0, 1.1, length(uv)));
  colour = mix(colour, glow(shift), bloom);
  gl_FragColor = vec4(colour, 1.0);
}`;

// Soft fields are rendered small and scaled up; a sub-level dither hides 8-bit banding.
const FLUFF_PRESENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uSize;
uniform sampler2D uField;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec3 colour = texture2D(uField, vUv).rgb;
  float dither = (hash(vUv * uSize) - 0.5) / 255.0;
  gl_FragColor = vec4(colour + dither, 1.0);
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
    private readonly fluff: ShaderPass | null,
    private readonly fluffPresent: ShaderPass | null,
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
    const fluff = createPass(gl, FLUFF_SHADER);
    const fluffPresent = createPass(gl, FLUFF_PRESENT_SHADER);
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
      fluff,
      fluffPresent,
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

  drawFluff(frame: FluidFrame, animated: boolean): boolean {
    const gl = this.gl;
    const fluff = this.fluff;
    const present = this.fluffPresent;
    if (!fluff || !present || !this.ready || gl.isContextLost()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.fieldWidth, this.fieldHeight);
    this.use(fluff, this.fieldWidth, this.fieldHeight, frame);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(fluff.palette, 2);
    gl.uniform1f(fluff.paletteMode, animated ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.use(present, this.canvas.width, this.canvas.height, frame);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.uniform1i(present.field, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  destroy(): void {
    this.gl.deleteProgram(this.fluid.program);
    this.gl.deleteProgram(this.swirlFluid.program);
    this.gl.deleteProgram(this.grain.program);
    this.gl.deleteProgram(this.fluff?.program ?? null);
    this.gl.deleteProgram(this.fluffPresent?.program ?? null);
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
  private mode: ProjectMode = "grain";
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
      step < 0
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

  setMode(mode: ProjectMode): void {
    if (this.destroyed || this.mode === mode) return;
    this.mode = mode;
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

  private paletteColour(position: number, alpha: number, white = 0): string {
    const index = Math.round(Math.max(0, Math.min(1, position)) * 255) * 4;
    const lift = (value: number): number =>
      Math.round(value + (255 - value) * white);
    const red = lift(this.paletteLookup[index] ?? 255);
    const green = lift(this.paletteLookup[index + 1] ?? 255);
    const blue = lift(this.paletteLookup[index + 2] ?? 255);
    return `rgb(${red} ${green} ${blue} / ${Math.max(0, Math.min(1, alpha))})`;
  }

  /** Canvas Fluff layers soft radial puffs and bokeh on a small canvas, then scales it up. */
  private drawFluffFallback(frame: FluidFrame, animated: boolean): void {
    const context = this.fallbackContext;
    const output = this.context;
    if (!context || !output) return;
    const width = this.fallback.width;
    const height = this.fallback.height;
    const size = Math.min(width, height);
    const time = frame.phase * 0.22;
    const tone = (position: number, alpha: number): string =>
      this.paletteColour(
        animated ? (((position * 0.7 + time * 0.18) % 1) + 1) % 1 : position,
        alpha,
      );
    const glow = (alpha: number): string =>
      animated
        ? this.paletteColour((0.7 + time * 0.18) % 1, alpha, 0.6)
        : tone(1, alpha);
    const puff = Math.max(frame.snare, frame.clap);
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, tone(0.3, 1));
    sky.addColorStop(1, tone(0.1, 1));
    context.globalCompositeOperation = "source-over";
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    const centreX = width * 0.5;
    const centreY = height * 0.5;
    const turn = frame.rim * 0.5;
    const swirlTurn = frame.swirl * (1.6 + Math.sin(time * 0.9) * 0.6);
    const place = (x: number, y: number): [number, number] => {
      const dx = x - centreX;
      const dy = y - centreY;
      const distance = (dx * dx + dy * dy) / (size * size);
      const angle = turn + swirlTurn * Math.exp(-distance * 2.2);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      return [
        centreX + dx * cosine - dy * sine,
        centreY + dx * sine + dy * cosine,
      ];
    };
    const blob = (
      x: number,
      y: number,
      radius: number,
      colour: string,
      edge: string,
    ): void => {
      const [px, py] = place(x, y);
      const gradient = context.createRadialGradient(px, py, 0, px, py, radius);
      gradient.addColorStop(0, colour);
      gradient.addColorStop(0.55, colour);
      gradient.addColorStop(1, edge);
      context.fillStyle = gradient;
      context.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    };
    const swell = 1 + frame.kick * 0.12;
    const span = width + size;
    for (let index = 0; index < 7; index++) {
      const speed = 0.04 + (index % 3) * 0.015;
      const x =
        ((((index * 0.29 + time * speed) % 1) + 1) % 1) * span - size * 0.5;
      const y =
        height * (0.2 + ((index * 0.37) % 1) * 0.65) +
        Math.sin(time * 0.5 + index) * size * 0.04;
      const radius = size * (0.28 + (index % 4) * 0.06) * swell;
      for (let lobe = 0; lobe < 3; lobe++) {
        blob(
          x + (lobe - 1) * radius * 0.55,
          y - (lobe === 1 ? radius * 0.18 : 0),
          radius * (lobe === 1 ? 0.85 : 0.65),
          tone(0.55 + (index % 3) * 0.12, 0.42),
          tone(0.55 + (index % 3) * 0.12, 0),
        );
      }
    }
    if (puff > 0.01) {
      const radius = size * (0.95 - puff * 0.55);
      blob(
        centreX + Math.sin(time * 0.31) * size * 0.35,
        centreY - Math.cos(time * 0.27) * size * 0.18,
        radius,
        tone(0.85, puff * 0.45),
        tone(0.85, 0),
      );
    }
    for (let index = 0; index < 10; index++) {
      const seedX = (Math.sin(index * 12.9898) * 43758.5453) % 1;
      const seedY = (Math.sin(index * 78.233) * 12345.678) % 1;
      const x =
        (Math.abs(seedX) * 1.1 - 0.05) * width +
        Math.sin(time * 0.6 + index * 1.7) * size * 0.05;
      const rise =
        (Math.abs(seedY) + time * 0.05 * (0.6 + (index % 4) * 0.2)) % 1;
      const y = (1 - rise) * height * 1.1 - height * 0.05;
      const radius =
        size * (0.035 + (index % 5) * 0.018) * (1 + frame.kick * 0.3);
      const alpha = 0.18 + frame.hat * 0.5 * (((index * 7) % 5) / 4);
      blob(x, y, radius, glow(alpha), glow(0));
    }
    if (frame.kick > 0.01) {
      blob(centreX, centreY, size * 1.1, glow(frame.kick * 0.22), glow(0));
    }
    output.imageSmoothingEnabled = true;
    output.imageSmoothingQuality = "high";
    output.drawImage(
      this.fallback,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
  }

  private draw(): void {
    if (!this.context || this.destroyed) return;
    if (this.mode === "fluff") {
      this.drawFluff();
      return;
    }
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

  private drawFluff(): void {
    if (!this.context) return;
    const frame: FluidFrame = {
      phase: this.phase,
      swirl: this.swirl,
      kick: this.pulses.kick.value,
      snare: this.pulses.snare.value,
      hat: this.pulses.hat.value,
      clap: this.pulses.clap.value,
      rim: this.pulses.rim.value * this.rimTurn,
    };
    const animated =
      VISUALIZER_PALETTES.find((palette) => palette.id === this.palette)
        ?.animated === true;
    if (this.gpu?.drawFluff(frame, animated))
      this.context.drawImage(this.gpu.canvas, 0, 0);
    else this.drawFluffFallback(frame, animated);
  }
}
