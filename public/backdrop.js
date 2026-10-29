// The playable backdrop of brainstrike.ai, drawn with WebGPU.
//
// One fragment shader ray-marches the whole scene: a glass core that changes
// shape every four bars, five shards orbiting it, a field of chrome shards and
// a hexagonal tunnel of neon rings streaming past at 128 BPM. Every eight bars
// the scene moves to its next area and colors. A bloom pass and a composite
// pass add glow, chromatic aberration, glitch tears and grain.
//
// The visitor plays it: drag to orbit, scroll or pinch to zoom, click the core
// to change its shape, click anywhere else to strike lightning there, and
// press and drag the core to pull it out like taffy. Strikes land on the next
// sixteenth note. With sound on (synth.js), the same clock plays the music.
//
// Without WebGPU, or when it fails, the page keeps its still backdrop and the
// console says why. Reduced motion draws one frame and takes no input. A
// hidden tab stops the loop and the sound.

import { createSynth } from './synth.js';

const canvas = document.querySelector('canvas.backdrop');
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const BPM = 128;
const BEAT = 60 / BPM;
const FORM_BEATS = 16; // the core changes shape every four bars
const AREA_BEATS = 32; // and the scene changes area every eight
const FORMS = 5;
const FOCAL = 1.9;
const DPR_CAP = 1.5;
const UNIFORM_FLOATS = 88;

// Each area's three colors, in linear RGB; the shader cycles through them.
const AREAS = [
  { colors: [[0.1, 0.9, 1], [0.45, 0.2, 1], [1, 0.2, 0.75]], name: 'Signal' },
  { colors: [[0.6, 1, 0.25], [0, 0.8, 0.7], [0.25, 0.5, 1]], name: 'Bloom' },
  { colors: [[1, 0.35, 0.3], [1, 0.75, 0.2], [1, 0.3, 0.65]], name: 'Solar' },
  { colors: [[0.6, 0.45, 1], [0.8, 0.95, 1], [1, 0.5, 0.8]], name: 'Euphoria' },
];

const COMMON = /* wgsl */ `
struct U {
  res: vec2f, time: f32, beat: f32,
  eye: vec3f, kick: f32,
  right: vec3f, focal: f32,
  up: vec3f, glitch: f32,
  fwd: vec3f, flight: f32,
  shift: vec2f, morph: f32, formA: f32,
  formB: f32, wave: f32, boltLight: f32, slice: f32,
  grabA: vec3f, grab: f32,
  grabB: vec3f, steps: f32,
  colA: vec4f, colB: vec4f, colC: vec4f, flash: vec4f,
  bolt: array<vec4f, 9>,
};
@group(0) @binding(0) var<uniform> u: U;

const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;

fn hash11(x: f32) -> f32 {
  return fract(sin(x * 91.3458) * 47453.5453);
}

fn hash31(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn rot(a: f32) -> mat2x2f {
  let c = cos(a);
  let s = sin(a);
  return mat2x2f(c, s, -s, c);
}

// The area's colors as a loop: 0, 1/3 and 2/3 are its three colors.
fn pal(t: f32) -> vec3f {
  let f = fract(t) * 3.0;
  let k = smoothstep(0.0, 1.0, fract(f));
  let i = floor(f);
  let a = select(select(u.colC.xyz, u.colB.xyz, i < 1.5), u.colA.xyz, i < 0.5);
  let b = select(select(u.colA.xyz, u.colC.xyz, i < 1.5), u.colB.xyz, i < 0.5);
  return mix(a, b, k);
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

const SCENE = /* wgsl */ `${COMMON}${FULLSCREEN}
const TUNNEL: f32 = 11.5;
const RING_GAP: f32 = 6.0;
const CELL: f32 = 2.6;
const FAR: f32 = 48.0;

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdOcta(p: vec3f, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y + q.z - s) * 0.57735027;
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  return length(vec2f(length(p.xz) - t.x, p.y)) - t.y;
}

