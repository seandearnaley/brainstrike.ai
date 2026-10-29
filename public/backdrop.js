// Flip field: the animated backdrop of brainstrike.ai, drawn with WebGPU.
//
// A wall of small metal tiles, seen in gentle perspective, keeps time to a
// silent 96 BPM. Kicks ripple across it and hi-hats glint off single tiles.
// Once a cycle a sweep crosses the screen and flips the tiles under the
// Brainstrike bolt to their orange faces; on the next downbeat lightning
// strikes down the bolt and a wave flips the wall out from it; then the bolt
// flips back, top to bottom. Tiles near the pointer turn to face it.
//
// Every tile's angle is a function of the cycle time, so the vertex shader
// works it out and nothing is simulated. The tiles render with 4x MSAA into a
// half-float target, lit by a procedural studio of soft boxes; a bloom and
// tone-map pass draws the canvas.
//
// The bolt is drawn where the page's still mark (.still-mark) is laid out, so
// CSS alone decides where it sits.
//
// Without WebGPU, or when it fails, the page keeps its still backdrop and the
// console says why. Reduced motion draws one frame with the bolt written. A
// hidden tab stops the loop.

const canvas = document.querySelector('canvas.backdrop');
const still = document.querySelector('.still-mark');
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The wall keeps a silent 96 BPM, and a cycle is six bars.
const BEAT = 60 / 96;
const CYCLE = 24 * BEAT;
const START = 4; // the page opens here, so the first sweep starts within a second
const SWEEP_AT = 8 * BEAT; // bar three: the sweep crosses the screen in seven beats
const SWEEP_LEN = 7 * BEAT;
const STRIKE_AT = 16 * BEAT; // bar five's downbeat
const ERASE_AT = 20 * BEAT; // bar six: the bolt flips back over two beats
const ERASE_LEN = 2 * BEAT;
const WAVE_SPEED = 1.8; // the strike's wave, in head heights per second

// The camera, and the wall turned so its right side comes toward it.
const DISTANCE = 3.6;
const FOCAL = 1 / Math.tan(0.26); // a 30° vertical field of view
const YAW = -0.17;
const PITCH = -0.1;
const NEAR = 0.5;
const FAR = 12;

const SAMPLES = 4;
const DPR_CAP = 1.5;
const MAX_PIXELS = 2.2e6; // keeps the 4x multisampled targets small on large screens
const MAX_TILES = 80000;
const MAX_SEGMENTS = 512;
const UNIFORM_FLOATS = 36;

// The bolt-shaped split between the head's two halves, in the icon's
// 1024-unit coordinates (assets/icons/icon.svg in the brainstrike repo).
const SPLIT = [
  [626, 140],
  [414, 440],
  [557, 442],
  [346, 769],
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a) => {
  const length = Math.hypot(...a);
  return a.map((v) => v / length);
};
const vec3 = (a) => `vec3f(${a.map((v) => v.toFixed(5)).join(', ')})`;

const WALL_X = [Math.cos(YAW), 0, -Math.sin(YAW)];
const WALL_Y = [Math.sin(PITCH) * Math.sin(YAW), Math.cos(PITCH), Math.sin(PITCH) * Math.cos(YAW)];
const WALL_N = [Math.cos(PITCH) * Math.sin(YAW), -Math.sin(PITCH), Math.cos(PITCH) * Math.cos(YAW)];

// The studio the tiles reflect: a key soft box behind the camera, a wide panel
// light overhead and a warm bounce from the floor. Tiles that tip back catch
// the panel; tiles that tip forward catch the floor.
const studioLight = (name, direction, color) => {
  const c = norm(direction);
  const x = norm(cross([0, 1, 0], c));
  return `const ${name} = ${vec3(c)};
const ${name}_X = ${vec3(x)};
const ${name}_Y = ${vec3(cross(c, x))};
const ${name}_COLOR = ${vec3(color)};
`;
};

const COMMON = /* wgsl */ `
struct U {
  eye: vec3f, aspect: f32,
  right: vec3f, focal: f32,
  up: vec3f, cycle: f32,
  forward: vec3f, time: f32,
  wallX: vec3f, unit: f32,
  wallY: vec3f, half: f32,
  wallN: vec3f, thick: f32,
  pointer: vec2f, pointerAmt: f32, boltLight: f32,
  boltCenter: vec2f, pad0: f32, pad1: f32,
};

fn onWall(p: vec2f, lift: f32) -> vec3f {
  return u.wallX * p.x + u.wallY * p.y + u.wallN * lift;
}

fn project(w: vec3f) -> vec4f {
  let r = w - u.eye;
  let z = dot(r, u.forward);
  return vec4f(dot(r, u.right) * u.focal / u.aspect, dot(r, u.up) * u.focal, (z - ${NEAR}) * ${FAR / (FAR - NEAR)}, z);
}
`;

