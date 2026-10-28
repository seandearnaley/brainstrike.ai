// Neural storm: the animated backdrop of brainstrike.ai, drawn with WebGPU.
//
// A compute shader moves up to about a million particles through a curl-noise
// flow field. Every 15 seconds they gather into the Brainstrike head, a bolt
// strikes down the split in the head, and they scatter again; smaller bolts
// strike while they drift, and the pointer stirs the field. Particles and
// bolts add into a half-float target, then a bloom and tone-map pass draws the
// canvas.
//
// The head comes from the page's still mark (.still-mark): its two outlines
// are sampled into target points, and the particles gather where the mark is
// laid out, so CSS alone decides where the head sits.
//
// Without WebGPU, or when it fails, the page keeps its still backdrop and the
// console says why. Reduced motion draws one formed frame. A hidden tab stops
// the loop.

const canvas = document.querySelector('canvas.backdrop');
const still = document.querySelector('.still-mark');
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const CYCLE = 15; // seconds: drift, gather, strike, hold, scatter
const START = 3; // the first cycle starts here, so the head forms within ~5 s
const TARGETS = 1 << 16;
const MAX_SEGMENTS = 512;
const IMPULSE_SEGMENTS = 24;
const DPR_CAP = 1.5;
const UNIFORM_FLOATS = 20 + IMPULSE_SEGMENTS * 4;

// The bolt-shaped split between the head's two halves, in the icon's
// 1024-unit coordinates (assets/icons/icon.svg in the brainstrike repo).
const SPLIT = [
  [626, 140],
  [414, 440],
  [557, 442],
  [346, 769],
];

const COMMON = /* wgsl */ `
struct U {
  time: f32, dt: f32, aspect: f32, gather: f32,
  pointer: vec2f, pointerActive: f32, scatter: f32,
  strike: f32, segCount: u32, headScale: f32, count: u32,
  headCenter: vec2f, intensity: f32, boltIntensity: f32,
  flash: f32, pad0: f32, pad1: f32, pad2: f32,
  segs: array<vec4f, ${IMPULSE_SEGMENTS}>,
};
struct Particle { pos: vec2f, vel: vec2f, heat: f32, rim: f32, pad0: f32, pad1: f32 };
`;

const SIMULATE = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> targets: array<vec4f>;

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

fn lattice(c: vec2f) -> vec2f {
  let i = vec2i(c);
  let h = hash((bitcast<u32>(i.x) * 0x8da6b343u) ^ (bitcast<u32>(i.y) * 0xd8163841u));
  let a = f32(h) * (6.2831853 / 4294967296.0);
  return vec2f(cos(a), sin(a));
}

// One simplex corner: its value and gradient.
fn corner(d: vec2f, i: vec2f) -> vec3f {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) {
    return vec3f(0.0);
  }
  let g = lattice(i);
  let gd = dot(g, d);
  let t2 = t * t;
  let t4 = t2 * t2;
  return vec3f(t4 * gd, t4 * g - 8.0 * t2 * t * gd * d);
}

// 2D simplex noise: value in x, gradient in yz.
fn simplex(p: vec2f) -> vec3f {
  let F2 = 0.36602540378;
  let G2 = 0.21132486540;
  let i = floor(p + (p.x + p.y) * F2);
  let x0 = p - (i - (i.x + i.y) * G2);
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
  let x1 = x0 - o + G2;
  let x2 = x0 - 1.0 + 2.0 * G2;
  return (corner(x0, i) + corner(x1, i + o) + corner(x2, i + 1.0)) * 70.0;
}

// The curl of two octaves of noise: a divergence-free flow, so the field never
// clumps while it drifts.
fn flow(p: vec2f, t: f32) -> vec2f {
  let a = simplex(p * 1.15 + vec2f(t * 0.031, -t * 0.019));
  let b = simplex(p * 2.9 + vec2f(-t * 0.047, t * 0.041) + vec2f(17.3, -4.1));
  let g = a.yz * 1.15 + b.yz * (2.9 * 0.32);
  return vec2f(g.y, -g.x);
}

