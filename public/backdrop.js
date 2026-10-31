// The playable backdrop of brainstrike.ai: the 1990s pipe screensaver,
// dreaming in 2026. Chrome, enamel and pearl pipes grow through a box of
// space one cell per beat, turning at right angles, over an endless
// checkerboard floor under a link-blue sky, while two Mystify ribbons drift
// behind them. Every turn a pipe takes plays a note when the music is on.
// The music alternates two 16-bar sections, Daylight and Night mall; at each
// change the pipes dissolve, dithered down to a 1990s palette, and new ones
// start.
//
// Visitors drag to orbit (with momentum), scroll or pinch to zoom, click
// empty space to start a pipe, click a pipe to ring it, and pull a pipe to
// bend it like rubber; it springs back when let go.
//
// It draws with WebGL2, which every current browser has. A lost GL context
// (sleep and wake, a GPU switch, a backgrounded tab on a phone) is rebuilt
// when the browser restores it. Without WebGL2 the page keeps its CSS sky and
// says why in html[data-backdrop-reason]; with reduced motion it draws one
// still frame and takes no input.

import { createSynth } from './synth.js';

const BPM = 100;
const BEAT = 60 / BPM;
const SECTION_BEATS = 64; // 16 bars
const SECTION = SECTION_BEATS * BEAT;
const SECTIONS = ['Daylight', 'Night mall'];
const DISSOLVE_BEATS = 4; // the last bar of a section dissolves the pipes
const LOOKAHEAD = 0.12; // pipes decide their next step this far ahead, for the music

const BOX = [6, 4, 5]; // half-extent of the grid, in cells
const PIPE_RADIUS = 0.19;
const JOINT_RADIUS = 0.3;
const MAX_SEGMENTS = 360;
const MAX_JOINTS = 360;
const PIPE_LIFE = 44; // the longest a pipe grows, in cells
const PIPES_WANTED = [3, 2]; // pipes growing at once, per section

const DPR_CAP = 1.5;
const FOCAL = 1.75;

const root = document.documentElement;
const canvas = document.querySelector('canvas.backdrop');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function keepStill(reason) {
  root.dataset.backdrop = 'still';
  root.dataset.backdropReason = reason;
  console.warn(`brainstrike.ai backdrop: ${reason}; showing the still sky.`);
}

// --- Small vector helpers -------------------------------------------------

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (length(a) || 1));
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// A small seeded random source, so the reduced-motion frame is the same
// picture every time.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Shaders --------------------------------------------------------------

// The sky, the checkerboard floor and the studio lights the chrome reflects.
// Daylight and Night mall are blended by uNight.
const ENV = /* glsl */ `
uniform float uNight;
uniform float uTime;
const vec3 BLUE = vec3(0.0, 0.0037, 0.73);
const vec3 VOLT = vec3(0.63, 0.96, 0.0013);

vec3 skyTop() { return mix(vec3(0.0, 0.006, 0.78), vec3(0.0004, 0.0012, 0.06), uNight); }
vec3 skyZenith() { return mix(vec3(0.0, 0.002, 0.3), vec3(0.0, 0.0004, 0.016), uNight); }
vec3 haze() { return mix(vec3(0.36, 0.46, 1.0), vec3(0.07, 0.025, 0.4), uNight); }
vec3 floorFog() { return mix(skyTop(), haze(), 0.45); }
vec3 sunDir() { return normalize(mix(vec3(-0.45, 0.22, -0.86), vec3(0.5, 0.14, -0.85), uNight)); }
vec3 sunColor() { return mix(vec3(1.0, 0.94, 0.82), VOLT * 0.9, uNight); }
// The key light the pipes are lit by, from above the camera's side of the room.
vec3 keyDir() { return normalize(vec3(0.35, 0.8, 0.5)); }
vec3 keyColor() { return mix(vec3(1.0, 0.97, 0.92), vec3(0.45, 0.55, 1.0), uNight); }

float checker(vec2 p, vec2 w) {
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

vec3 sky(vec3 d) {
  float h = d.y;
  vec3 c = mix(haze(), skyTop(), smoothstep(-0.01, 0.22, h));
  c = mix(c, skyZenith(), smoothstep(0.35, 1.0, h));
  float s = max(dot(d, sunDir()), 0.0);
  c += sunColor() * (pow(s, 1400.0) * 9.0 + pow(s, 14.0) * 0.16);
  return c;
}

const float FLOOR_Y = -7.5;

vec3 floorAt(vec3 ro, vec3 rd, float blur) {
  float t = (FLOOR_Y - ro.y) / rd.y;
  vec3 p = ro + rd * t;
  vec2 q = p.xz * 0.25;
  vec2 w = max(fwidth(q), vec2(0.002)) + blur * t * 0.004;
  float k = checker(q, w);
  vec3 day = mix(vec3(0.0, 0.004, 0.42), vec3(0.11, 0.17, 1.0), k);
  vec3 night = mix(vec3(0.0003, 0.0008, 0.03), vec3(0.002, 0.004, 0.14), k);
  vec2 g = abs(fract(q + 0.5) - 0.5) / max(w, vec2(0.0001));
  float line = 1.0 - clamp(min(g.x, g.y) - 0.5, 0.0, 1.0);
  night += VOLT * line * 0.55;
  vec3 c = mix(day, night, uNight);
  return mix(c, floorFog(), 1.0 - exp(-t * 0.022));
}

vec3 env(vec3 ro, vec3 rd, float blur) {
  // Both are computed so the floor's derivatives stay in uniform control flow.
  vec3 ground = floorAt(ro, rd, blur);
  vec3 c = sky(rd);
  // two soft boxes, seen only in reflections, for the studio-chrome look
  float a = smoothstep(0.8, 0.86, dot(rd, normalize(vec3(0.6, 0.75, 0.3))));
  float b = smoothstep(0.9, 0.94, dot(rd, normalize(vec3(-0.7, 0.55, 0.6))));
  c += vec3(1.0, 0.98, 0.95) * a * mix(2.2, 0.5, uNight) * blur + mix(vec3(0.6, 0.7, 1.0), VOLT, uNight) * b * 1.2 * blur;
  return rd.y < -0.002 ? ground : c;
}
`;