const TILES = /* wgsl */ `${COMMON}
struct Tile { pos: vec2f, sweep: f32, bolt: f32, dist: f32, along: f32, seed: f32, pad0: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> tiles: array<Tile>;

const PI: f32 = 3.14159265;
const BEAT: f32 = ${BEAT};
const SWEEP_AT: f32 = ${SWEEP_AT};
const SWEEP_LEN: f32 = ${SWEEP_LEN};
const STRIKE_AT: f32 = ${STRIKE_AT};
const ERASE_AT: f32 = ${ERASE_AT};
const ERASE_LEN: f32 = ${ERASE_LEN};
const WAVE_SPEED: f32 = ${WAVE_SPEED};
const SPIN_BAND: f32 = 0.22; // head heights from the bolt
${studioLight('KEY', [-0.3, 0.36, 0.88], [5, 4.8, 4.5])}
${studioLight('PANEL', [-0.1, 0.87, 0.48], [3.4, 3.5, 3.7])}
${studioLight('WARM', [-0.15, -0.45, 0.88], [1.2, 0.32, 0.1])}

fn hash(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

fn rand(x: u32) -> f32 {
  return f32(hash(x) >> 8u) / 16777216.0;
}

// A flap's step from 0 to 1, starting when a = 0: a lightly damped spring, so
// it snaps over and settles with one small bounce.
fn snap(a: f32) -> f32 {
  if (a <= 0.0) {
    return 0.0;
  }
  let w = 24.0;
  let z = 0.55;
  let wd = w * sqrt(1.0 - z * z);
  return 1.0 - exp(-z * w * a) * (cos(wd * a) + z * w / wd * sin(wd * a));
}

// A tile spinning right round, from 0 to 1 turn: a slower, softer spring.
fn spin(a: f32) -> f32 {
  if (a <= 0.0) {
    return 0.0;
  }
  let w = 13.0;
  let z = 0.6;
  let wd = w * sqrt(1.0 - z * z);
  return 1.0 - exp(-z * w * a) * (cos(wd * a) + z * w / wd * sin(wd * a));
}

// A knock: the same spring struck rather than stepped. It swings to 1, back
// past 0 a little and settles within half a second.
fn knock(a: f32) -> f32 {
  if (a <= 0.0) {
    return 0.0;
  }
  return exp(-5.0 * a) * sin(8.66 * a) / 0.473;
}

// The tile's turn about its own horizontal axis (x) and its lean about its
// vertical one (y) at cycle time c. A positive turn tips its top toward the
// camera.
fn turn(t: Tile, i: u32, c: f32) -> vec2f {
  var a = 0.0;
  var b = 0.0;
  // The groove drops out while the strike's wave crosses the wall.
  let groove = 1.0 - smoothstep(STRIKE_AT - 0.3, STRIKE_AT, c) * (1.0 - smoothstep(STRIKE_AT + 2.0, STRIKE_AT + 3.0, c));
  // Kicks on beats one and three ring out from the bolt, tipping tiles back
  // into the panel light; the bar's downbeat hits hardest.
  let r = length(t.pos - u.boltCenter) / u.unit;
  let kick = floor(c / (2.0 * BEAT));
  for (var k = 0.0; k < 2.0; k += 1.0) {
    let n = kick - k;
    let age = c - n * 2.0 * BEAT;
    if (n >= 0.0) {
      let ring = exp(-pow((r - 0.2 - age * 1.7) / 0.14, 2.0)) * exp(-age * 1.2) * (1.0 - exp(-age * 14.0));
      a -= ring * select(0.2, 0.32, n % 2.0 == 0.0) * groove;
    }
  }
  // Hi-hats: on every eighth note a few tiles glint in the panel light.
  let eighth = floor(c / (0.5 * BEAT));
  if (rand(hash(i) ^ (u32(eighth) * 0x85ebca6bu)) < 0.002) {
    a -= 0.45 * max(knock(c - eighth * 0.5 * BEAT), 0.0) * groove;
  }
  let swept = SWEEP_AT + t.sweep * SWEEP_LEN;
  if (t.bolt > 0.5) {
    // The bolt's tiles flip to their orange faces as the sweep passes, and
    // flip on round again in bar six, top to bottom on sixteenth notes.
    let erase = ERASE_AT + floor(t.along * 8.0) / 8.0 * ERASE_LEN;
    a += PI * (snap(c - swept) + snap(c - erase));
  } else {
    // Every other tile tips back into the overhead panel's light as the sweep
    // passes, so the sweep is a bar of light.
    a -= 0.45 * (snap(c - swept) - snap(c - swept - 0.2));
    // The strike's wave runs out from the bolt, so its front keeps the bolt's
    // zig-zag: tiles near the bolt spin right round, and farther out they
    // knock back into the panel light, less the farther they are.
    let hit = c - STRIKE_AT - t.dist / WAVE_SPEED;
    if (t.dist < SPIN_BAND) {
      a += 2.0 * PI * spin(hit);
    } else {
      a -= 1.1 * exp(-(t.dist - SPIN_BAND) / 0.7) * knock(hit);
    }
  }
  if (u.pointerAmt > 0.0) {
    let d = (t.pos - u.pointer) / u.unit;
    let fall = exp(-dot(d, d) / 0.05) * u.pointerAmt * 0.5;
    a += clamp(d.y * 4.0, -1.0, 1.0) * fall;
    b -= clamp(d.x * 4.0, -1.0, 1.0) * fall;
  }
  return vec2f(a, b);
}

// How brightly the bolt's orange faces glow: barely while written, warming as
// the strike nears; the lightning lights them white-hot and they cool to
// embers.
fn glow(t: Tile, c: f32) -> f32 {
  let swept = SWEEP_AT + t.sweep * SWEEP_LEN;
  let charge = smoothstep(swept, STRIKE_AT, c) * step(c, STRIKE_AT);
  let after = select(0.0, exp(-(c - STRIKE_AT) / 1.2), c >= STRIKE_AT);
  return 0.06 + 0.3 * charge * charge + 1.6 * after + u.boltLight * 2.5;
}

struct TOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) side: vec3f,
  @location(3) rise: vec3f,
  @location(4) uv: vec2f,
  @location(5) @interpolate(flat) face: u32,
  @location(6) @interpolate(flat) look: vec4f,
};

// One box per tile: its front (face 0), its back (1) and four thin edges.
@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> TOut {
  let t = tiles[i];
  var quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let q = quad[v % 6u];
  let face = v / 6u;
  let h = u.half;
  let d = u.thick;
  var p = vec3f(q * h, d);
  var n = vec3f(0.0, 0.0, 1.0);
  switch face {
    case 1u: { p = vec3f(q * h, -d); n = vec3f(0.0, 0.0, -1.0); }
    case 2u: { p = vec3f(h, q.x * h, q.y * d); n = vec3f(1.0, 0.0, 0.0); }
    case 3u: { p = vec3f(-h, q.x * h, q.y * d); n = vec3f(-1.0, 0.0, 0.0); }
    case 4u: { p = vec3f(q.x * h, h, q.y * d); n = vec3f(0.0, 1.0, 0.0); }
    case 5u: { p = vec3f(q.x * h, -h, q.y * d); n = vec3f(0.0, -1.0, 0.0); }
    default: {}
  }
  let ab = turn(t, i, u.cycle);
  let ca = cos(ab.x);
  let sa = sin(ab.x);
  let cb = cos(ab.y);
  let sb = sin(ab.y);
  // The tile's own turn (about x, then y), then the wall's.
  let m = mat3x3f(u.wallX, u.wallY, u.wallN) *
    mat3x3f(vec3f(cb, 0.0, -sb), vec3f(sb * sa, ca, cb * sa), vec3f(sb * ca, -sa, cb * ca));
  let world = onWall(t.pos, 0.0) + m * p;
  var o: TOut;
  o.clip = project(world);
  o.world = world;
  o.normal = m * n;
  o.side = m[0];
  o.rise = m[1];
  o.uv = q;
  o.face = face;
  o.look = vec4f(t.bolt, select(0.0, glow(t, u.cycle), t.bolt > 0.5), t.seed, t.dist);
  return o;
}

fn softbox(r: vec3f, c: vec3f, x: vec3f, y: vec3f, size: vec2f, soft: f32) -> f32 {
  let k = dot(r, c);
  if (k <= 0.0) {
    return 0.0;
  }
  let q = abs(vec2f(dot(r, x), dot(r, y)) / k) - size;
  return (1.0 - smoothstep(-soft, soft, q.x)) * (1.0 - smoothstep(-soft, soft, q.y));
}

// The studio seen along r; a rougher surface sees it softer and dimmer.
fn env(r: vec3f, rough: f32) -> vec3f {
  let soft = 0.02 + rough * 0.6;
  let dim = 1.0 / (1.0 + rough * 4.0);
  var e = mix(vec3f(0.0012, 0.0013, 0.0016), vec3f(0.008, 0.0085, 0.01), smoothstep(-0.6, 0.9, r.y));
  e += KEY_COLOR * softbox(r, KEY, KEY_X, KEY_Y, vec2f(0.12, 0.07), soft) * dim;
  e += PANEL_COLOR * softbox(r, PANEL, PANEL_X, PANEL_Y, vec2f(1.6, 0.3), soft) * dim;
  e += WARM_COLOR * softbox(r, WARM, WARM_X, WARM_Y, vec2f(0.5, 0.22), soft + 0.2);
  return e;
}

fn irradiance(n: vec3f) -> vec3f {
  return KEY_COLOR * max(dot(n, KEY), 0.0) * 0.08 + WARM_COLOR * max(dot(n, WARM), 0.0) * 0.2 + vec3f(0.004);
}

@fragment
fn fs(in: TOut) -> @location(0) vec4f {
  var n = normalize(in.normal);
  let seed = in.look.z;
  if (in.face < 2u) {
    // A chamfer round each face: the normal leans out toward the nearest
    // edge, so each tile's top edge catches the panel light overhead.
    let e = abs(in.uv);
    let edge = smoothstep(0.8, 1.0, max(e.x, e.y));
    let out = select(vec2f(0.0, sign(in.uv.y)), vec2f(sign(in.uv.x), 0.0), e.x > e.y);
    n = normalize(n + (normalize(in.side) * out.x + normalize(in.rise) * out.y) * edge * 0.5);
  }
  var f0 = vec3f(0.62, 0.6, 0.57); // the edges: brushed steel
  var rough = 0.3;
  var albedo = vec3f(0.0);
  var emit = vec3f(0.0);
  if (in.face == 0u) {
    // The front: glossy black glass, each tile a little different, so the
    // studio's reflection breaks up across them.
    f0 = vec3f(0.04) * (0.8 + 0.4 * seed);
    rough = 0.08 + 0.08 * seed;
  } else if (in.face == 1u && in.look.x > 0.5) {
    // The bolt's back: satin orange enamel, glowing.
    f0 = vec3f(0.02);
    rough = 0.22;
    albedo = vec3f(1.0, 0.09, 0.033) * 0.5;
    let g = in.look.y;
    emit = vec3f(1.0, 0.16, 0.05) * g + vec3f(1.0, 0.75, 0.55) * max(g - 1.6, 0.0) * 0.8;
  } else if (in.face == 1u) {
    // Every other back: polished champagne metal.
    f0 = vec3f(0.8, 0.74, 0.66);
    rough = 0.2 + 0.1 * seed;
  }
  let v = normalize(u.eye - in.world);
  let nv = max(dot(n, v), 1e-3);
  let fr = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  var c = env(reflect(-v, n), rough) * fr + albedo * irradiance(n) * (1.0 - fr) + emit;
  // The lightning lights the tiles around it.
  c += vec3f(1.0, 0.62, 0.42) * u.boltLight * exp(-in.look.w / 0.15) * (0.08 + fr.x);
  return vec4f(c, 1.0);
}
`;