@compute @workgroup_size(256)
fn seed(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) {
    return;
  }
  let h = hash(i * 2654435761u + 1u);
  var p: Particle;
  p.pos = (vec2f(rand(h), rand(h ^ 0x9e3779b9u)) * 2.0 - 1.0) * vec2f(u.aspect, 1.0);
  p.vel = vec2f(0.0);
  p.heat = 0.0;
  p.rim = 0.0;
  p.pad0 = 0.0;
  p.pad1 = 0.0;
  particles[i] = p;
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) {
    return;
  }
  var p = particles[i];
  let dt = u.dt;
  let h = hash(i * 747796405u + 2891336453u);
  let tgt = targets[h % arrayLength(&targets)];
  let jitter = vec2f(rand(h ^ 0x68e31da4u), rand(h ^ 0xb5297a4du)) - 0.5;
  let home = u.headCenter + (tgt.xy + jitter * 0.006) * u.headScale;

  let f = flow(p.pos, u.time) * 0.06;
  // Drifting, velocity relaxes toward the flow; gathered, a slightly
  // underdamped spring holds each particle at home with a little flow left in.
  let free = (f - p.vel) * 1.4;
  let spring = (home - p.pos) * 22.0 - p.vel * 7.0 + f * 3.0;
  var acc = mix(free, spring, u.gather);

  if (u.pointerActive > 0.0) {
    let r = p.pos - u.pointer;
    let fall = exp(-dot(r, r) / 0.03) * u.pointerActive;
    acc += (vec2f(-r.y, r.x) * 4.0 + r * 1.2) * fall;
  }

  if (u.scatter > 0.0) {
    let away = p.pos - u.headCenter;
    acc += normalize(away + 1e-5) * u.scatter * (0.6 + rand(h ^ 0x1b873593u)) * 3.0;
  }

  var heat = p.heat * exp(-dt * 1.8);
  if (u.strike > 0.0) {
    var best = 1e9;
    var push = vec2f(0.0);
    for (var s = 0u; s < u.segCount; s++) {
      let seg = u.segs[s];
      let ab = seg.zw - seg.xy;
      let k = clamp(dot(p.pos - seg.xy, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      let r = p.pos - (seg.xy + ab * k);
      let d2 = dot(r, r);
      if (d2 < best) {
        best = d2;
        push = r;
      }
    }
    acc += normalize(push + 1e-6) * exp(-best / 0.0025) * u.strike * 18.0;
    heat = max(heat, exp(-best / 0.006) * u.strike);
  }

  p.vel += acc * dt;
  p.pos += p.vel * dt;
  p.heat = heat;
  p.rim = tgt.z;

  // Strays respawn anywhere on screen.
  if (any(abs(p.pos) > vec2f(u.aspect + 0.25, 1.25))) {
    let r = hash(h ^ bitcast<u32>(u.time));
    p.pos = (vec2f(rand(r), rand(r ^ 0x85ebca6bu)) * 2.0 - 1.0) * vec2f(u.aspect, 1.0);
    p.vel = vec2f(0.0);
  }
  particles[i] = p;
}
`;

const PARTICLES = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VOut { @builtin(position) clip: vec4f, @location(0) color: vec3f };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = particles[i];
  let speed = clamp(length(p.vel) * 2.2, 0.0, 1.0);
  let metal = mix(vec3f(0.26, 0.27, 0.30), vec3f(0.80, 0.82, 0.88), speed);
  // Gathered, the field is about five times denser, so each particle dims:
  // the rim stays bright metal and the core goes dark, as in the icon.
  let lit = metal * mix(0.6, p.rim * 0.85, u.gather);
  let hot = vec3f(1.0, 0.32, 0.14) * p.heat * 4.0 + vec3f(1.0, 0.86, 0.72) * p.heat * p.heat * 3.0;
  var o: VOut;
  o.clip = vec4f(p.pos.x / u.aspect, p.pos.y, 0.0, 1.0);
  o.color = (lit + hot) * u.intensity;
  return o;
}

@fragment
fn fs(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(color, 1.0);
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

// One quad per segment, wide enough for its glow.
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
  o.clip = vec4f(world.x / u.aspect, world.y, 0.0, 1.0);
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
  return vec4f(c * u.boltIntensity, 1.0);
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
  var c = textureSample(scene, samp, in.uv).rgb + textureSample(bloom, samp, in.uv).rgb * 0.9;
  // The strike lights the whole room for a moment.
  c += vec3f(1.0, 0.42, 0.22) * u.flash * 0.06;
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

// Samples the head's outlines into target points (x, y in [-1, 1], glow).
// The metal rim and the outline glow; the dark core inside stays dim.
function sampleTargets(headPath, rimPath) {
  const size = 512;
  const surface =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { height: size, width: size });
  const g = surface.getContext('2d', { willReadFrequently: true });
  const alpha = (d, rule) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.setTransform(size / 1024, 0, 0, size / 1024, 0, 0);
    g.fill(new Path2D(d), rule);
    return g.getImageData(0, 0, size, size).data;
  };
  const head = alpha(headPath, 'nonzero');
  const rim = alpha(rimPath, 'evenodd');
  const inHead = (x, y) => x >= 0 && y >= 0 && x < size && y < size && head[(y * size + x) * 4 + 3] > 127;
  const pools = { body: [], edge: [], rim: [] };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const a = (y * size + x) * 4 + 3;
      if (rim[a] > 127) {
        pools.rim.push(x, y);
      }
      if (head[a] > 127) {
        const edge = !(inHead(x + 1, y) && inHead(x - 1, y) && inHead(x, y + 1) && inHead(x, y - 1));
        (edge ? pools.edge : pools.body).push(x, y);
      }
    }
  }
  const out = new Float32Array(TARGETS * 4);
  for (let t = 0; t < TARGETS; t += 1) {
    const r = Math.random();
    const [pool, glow] = r < 0.42 ? [pools.rim, 1] : r < 0.6 ? [pools.edge, 0.9] : [pools.body, 0.25];
    const k = Math.floor(Math.random() * (pool.length / 2)) * 2;
    out[t * 4] = ((pool[k] + Math.random()) / size) * 2 - 1;
    out[t * 4 + 1] = 1 - ((pool[k + 1] + Math.random()) / size) * 2;
    out[t * 4 + 2] = glow;
  }
  return out;
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

  const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  const capacity = small ? 1 << 18 : 1 << 20;
  let count = capacity;

  const BUFFER = GPUBufferUsage;
  const { COMPUTE, FRAGMENT, VERTEX } = GPUShaderStage;
  const uniformData = new ArrayBuffer(UNIFORM_FLOATS * 4);
  const f32 = new Float32Array(uniformData);
  const u32 = new Uint32Array(uniformData);
  const uniforms = device.createBuffer({ size: uniformData.byteLength, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
  const particles = device.createBuffer({ size: capacity * 32, usage: BUFFER.STORAGE });
  const targets = device.createBuffer({ size: TARGETS * 16, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
  const segments = device.createBuffer({ size: MAX_SEGMENTS * 32, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
  device.queue.writeBuffer(
    targets,
    0,
    sampleTargets(
      still.querySelector('[data-shape="head"]').getAttribute('d'),
      still.querySelector('[data-shape="rim"]').getAttribute('d')
    )
  );

  const simLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: COMPUTE },
      { binding: 1, buffer: { type: 'storage' }, visibility: COMPUTE },
      { binding: 2, buffer: { type: 'read-only-storage' }, visibility: COMPUTE },
    ],
  });
  const drawLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: VERTEX | FRAGMENT },
      { binding: 1, buffer: { type: 'read-only-storage' }, visibility: VERTEX | FRAGMENT },
    ],
  });
  const [simModule, particleModule, boltModule, blurModule, compositeModule] = await Promise.all([
    compile(device, SIMULATE, 'simulate'),
    compile(device, PARTICLES, 'particles'),
    compile(device, BOLTS, 'bolts'),
    compile(device, BLUR, 'bloom'),
    compile(device, COMPOSITE, 'composite'),
  ]);
  const HDR = 'rgba16float';
  const additive = {
    alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
    color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
  };
  const simPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
  const drawPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] });
  const fullscreen = (module, entryPoint, targetFormat) =>
    device.createRenderPipelineAsync({
      fragment: { entryPoint, module, targets: [{ format: targetFormat }] },
      layout: 'auto',
      vertex: { entryPoint: 'vs', module },
    });
  const [seedPipeline, simPipeline, particlePipeline, boltPipeline, downPipeline, blurPipeline, compositePipeline] =
    await Promise.all([
      device.createComputePipelineAsync({ compute: { entryPoint: 'seed', module: simModule }, layout: simPipelineLayout }),
      device.createComputePipelineAsync({
        compute: { entryPoint: 'simulate', module: simModule },
        layout: simPipelineLayout,
      }),
      device.createRenderPipelineAsync({
        fragment: { entryPoint: 'fs', module: particleModule, targets: [{ blend: additive, format: HDR }] },
        layout: drawPipelineLayout,
        primitive: { topology: 'point-list' },
        vertex: { entryPoint: 'vs', module: particleModule },
      }),
      device.createRenderPipelineAsync({
        fragment: { entryPoint: 'fs', module: boltModule, targets: [{ blend: additive, format: HDR }] },
        layout: drawPipelineLayout,
        vertex: { entryPoint: 'vs', module: boltModule },
      }),
      fullscreen(blurModule, 'down', HDR),
      fullscreen(blurModule, 'blur', HDR),
      fullscreen(compositeModule, 'fs', format),
    ]);

  const bind = (layout, buffers) =>
    device.createBindGroup({ entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })), layout });
  const simGroup = bind(simLayout, [uniforms, particles, targets]);
  const particleGroup = bind(drawLayout, [uniforms, particles]);
  const boltGroup = bind(drawLayout, [uniforms, segments]);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const passUniforms = [0, 1, 2].map(() =>
    device.createBuffer({ size: 16, usage: BUFFER.UNIFORM | BUFFER.COPY_DST })
  );

  // Screen state: render size, head placement and the post-process targets.
  let width = 0;
  let height = 0;
  let aspect = 1;
  let head = { cx: 0, cy: 0, scale: 0.8 };
  let views = null;

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    width = Math.max(1, Math.round(cssWidth * dpr));
    height = Math.max(1, Math.round(cssHeight * dpr));
    aspect = cssWidth / cssHeight;
    canvas.width = width;
    canvas.height = height;
    const box = still.getBoundingClientRect();
    head = {
      cx: (((box.left + box.width / 2) / cssWidth) * 2 - 1) * aspect,
      cy: 1 - ((box.top + box.height / 2) / cssHeight) * 2,
      scale: box.height / cssHeight,
    };
    const texture = (w, h) =>
      device.createTexture({
        format: HDR,
        size: [w, h],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    const bw = Math.max(1, Math.floor(width / 4));
    const bh = Math.max(1, Math.floor(height / 4));
    const scene = texture(width, height).createView();
    const bloomA = texture(bw, bh).createView();
    const bloomB = texture(bw, bh).createView();
    device.queue.writeBuffer(passUniforms[0], 0, new Float32Array([1 / width, 1 / height, 0, 0]));
    device.queue.writeBuffer(passUniforms[1], 0, new Float32Array([0, 0, 1.6 / bw, 0]));
    device.queue.writeBuffer(passUniforms[2], 0, new Float32Array([0, 0, 0, 1.6 / bh]));
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
      down: pass(downPipeline, scene, passUniforms[0]),
      scene,
    };
  }

  const fromIcon = ([x, y]) => [head.cx + (x / 512 - 1) * head.scale, head.cy + (1 - y / 512) * head.scale];

  // The current bolt: its drawn segments are in `segments`, and its impulse
  // path (a coarser copy) goes in the uniforms while it strikes.
  let bolt = null;

  function strike(kind, at) {
    let main;
    let branches;
    let light = 1;
    let impulse = 1;
    if (kind === 'signature') {
      // From the sky, down the split in the head, out under the chin.
      const inside = SPLIT.map(fromIcon);
      const [tx, ty] = inside[0];
      const up = [tx - inside[1][0], ty - inside[1][1]];
      const sky = [tx + (up[0] / up[1]) * (1.15 - ty), 1.15];
      const last = inside.at(-1);
      const down = [last[0] - inside.at(-2)[0], last[1] - inside.at(-2)[1]];
      const ground = [last[0] + (down[0] / -down[1]) * (last[1] + 1.15), -1.15];
      main = [
        ...jagged([sky, inside[0]], 0.32, 5),
        ...jagged(inside, 0.06, 3).slice(1),
        ...jagged([last, ground], 0.3, 5).slice(1),
      ];
      branches = branchFrom(main.slice(0, 33), 2, 0.0018).concat(branchFrom(main.slice(-33), 2, 0.0018));
    } else if (kind === 'aftershock') {
      const [ox, oy] = fromIcon([700 + Math.random() * 80, 260 + Math.random() * 260]);
      const heading = Math.random() * Math.PI * 2;
      main = jagged([[ox, oy], [ox + Math.cos(heading) * 0.35, oy + Math.sin(heading) * 0.35]], 0.45, 4);
      branches = branchFrom(main, 1, 0.0014);
      light = 0.55;
      impulse = 0.5;
    } else {
      const x = (Math.random() * 1.8 - 0.9) * aspect;
      const end = [x + (Math.random() - 0.5) * 0.9, -0.3 + Math.random() * 0.8];
      const mid = (t, wobble) => [x + (end[0] - x) * t + (Math.random() - 0.5) * wobble, 1.15 + (end[1] - 1.15) * t];
      main = jagged([[x, 1.15], mid(0.35, 0.25), mid(0.7, 0.2), end], 0.35, 4);
      branches = branchFrom(main, 2, 0.0016);
      light = 0.7;
      impulse = 0.7;
    }
    const lines = [{ points: main, width: 0.0032 }, ...branches];
    const data = new Float32Array(MAX_SEGMENTS * 8);
    let drawn = 0;
    for (const { points, width: w } of lines) {
      for (let i = 1; i < points.length && drawn < MAX_SEGMENTS; i += 1) {
        data.set([...points[i - 1], ...points[i], w, 14], drawn * 8);
        drawn += 1;
      }
    }
    device.queue.writeBuffer(segments, 0, data, 0, drawn * 8);
    const step = Math.ceil((main.length - 1) / IMPULSE_SEGMENTS);
    const coarse = main.filter((_, i) => i % step === 0 || i === main.length - 1);
    for (let i = 1; i < coarse.length; i += 1) {
      f32.set([...coarse[i - 1], ...coarse[i]], 20 + (i - 1) * 4);
    }
    bolt = { at, drawn, impulse, impulseSegments: coarse.length - 1, kind, light };
  }

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

  const EVENTS = [
    { at: 1.6, kind: 'ambient' },
    { at: 8.0, kind: 'signature' },
    { at: 9.3, kind: 'aftershock' },
    { at: 13.4, kind: 'ambient' },
  ];

  let elapsed = 0;
  // The page opens mid-cycle; events before that point wait for the next one.
  let cycle = Math.floor(START / CYCLE);
  let fired = new Set(EVENTS.filter((event) => event.at < START % CYCLE));
  const pointer = { at: -10, inside: false, x: 0, y: 0 };

  function writeUniforms(t, dt, phase) {
    f32[0] = t;
    f32[1] = dt;
    f32[2] = aspect;
    f32[3] = phase.gather;
    f32[4] = pointer.x;
    f32[5] = pointer.y;
    f32[6] = phase.pointer;
    f32[7] = phase.scatter;
    f32[8] = phase.strike;
    u32[9] = phase.strike > 0 ? bolt.impulseSegments : 0;
    f32[10] = head.scale;
    u32[11] = count;
    f32[12] = head.cx;
    f32[13] = head.cy;
    f32[14] = 1.25 * Math.min(Math.max((width * height) / count / 4.5, 0.55), 1.8);
    f32[15] = phase.light;
    f32[16] = phase.flash;
    device.queue.writeBuffer(uniforms, 0, uniformData);
  }

  function phaseAt(t) {
    const c = t % CYCLE;
    const index = Math.floor(t / CYCLE);
    if (index !== cycle) {
      cycle = index;
      fired = new Set();
    }
    for (const event of EVENTS) {
      if (c >= event.at && !fired.has(event)) {
        fired.add(event);
        strike(event.kind, t);
      }
    }
    const age = bolt ? t - bolt.at : 10;
    const light = bolt ? boltLight(age) * bolt.light : 0;
    const idle = (performance.now() - pointer.at) / 1000;
    return {
      flash: bolt?.kind === 'signature' ? light : light * 0.4,
      gather: smoothstep(4.6, 7.8, c) * (1 - smoothstep(11.35, 11.9, c)),
      light,
      pointer: pointer.inside ? 1 - smoothstep(1.2, 2, idle) : 0,
      scatter: c >= 11.5 && c < 11.9 ? (1 - (c - 11.5) / 0.4) * 1.4 : 0,
      strike: bolt && age < 0.22 ? Math.exp(-age / 0.06) * bolt.impulse : 0,
    };
  }

  function encode(simSteps) {
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setBindGroup(0, simGroup);
    compute.setPipeline(simPipeline);
    for (let step = 0; step < simSteps; step += 1) {
      compute.dispatchWorkgroups(Math.ceil(count / 256));
    }
    compute.end();
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store', view: views.scene }],
    });
    scenePass.setPipeline(particlePipeline);
    scenePass.setBindGroup(0, particleGroup);
    scenePass.draw(count);
    if (bolt && f32[15] > 0.002) {
      scenePass.setPipeline(boltPipeline);
      scenePass.setBindGroup(0, boltGroup);
      scenePass.draw(6, bolt.drawn);
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

  // One formed frame, for reduced motion: the head, held, with its bolt.
  function drawStill() {
    strike('signature', 0);
    writeUniforms(START + 9, 1 / 60, { flash: 0, gather: 1, light: 0.6, pointer: 0, scatter: 0, strike: 0 });
    encode(360);
  }

  let last = 0;
  const slowFrames = [];
  let downgrades = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    elapsed += dt;
    const t = START + elapsed;
    writeUniforms(t, dt, phaseAt(t));
    encode(1);
    // Quality steps down at most twice if the GPU cannot keep up.
    slowFrames.push(dt);
    if (slowFrames.length === 120) {
      slowFrames.sort((a, b) => a - b);
      if (slowFrames[60] > 1 / 42 && downgrades < 2) {
        count >>= 1;
        downgrades += 1;
      }
      slowFrames.length = 0;
    }
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
  f32[2] = aspect;
  device.queue.writeBuffer(uniforms, 0, uniformData);
  {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(seedPipeline);
    pass.setBindGroup(0, simGroup);
    pass.dispatchWorkgroups(Math.ceil(capacity / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
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
    pointer.x = ((event.clientX / innerWidth) * 2 - 1) * aspect;
    pointer.y = 1 - (event.clientY / innerHeight) * 2;
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