const CAMERA = /* glsl */ `
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform vec2 uShift;
uniform float uFocal;
uniform float uAspect;

vec4 project(vec3 p) {
  vec3 v = p - uEye;
  vec3 c = vec3(dot(v, uRight), dot(v, uUp), dot(v, uFwd));
  const float n = 0.1;
  const float f = 160.0;
  return vec4(c.x * uFocal / uAspect + uShift.x * c.z, c.y * uFocal + uShift.y * c.z, c.z * (f + n) / (f - n) - 2.0 * f * n / (f - n), c.z);
}
`;

const BACKGROUND_VS = /* glsl */ `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

const BACKGROUND_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 outColor;
${CAMERA}
${ENV}
void main() {
  vec2 q = vNdc - uShift;
  vec3 rd = normalize(uFwd + uRight * q.x * uAspect / uFocal + uUp * q.y / uFocal);
  outColor = vec4(env(uEye, rd, 0.0), 1.0);
}`;

const PIPE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 iA;
layout(location = 3) in vec3 iB;
layout(location = 4) in vec4 iInfo; // radius, material, born, pipe
uniform int uKind; // 0 segment, 1 joint
uniform float uTime;
uniform float uStep;
uniform float uGrabPipe;
uniform vec3 uGrabAt;
uniform vec3 uGrabOffset;
uniform float uRingPipe;
uniform float uRingAge;
uniform float uDissolve;
uniform vec3 uDissolveFrom;
${CAMERA}
out vec3 vWorld;
out vec3 vNormal;
out float vGlow;
flat out float vMaterial;

void main() {
  float age = (uTime - iInfo.z) / uStep;
  float grow = 1.0 - pow(1.0 - clamp(age, 0.0, 1.0), 3.0);
  vec3 center = uKind == 0 ? mix(iA, iB, 0.5) : iA;
  float fade = 1.0 - smoothstep(0.0, 0.55, uDissolve - distance(center, uDissolveFrom) * 0.07);
  float r = iInfo.x * fade;
  vec3 p;
  vec3 n;
  if (uKind == 0) {
    vec3 axis = iB - iA;
    float len = length(axis);
    vec3 w = axis / len;
    vec3 t = abs(w.y) < 0.99 ? normalize(cross(w, vec3(0.0, 1.0, 0.0))) : vec3(1.0, 0.0, 0.0);
    vec3 b = cross(w, t);
    p = iA + w * (aPos.y * len * grow) + (t * aPos.x + b * aPos.z) * r;
    n = t * aNormal.x + b * aNormal.z;
  } else {
    float pop = age < 1.0 ? grow * (1.0 + 0.55 * sin(grow * 3.14159)) : 1.0;
    p = iA + aPos * r * max(pop, 0.0);
    n = aNormal;
  }
  bool ringing = abs(iInfo.w - uRingPipe) < 0.5;
  if (ringing) {
    float k = exp(-uRingAge * 2.6);
    p += n * sin(uRingAge * 34.0 - dot(p, vec3(1.3, 1.7, 1.1)) * 2.4) * 0.07 * k;
  }
  if (abs(iInfo.w - uGrabPipe) < 0.5) {
    float d = distance(p, uGrabAt);
    p += uGrabOffset * exp(-d * d / 4.5);
  }
  vWorld = p;
  vNormal = n;
  vMaterial = iInfo.y;
  // Rung pipes flash, dissolving ones flare as they go, and a new cell glows
  // for a beat.
  vGlow = (ringing ? exp(-uRingAge * 3.0) * 1.4 : 0.0) + (1.0 - fade) * fade * 6.0 + (1.0 - clamp(age - 1.0, 0.0, 1.0)) * 0.35 * step(0.0, age);
  gl_Position = project(p);
}`;

const PIPE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vGlow;
flat in float vMaterial;
out vec4 outColor;
${CAMERA}
${ENV}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) {
    n = -n;
  }
  vec3 r = reflect(-v, n);
  float nv = max(dot(n, v), 0.0);
  float fres = pow(1.0 - nv, 5.0);
  vec3 refl = env(vWorld, r, 1.0);
  vec3 l = keyDir();
  float diffuse = max(dot(n, l), 0.0);
  vec3 ambient = mix(mix(vec3(0.05, 0.06, 0.3), vec3(0.003, 0.003, 0.06), uNight), skyTop() * 0.9 + 0.08, 0.5 + 0.5 * n.y);
  int m = int(vMaterial + 0.5);
  vec3 c;
  if (m == 0) {
    c = refl * vec3(0.92, 0.95, 1.0);
  } else if (m == 1) {
    c = VOLT * (0.12 + ambient * 0.5 + diffuse * keyColor() * 0.8) + refl * mix(0.05, 1.0, fres) * 0.7;
  } else if (m == 2) {
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + nv * 1.3 + 0.15));
    c = film * 0.5 * (ambient + diffuse * 0.6) + refl * mix(0.1, 1.0, fres);
  } else if (m == 3) {
    c = BLUE * (ambient * 0.5 + diffuse * 0.35) + refl * mix(0.12, 1.0, fres) * 0.8;
  } else {
    c = vec3(0.86, 0.88, 0.92) * (ambient * 0.7 + diffuse * keyColor() * 0.6) + refl * mix(0.04, 1.0, fres) * 0.45;
  }
  vec3 h = normalize(l + v);
  c += keyColor() * pow(max(dot(n, h), 0.0), 260.0) * (m == 0 ? 2.5 : 1.4);
  c += mix(vec3(0.7, 0.8, 1.0), VOLT, 0.5 + 0.5 * uNight) * vGlow;
  float dist = length(uEye - vWorld);
  c = mix(c, floorFog(), 1.0 - exp(-max(dist - 16.0, 0.0) * 0.035));
  outColor = vec4(c, 1.0);
}`;