const BOLTS = /* wgsl */ `${COMMON}
struct Seg { a: vec2f, b: vec2f, width: f32, glow: f32, pad0: f32, pad1: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> segs: array<Seg>;

struct BOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec2f,
  @location(1) @interpolate(flat) seg: u32,
};

// One quad per segment on the wall, just in front of the tiles, wide enough
// for its glow.
@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) s: u32) -> BOut {
  let seg = segs[s];
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let c = corners[v];
  let len = length(seg.b - seg.a);
  let dir = (seg.b - seg.a) / max(len, 1e-6);
  let r = seg.width * seg.glow;
  let world = seg.a + dir * mix(-r, len + r, c.x) + vec2f(-dir.y, dir.x) * mix(-r, r, c.y);
  var o: BOut;
  o.clip = project(onWall(world, u.thick * 4.0));
  o.world = world;
  o.seg = s;
  return o;
}

@fragment
fn fs(in: BOut) -> @location(0) vec4f {
  let seg = segs[in.seg];
  let ab = seg.b - seg.a;
  let k = clamp(dot(in.world - seg.a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  let d = length(in.world - (seg.a + ab * k));
  let core = exp(-pow(d / seg.width, 2.0));
  let glow = exp(-d / (seg.width * seg.glow * 0.25));
  let c = vec3f(1.0, 0.96, 0.92) * core * 6.0 + vec3f(1.0, 0.38, 0.16) * glow * 1.2;
  return vec4f(c * u.boltLight, 1.0);
}
`;