fn sdBoxFrame(p0: vec3f, b: vec3f, e: f32) -> f32 {
  let p = abs(p0) - b;
  let q = abs(p + e) - e;
  return min(
    min(
      length(max(vec3f(p.x, q.y, q.z), vec3f(0.0))) + min(max(p.x, max(q.y, q.z)), 0.0),
      length(max(vec3f(q.x, p.y, q.z), vec3f(0.0))) + min(max(q.x, max(p.y, q.z)), 0.0)
    ),
    length(max(vec3f(q.x, q.y, p.z), vec3f(0.0))) + min(max(q.x, max(q.y, p.z)), 0.0)
  );
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn sdHex(p0: vec2f, r: f32) -> f32 {
  let k = vec3f(-0.866025404, 0.5, 0.577350269);
  var p = abs(p0);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

fn gyroid(p: vec3f) -> f32 {
  return dot(sin(p), cos(p.yzx));
}

// The core's five shapes, each about two and a half units across: a
// breathing blob, an octahedron, a torus, a wire cube and a gyroid lattice
// inside a sphere.
fn form(i: i32, p: vec3f) -> f32 {
  switch i {
    case 0: {
      return (length(p) - 1.15 - 0.09 * gyroid(p * 3.2 + u.time * 0.8)) * 0.8;
    }
    case 1: {
      return sdOcta(p, 1.65) - 0.04;
    }
    case 2: {
      return sdTorus(p, vec2f(1.05, 0.32));
    }
    case 3: {
      return sdBoxFrame(p, vec3f(0.92), 0.07) - 0.02;
    }
    default: {
      return max(length(p) - 1.3, (abs(gyroid(p * 3.6)) / 3.6 - 0.07) * 0.8);
    }
  }
}

fn core(p0: vec3f) -> f32 {
  let s = 1.0 + 0.07 * u.kick;
  var p = p0 / s;
  let xz = rot(u.time * 0.31) * vec2f(p.x, p.z);
  p = vec3f(xz.x, p.y, xz.y);
  let yz = rot(u.time * 0.19) * vec2f(p.y, p.z);
  p = vec3f(p.x, yz.x, yz.y);
  // While it changes shape, the core tears into sliding bands.
  let band = floor(p.y * 9.0 + u.time * 13.0);
  p.x += (hash11(band) - 0.5) * 0.6 * u.slice;
  var d = mix(form(i32(u.formA), p), form(i32(u.formB), p), u.morph) * s;
  if (u.grab > 0.001) {
    // Pulled out like taffy: a tendril to the pointer, thinner as it stretches.
    let stretch = clamp(distance(u.grabA, u.grabB) / 3.2, 0.0, 1.0);
    d = smin(d, sdCapsule(p0, u.grabA, u.grabB, mix(0.34, 0.1, stretch) * u.grab), 0.5 * u.grab + 0.001);
  }
  return d;
}

fn orbiters(p: vec3f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < 5; i++) {
    let f = f32(i);
    let a = u.time * (0.45 + f * 0.11) + f * 1.2566;
    var c = vec3f(cos(a) * 2.6, 0.0, sin(a) * 2.6);
    let tilt = rot(f * 0.7 - 1.0) * vec2f(c.y, c.z);
    c = vec3f(c.x, tilt.x, tilt.y);
    var q = p - c;
    let spin = rot(u.time * 1.3 + f) * q.xy;
    q = vec3f(spin, q.z);
    d = min(d, sdOcta(q, 0.24 + 0.1 * u.kick));
  }
  return d;
}

// A field of chrome shards between the core and the tunnel, streaming past.
// x is the distance, y the shard's random tag.
fn shards(p0: vec3f) -> vec2f {
  let p = vec3f(p0.xy, p0.z - u.flight);
  let id = floor(p / CELL + 0.5);
  let q = p - id * CELL;
  let h = hash31(id);
  // Never step past a neighbor's shard: none reaches more than 0.5 from the
  // middle of its cell.
  let safe = CELL - 0.5 - max(abs(q.x), max(abs(q.y), abs(q.z)));
  let rad = length(id.xy * CELL);
  if (rad < 3.8 || rad > 9.8 || h < 0.55) {
    return vec2f(safe, h);
  }
  let a = rot(u.time * (0.6 + h) + h * 6.0) * q.xy;
  var r = vec3f(a, q.z);
  let b = rot(u.time * 0.8 + h * 3.0) * vec2f(r.y, r.z);
  r = vec3f(r.x, b.x, b.y);
  return vec2f(min(sdOcta(r, 0.2 + 0.3 * fract(h * 7.3)), safe), h);
}

// The tunnel's neon rings; y is the ring's index.
fn rings(p0: vec3f) -> vec2f {
  let z = p0.z - u.flight;
  let cell = floor(z / RING_GAP + 0.5);
  let xy = rot(cell * 0.35 + u.time * 0.05) * p0.xy;
  let d = length(vec2f(sdHex(xy, TUNNEL + sin(cell * 1.7) * 0.7), z - cell * RING_GAP)) - 0.035;
  return vec2f(d, cell);
}

// Six rails of light along the tunnel.
fn rails(p: vec3f) -> f32 {
  let sector = round(atan2(p.y, p.x) / (TAU / 6.0));
  let xy = rot(-sector * TAU / 6.0) * p.xy;
  return length(xy - vec2f(TUNNEL * 1.22, 0.0)) - 0.02;
}

fn bolt(p: vec3f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < 8; i++) {
    d = min(d, sdCapsule(p, u.bolt[i].xyz, u.bolt[i + 1].xyz, 0.01));
  }
  return d;
}