// Mystify: two four-cornered shapes bouncing round the sky, with trails.
const RIBBON_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInfo; // across (-1..1), fade, shape
out vec3 vInfo;
void main() {
  vInfo = aInfo;
  gl_Position = vec4(aPos, 0.9998, 1.0);
}`;

const RIBBON_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vInfo;
uniform float uNight;
out vec4 outColor;
void main() {
  float edge = exp(-vInfo.x * vInfo.x * 3.5);
  vec3 a = mix(vec3(0.9, 0.95, 1.0), vec3(0.63, 0.96, 0.0013), uNight);
  vec3 b = mix(vec3(0.63, 0.96, 0.0013), vec3(0.4, 0.5, 1.0), uNight);
  vec3 c = vInfo.z < 0.5 ? a : b;
  outColor = vec4(c * edge * vInfo.y * mix(0.35, 0.6, uNight), 1.0);
}`;

const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Bright parts only, at a quarter of the size, for the bloom.
const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      c += texture(uSource, vUv + vec2(x, y) * uTexel).rgb;
    }
  }
  c /= 9.0;
  outColor = vec4(max(c - 0.75, 0.0), 1.0);
}`;

const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;
out vec4 outColor;
void main() {
  const float w[5] = float[](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture(uSource, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSource, vUv + uDirection * float(i)).rgb * w[i];
    c += texture(uSource, vUv - uDirection * float(i)).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}`;

// Tone mapping, bloom, a little lens, tape wobble at night and a dither.
// While the pipes dissolve the picture drops to the web-safe palette.
const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uTime;
uniform float uNight;
uniform float uGlitch;
uniform float uPalette;
uniform float uExposure;
out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// ACES on luminance only, so the link blue keeps its saturation; colours
// brighter than the screen roll toward white instead of clipping.
vec3 tonemap(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 t = c * (aces(vec3(l)).x / max(l, 1e-5));
  float m = max(t.r, max(t.g, t.b));
  return m > 1.0 ? mix(t / m, vec3(1.0), clamp((m - 1.0) * 0.35, 0.0, 1.0)) : t;
}

float bayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int m[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[i.y * 4 + i.x]) / 16.0 - 0.5;
}