const FULLSCREEN = /* wgsl */ `
struct FOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };

@vertex
fn vs(@builtin(vertex_index) v: u32) -> FOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  let p = corners[v];
  var o: FOut;
  o.clip = vec4f(p, 0.0, 1.0);
  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return o;
}
`;

const BLUR = /* wgsl */ `${FULLSCREEN}
struct PassU { texel: vec2f, dir: vec2f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> pu: PassU;

// Four bilinear taps: a 4x4 box, for the quarter-size bloom target.
@fragment
fn down(in: FOut) -> @location(0) vec4f {
  let t = pu.texel;
  var c = textureSample(src, samp, in.uv + t * vec2f(-1.0, -1.0)).rgb;
  c += textureSample(src, samp, in.uv + t * vec2f(1.0, -1.0)).rgb;
  c += textureSample(src, samp, in.uv + t * vec2f(-1.0, 1.0)).rgb;
  c += textureSample(src, samp, in.uv + t * vec2f(1.0, 1.0)).rgb;
  return vec4f(c * 0.25, 1.0);
}

// A 9-tap Gaussian in five linear fetches, along pu.dir.
@fragment
fn blur(in: FOut) -> @location(0) vec4f {
  let o1 = pu.dir * 1.3846153846;
  let o2 = pu.dir * 3.2307692308;
  var c = textureSample(src, samp, in.uv).rgb * 0.2270270270;
  c += (textureSample(src, samp, in.uv + o1).rgb + textureSample(src, samp, in.uv - o1).rgb) * 0.3162162162;
  c += (textureSample(src, samp, in.uv + o2).rgb + textureSample(src, samp, in.uv - o2).rgb) * 0.0702702703;
  return vec4f(c, 1.0);
}
`;