fn solids(p: vec3f) -> f32 {
  return min(orbiters(p), shards(p).x);
}

fn coreNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.0015, -0.0015);
  return normalize(
    e.xyy * core(p + e.xyy) + e.yyx * core(p + e.yyx) + e.yxy * core(p + e.yxy) + e.xxx * core(p + e.xxx)
  );
}

fn solidNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.0015, -0.0015);
  return normalize(
    e.xyy * solids(p + e.xyy) + e.yyx * solids(p + e.yyx) + e.yxy * solids(p + e.yxy) + e.xxx * solids(p + e.xxx)
  );
}

// Deep space in the area's colors: a slow nebula and a few stars.
fn sky(rd: vec3f) -> vec3f {
  let n = sin(rd.x * 3.1 + u.time * 0.05) * sin(rd.y * 4.3 - u.time * 0.04) * sin(rd.z * 2.7 + 1.3) +
    0.5 * sin(rd.x * 7.9 - rd.z * 5.1 + u.time * 0.08) * sin(rd.y * 8.3 + rd.x * 3.0);
  var c = mix(u.colB.xyz * 0.008, pal(0.3 + n * 0.25 + rd.y * 0.2) * 0.12, smoothstep(-0.3, 1.4, n));
  let g = rd * 150.0;
  let h = hash31(floor(g));
  c += vec3f(step(0.996, h) * smoothstep(0.45, 0.0, length(fract(g) - 0.5)) * (0.5 + 0.5 * sin(u.time * 3.0 + h * 50.0)));
  return c;
}

// What a mirror sees: the sky, the tunnel's rings sweeping past and a light
// overhead.
fn env(r: vec3f) -> vec3f {
  let sweep = smoothstep(0.9, 1.0, sin(r.z * 7.0 + u.flight * 1.1));
  return sky(r) * 2.0 + pal(r.z * 0.3 + u.beat * 0.02) * sweep * 0.7 +
    vec3f(1.0) * pow(max(dot(r, normalize(vec3f(0.3, 0.9, 0.4))), 0.0), 30.0) * 2.5;
}

fn shadeCore(p: vec3f, rd: vec3f) -> vec3f {
  let n = coreNormal(p);
  let nv = clamp(dot(n, -rd), 0.0, 1.0);
  let fres = pow(1.0 - nv, 3.0);
  // Thin film: the hue shifts with the angle the surface is seen at.
  let film = pal(nv * 1.4 + u.beat * 0.03 + 0.15);
  let through = sky(refract(rd, n, 0.7)) * 3.0 + film * 0.12;
  let mirror = env(reflect(rd, n)) * mix(vec3f(0.3), film, 0.7);
  // Veins of light drift through the glass and flare on every kick.
  let veins = pow(abs(sin(gyroid(p * 4.5 + u.time * 0.5) * 3.0)), 24.0);
  let glow = film * (0.05 + 0.7 * u.kick + veins * (0.2 + 1.2 * u.kick)) * (1.0 - fres);
  return through * film * (1.0 - fres) + mirror * (0.35 + 1.6 * fres) + glow;
}

fn shadeSolid(p: vec3f, rd: vec3f, tag: f32) -> vec3f {
  let n = solidNormal(p);
  let fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 4.0);
  let tint = pal(tag * 3.0 + u.beat * 0.05);
  return env(reflect(rd, n)) * mix(tint, vec3f(1.0), 0.35) * (0.7 + 1.4 * fres) + tint * 0.06;
}