void main() {
  vec2 uv = vUv;
  float row = floor(uv.y * 180.0);
  float tear = fract(sin(row * 12.9898 + floor(uTime * 24.0) * 78.233) * 43758.5453);
  uv.x += sin(uv.y * 30.0 + uTime * 2.3) * 0.0015 * uNight + (tear - 0.5) * 0.04 * step(0.85, tear) * uGlitch;
  vec2 d = (uv - 0.5) * 0.0025;
  vec3 c = vec3(texture(uScene, uv + d).r, texture(uScene, uv).g, texture(uScene, uv - d).b);
  c += texture(uBloom, uv).rgb * 0.8;
  c = tonemap(c * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.55;
  c *= 1.0 - uNight * 0.05 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
  float b = bayer(gl_FragCoord.xy);
  vec3 safe = floor(c * 5.0 + 0.5 + b) / 5.0;
  c = mix(c + b / 255.0 * 1.5, safe, uPalette);
  outColor = vec4(c, 1.0);
}`;

// --- Meshes ---------------------------------------------------------------

// An open tube along +Y from 0 to 1, radius 1, in rings so it can bend.
function tube(sides, rings) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = (side / sides) * Math.PI * 2;
      positions.push(Math.cos(a), ring / rings, Math.sin(a));
      normals.push(Math.cos(a), 0, Math.sin(a));
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = ring * sides + side;
      const b = ring * sides + ((side + 1) % sides);
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  return { indices: new Uint16Array(indices), normals: new Float32Array(normals), positions: new Float32Array(positions) };
}

function ball(columns, rows) {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = (row / rows) * Math.PI;
    for (let column = 0; column <= columns; column += 1) {
      const u = (column / columns) * Math.PI * 2;
      positions.push(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const p = new Float32Array(positions);
  return { indices: new Uint16Array(indices), normals: p, positions: p };
}

// --- The pipes ------------------------------------------------------------

// The growing pipes, independent of the GL context: a context restore keeps
// them. Times are scene seconds.
function createPipes(rand) {
  const segments = []; // { a, b, radius, material, born, pipe }
  const joints = []; // { at, radius, material, born, pipe }
  const occupied = new Set();
  let pipes = [];
  let nextId = 1;
  let version = 0;
  const key = (c) => `${c[0]},${c[1]},${c[2]}`;
  const inside = (c) => Math.abs(c[0]) <= BOX[0] && Math.abs(c[1]) <= BOX[1] && Math.abs(c[2]) <= BOX[2];
  const free = (c) => inside(c) && !occupied.has(key(c));
  const DIRECTIONS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const MATERIALS = [0, 0, 1, 1, 1, 2, 3, 4];

  function start(cell, born) {
    if (!free(cell) || segments.length >= MAX_SEGMENTS - 4) {
      return null;
    }
    const pipe = {
      cell,
      direction: DIRECTIONS[Math.floor(rand() * 6)],
      id: nextId,
      length: 0,
      material: MATERIALS[Math.floor(rand() * MATERIALS.length)],
    };
    nextId += 1;
    occupied.add(key(cell));
    joints.push({ at: cell, born, material: pipe.material, pipe: pipe.id, radius: JOINT_RADIUS });
    pipes.push(pipe);
    version += 1;
    return pipe;
  }

  function randomCell() {
    for (let tries = 0; tries < 30; tries += 1) {
      const c = BOX.map((h) => Math.floor(rand() * (h * 2 + 1)) - h);
      if (free(c)) {
        return c;
      }
    }
    return null;
  }

  // One beat: every growing pipe moves a cell, mostly straight on. Returns
  // the turns taken, for the music.
  function step(born) {
    const turns = [];
    for (const pipe of pipes) {
      const ahead = add(pipe.cell, pipe.direction);
      let direction = pipe.direction;
      if (!(free(ahead) && rand() < 0.7)) {
        const options = DIRECTIONS.filter((d) => dot(d, pipe.direction) === 0 && free(add(pipe.cell, d)));
        direction = options.length > 0 ? options[Math.floor(rand() * options.length)] : free(ahead) ? pipe.direction : null;
      }
      if (!direction || pipe.length >= PIPE_LIFE || segments.length >= MAX_SEGMENTS || joints.length >= MAX_JOINTS - 2) {
        joints.push({ at: pipe.cell, born, material: pipe.material, pipe: pipe.id, radius: JOINT_RADIUS });
        pipe.done = true;
        continue;
      }
      if (direction !== pipe.direction && pipe.length > 0) {
        joints.push({ at: pipe.cell, born, material: pipe.material, pipe: pipe.id, radius: JOINT_RADIUS });
        turns.push(pipe);
      }
      const next = add(pipe.cell, direction);
      segments.push({ a: pipe.cell, b: next, born, material: pipe.material, pipe: pipe.id, radius: PIPE_RADIUS });
      occupied.add(key(next));
      pipe.cell = next;
      pipe.direction = direction;
      pipe.length += 1;
    }
    pipes = pipes.filter((pipe) => !pipe.done);
    version += 1;
    return turns;
  }

  function clear() {
    segments.length = 0;
    joints.length = 0;
    occupied.clear();
    pipes = [];
    version += 1;
  }

  return {
    clear,
    get growing() {
      return pipes.length;
    },
    joints,
    randomCell,
    segments,
    start,
    step,
    get version() {
      return version;
    },
  };
}

// The nearest pipe a ray hits, as { pipe, at, t }, or null. Pipes count as a
// little fatter than they are, so they are easy to catch.
function pick(pipes, ro, rd) {
  let best = null;
  const consider = (t, pipe, at) => {
    if (t > 0 && (!best || t < best.t)) {
      best = { at, pipe, t };
    }
  };
  for (const s of pipes.segments) {
    const ab = sub(s.b, s.a);
    const ao = sub(ro, s.a);
    const abab = dot(ab, ab);
    const abrd = dot(ab, rd);
    const denominator = abab - abrd * abrd;
    if (denominator < 1e-6) {
      continue;
    }
    const t = (dot(ab, ao) * abrd - abab * dot(ao, rd)) / denominator;
    const k = clamp((dot(ab, ao) + abrd * t) / abab, 0, 1);
    const onPipe = add(s.a, ab, k);
    const onRay = add(ro, rd, t);
    if (length(sub(onPipe, onRay)) < PIPE_RADIUS * 2.2) {
      consider(t, s.pipe, onPipe);
    }
  }
  for (const j of pipes.joints) {
    const oc = sub(ro, j.at);
    const b = dot(oc, rd);
    const c = dot(oc, oc) - (j.radius * 1.6) ** 2;
    const h = b * b - c;
    if (h > 0) {
      consider(-b - Math.sqrt(h), j.pipe, j.at);
    }
  }
  return best;
}

// --- Camera ---------------------------------------------------------------

function orbitCamera(yaw, pitch, distance) {
  const eye = [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)];
  const fwd = norm(scale(eye, -1));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, fwd, right, up };
}

// --- GL -------------------------------------------------------------------

function compile(gl, vertex, fragment, label) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const logs = gl
      .getAttachedShaders(program)
      .map((s) => gl.getShaderInfoLog(s))
      .filter(Boolean)
      .join(' ');
    throw new Error(`${label}: ${logs || gl.getProgramInfoLog(program)}`);
  }
  const locations = new Map();
  const at = (name) => {
    if (!locations.has(name)) {
      locations.set(name, gl.getUniformLocation(program, name));
    }
    return locations.get(name);
  };
  return { at, program };
}

// Every GL object, made from scratch on start and again after a lost
// context is restored.
function createRenderer(gl) {
  const floatTargets = Boolean(gl.getExtension('EXT_color_buffer_float'));
  const programs = {
    background: compile(gl, BACKGROUND_VS, BACKGROUND_FS, 'background'),
    blur: compile(gl, FULLSCREEN_VS, BLUR_FS, 'blur'),
    bright: compile(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright'),
    composite: compile(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite'),
    pipe: compile(gl, PIPE_VS, PIPE_FS, 'pipe'),
    ribbon: compile(gl, RIBBON_VS, RIBBON_FS, 'ribbon'),
  };

  function mesh(shape, instanceFloats, capacity) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, shape.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normals = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normals);
    gl.bufferData(gl.ARRAY_BUFFER, shape.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * instanceFloats * 4, gl.DYNAMIC_DRAW);
    const stride = instanceFloats * 4;
    for (const [location, size, offset] of [
      [2, 3, 0],
      [3, 3, 12],
      [4, 4, 24],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    const elements = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shape.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { count: shape.indices.length, data: new Float32Array(capacity * instanceFloats), instances, vao };
  }

  const segmentMesh = mesh(tube(20, 10), 10, MAX_SEGMENTS);
  const jointMesh = mesh(ball(20, 14), 10, MAX_JOINTS);

  const ribbonVao = gl.createVertexArray();
  gl.bindVertexArray(ribbonVao);
  const ribbonBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  let targets = null;
  let width = 1;
  let height = 1;

  function texture(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, floatTargets ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { fb, h, t, w };
  }

  function resize(w, h) {
    if (targets) {
      for (const target of [targets.scene, targets.bloomA, targets.bloomB]) {
        gl.deleteTexture(target.t);
        gl.deleteFramebuffer(target.fb);
      }
      gl.deleteRenderbuffer(targets.color);
      gl.deleteRenderbuffer(targets.depth);
      gl.deleteFramebuffer(targets.msaa);
    }
    width = w;
    height = h;
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    const msaa = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, floatTargets ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const bw = Math.max(1, Math.floor(w / 4));
    const bh = Math.max(1, Math.floor(h / 4));
    targets = { bloomA: texture(bw, bh), bloomB: texture(bw, bh), color, depth, msaa, scene: texture(w, h) };
  }

  function upload(target, items, kind) {
    const { data } = target;
    let i = 0;
    for (const item of items) {
      const a = kind === 0 ? item.a : item.at;
      const b = kind === 0 ? item.b : item.at;
      data.set([a[0], a[1], a[2], b[0], b[1], b[2], item.radius, item.material, item.born, item.pipe], i);
      i += 10;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, target.instances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, i);
    target.used = items.length;
  }

  function setCamera(p, view) {
    gl.uniform3fv(p.at('uEye'), view.camera.eye);
    gl.uniform3fv(p.at('uRight'), view.camera.right);
    gl.uniform3fv(p.at('uUp'), view.camera.up);
    gl.uniform3fv(p.at('uFwd'), view.camera.fwd);
    gl.uniform2fv(p.at('uShift'), view.shift);
    gl.uniform1f(p.at('uFocal'), FOCAL);
    gl.uniform1f(p.at('uAspect'), view.aspect);
    gl.uniform1f(p.at('uNight'), view.night);
    gl.uniform1f(p.at('uTime'), view.time);
  }

  function fullscreen(p, target, inputs) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : gl.drawingBufferWidth, target ? target.h : gl.drawingBufferHeight);
    gl.useProgram(p.program);
    inputs.forEach(([name, tex], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex.t);
      gl.uniform1i(p.at(name), unit);
    });
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw(view, pipes, ribbons) {
    const { background, blur, bright, composite, pipe, ribbon } = programs;
    if (segmentMesh.version !== pipes.version) {
      upload(segmentMesh, pipes.segments, 0);
      upload(jointMesh, pipes.joints, 1);
      segmentMesh.version = pipes.version;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.msaa);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(background.program);
    setCamera(background, view);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(ribbon.program);
    gl.uniform1f(ribbon.at('uNight'), view.night);
    gl.bindVertexArray(ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ribbons, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, ribbons.length / 5);
    gl.disable(gl.BLEND);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pipe.program);
    setCamera(pipe, view);
    gl.uniform1f(pipe.at('uStep'), BEAT * 0.9);
    gl.uniform1f(pipe.at('uGrabPipe'), view.grab.pipe);
    gl.uniform3fv(pipe.at('uGrabAt'), view.grab.at);
    gl.uniform3fv(pipe.at('uGrabOffset'), view.grab.offset);
    gl.uniform1f(pipe.at('uRingPipe'), view.ring.pipe);
    gl.uniform1f(pipe.at('uRingAge'), view.ring.age);
    gl.uniform1f(pipe.at('uDissolve'), view.dissolve.age);
    gl.uniform3fv(pipe.at('uDissolveFrom'), view.dissolve.from);
    for (const [kind, m] of [
      [0, segmentMesh],
      [1, jointMesh],
    ]) {
      if (m.used > 0) {
        gl.uniform1i(pipe.at('uKind'), kind);
        gl.bindVertexArray(m.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.used);
      }
    }
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.msaa);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.fb);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    const { bloomA, bloomB, scene } = targets;
    gl.useProgram(bright.program);
    gl.uniform2f(bright.at('uTexel'), 1 / width, 1 / height);
    fullscreen(bright, bloomA, [['uSource', scene]]);
    gl.useProgram(blur.program);
    gl.uniform2f(blur.at('uDirection'), 1.5 / bloomA.w, 0);
    fullscreen(blur, bloomB, [['uSource', bloomA]]);
    gl.uniform2f(blur.at('uDirection'), 0, 1.5 / bloomA.h);
    fullscreen(blur, bloomA, [['uSource', bloomB]]);

    gl.useProgram(composite.program);
    gl.uniform1f(composite.at('uTime'), view.time);
    gl.uniform1f(composite.at('uNight'), view.night);
    gl.uniform1f(composite.at('uGlitch'), view.glitch);
    gl.uniform1f(composite.at('uPalette'), view.palette);
    gl.uniform1f(composite.at('uExposure'), view.exposure);
    fullscreen(composite, null, [
      ['uScene', scene],
      ['uBloom', bloomA],
    ]);
  }

  return { draw, resize };
}

// --- Mystify --------------------------------------------------------------

// Two shapes of four corners bounce round the part of the screen beside the
// copy (`bounds`, in NDC: x0, x1, y0, y1); each keeps a trail of where it
// was. Returns the triangles to draw, as x, y, across, fade, shape.
function createRibbons(rand) {
  const TRAIL = 9;
  const bounds = [0, 0.98, -0.2, 0.92];
  const shapes = [0, 1].map(() => ({
    corners: Array.from({ length: 4 }, () => ({
      p: [0.1 + rand() * 0.8, rand() * 1.1 - 0.2],
      v: [(rand() * 0.5 + 0.18) * (rand() < 0.5 ? -1 : 1), (rand() * 0.5 + 0.18) * (rand() < 0.5 ? -1 : 1)],
    })),
    trail: [],
  }));
  let since = 0;
  const out = new Float32Array(2 * TRAIL * 4 * 6 * 5);

  function step(dt) {
    for (const shape of shapes) {
      for (const corner of shape.corners) {
        for (const i of [0, 1]) {
          const lo = bounds[i * 2];
          const hi = bounds[i * 2 + 1];
          corner.p[i] += corner.v[i] * dt * 0.22;
          if (corner.p[i] < lo || corner.p[i] > hi) {
            corner.p[i] = clamp(corner.p[i], lo, hi);
            corner.v[i] = Math.abs(corner.v[i]) * (corner.p[i] === lo ? 1 : -1);
          }
        }
      }
    }
    since += dt;
    if (since > 0.07) {
      since = 0;
      for (const shape of shapes) {
        shape.trail.unshift(shape.corners.map((c) => [...c.p]));
        shape.trail.length = Math.min(shape.trail.length, TRAIL);
      }
    }
  }

  function triangles(aspect, pixel) {
    let i = 0;
    const w = pixel * 2.2;
    shapes.forEach((shape, s) => {
      shape.trail.forEach((corners, k) => {
        const fade = (1 - k / TRAIL) ** 1.6;
        for (let e = 0; e < 4; e += 1) {
          const a = corners[e];
          const b = corners[(e + 1) % 4];
          const dx = (b[0] - a[0]) * aspect;
          const dy = b[1] - a[1];
          const l = Math.hypot(dx, dy) || 1;
          const nx = (-dy / l) * w / aspect;
          const ny = (dx / l) * w;
          const quad = [
            [a[0] - nx, a[1] - ny, -1],
            [a[0] + nx, a[1] + ny, 1],
            [b[0] - nx, b[1] - ny, -1],
            [b[0] - nx, b[1] - ny, -1],
            [a[0] + nx, a[1] + ny, 1],
            [b[0] + nx, b[1] + ny, 1],
          ];
          for (const [x, y, across] of quad) {
            out.set([x, y, across, fade, s], i);
            i += 5;
          }
        }
      });
    });
    return out.subarray(0, i);
  }

  return { bounds, step, triangles };
}

// --- The scene ------------------------------------------------------------

function start() {
  if (!canvas) {
    return;
  }
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) {
    keepStill('this browser has no WebGL2');
    return;
  }

  const still = reducedMotion.matches;
  const rand = random(still ? 7 : (Date.now() ^ (Math.random() * 1e9)) >>> 0);
  const pipes = createPipes(rand);
  const ribbons = createRibbons(rand);
  const synth = createSynth(BPM);
  let renderer = null;

  const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let renderScale = small ? 0.8 : 1;
  let width = 1;
  let height = 1;
  let aspect = 1;
  let shift = [0, 0];

  // The camera drifts round the pipes on its own; dragging spins it, with
  // momentum, and it eases back to drifting.
  // A narrow screen stands further back, so the pipes fit above the copy.
  const away = innerWidth <= 760 ? 30 : 18;
  const orbit = { distance: away, pitch: 0.12, spin: 0, tilt: 0, yaw: 0.6, zoom: away };
  const grab = { at: [0, 0, 0], held: false, offset: [0, 0, 0], pipe: -1, plane: null, velocity: [0, 0, 0] };
  const ring = { age: 99, pipe: -1 };
  const dissolve = { age: 0, from: [0, 0, 0] };
  const state = { glitch: 0, nextStep: 0, section: -1 };
  let elapsed = 0;

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
    width = Math.max(1, Math.round(canvas.clientWidth * dpr * renderScale));
    height = Math.max(1, Math.round(canvas.clientHeight * dpr * renderScale));
    aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    canvas.width = width;
    canvas.height = height;
    // The pipes sit right of the copy on a wide screen and above it on a phone.
    shift = innerWidth <= 760 ? [0, 0.42] : [0.38, 0.02];
    ribbons.bounds.splice(0, 4, ...(innerWidth <= 760 ? [-0.95, 0.95, 0.15, 0.95] : [0, 0.98, -0.25, 0.92]));
    renderer?.resize(width, height);
  }

  function seed(born) {
    for (let i = 0; i < PIPES_WANTED[0]; i += 1) {
      const cell = pipes.randomCell();
      if (cell) {
        pipes.start(cell, born);
      }
    }
  }

  // The pipes decide each beat a little ahead, so the music can play their
  // turns on the beat.
  function growUntil(t) {
    while (state.nextStep * BEAT < t + LOOKAHEAD) {
      const beat = state.nextStep;
      const at = beat * BEAT;
      const inSection = beat % SECTION_BEATS;
      const section = Math.floor(beat / SECTION_BEATS) % 2;
      if (inSection === 0) {
        pipes.clear();
        seed(at);
      } else if (inSection < SECTION_BEATS - DISSOLVE_BEATS) {
        for (const pipe of pipes.step(at)) {
          synth.turn(at, pipe.material);
        }
        if (pipes.growing < PIPES_WANTED[section] && inSection % 4 === 0) {
          const cell = pipes.randomCell();
          if (cell) {
            pipes.start(cell, at);
          }
        }
      }
      state.nextStep += 1;
    }
  }

  function view(t) {
    const camera = orbitCamera(orbit.yaw, orbit.pitch, orbit.distance);
    const inSection = (t % SECTION) / BEAT;
    const section = Math.floor(t / SECTION) % 2;
    // Night fades in over the first two bars of its section and out over the
    // first two bars of the next.
    const into = smoothstep(0, 8, inSection);
    const night = section === 1 ? into : 1 - into;
    dissolve.age = Math.max(0, (inSection - (SECTION_BEATS - DISSOLVE_BEATS)) * BEAT);
    const palette = smoothstep(0, 0.5, dissolve.age) * (1 - smoothstep(1.6, 2.4, dissolve.age));
    const beatPhase = (t / BEAT) % 1;
    return {
      aspect,
      camera,
      dissolve,
      exposure: 1 + Math.exp(-beatPhase * 6) * 0.06,
      glitch: state.glitch,
      grab,
      night,
      palette,
      ring,
      shift,
      time: t,
    };
  }

  // HUD: a small CD-player display of the track, the time and the levels.
  const track = document.querySelector('[data-track]');
  const clock = document.querySelector('[data-time]');
  const bars = [...document.querySelectorAll('[data-level]')];
  let shownSecond = -1;
  function updateHud(t) {
    const section = Math.floor(t / SECTION) % 2;
    if (section !== state.section) {
      state.section = section;
      if (track) {
        track.textContent = `0${section + 1} ${SECTIONS[section]}`;
      }
    }
    const second = Math.floor(t);
    if (clock && second !== shownSecond) {
      shownSecond = second;
      clock.textContent = `${String(Math.floor(second / 60) % 100).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;
    }
    const levels = synth.levels();
    const beatPhase = (t / BEAT) % 1;
    bars.forEach((bar, i) => {
      const level = levels ? levels[i] : 0.25 + 0.55 * Math.exp(-beatPhase * (3 + i)) * (0.6 + 0.4 * Math.sin(t * (1.3 + i * 0.7)));
      bar.style.setProperty('--level', level.toFixed(3));
    });
  }

  function step(dt) {
    elapsed += dt;
    const t = elapsed;
    growUntil(t);
    ribbons.step(dt);
    // The last bar of a section dissolves the pipes from one of their joints,
    // and the tape tears as the next section starts.
    const sectionNow = Math.floor(t / SECTION);
    if (sectionNow !== state.lastSection) {
      state.glitch = state.lastSection === undefined ? 0 : 1;
      state.lastSection = sectionNow;
    }
    if ((t % SECTION) / BEAT >= SECTION_BEATS - DISSOLVE_BEATS && state.dissolving !== sectionNow) {
      state.dissolving = sectionNow;
      dissolve.from = pipes.joints.length > 0 ? pipes.joints[Math.floor(rand() * pipes.joints.length)].at : [0, 0, 0];
      state.glitch = Math.max(state.glitch, 0.5);
    }
    state.glitch *= Math.exp(-dt * 3);

    if (!drag.active) {
      orbit.yaw += orbit.spin * dt + 0.035 * dt;
      orbit.pitch = clamp(orbit.pitch + orbit.tilt * dt, -0.15, 1.1);
      orbit.spin *= Math.exp(-dt * 2.2);
      orbit.tilt *= Math.exp(-dt * 2.2);
    }
    orbit.distance += (orbit.zoom - orbit.distance) * (1 - Math.exp(-dt * 6));

    // A pulled pipe follows the pointer; let go, it springs back and wobbles.
    if (!grab.held) {
      grab.velocity = add(scale(grab.velocity, Math.exp(-dt * 7)), grab.offset, -95 * dt);
      grab.offset = add(grab.offset, grab.velocity, dt);
      if (length(grab.offset) < 0.002 && length(grab.velocity) < 0.01) {
        grab.offset = [0, 0, 0];
        grab.pipe = -1;
      }
    }
    ring.age += dt;
    updateHud(t);
    synth.update(t, Math.floor(t / SECTION) % 2);
  }

  let raf = 0;
  let last = 0;
  let shown = false;
  const slowFrames = [];
  let downgrades = 0;

  function render() {
    renderer.draw(view(elapsed), pipes, ribbons.triangles(aspect, 2 / height));
    if (!shown) {
      shown = true;
      root.dataset.backdrop = 'live';
      delete root.dataset.backdropReason;
      const sound = document.querySelector('[data-sound]');
      if (sound && !still) {
        sound.hidden = false;
      }
    }
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt);
    render();
    // The resolution steps down at most twice if the GPU cannot keep up.
    slowFrames.push(dt);
    if (slowFrames.length === 90) {
      slowFrames.sort((a, b) => a - b);
      if (slowFrames[45] > 1 / 45 && downgrades < 2) {
        renderScale *= 0.75;
        downgrades += 1;
        layout();
      }
      slowFrames.length = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  // One frame for reduced motion: a screenful of pipes, already grown.
  function drawStill() {
    pipes.clear();
    seed(-99);
    for (let i = 0; i < 60; i += 1) {
      pipes.step(-99);
      if (pipes.growing < 3) {
        const cell = pipes.randomCell();
        if (cell) {
          pipes.start(cell, -99);
        }
      }
    }
    elapsed = 4;
    state.nextStep = Number.POSITIVE_INFINITY;
    render();
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!renderer || gl.isContextLost()) {
      return;
    }
    if (still) {
      drawStill();
    } else if (document.hidden) {
      synth.pause();
    } else {
      synth.resume();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function build() {
    renderer = createRenderer(gl);
    layout();
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    renderer = null;
    synth.pause();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      build();
      run();
    } catch (error) {
      keepStill(`it could not rebuild after the GPU reset (${error.message})`);
    }
  });

  // --- Input --------------------------------------------------------------

  const pointer = { x: 0, y: 0 };
  const drag = { active: false, id: -1, lastX: 0, lastY: 0, moved: 0, onPipe: null, startX: 0, startY: 0 };
  const pinch = new Map();
  const isUi = (target) =>
    target instanceof Element && Boolean(target.closest('a, button, dialog, .hero, .notes-card, .top, .foot'));
  const live = () => !still && root.dataset.backdrop === 'live';

  function rayThrough(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1 - shift[0];
    const y = 1 - ((clientY - rect.top) / rect.height) * 2 - shift[1];
    const camera = orbitCamera(orbit.yaw, orbit.pitch, orbit.distance);
    return { camera, ro: camera.eye, rd: norm(add(add(camera.fwd, camera.right, (x * aspect) / FOCAL), camera.up, y / FOCAL)) };
  }

  // Where a ray meets the plane through `point` that faces the camera.
  function onPlane(ray, point) {
    const t = dot(sub(point, ray.ro), ray.camera.fwd) / dot(ray.rd, ray.camera.fwd);
    return add(ray.ro, ray.rd, t);
  }

  addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!live()) {
      return;
    }
    if (pinch.has(event.pointerId)) {
      const before = [...pinch.values()];
      pinch.set(event.pointerId, [event.clientX, event.clientY]);
      if (pinch.size === 2) {
        const after = [...pinch.values()];
        const spread = (p) => Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        orbit.zoom = clamp(orbit.zoom * (spread(before) / Math.max(1, spread(after))), 9, 44);
        return;
      }
    }
    if (!drag.active || event.pointerId !== drag.id) {
      if (event.pointerType === 'mouse') {
        const { ro, rd } = rayThrough(event.clientX, event.clientY);
        root.dataset.aim = !isUi(event.target) && pick(pipes, ro, rd) ? 'pipe' : '';
      }
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY));
    if (grab.held) {
      const ray = rayThrough(event.clientX, event.clientY);
      const target = sub(onPlane(ray, grab.at), grab.at);
      const reach = length(target);
      grab.offset = reach > 3 ? scale(target, 3 / reach) : target;
      return;
    }
    if (drag.moved > 4) {
      const k = 3.2 / Math.min(innerWidth, innerHeight);
      orbit.yaw -= dx * k;
      orbit.pitch = clamp(orbit.pitch + dy * k, -0.15, 1.1);
      orbit.spin = -dx * k * 60;
      orbit.tilt = dy * k * 60;
    }
  });

  addEventListener('pointerdown', (event) => {
    if (!live() || isUi(event.target) || event.button > 0) {
      return;
    }
    pinch.set(event.pointerId, [event.clientX, event.clientY]);
    if (pinch.size > 1) {
      drag.active = false;
      grab.held = false;
      return;
    }
    drag.active = true;
    drag.id = event.pointerId;
    drag.startX = drag.lastX = event.clientX;
    drag.startY = drag.lastY = event.clientY;
    drag.moved = 0;
    const { ro, rd } = rayThrough(event.clientX, event.clientY);
    const hit = pick(pipes, ro, rd);
    drag.onPipe = hit;
    if (hit) {
      grab.held = true;
      grab.pipe = hit.pipe;
      grab.at = hit.at;
      grab.offset = [0, 0, 0];
      grab.velocity = [0, 0, 0];
    }
    root.dataset.dragging = '';
  });

  function release(event) {
    pinch.delete(event.pointerId);
    if (!drag.active || event.pointerId !== drag.id) {
      return;
    }
    drag.active = false;
    delete root.dataset.dragging;
    const t = elapsed;
    if (grab.held) {
      grab.held = false;
      if (drag.moved < 6) {
        // A click on a pipe rings it.
        ring.pipe = drag.onPipe.pipe;
        ring.age = 0;
        const segment = pipes.segments.find((s) => s.pipe === ring.pipe) ?? pipes.joints.find((j) => j.pipe === ring.pipe);
        synth.ring(t, segment ? segment.material : 0);
      } else if (length(grab.offset) > 0.4) {
        synth.snap(t);
      }
      return;
    }
    if (drag.moved < 6) {
      // A click on empty space starts a pipe there.
      const ray = rayThrough(event.clientX, event.clientY);
      const p = onPlane(ray, [0, 0, 0]);
      const cell = p.map((v, i) => clamp(Math.round(v), -BOX[i], BOX[i]));
      if (pipes.start(cell, t)) {
        synth.spawn(t);
      }
    }
  }
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  addEventListener(
    'wheel',
    (event) => {
      if (!live() || isUi(event.target)) {
        return;
      }
      orbit.zoom = clamp(orbit.zoom * Math.exp(event.deltaY * 0.0012), 9, 44);
    },
    { passive: true }
  );
  root.addEventListener('pointerleave', () => {
    root.dataset.aim = '';
  });

  // The sound switch: off until the visitor turns it on.
  const sound = document.querySelector('[data-sound]');
  sound?.addEventListener('click', async () => {
    const on = await synth.toggle(elapsed);
    sound.setAttribute('aria-pressed', String(on));
    const label = sound.querySelector('[data-sound-label]');
    if (label) {
      label.textContent = on ? 'Pause the music' : 'Play the music';
    }
  });

  build();
  run();
  new ResizeObserver(() => {
    if (!renderer) {
      return;
    }
    layout();
    if (still) {
      render();
    }
  }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  reducedMotion.addEventListener('change', () => location.reload());
}

try {
  start();
} catch (error) {
  keepStill(`it failed to start (${error.message})`);
}