const COMPOSITE = /* wgsl */ `${COMMON}${FULLSCREEN}
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: U;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: FOut) -> @location(0) vec4f {
  var c = textureSample(scene, samp, in.uv).rgb + textureSample(bloom, samp, in.uv).rgb * 0.7;
  let q = in.uv - 0.5;
  c *= 1.0 - dot(q, q) * 0.9;
  c = pow(aces(c), vec3f(1.0 / 2.2));
  let n = fract(sin(dot(in.clip.xy + fract(u.time) * 97.0, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(c + (n - 0.5) * 0.02, 1.0);
}
`;

function keepStill(reason) {
  root.dataset.backdrop = 'still';
  console.warn(`brainstrike.ai backdrop: ${reason}; showing the still image.`);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    throw new Error(`${label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
  return module;
}

// The point of a polyline nearest p: its distance, and how far along the line
// it lies.
function nearest(line, p) {
  let best = { d: Number.POSITIVE_INFINITY, s: 0 };
  let run = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1];
    const dx = line[i][0] - ax;
    const dy = line[i][1] - ay;
    const length = Math.hypot(dx, dy);
    const k = Math.min(Math.max(((p[0] - ax) * dx + (p[1] - ay) * dy) / (length * length), 0), 1);
    const d = Math.hypot(p[0] - ax - dx * k, p[1] - ay - dy * k);
    if (d < best.d) {
      best = { d, s: run + k * length };
    }
    run += length;
  }
  return { ...best, length: run };
}

// Midpoint displacement: each pass splits every segment and pushes the new
// point sideways by up to `amplitude` of the segment's length.
function jagged(points, amplitude, depth) {
  let line = points;
  let amp = amplitude;
  for (let level = 0; level < depth; level += 1) {
    const next = [line[0]];
    for (let i = 1; i < line.length; i += 1) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay) || 1e-6;
      const off = (Math.random() - 0.5) * amp * len;
      next.push([(ax + bx) / 2 - ((by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], line[i]);
    }
    line = next;
    amp *= 0.62;
  }
  return line;
}

function branchFrom(line, count, width) {
  const branches = [];
  for (let n = 0; n < count; n += 1) {
    const k = 2 + Math.floor(Math.random() * (line.length - 4));
    const [ax, ay] = line[k];
    const [bx, by] = line[k + 1];
    const heading = Math.atan2(by - ay, bx - ax) + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5);
    const len = 0.12 + Math.random() * 0.25;
    const end = [ax + Math.cos(heading) * len, ay + Math.sin(heading) * len];
    branches.push({ points: jagged([[ax, ay], end], 0.45, 4), width });
  }
  return branches;
}

// A camera looking at the wall from DISTANCE, moved by (dx, dy).
function camera(dx, dy) {
  const eye = [dx, dy, DISTANCE];
  const forward = norm([-0.6 * dx, -0.6 * dy, -DISTANCE]);
  const right = norm(cross(forward, [0, 1, 0]));
  return { eye, forward, right, up: cross(right, forward) };
}

const REST = camera(0, 0);

// The camera drifts slowly, for a little parallax.
const cameraAt = (t) => camera(Math.sin(t * 0.23) * 0.09, Math.sin(t * 0.17 + 1) * 0.05);

// Lightning flickers: three quick flashes over a fading afterglow.
const boltLight = (age) => {
  if (age < 0 || age > 1.6) {
    return 0;
  }
  let v = 0.35 * Math.exp(-age / 0.4);
  for (const flash of [0, 0.075, 0.2]) {
    if (age >= flash) {
      v += Math.exp(-(age - flash) / 0.045);
    }
  }
  return v;
};

async function start() {
  if (!(canvas && still)) {
    return;
  }
  if (!navigator.gpu) {
    keepStill('this browser has no WebGPU');
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    keepStill('no WebGPU adapter is available');
    return;
  }
  const device = await adapter.requestDevice();
  let raf = 0;
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') {
      cancelAnimationFrame(raf);
      raf = 0;
      keepStill(`the GPU device was lost (${info.message})`);
    }
  });
  device.addEventListener('uncapturederror', (event) => {
    console.error('brainstrike.ai backdrop:', event.error.message);
  });

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ alphaMode: 'opaque', device, format });

  const BUFFER = GPUBufferUsage;
  const { FRAGMENT, VERTEX } = GPUShaderStage;
  const f32 = new Float32Array(UNIFORM_FLOATS);
  const uniforms = device.createBuffer({ size: f32.byteLength, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
  const segments = device.createBuffer({ size: MAX_SEGMENTS * 32, usage: BUFFER.STORAGE | BUFFER.COPY_DST });

  const drawLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: VERTEX | FRAGMENT },
      { binding: 1, buffer: { type: 'read-only-storage' }, visibility: VERTEX | FRAGMENT },
    ],
  });
  const [tileModule, boltModule, blurModule, compositeModule] = await Promise.all([
    compile(device, TILES, 'tiles'),
    compile(device, BOLTS, 'bolts'),
    compile(device, BLUR, 'bloom'),
    compile(device, COMPOSITE, 'composite'),
  ]);
  const HDR = 'rgba16float';
  const DEPTH = 'depth24plus';
  const additive = {
    alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
    color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
  };
  const drawPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] });
  const fullscreen = (module, entryPoint, targetFormat) =>
    device.createRenderPipelineAsync({
      fragment: { entryPoint, module, targets: [{ format: targetFormat }] },
      layout: 'auto',
      vertex: { entryPoint: 'vs', module },
    });
  const [tilePipeline, boltPipeline, downPipeline, blurPipeline, compositePipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'less', depthWriteEnabled: true, format: DEPTH },
      fragment: { entryPoint: 'fs', module: tileModule, targets: [{ format: HDR }] },
      layout: drawPipelineLayout,
      multisample: { count: SAMPLES },
      vertex: { entryPoint: 'vs', module: tileModule },
    }),
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'always', depthWriteEnabled: false, format: DEPTH },
      fragment: { entryPoint: 'fs', module: boltModule, targets: [{ blend: additive, format: HDR }] },
      layout: drawPipelineLayout,
      multisample: { count: SAMPLES },
      vertex: { entryPoint: 'vs', module: boltModule },
    }),
    fullscreen(blurModule, 'down', HDR),
    fullscreen(blurModule, 'blur', HDR),
    fullscreen(compositeModule, 'fs', format),
  ]);

  const bind = (layout, buffers) =>
    device.createBindGroup({ entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })), layout });
  const boltGroup = bind(drawLayout, [uniforms, segments]);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const passUniforms = [0, 1, 2].map(() =>
    device.createBuffer({ size: 16, usage: BUFFER.UNIFORM | BUFFER.COPY_DST })
  );

  // Screen state: render size, the wall's tiles and bolt, and the render
  // targets.
  let width = 0;
  let height = 0;
  let aspect = 1;
  let wall = null;
  let tiles = null;
  let textures = [];
  let views = null;

  // Where the ray through a point on screen (in NDC) meets the wall, in the
  // wall's own coordinates.
  function toWall(cam, x, y) {
    const dir = add(add(cam.forward, cam.right, (x * aspect) / FOCAL), cam.up, y / FOCAL);
    const p = add(cam.eye, dir, -dot(cam.eye, WALL_N) / dot(dir, WALL_N));
    return [dot(p, WALL_X), dot(p, WALL_Y)];
  }

  // Where a point on the wall is on screen, in NDC.
  function toScreen(cam, [x, y]) {
    const r = add(add(WALL_X.map((v) => v * x), WALL_Y, y), cam.eye, -1);
    const z = dot(r, cam.forward);
    return [(dot(r, cam.right) * FOCAL) / aspect / z, (dot(r, cam.up) * FOCAL) / z];
  }

  function layout() {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, DPR_CAP, Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)));
    width = Math.max(1, Math.round(cssWidth * dpr));
    height = Math.max(1, Math.round(cssHeight * dpr));
    aspect = cssWidth / cssHeight;
    canvas.width = width;
    canvas.height = height;

    // The bolt goes where CSS lays out the still mark.
    const box = still.getBoundingClientRect();
    const fromIcon = ([x, y]) =>
      toWall(
        REST,
        ((box.left + (x / 1024) * box.width) / cssWidth) * 2 - 1,
        1 - ((box.top + (y / 1024) * box.height) / cssHeight) * 2
      );
    const path = SPLIT.map(fromIcon);
    const crown = fromIcon([512, 0]);
    const chin = fromIcon([512, 1024]);
    const unit = Math.hypot(crown[0] - chin[0], crown[1] - chin[1]);
    const center = fromIcon([512, 470]);
    const corners = [
      [-1.15, -1.15],
      [1.15, -1.15],
      [-1.15, 1.15],
      [1.15, 1.15],
    ].map(([x, y]) => toWall(REST, x, y));
    const [minX, maxX] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))];
    const [minY, maxY] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))];

    // Tiles are a fiftieth of the head's height, from 9 to 18 CSS pixels.
    const pxPerUnit = ((cssHeight / 2) * FOCAL) / DISTANCE;
    const pitch = Math.max(
      Math.min(Math.max(box.height / 50, 9), 18) / pxPerUnit,
      Math.sqrt(((maxX - minX) * (maxY - minY)) / MAX_TILES)
    );
    // The bolt is three or so tiles wide, and tapers at its ends.
    const boltHalf = Math.max(unit * 0.03, pitch * 1.2);
    const [x0, y0] = [
      center[0] + Math.floor((minX - center[0]) / pitch) * pitch,
      center[1] + Math.floor((minY - center[1]) / pitch) * pitch,
    ];
    const cols = Math.ceil((maxX - x0) / pitch) + 1;
    const rows = Math.ceil((maxY - y0) / pitch) + 1;
    const data = new Float32Array(cols * rows * 8);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const p = [x0 + col * pitch, y0 + row * pitch];
        const bolt = nearest(path, p);
        const taper = 0.4 + 0.6 * smoothstep(0, bolt.length * 0.15, Math.min(bolt.s, bolt.length - bolt.s));
        const [nx] = toScreen(REST, p);
        data.set(
          [...p, (nx + 1) / 2, bolt.d < boltHalf * taper ? 1 : 0, bolt.d / unit, bolt.s / bolt.length, Math.random(), 0],
          (row * cols + col) * 8
        );
      }
    }
    tiles?.buffer.destroy();
    const buffer = device.createBuffer({ size: data.byteLength, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    tiles = { buffer, count: cols * rows, group: bind(drawLayout, [uniforms, buffer]) };
    wall = { bottom: minY, center, half: pitch * 0.46, path, thick: pitch * 0.06, top: maxY, unit };

    for (const texture of textures) {
      texture.destroy();
    }
    textures = [];
    const target = (w, h, targetFormat, sampleCount) => {
      const texture = device.createTexture({
        format: targetFormat,
        sampleCount,
        size: [w, h],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0),
      });
      textures.push(texture);
      return texture.createView();
    };
    const bw = Math.max(1, Math.floor(width / 4));
    const bh = Math.max(1, Math.floor(height / 4));
    const scene = target(width, height, HDR, 1);
    const bloomA = target(bw, bh, HDR, 1);
    const bloomB = target(bw, bh, HDR, 1);
    // The bloom's tap step is a share of the head's size, so a phone's small
    // head glows as tightly as a large one; it never widens past 1.6 texels,
    // where the 9-tap blur would start to leave gaps.
    const spread = Math.min(((box.height / cssHeight) * height) / 700, 1.6);
    device.queue.writeBuffer(passUniforms[0], 0, new Float32Array([1 / width, 1 / height, 0, 0]));
    device.queue.writeBuffer(passUniforms[1], 0, new Float32Array([0, 0, spread / bw, 0]));
    device.queue.writeBuffer(passUniforms[2], 0, new Float32Array([0, 0, 0, spread / bh]));
    const pass = (pipeline, view, uniform) =>
      device.createBindGroup({
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: uniform } },
        ],
        layout: pipeline.getBindGroupLayout(0),
      });
    views = {
      bloomA,
      bloomB,
      blurH: pass(blurPipeline, bloomA, passUniforms[1]),
      blurV: pass(blurPipeline, bloomB, passUniforms[2]),
      composite: device.createBindGroup({
        entries: [
          { binding: 0, resource: scene },
          { binding: 1, resource: bloomA },
          { binding: 2, resource: sampler },
          { binding: 3, resource: { buffer: uniforms } },
        ],
        layout: compositePipeline.getBindGroupLayout(0),
      }),
      depth: target(width, height, DEPTH, SAMPLES),
      down: pass(downPipeline, scene, passUniforms[0]),
      msaa: target(width, height, HDR, SAMPLES),
      scene,
    };
  }

  // The strike's lightning: from the sky, down the bolt, out under it.
  let drawn = 0;

  function strike() {
    const inside = wall.path;
    const [tx, ty] = inside[0];
    const up = [tx - inside[1][0], ty - inside[1][1]];
    const sky = [tx + (up[0] / up[1]) * (wall.top - ty), wall.top];
    const last = inside.at(-1);
    const down = [last[0] - inside.at(-2)[0], last[1] - inside.at(-2)[1]];
    const ground = [last[0] + (down[0] / -down[1]) * (last[1] - wall.bottom), wall.bottom];
    const main = [
      ...jagged([sky, inside[0]], 0.3, 5),
      ...jagged(inside, 0.05, 3).slice(1),
      ...jagged([last, ground], 0.3, 5).slice(1),
    ];
    const lines = [
      { points: main, width: 0.0032 },
      ...branchFrom(main.slice(0, 33), 2, 0.0018),
      ...branchFrom(main.slice(-33), 2, 0.0018),
    ];
    const data = new Float32Array(MAX_SEGMENTS * 8);
    drawn = 0;
    for (const { points, width: w } of lines) {
      for (let i = 1; i < points.length && drawn < MAX_SEGMENTS; i += 1) {
        data.set([...points[i - 1], ...points[i], w, 14], drawn * 8);
        drawn += 1;
      }
    }
    device.queue.writeBuffer(segments, 0, data, 0, drawn * 8);
  }

  const pointer = { amount: 0, at: -10, inside: false, wall: null, x: 0, y: 0 };

  function writeUniforms(t, c, light, cam) {
    f32.set(cam.eye, 0);
    f32[3] = aspect;
    f32.set(cam.right, 4);
    f32[7] = FOCAL;
    f32.set(cam.up, 8);
    f32[11] = c;
    f32.set(cam.forward, 12);
    f32[15] = t;
    f32.set(WALL_X, 16);
    f32[19] = wall.unit;
    f32.set(WALL_Y, 20);
    f32[23] = wall.half;
    f32.set(WALL_N, 24);
    f32[27] = wall.thick;
    f32.set(pointer.wall ?? [0, 0], 28);
    f32[30] = pointer.amount;
    f32[31] = light;
    f32.set(wall.center, 32);
    device.queue.writeBuffer(uniforms, 0, f32);
  }

  function encode(lightning) {
    const encoder = device.createCommandEncoder();
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [
        { clearValue: [0, 0, 0, 1], loadOp: 'clear', resolveTarget: views.scene, storeOp: 'discard', view: views.msaa },
      ],
      depthStencilAttachment: { depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard', view: views.depth },
    });
    scenePass.setPipeline(tilePipeline);
    scenePass.setBindGroup(0, tiles.group);
    scenePass.draw(36, tiles.count);
    if (lightning) {
      scenePass.setPipeline(boltPipeline);
      scenePass.setBindGroup(0, boltGroup);
      scenePass.draw(6, drawn);
    }
    scenePass.end();
    const post = (pipeline, group, view) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ loadOp: 'clear', storeOp: 'store', view }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    post(downPipeline, views.down, views.bloomA);
    post(blurPipeline, views.blurH, views.bloomB);
    post(blurPipeline, views.blurV, views.bloomA);
    post(compositePipeline, views.composite, context.getCurrentTexture().createView());
    device.queue.submit([encoder.finish()]);
  }

  // One frame for reduced motion: the bolt written on the wall after its
  // strike, still glowing.
  function drawStill() {
    writeUniforms(START, STRIKE_AT + 2, 0, REST);
    encode(false);
  }

  let elapsed = 0;
  let last = 0;
  let struck = -1;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    elapsed += dt;
    const t = START + elapsed;
    const c = t % CYCLE;
    if (c >= STRIKE_AT && struck !== Math.floor(t / CYCLE)) {
      struck = Math.floor(t / CYCLE);
      strike();
    }
    const light = c >= STRIKE_AT ? boltLight(c - STRIKE_AT) : 0;
    const cam = cameraAt(t);
    // The pointer's pull eases in as it moves and out a second after it stops.
    const idle = (performance.now() - pointer.at) / 1000;
    const pull = pointer.inside ? 1 - smoothstep(1.2, 2, idle) : 0;
    pointer.amount += (pull - pointer.amount) * (1 - Math.exp(-dt * 6));
    const aim = toWall(cam, (pointer.x / innerWidth) * 2 - 1, 1 - (pointer.y / innerHeight) * 2);
    pointer.wall = pointer.wall ? pointer.wall.map((v, k) => v + (aim[k] - v) * (1 - Math.exp(-dt * 10))) : aim;
    writeUniforms(t, c, light, cam);
    encode(light > 0.002);
    raf = requestAnimationFrame(frame);
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (reducedMotion.matches) {
      drawStill();
    } else if (!document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  layout();
  run();
  device.queue.onSubmittedWorkDone().then(() => {
    if (root.dataset.backdrop !== 'still') {
      root.dataset.backdrop = 'live';
    }
  });

  new ResizeObserver(() => {
    layout();
    if (reducedMotion.matches) {
      drawStill();
    }
  }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  reducedMotion.addEventListener('change', run);
  addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.at = performance.now();
    pointer.inside = true;
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });
}

start().catch((error) => {
  keepStill(`it failed to start (${error.message})`);
});