@fragment
fn march(in: FOut) -> @location(0) vec4f {
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let aspect = u.res.x / u.res.y;
  let rd = normalize(u.fwd * u.focal + u.right * (ndc.x * aspect + u.shift.x) + u.up * (ndc.y + u.shift.y));
  let ro = u.eye;
  var t = 0.0;
  var glow = vec3f(0.0);
  var hit = 0;
  var tag = 0.0;
  var ring = 0.0;
  let striking = u.boltLight > 0.01;
  for (var i = 0; i < 128; i++) {
    if (f32(i) >= u.steps) {
      break;
    }
    let p = ro + rd * t;
    let dc = core(p);
    let dob = orbiters(p);
    let sh = shards(p);
    let rg = rings(p);
    let dr = rails(p);
    let solid = min(min(dc, dob), min(sh.x, min(rg.x, dr)));
    // The lightning only glows; rays slow down near it but pass through.
    var db = 1e9;
    var d = solid;
    if (striking) {
      db = bolt(p);
      d = min(d, max(db, 0.012));
    }
    let adv = max(d * 0.8, 0.004);
    // A pulse runs down the tunnel's rings on every bar.
    let flash = exp(-fract(u.beat * 0.25 - rg.y * 0.0625) * 5.0);
    glow += pal(rg.y * 0.13 + u.beat * 0.02) * (0.5 + 2.5 * flash) * exp(-rg.x * 22.0) * adv * 1.6;
    glow += pal(atan2(p.y, p.x) * 0.16 + 0.5) * exp(-dr * 26.0) * adv * 0.7;
    glow += pal(0.5 + u.beat * 0.01) * exp(-max(dc, 0.0) * 3.0) * adv * (0.012 + 0.05 * u.kick);
    if (u.wave > 0.0) {
      let shell = abs(length(p) - u.wave);
      glow += pal(0.8) * exp(-shell * 9.0) * adv * 0.12 * exp(-u.wave * 0.15);
    }
    if (striking) {
      glow += (vec3f(1.0, 0.95, 1.0) * exp(-db * 40.0) * 2.4 + pal(0.6) * exp(-db * 5.0) * 0.14) * adv * u.boltLight;
    }
    if (solid < 0.0008 + 0.0012 * t) {
      if (solid == dc) {
        hit = 1;
      } else if (solid == dob) {
        hit = 2;
      } else if (solid == sh.x) {
        hit = 2;
        tag = sh.y;
      } else if (solid == rg.x) {
        hit = 3;
        ring = rg.y;
      } else {
        hit = 4;
      }
      break;
    }
    t += adv;
    if (t > FAR) {
      break;
    }
  }
  let p = ro + rd * t;
  var c = sky(rd);
  if (hit == 1) {
    c = shadeCore(p, rd);
  } else if (hit == 2) {
    c = shadeSolid(p, rd, tag);
  } else if (hit == 3) {
    c = pal(ring * 0.13 + u.beat * 0.02) * 3.0;
  } else if (hit == 4) {
    c = pal(atan2(p.y, p.x) * 0.16 + 0.5) * 2.0;
  }
  if (hit > 0) {
    c = mix(c, sky(rd), 1.0 - exp(-max(t - 5.0, 0.0) * 0.04));
  }
  c += glow + u.flash.xyz * u.flash.w;
  return vec4f(c, 1.0);
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
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: FOut) -> @location(0) vec4f {
  var uv = in.uv;
  let g = u.glitch;
  // Glitch: rows of the picture tear sideways, a new set thirty times a second.
  let row = floor(uv.y * 40.0);
  let frame = floor(u.time * 30.0);
  if (hash11(row + frame * 7.0) > 1.0 - g * 0.5) {
    uv.x += (hash11(row * 3.1 + frame) - 0.5) * 0.14 * g;
  }
  // Chromatic aberration, wider toward the edges and in a glitch.
  let off = (uv - 0.5) * (0.004 + g * 0.03);
  var c = vec3f(
    textureSample(scene, samp, uv - off).r,
    textureSample(scene, samp, uv).g,
    textureSample(scene, samp, uv + off).b
  );
  c += textureSample(bloom, samp, uv).rgb * 0.9;
  c *= 1.0 - g * 0.12 * (0.5 + 0.5 * sin(in.clip.y * 2.1));
  let q = in.uv - 0.5;
  c *= 1.0 - dot(q, q) * 0.7;
  c = pow(aces(c), vec3f(1.0 / 2.2));
  let n = fract(sin(dot(in.clip.xy + fract(u.time) * 97.0, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(c + (n - 0.5) * 0.025, 1.0);
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
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (length(a) || 1));
const mixColor = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    throw new Error(`${label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
  return module;
}

// A camera on a sphere round the core, looking at it, rolled a little.
function orbitCamera(yaw, pitch, distance, roll) {
  const eye = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  const fwd = norm(scale(eye, -1));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  return { eye, fwd, right: add(scale(right, c), up, s), up: add(scale(up, c), right, -s) };
}

// Lightning between two points: a jagged line of nine points.
function lightning(from, to) {
  const span = length(add(to, from, -1));
  const points = [];
  for (let i = 0; i <= 8; i += 1) {
    const k = i / 8;
    const jitter = i === 0 || i === 8 ? 0 : span * 0.09;
    const wobble = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    points.push(add(add(scale(from, 1 - k), to, k), wobble, jitter));
  }
  return points;
}

// Lightning flickers: three quick flashes over a fading afterglow.
const flicker = (age) => {
  if (age < 0 || age > 0.9) {
    return 0;
  }
  let v = 0.3 * Math.exp(-age / 0.25);
  for (const at of [0, 0.06, 0.16]) {
    if (age >= at) {
      v += Math.exp(-(age - at) / 0.04);
    }
  }
  return v;
};

async function start() {
  if (!canvas) {
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
  const synth = createSynth(BPM);
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') {
      cancelAnimationFrame(raf);
      raf = 0;
      synth.stop();
      keepStill(`the GPU device was lost (${info.message})`);
    }
  });
  device.addEventListener('uncapturederror', (event) => {
    console.error('brainstrike.ai backdrop:', event.error.message);
  });

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ alphaMode: 'opaque', device, format });

  const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  // The scene renders at a share of the canvas, which steps down if the GPU
  // cannot keep up; the composite pass scales it up.
  let renderScale = small ? 0.42 : 0.55;
  const steps = small ? 80 : 110;

  const f32 = new Float32Array(UNIFORM_FLOATS);
  const uniforms = device.createBuffer({ size: f32.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const [sceneModule, blurModule, compositeModule] = await Promise.all([
    compile(device, SCENE, 'scene'),
    compile(device, BLUR, 'bloom'),
    compile(device, COMPOSITE, 'composite'),
  ]);
  const HDR = 'rgba16float';
  const pipeline = (module, entryPoint, targetFormat) =>
    device.createRenderPipelineAsync({
      fragment: { entryPoint, module, targets: [{ format: targetFormat }] },
      layout: 'auto',
      vertex: { entryPoint: 'vs', module },
    });
  const [scenePipeline, downPipeline, blurPipeline, compositePipeline] = await Promise.all([
    pipeline(sceneModule, 'march', HDR),
    pipeline(blurModule, 'down', HDR),
    pipeline(blurModule, 'blur', HDR),
    pipeline(compositeModule, 'fs', format),
  ]);
  const sceneGroup = device.createBindGroup({
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
    layout: scenePipeline.getBindGroupLayout(0),
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const passUniforms = [0, 1, 2].map(() =>
    device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  );

  let width = 0;
  let height = 0;
  let aspect = 1;
  let textures = [];
  let views = null;
  // Where the core sits on screen, in NDC: right of the copy on a wide
  // screen, above it on a narrow one.
  let coreAt = [0.42, 0.02];

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
    width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    aspect = canvas.clientWidth / canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    coreAt = innerWidth <= 760 ? [0, 0.42] : [0.42, 0.02];
    for (const texture of textures) {
      texture.destroy();
    }
    textures = [];
    const target = (w, h) => {
      const texture = device.createTexture({
        format: HDR,
        size: [Math.max(1, w), Math.max(1, h)],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      textures.push(texture);
      return texture.createView();
    };
    const sw = Math.max(1, Math.round(width * renderScale));
    const sh = Math.max(1, Math.round(height * renderScale));
    const bw = Math.max(1, Math.floor(sw / 4));
    const bh = Math.max(1, Math.floor(sh / 4));
    const scene = target(sw, sh);
    const bloomA = target(bw, bh);
    const bloomB = target(bw, bh);
    device.queue.writeBuffer(passUniforms[0], 0, new Float32Array([1 / sw, 1 / sh, 0, 0]));
    device.queue.writeBuffer(passUniforms[1], 0, new Float32Array([0, 0, 1.6 / bw, 0]));
    device.queue.writeBuffer(passUniforms[2], 0, new Float32Array([0, 0, 0, 1.6 / bh]));
    const pass = (pipe, view, uniform) =>
      device.createBindGroup({
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: uniform } },
        ],
        layout: pipe.getBindGroupLayout(0),
      });
    views = {
      bloomA,
      bloomB,
      blurH: pass(blurPipeline, bloomA, passUniforms[1]),
      blurV: pass(blurPipeline, bloomB, passUniforms[2]),
      composite: device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: scene },
          { binding: 2, resource: bloomA },
          { binding: 3, resource: sampler },
        ],
        layout: compositePipeline.getBindGroupLayout(0),
      }),
      down: pass(downPipeline, scene, passUniforms[0]),
      scene,
    };
  }

  // Everything the visitor and the clock move.
  const state = {
    camera: { distance: 7, pitch: 0.12, pitchVel: 0, targetDistance: 7, yaw: 0.55, yawVel: 0 },
    // The core's shape: it morphs from `from` to `to`, starting at `at`.
    form: { at: -10, duration: BEAT, from: 0, to: 0 },
    glitch: 0,
    // The tendril pulled out of the core: its base, its springy tip, and the
    // point the tip chases while it is held.
    grab: { amount: 0, base: [0, 0, 0], depth: 0, held: false, target: [0, 0, 0], tip: [0, 0, 0], tipVel: [0, 0, 0] },
    hover: [0, 0],
    kickBoost: 0,
    lastArea: -1,
    lastBeat: -1,
    lastFormBlock: 0,
    pending: [],
    strike: { at: -10, points: lightning([0, 0, 0], [0, 0, 1]) },
    wave: -10,
  };
  const pointer = { inside: false, ndc: [0, 0] };
  let dragging = null;
  let camera = orbitCamera(state.camera.yaw, state.camera.pitch, state.camera.distance, 0);
  let elapsed = 0;

  const ndcOf = (clientX, clientY) => [(clientX / innerWidth) * 2 - 1, 1 - (clientY / innerHeight) * 2];
  const rayThrough = ([x, y]) =>
    norm(add(add(scale(camera.fwd, FOCAL), camera.right, (x - coreAt[0]) * aspect), camera.up, y - coreAt[1]));
  // How far along a ray from the eye it meets the core's bounding sphere, or
  // null if it misses.
  const hitCore = (dir) => {
    const b = dot(camera.eye, dir);
    const disc = b * b - (dot(camera.eye, camera.eye) - 1.25 * 1.25);
    return disc < 0 ? null : -b - Math.sqrt(disc);
  };

  function morphTo(next, t, duration) {
    const f = state.form;
    if (t - f.at < f.duration) {
      return;
    }
    state.form = { at: t, duration, from: f.to, to: next % FORMS };
  }

  // A click away from the core strikes lightning toward it on the next
  // sixteenth note.
  function queueStrike(dir, t) {
    const sixteenth = BEAT / 4;
    const at = Math.ceil(t / sixteenth + 0.001) * sixteenth;
    state.pending.push({ at, dir });
    synth.strike(at);
  }

  function fire(strike, t) {
    const far = add(camera.eye, strike.dir, 16);
    state.strike = { at: t, points: lightning(scale(norm(far), 1.15), far) };
    state.wave = t;
    state.glitch = Math.max(state.glitch, 0.55);
    state.kickBoost = 1;
  }

  function writeUniforms(t) {
    const beat = t / BEAT;
    const area = Math.floor(beat / AREA_BEATS);
    const inArea = beat - area * AREA_BEATS;
    const toNext = smoothstep(AREA_BEATS - 2, AREA_BEATS, inArea);
    const colors = AREAS[area % AREAS.length].colors.map((c, i) =>
      mixColor(c, AREAS[(area + 1) % AREAS.length].colors[i], toNext)
    );
    const kick = Math.max(Math.exp(-(beat % 1) * 6) * (beat % 4 < 1 ? 1 : 0.7), state.kickBoost);
    const f = state.form;
    const morph = smoothstep(0, 1, clamp((t - f.at) / f.duration, 0, 1));
    const waveAge = t - state.wave;
    f32.set([width, height, t, beat], 0);
    f32.set([...camera.eye, kick], 4);
    f32.set([...camera.right, FOCAL], 8);
    f32.set([...camera.up, state.glitch], 12);
    f32.set([...camera.fwd, t * 7.5], 16);
    f32.set([-coreAt[0] * aspect, -coreAt[1], morph, f.from], 20);
    f32.set([f.to, waveAge < 1.6 ? waveAge * 13 : -1, flicker(t - state.strike.at), Math.sin(Math.PI * morph)], 24);
    f32.set([...state.grab.base, state.grab.amount], 28);
    f32.set([...state.grab.tip, steps], 32);
    f32.set([...colors[0], 0, ...colors[1], 0, ...colors[2], 0], 36);
    // A flash of the new area's first color as the scene moves on.
    f32.set([...colors[0], Math.max(0, 1 - Math.abs(inArea - 0.15) * 3) * (area > 0 ? 0.08 : 0)], 48);
    state.strike.points.forEach((p, i) => f32.set([...p, 0], 52 + i * 4));
    device.queue.writeBuffer(uniforms, 0, f32);
    return area;
  }

  function encode() {
    const encoder = device.createCommandEncoder();
    const draw = (pipe, group, view) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ loadOp: 'clear', storeOp: 'store', view }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    draw(scenePipeline, sceneGroup, views.scene);
    draw(downPipeline, views.down, views.bloomA);
    draw(blurPipeline, views.blurH, views.bloomB);
    draw(blurPipeline, views.blurV, views.bloomA);
    draw(compositePipeline, views.composite, context.getCurrentTexture().createView());
    device.queue.submit([encoder.finish()]);
  }

  // The page's readouts: the area, the bar and beat, and a pulse on the beat.
  const hud = {
    area: document.querySelector('[data-area]'),
    count: document.querySelector('[data-count]'),
    pulse: document.querySelector('[data-pulse]'),
    reticle: document.querySelector('.reticle'),
  };

  function updateHud(area, beat) {
    const whole = Math.floor(beat);
    if (whole === state.lastBeat) {
      return;
    }
    state.lastBeat = whole;
    if (hud.count) {
      hud.count.textContent = `${String(Math.floor(whole / 4) % 100).padStart(2, '0')}.${(whole % 4) + 1}`;
    }
    if (hud.area && area !== state.lastArea) {
      state.lastArea = area;
      hud.area.textContent = `Area ${String((area % AREAS.length) + 1).padStart(2, '0')} · ${AREAS[area % AREAS.length].name}`;
    }
    for (const el of [hud.pulse, hud.reticle]) {
      el?.animate([{ scale: 1.5 }, { scale: 1 }], { duration: BEAT * 700, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  }

  function step(dt) {
    elapsed += dt;
    const t = elapsed;
    const beat = t / BEAT;
    const cam = state.camera;

    // The clock's own moves: a new shape every four bars, with a glitch, and
    // a push in and a roll as each area begins.
    const block = Math.floor(beat / FORM_BEATS);
    if (block !== state.lastFormBlock) {
      state.lastFormBlock = block;
      morphTo(state.form.to + 1, t, BEAT);
      state.glitch = Math.max(state.glitch, block % 2 === 0 ? 0.9 : 0.35);
    }
    const punch = beat > AREA_BEATS ? Math.exp(-(beat % AREA_BEATS) * 1.2) : 0;

    for (const strike of state.pending.filter((s) => s.at <= t)) {
      fire(strike, t);
    }
    state.pending = state.pending.filter((s) => s.at > t);

    // Orbit: the drag's momentum, a slow drift and a lean toward the pointer.
    if (!dragging) {
      cam.yaw += cam.yawVel * dt;
      cam.pitch += cam.pitchVel * dt;
      cam.yawVel *= Math.exp(-dt * 2.5);
      cam.pitchVel *= Math.exp(-dt * 2.5);
    }
    cam.yaw += dt * 0.06;
    cam.pitch = clamp(cam.pitch + (0.12 - cam.pitch) * dt * 0.2, -1.2, 1.2);
    cam.distance += (cam.targetDistance - cam.distance) * (1 - Math.exp(-dt * 6));
    state.hover = state.hover.map((v, i) => v + ((pointer.inside ? pointer.ndc[i] : 0) - v) * (1 - Math.exp(-dt * 3)));
    camera = orbitCamera(
      cam.yaw + state.hover[0] * 0.18,
      clamp(cam.pitch - state.hover[1] * 0.12, -1.25, 1.25),
      cam.distance * (1 - 0.28 * punch),
      Math.sin(t * 0.13) * 0.06 + punch * 0.4
    );

    // The tendril's tip is a spring: it chases the pointer while held and
    // wobbles home when let go.
    const g = state.grab;
    if (g.held) {
      g.target = add(camera.eye, rayThrough(pointer.ndc), g.depth);
      const reach = add(g.target, g.base, -1);
      if (length(reach) > 3.2) {
        g.target = add(g.base, norm(reach), 3.2);
      }
    }
    g.tipVel = add(scale(g.tipVel, Math.exp(-dt * 9)), add(g.target, g.tip, -1), 140 * dt);
    g.tip = add(g.tip, g.tipVel, dt);
    const home = length(add(g.tip, g.base, -1)) < 0.08 && length(g.tipVel) < 0.3;
    g.amount += ((g.held || !home ? 1 : 0) - g.amount) * (1 - Math.exp(-dt * (g.held ? 14 : 5)));

    state.glitch *= Math.exp(-dt * 4.5);
    state.kickBoost *= Math.exp(-dt * 6);
    const area = writeUniforms(t);
    updateHud(area, beat);
    synth.update(t, area);
  }

  let last = 0;
  const slowFrames = [];
  let downgrades = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt);
    encode();
    // The scene's resolution steps down at most three times if the GPU
    // cannot keep up.
    slowFrames.push(dt);
    if (slowFrames.length === 90) {
      slowFrames.sort((a, b) => a - b);
      if (slowFrames[45] > 1 / 45 && downgrades < 3) {
        renderScale *= 0.8;
        downgrades += 1;
        layout();
      }
      slowFrames.length = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  // One frame for reduced motion: a moment just after a strike, held.
  function drawStill() {
    elapsed = AREA_BEATS * BEAT * 0.5;
    state.strike = { at: elapsed - 0.12, points: lightning([0.9, 0.5, 0.5], [9, 4, -6]) };
    writeUniforms(elapsed);
    encode();
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (reducedMotion.matches) {
      synth.stop();
      drawStill();
    } else if (document.hidden) {
      synth.pause();
    } else {
      synth.resume();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // Input. The page's own controls and text keep their pointer.
  const pinch = new Map();
  const isUi = (target) =>
    target instanceof Element && Boolean(target.closest('a, button, dialog, .hero, .notes-card, .top, .foot'));
  const live = () => !reducedMotion.matches && root.dataset.backdrop === 'live';

  addEventListener('pointermove', (event) => {
    pointer.ndc = ndcOf(event.clientX, event.clientY);
    pointer.inside = true;
    if (hud.reticle) {
      hud.reticle.style.translate = `${event.clientX}px ${event.clientY}px`;
      const aim = live() && !isUi(event.target) && event.pointerType !== 'touch';
      root.dataset.aim = aim ? (hitCore(rayThrough(pointer.ndc)) === null ? 'on' : 'core') : '';
    }
    if (pinch.has(event.pointerId) && pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [c, d] = [...pinch.values()];
      const after = Math.hypot(c.x - d.x, c.y - d.y);
      state.camera.targetDistance = clamp(state.camera.targetDistance * (before / Math.max(after, 1)), 3.2, 12);
      return;
    }
    if (!dragging || dragging.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    const ms = Math.max(event.timeStamp - dragging.time, 8);
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    dragging.time = event.timeStamp;
    if (dragging.mode === 'orbit') {
      const cam = state.camera;
      cam.yaw -= dx * 0.006;
      cam.pitch = clamp(cam.pitch + dy * 0.005, -1.2, 1.2);
      cam.yawVel = ((-dx * 0.006) / ms) * 500;
      cam.pitchVel = ((dy * 0.005) / ms) * 500;
    }
  });
  addEventListener('pointerdown', (event) => {
    if (!live() || isUi(event.target) || event.button !== 0) {
      return;
    }
    pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.size > 1) {
      dragging = null;
      state.grab.held = false;
      state.grab.target = state.grab.base;
      return;
    }
    pointer.ndc = ndcOf(event.clientX, event.clientY);
    const dir = rayThrough(pointer.ndc);
    const depth = hitCore(dir);
    dragging = {
      id: event.pointerId,
      mode: depth === null ? 'orbit' : 'grab',
      moved: 0,
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
    root.dataset.dragging = '';
    if (depth !== null) {
      const g = state.grab;
      const surface = add(camera.eye, dir, depth);
      g.base = scale(surface, 0.8);
      g.depth = depth;
      g.held = true;
      if (g.amount < 0.05) {
        g.tip = surface;
        g.tipVel = [0, 0, 0];
      }
      g.target = surface;
    }
  });
  const release = (event) => {
    pinch.delete(event.pointerId);
    if (!dragging || dragging.id !== event.pointerId) {
      return;
    }
    const t = elapsed;
    if (dragging.moved < 6) {
      // A click: on the core it changes shape, anywhere else lightning strikes.
      if (dragging.mode === 'grab') {
        morphTo(state.form.to + 1, t, 0.35);
        state.glitch = Math.max(state.glitch, 0.6);
        state.kickBoost = 1;
        synth.morph(t);
      } else {
        queueStrike(rayThrough(ndcOf(event.clientX, event.clientY)), t);
      }
    }
    if (dragging.mode === 'grab') {
      state.grab.held = false;
      state.grab.target = state.grab.base;
      if (dragging.moved >= 6) {
        synth.snap(t);
      }
    }
    dragging = null;
    delete root.dataset.dragging;
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  addEventListener(
    'wheel',
    (event) => {
      if (!live() || (event.target instanceof Element && event.target.closest('dialog'))) {
        return;
      }
      state.camera.targetDistance = clamp(state.camera.targetDistance * Math.exp(event.deltaY * 0.0012), 3.2, 12);
    },
    { passive: true }
  );
  root.addEventListener('pointerleave', () => {
    pointer.inside = false;
    root.dataset.aim = '';
  });

  // The sound switch: off until the visitor turns it on.
  const sound = document.querySelector('[data-sound]');
  sound?.addEventListener('click', async () => {
    const on = await synth.toggle(elapsed);
    sound.setAttribute('aria-pressed', String(on));
    sound.querySelector('[data-sound-label]').textContent = on ? 'Sound on' : 'Sound off';
  });

  layout();
  writeUniforms(0);
  run();
  device.queue.onSubmittedWorkDone().then(() => {
    if (root.dataset.backdrop !== 'still') {
      root.dataset.backdrop = 'live';
      if (sound && !reducedMotion.matches) {
        sound.hidden = false;
      }
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
}

start().catch((error) => {
  keepStill(`it failed to start (${error.message})`);
});
