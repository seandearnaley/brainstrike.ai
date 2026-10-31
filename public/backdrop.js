// The live layer of brainstrike.ai: the page is an agent, and it knows you
// are here.
//
// The agent is a small chartreuse drop that lives as the dot on the second
// "i" of the wordmark. It hops off when the page wakes, follows the cursor
// with a little lag, visits whatever the visitor hovers, can be picked up and
// thrown, squishes when booped, and goes back to its "i" to nap when nobody
// moves. It shows its work in a short log: what it noticed and what it
// decided. Behind everything, a fine dot field leans toward the agent and
// lights up when it thinks.
//
// Both layers draw with WebGL2. A lost GL context is rebuilt when the browser
// restores it. Without WebGL2 the wordmark keeps its plain dot and the page
// says why in html[data-backdrop-reason]; with reduced motion the agent stays
// on its "i" and the log is written at once.

import { createSynth } from './synth.js';

const BPM = 90;
const BEAT = 60 / BPM;
const AGENT_SIZE = 240; // the agent's own canvas, in CSS pixels
const AWAKE_RADIUS = 22;
const NAP_AFTER = 15; // seconds without input
const LOG_LINES = 5;

const root = document.documentElement;
const fieldCanvas = document.querySelector('canvas.backdrop');
const agentCanvas = document.querySelector('canvas.agent');
const logList = document.querySelector('[data-log]');
const homeDot = document.querySelector('[data-home]');
const agentHit = document.querySelector('.agent-hit');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function keepStill(reason) {
  root.dataset.backdrop = 'still';
  root.dataset.backdropReason = reason;
  console.warn(`brainstrike.ai: ${reason}; the page stays still.`);
}

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// --- Shaders --------------------------------------------------------------

const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The field: a link-blue gradient under a fine grid of dots. Dots lean toward
// the agent and swell near it and the cursor; each thought sends a ring of
// light through them, and now and then a slow band of light sweeps across.
const FIELD_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uAgent;
uniform vec2 uCursor;
uniform vec4 uPulses[4]; // x, y, age in seconds, strength
uniform float uTime;
uniform float uBeat;
uniform float uNap;
out vec4 outColor;

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 uv = px / uRes;
  vec3 c = mix(vec3(0.09, 0.16, 1.0), vec3(0.0, 0.047, 0.87), smoothstep(0.0, 0.55, distance(uv, vec2(0.74, 0.3))));
  c = mix(c, vec3(0.0, 0.02, 0.42), smoothstep(0.5, 1.25, distance(uv, vec2(0.6, 0.35))));

  vec2 toAgent = uAgent - px;
  float dAgent = length(toAgent);
  float near = exp(-dAgent * dAgent / (2.0 * 130.0 * 130.0));
  vec2 q = px + toAgent * 0.12 * near;
  float dCursor = distance(uCursor, px);
  float cursor = exp(-dCursor * dCursor / (2.0 * 90.0 * 90.0));

  float pulse = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 p = uPulses[i];
    float front = (distance(px, p.xy) - p.z * 520.0) / 38.0;
    pulse += exp(-front * front) * exp(-p.z * 1.4) * p.w * step(0.0, p.z);
  }
  float sweepAt = mod(uTime, 14.0) / 14.0 * (uRes.x + uRes.y + 800.0) - 400.0;
  float across = (px.x * 0.75 + px.y * 0.35 - sweepAt) / 90.0;
  float sweep = exp(-across * across) * 0.6;

  float energy = 0.16 + near * (0.9 - uNap * 0.55) + cursor * 0.35 + pulse + sweep * 0.5 + uBeat * 0.06;
  const float SPACING = 22.0;
  float d = length(fract(q / SPACING) - 0.5) * SPACING;
  float radius = 0.75 + energy * 1.4;
  float dotMask = smoothstep(radius + 0.6, radius - 0.6, d);
  vec3 ink = mix(vec3(0.72, 0.8, 1.0), vec3(0.82, 0.98, 0.03), clamp(near * 0.9 + pulse * 1.2 + sweep * 0.5, 0.0, 1.0));
  c = mix(c, ink, dotMask * clamp(0.12 + energy * 0.8, 0.0, 1.0));
  c += vec3(0.5, 0.7, 0.0) * near * 0.035;
  float grain = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(c + (grain - 0.5) * 0.018, 1.0);
}`;

// The agent: a drop of chartreuse liquid, lit like glass, with two eyes. Its
// shape is a circle bent by a deform matrix (stretch with speed, squash on a
// boop) and smoothly joined to two trailing droplets. y points up here.
const AGENT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uSize;
uniform float uRadius;
uniform mat2 uDeform; // inverse of the body's stretch and squash
uniform vec2 uTail[2];
uniform float uTailRadius[2];
uniform vec2 uLook;
uniform float uBlink;
uniform vec4 uMood; // weights: open, happy, asleep, surprised
uniform float uTime;
out vec4 outColor;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float body(vec2 p) {
  vec2 q = uDeform * p;
  float d = (length(q) - uRadius) / max(length(uDeform * normalize(p + 1e-4)), 0.5);
  for (int i = 0; i < 2; i++) {
    d = smin(d, length(p - uTail[i]) - uTailRadius[i], uRadius * 0.6);
  }
  return d;
}

float capsule(vec2 p, float h, float r) {
  return length(vec2(p.x, max(abs(p.y) - h, 0.0))) - r;
}

float eye(vec2 p) {
  float r = uRadius;
  float open = capsule(p, r * 0.15 * (1.0 - uBlink) + 0.001, r * 0.105);
  float happy = max(abs(length(p + vec2(0.0, r * 0.08)) - r * 0.15) - r * 0.05, -p.y - r * 0.08);
  float asleep = length(vec2(max(abs(p.x) - r * 0.12, 0.0), p.y + 0.02 * r * cos(p.x / r * 9.0))) - r * 0.04;
  float surprised = length(p) - r * 0.17;
  return open * uMood.x + happy * uMood.y + asleep * uMood.z + surprised * uMood.w;
}

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = body(p);
  float aa = max(fwidth(d), 0.5);
  float alpha = smoothstep(aa, -aa, d);
  float shadowD = body(p + vec2(0.0, uRadius * 0.6));
  float shadow = smoothstep(uRadius * 0.9, -uRadius * 0.4, shadowD) * 0.28;

  float e = 0.75;
  vec2 g = normalize(vec2(body(p + vec2(e, 0.0)) - body(p - vec2(e, 0.0)), body(p + vec2(0.0, e)) - body(p - vec2(0.0, e))) + 1e-5);
  float rim = 1.0 - clamp(-d / uRadius, 0.0, 1.0);
  vec3 n = normalize(vec3(g * pow(rim, 1.5) * 1.15, sqrt(max(0.06, 1.0 - pow(rim, 3.0)))));
  vec3 l = normalize(vec3(-0.45, 0.6, 0.75));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);
  vec3 volt = vec3(0.816, 0.984, 0.027);
  vec3 c = volt * (0.74 + 0.38 * diffuse);
  c = mix(c, volt * 0.55 + vec3(0.0, 0.03, 0.18), pow(rim, 3.0) * 0.3);
  c += spec * 0.95;
  float fres = pow(rim, 3.0);
  c += (0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + rim * 1.4 + uTime * 0.05))) * fres * 0.14;

  vec2 eyes = uLook * uRadius * 0.22 + vec2(0.0, uRadius * 0.12);
  vec2 sep = vec2(uRadius * 0.36, 0.0);
  float de = min(eye(p - eyes - sep), eye(p - eyes + sep));
  float eyeMask = smoothstep(0.6, -0.6, de) * alpha;
  c = mix(c, vec3(0.004, 0.016, 0.16), eyeMask);
  vec2 shine = vec2(-uRadius * 0.035, uRadius * 0.07);
  float glint = smoothstep(uRadius * 0.06, uRadius * 0.03, min(length(p - eyes - sep - shine), length(p - eyes + sep - shine)));
  c = mix(c, vec3(1.0), glint * eyeMask * uMood.x * (1.0 - uBlink));

  vec4 shadowColor = vec4(vec3(0.0, 0.01, 0.12) * shadow, shadow);
  outColor = vec4(c * alpha, alpha) + shadowColor * (1.0 - alpha);
}`;

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
  return { at, program, vao: gl.createVertexArray() };
}

// A canvas drawn by one fullscreen fragment shader. `draw(set)` binds the
// program, lets `set` write its uniforms, and draws. A lost context is
// rebuilt when the browser restores it.
function createLayer(canvas, fragment, label, options) {
  const gl = canvas.getContext('webgl2', options);
  if (!gl) {
    return null;
  }
  let program = compile(gl, FULLSCREEN_VS, fragment, label);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      program = compile(gl, FULLSCREEN_VS, fragment, label);
      lost = false;
    } catch (error) {
      keepStill(`it could not rebuild after the GPU reset (${error.message})`);
    }
  });
  return {
    draw(set) {
      if (lost) {
        return;
      }
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program.program);
      set(gl, program.at);
      gl.bindVertexArray(program.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// --- The log --------------------------------------------------------------

// Lines type out one at a time; the newest is at the bottom. `onLine` runs as
// each line starts.
function createLog(onLine) {
  const queue = [];
  let typing = null;
  let lastAt = -9;

  const stamp = (t) => {
    const s = Math.floor(t);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function begin(text, t) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = stamp(t);
    const span = document.createElement('span');
    li.append(time, span);
    logList.append(li);
    while (logList.children.length > LOG_LINES) {
      logList.firstElementChild.remove();
    }
    typing = { at: t, span, text };
    lastAt = t;
    onLine();
  }

  return {
    // `key` lets a repeated event replace its own waiting line; `now` drops
    // whatever is waiting.
    say(text, { key, now = false } = {}) {
      if (!logList) {
        return;
      }
      if (now) {
        queue.length = 0;
      }
      const waiting = key ? queue.findIndex((item) => item.key === key) : -1;
      if (waiting >= 0) {
        queue[waiting].text = text;
      } else if (queue.length < 3) {
        queue.push({ key, text });
      }
    },
    // Writes every waiting line at once, for reduced motion.
    flush(t) {
      for (const item of queue.splice(0)) {
        begin(item.text, t);
        typing.span.textContent = item.text;
      }
      typing = null;
    },
    update(t) {
      if (typing) {
        const shown = Math.min(typing.text.length, Math.floor((t - typing.at) * 55));
        typing.span.textContent = typing.text.slice(0, shown);
        if (shown === typing.text.length) {
          typing = null;
        }
      } else if (queue.length > 0 && t - lastAt > 1.1) {
        begin(queue.shift().text, t);
      }
    },
  };
}

// --- What the agent knows ---------------------------------------------------

function greeting() {
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) {
    return 'late night? same.';
  }
  return hour < 12 ? 'good morning.' : hour < 18 ? 'good afternoon.' : 'good evening.';
}

function since(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 2) {
    return 'a minute ago';
  }
  if (minutes < 90) {
    return `${minutes} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

// Remembers visits in this browser only. Storage can be off; then every visit
// is a first one.
function visit() {
  try {
    const before = JSON.parse(localStorage.getItem('brainstrike.visits') ?? 'null');
    const now = { count: (before?.count ?? 0) + 1, last: Date.now() };
    localStorage.setItem('brainstrike.visits', JSON.stringify(now));
    return before ? `back again · visit ${now.count} · last here ${since(Date.now() - before.last)}.` : null;
  } catch {
    return null;
  }
}

function platformLine() {
  if (root.dataset.get === 'elsewhere') {
    return 'you’re on a phone. Brainstrike lives on desktops · bookmark me?';
  }
  const title = document.querySelector('[data-title]')?.textContent ?? '';
  const meta = document.querySelector('[data-meta]')?.textContent ?? '';
  const os = title.replace('Download for ', '');
  return os ? `you’re on ${os} · ${meta.split(' · ')[0]} → picked that build.` : null;
}

// What to say when the visitor hovers something, by its data-agent key.
function hoverLine(element) {
  const key = element.dataset.agent;
  if (key === 'download') {
    const meta = element.querySelector('[data-meta]')?.textContent ?? '';
    return `that one’s yours · ${meta.split(' · ').pop()}.`;
  }
  if (key === 'chip') {
    const label = element.textContent.replace(/\s+/g, ' ').trim();
    return pick([`${label}? noted.`, `${label}. respect.`, `considering ${label}.`]);
  }
  return (
    {
      github: 'the builds live there. checksums too.',
      notes: 'every line of the changelog is true. I checked.',
      play: 'press it. I made the music.',
      tagline: 'it’s true. watch me.',
      wordmark: 'that’s my name. well, our name.',
    }[key] ?? null
  );
}

// --- The agent ------------------------------------------------------------

function start() {
  if (!fieldCanvas || !agentCanvas) {
    return;
  }
  const field = createLayer(fieldCanvas, FIELD_FS, 'field', { alpha: false, antialias: false, depth: false });
  const drop = createLayer(agentCanvas, AGENT_FS, 'agent', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true });
  if (!field || !drop) {
    keepStill('this browser has no WebGL2');
    return;
  }

  const still = reducedMotion.matches;
  const synth = createSynth(BPM);
  let synthOn = false;
  const pulses = Array.from({ length: 4 }, () => ({ age: 99, strength: 0, x: 0, y: 0 }));
  let nextPulse = 0;
  const pulseData = new Float32Array(16);

  const agent = {
    blink: 0,
    boops: 0,
    grabbedAt: 0,
    look: [0, 0],
    mood: [1, 0, 0, 0],
    moodGoal: [1, 0, 0, 0],
    moodUntil: 0,
    pos: [0, 0],
    radius: 10,
    squash: 0,
    state: 'home', // home, follow, visit, held, thrown, nap
    swallowClick: false,
    tail: [
      [0, 0],
      [0, 0],
    ],
    vel: [0, 0],
    visiting: null,
  };
  const pointer = { inside: false, lastMove: 0, speed: 0, x: innerWidth * 0.6, y: innerHeight * 0.4 };
  let elapsed = 0;
  let nextBlink = 2;
  const wakeAt = still ? Number.POSITIVE_INFINITY : 1.4;

  function pulseFromAgent(strength) {
    Object.assign(pulses[nextPulse], { age: 0, strength, x: agent.pos[0], y: agent.pos[1] });
    nextPulse = (nextPulse + 1) % pulses.length;
  }
  const log = createLog(() => {
    pulseFromAgent(0.9);
    synth.say(elapsed);
  });

  // The agent's seat: the dot of the second "i".
  function home() {
    if (!homeDot) {
      return { r: 10, x: innerWidth * 0.3, y: innerHeight * 0.4 };
    }
    const box = homeDot.getBoundingClientRect();
    return { r: box.width / 2, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  function setMood(mood, seconds) {
    agent.moodGoal = { asleep: [0, 0, 1, 0], happy: [0, 1, 0, 0], open: [1, 0, 0, 0], surprised: [0, 0, 0, 1] }[mood];
    agent.moodUntil = seconds ? elapsed + seconds : Number.POSITIVE_INFINITY;
  }

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    fieldCanvas.width = Math.round(fieldCanvas.clientWidth * Math.min(dpr, 1.5));
    fieldCanvas.height = Math.round(fieldCanvas.clientHeight * Math.min(dpr, 1.5));
    agentCanvas.width = Math.round(AGENT_SIZE * dpr);
    agentCanvas.height = Math.round(AGENT_SIZE * dpr);
    if (agent.state === 'home' || agent.state === 'nap') {
      const seat = home();
      agent.pos = [seat.x, seat.y];
    }
  }

  // Where the agent wants to be while it is up and about.
  function goal() {
    if (agent.state === 'visit' && agent.visiting) {
      const box = agent.visiting.getBoundingClientRect();
      return [clamp(box.right + 18, 30, innerWidth - 30), clamp(box.top - 16, 30, innerHeight - 30)];
    }
    // Following: up and to the left of the cursor, out of its way.
    return [clamp(pointer.x - 48, 30, innerWidth - 30), clamp(pointer.y - 44, 30, innerHeight - 30)];
  }

  function step(dt) {
    elapsed += dt;
    const t = elapsed;
    log.update(t);
    for (const p of pulses) {
      p.age += dt;
    }

    if (agent.state === 'home' && t >= wakeAt) {
      agent.state = 'follow';
      agent.vel = [0, -420];
      setMood('surprised', 0.5);
      synth.spawn(t);
    }
    // Nobody has moved for a while: back to the "i" for a nap.
    if (['follow', 'visit'].includes(agent.state) && t - pointer.lastMove > NAP_AFTER) {
      agent.state = 'nap';
      synth.nap(true);
      setMood('asleep');
      log.say(`idle ${NAP_AFTER}s → napping on my i.`, { key: 'nap' });
    }

    const seat = home();
    const resting = agent.state === 'home' || agent.state === 'nap';
    agent.radius += ((resting ? seat.r : AWAKE_RADIUS) - agent.radius) * (1 - Math.exp(-dt * 7));

    if (agent.state === 'held') {
      const before = agent.pos;
      agent.pos = [pointer.x, pointer.y];
      agent.vel = [(agent.pos[0] - before[0]) / Math.max(dt, 1e-3), (agent.pos[1] - before[1]) / Math.max(dt, 1e-3)];
    } else if (agent.state === 'thrown') {
      agent.vel[1] += 1600 * dt;
      agent.vel = agent.vel.map((v) => v * Math.exp(-dt * 0.6));
      agent.pos = [agent.pos[0] + agent.vel[0] * dt, agent.pos[1] + agent.vel[1] * dt];
      const r = agent.radius;
      for (const [i, lo, hi] of [
        [0, r, innerWidth - r],
        [1, r, innerHeight - r],
      ]) {
        if (agent.pos[i] < lo || agent.pos[i] > hi) {
          agent.pos[i] = clamp(agent.pos[i], lo, hi);
          agent.squash = Math.min(1, Math.abs(agent.vel[i]) / 900);
          agent.vel[i] *= -0.62;
        }
      }
      if (Math.hypot(...agent.vel) < 80 && agent.pos[1] > innerHeight - r - 2) {
        agent.state = 'follow';
      }
    } else {
      // A slightly bouncy spring toward the goal; napping settles home firmly.
      const [gx, gy] = resting ? [seat.x, seat.y] : goal();
      const k = resting ? 60 : 34;
      const damping = resting ? 14 : 8.5;
      agent.vel = [
        agent.vel[0] + ((gx - agent.pos[0]) * k - agent.vel[0] * damping) * dt,
        agent.vel[1] + ((gy - agent.pos[1]) * k - agent.vel[1] * damping) * dt,
      ];
      agent.pos = [agent.pos[0] + agent.vel[0] * dt, agent.pos[1] + agent.vel[1] * dt];
    }

    // The trailing droplets lag behind, like liquid.
    agent.tail[0] = agent.tail[0].map((v, i) => v + (agent.pos[i] - v) * (1 - Math.exp(-dt * 16)));
    agent.tail[1] = agent.tail[1].map((v, i) => v + (agent.tail[0][i] - v) * (1 - Math.exp(-dt * 12)));

    // Eyes on the cursor, or on whatever it is visiting.
    let lookAt = [pointer.x, pointer.y];
    if (agent.state === 'visit' && agent.visiting) {
      const box = agent.visiting.getBoundingClientRect();
      lookAt = [box.left + box.width / 2, box.top + box.height / 2];
    }
    const lx = lookAt[0] - agent.pos[0];
    const ly = lookAt[1] - agent.pos[1];
    const reach = Math.max(Math.hypot(lx, ly), 60);
    const lookGoal = resting && agent.state === 'nap' ? [0, -0.2] : [lx / reach, -ly / reach];
    agent.look = agent.look.map((v, i) => v + (lookGoal[i] - v) * (1 - Math.exp(-dt * 10)));

    if (t > nextBlink && agent.moodGoal[0] === 1) {
      agent.blink = 1;
      nextBlink = t + 2 + Math.random() * 4;
    }
    agent.blink = Math.max(0, agent.blink - dt * 7);
    if (t > agent.moodUntil) {
      setMood(agent.state === 'nap' ? 'asleep' : 'open');
    }
    agent.mood = agent.mood.map((v, i) => v + (agent.moodGoal[i] - v) * (1 - Math.exp(-dt * 12)));
    agent.squash *= Math.exp(-dt * 5);

    // A fast, shaky cursor makes it dizzy.
    pointer.speed *= Math.exp(-dt * 3);
    if (pointer.speed > 9000 && agent.state === 'follow') {
      pointer.speed = 0;
      setMood('surprised', 0.8);
      log.say('whoa. easy.', { key: 'shake' });
    }
    synth.update(t);
    updateHud(t);
  }

  // The deform matrix for the shader: stretch along the velocity, squash flat.
  function deform() {
    const speed = Math.hypot(...agent.vel);
    const stretch = Math.min(speed / 1600, 0.55);
    const angle = Math.atan2(-agent.vel[1], agent.vel[0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const breathe = agent.state === 'nap' ? 1 + 0.06 * Math.sin(elapsed * 2.2) : 1;
    const beat = synthOn ? 1 + 0.05 * Math.exp(-((elapsed / BEAT) % 1) * 6) : 1;
    const sx = (1 + stretch) * (1 + agent.squash * 0.35) * beat;
    const sy = (1 / Math.sqrt(1 + stretch)) * (1 - agent.squash * 0.3) * breathe * beat;
    // M = R diag(sx, sy) R^T; the shader wants M^-1 = R diag(1/sx, 1/sy) R^T.
    const a = (c * c) / sx + (s * s) / sy;
    const b = c * s * (1 / sx - 1 / sy);
    const d = (s * s) / sx + (c * c) / sy;
    return [a, b, b, d];
  }

  function render() {
    const dpr = fieldCanvas.width / Math.max(1, fieldCanvas.clientWidth);
    pulses.forEach((p, i) => pulseData.set([p.x, p.y, p.age, p.strength], i * 4));
    const seat = home();
    const seated = Math.hypot(agent.pos[0] - seat.x, agent.pos[1] - seat.y) < 3 && ['home', 'nap'].includes(agent.state);
    field.draw((gl, at) => {
      gl.uniform2f(at('uRes'), fieldCanvas.clientWidth, fieldCanvas.clientHeight);
      gl.uniform1f(at('uDpr'), dpr);
      gl.uniform2f(at('uAgent'), agent.pos[0], agent.pos[1]);
      gl.uniform2f(at('uCursor'), pointer.inside ? pointer.x : -999, pointer.inside ? pointer.y : -999);
      gl.uniform4fv(at('uPulses'), pulseData);
      gl.uniform1f(at('uTime'), elapsed);
      gl.uniform1f(at('uBeat'), synthOn ? Math.exp(-((elapsed / BEAT) % 1) * 6) : 0);
      gl.uniform1f(at('uNap'), seated ? 1 : 0);
    });
    const tail = agent.tail.map((p) => [p[0] - agent.pos[0], -(p[1] - agent.pos[1])]);
    const spread = Math.hypot(...tail[1]);
    drop.draw((gl, at) => {
      gl.uniform1f(at('uSize'), AGENT_SIZE);
      gl.uniform1f(at('uRadius'), agent.radius);
      gl.uniformMatrix2fv(at('uDeform'), false, deform());
      gl.uniform2fv(at('uTail'), [...tail[0], ...tail[1]]);
      gl.uniform1fv(at('uTailRadius'), [agent.radius * clamp(0.62 - spread / 400, 0.2, 0.62), agent.radius * clamp(0.42 - spread / 300, 0.1, 0.42)]);
      gl.uniform2fv(at('uLook'), agent.look);
      gl.uniform1f(at('uBlink'), agent.blink);
      gl.uniform4fv(at('uMood'), agent.mood);
      gl.uniform1f(at('uTime'), elapsed);
    });
    agentCanvas.style.transform = `translate(${agent.pos[0] - AGENT_SIZE / 2}px, ${agent.pos[1] - AGENT_SIZE / 2}px)`;
    if (agentHit) {
      agentHit.style.transform = `translate(${agent.pos[0]}px, ${agent.pos[1]}px)`;
    }
    root.dataset.agent = seated ? 'home' : 'out';
  }

  // HUD: the little player's time and levels.
  const clock = document.querySelector('[data-time]');
  const bars = [...document.querySelectorAll('[data-level]')];
  let shownSecond = -1;
  function updateHud(t) {
    const second = Math.floor(t);
    if (clock && second !== shownSecond) {
      shownSecond = second;
      clock.textContent = `${String(Math.floor(second / 60) % 100).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;
    }
    const levels = synth.levels();
    const phase = (t / BEAT) % 1;
    bars.forEach((bar, i) => {
      const level = levels ? levels[i] : 0.2 + 0.25 * Math.exp(-phase * (3 + i)) * (0.6 + 0.4 * Math.sin(t * (1.3 + i * 0.7)));
      bar.style.setProperty('--level', level.toFixed(3));
    });
  }

  let raf = 0;
  let last = 0;
  let shown = false;
  function live() {
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
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    step(dt);
    render();
    live();
    raf = requestAnimationFrame(frame);
  }

  // Hidden for a while, then back: it noticed.
  let hiddenAt = 0;
  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (still) {
      layout();
      render();
      live();
      return;
    }
    if (document.hidden) {
      hiddenAt = performance.now();
      synth.pause();
      return;
    }
    if (hiddenAt) {
      const away = Math.round((performance.now() - hiddenAt) / 1000);
      if (away >= 3) {
        log.say(`welcome back · ${away}s away.`, { key: 'back' });
        setMood('happy', 1.2);
      }
      hiddenAt = 0;
    }
    synth.resume();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // --- Input --------------------------------------------------------------

  const hitsAgent = (x, y) => Math.hypot(x - agent.pos[0], y - agent.pos[1]) < Math.max(agent.radius * 1.5, 18);
  const moves = [];

  addEventListener('pointermove', (event) => {
    pointer.speed += Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) * 6;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.inside = true;
    pointer.lastMove = elapsed;
    if (agent.state === 'nap') {
      agent.state = 'follow';
      synth.nap(false);
      synth.spawn(elapsed);
      agent.vel = [0, -380];
      setMood('surprised', 0.6);
      log.say('oh! hi.', { key: 'wake' });
    }
    if (agent.state === 'held') {
      moves.push([event.clientX, event.clientY, event.timeStamp]);
      moves.splice(0, Math.max(0, moves.length - 5));
    }
    root.dataset.aim = !still && agent.state !== 'home' && hitsAgent(event.clientX, event.clientY) ? 'agent' : '';
  });
  root.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });

  // The agent can be picked up wherever it is; the page underneath it does
  // not get the click.
  addEventListener(
    'pointerdown',
    (event) => {
      pointer.lastMove = elapsed;
      if (still || agent.state === 'home' || !hitsAgent(event.clientX, event.clientY)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      agent.state = 'held';
      agent.grabbedAt = elapsed;
      moves.length = 0;
      moves.push([event.clientX, event.clientY, event.timeStamp]);
      setMood('surprised', 0.4);
      root.dataset.dragging = '';
    },
    { capture: true }
  );
  addEventListener(
    'click',
    (event) => {
      if (agent.swallowClick) {
        agent.swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true }
  );

  function release() {
    if (agent.state !== 'held') {
      return;
    }
    agent.swallowClick = true;
    delete root.dataset.dragging;
    const first = moves[0];
    const latest = moves[moves.length - 1];
    const span = Math.max((latest[2] - first[2]) / 1000, 1e-3);
    const vx = (latest[0] - first[0]) / span;
    const vy = (latest[1] - first[1]) / span;
    const moved = Math.hypot(latest[0] - first[0], latest[1] - first[1]);
    if (moved < 6 && elapsed - agent.grabbedAt < 0.35) {
      // A boop.
      agent.state = 'follow';
      agent.squash = 1;
      agent.boops += 1;
      setMood('happy', 1);
      synth.snap(elapsed);
      const n = agent.boops;
      log.say(n === 1 ? 'boop.' : n < 5 ? `boop ×${n}.` : n < 9 ? `boop ×${n}. okay, okay.` : `boop ×${n}. I’m logging every one.`, { key: 'boop' });
      return;
    }
    const speed = Math.hypot(vx, vy);
    if (speed > 500) {
      agent.state = 'thrown';
      agent.vel = [clamp(vx, -4000, 4000), clamp(vy, -4000, 4000)];
      setMood('happy', 1.4);
      log.say(speed > 2500 ? 'rude. fun, but rude.' : 'wheee.', { key: 'throw' });
    } else {
      agent.state = 'follow';
      agent.vel = [0, 0];
      log.say('put down. thanks.', { key: 'drop' });
    }
  }
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  // It visits what the visitor hovers, and says something about it.
  for (const element of document.querySelectorAll('[data-agent]')) {
    element.addEventListener('pointerenter', () => {
      if (still || !['follow', 'visit'].includes(agent.state)) {
        return;
      }
      agent.visiting = element;
      agent.state = 'visit';
      const line = hoverLine(element);
      if (line) {
        log.say(line, { key: 'hover' });
      }
    });
    element.addEventListener('pointerleave', () => {
      if (agent.visiting === element) {
        agent.visiting = null;
        if (agent.state === 'visit') {
          agent.state = 'follow';
        }
      }
    });
  }
  document.querySelector('[data-agent="download"]')?.addEventListener('click', () => {
    log.say('downloading… see you in your apps folder.', { key: 'download', now: true });
    setMood('happy', 1.6);
  });

  // A phone's address bar changes only the height; that is not worth a line.
  let resizeTimer = 0;
  let lastWidth = innerWidth;
  new ResizeObserver(() => {
    layout();
    if (still) {
      render();
    }
    clearTimeout(resizeTimer);
    if (shown && !still && innerWidth !== lastWidth) {
      lastWidth = innerWidth;
      resizeTimer = setTimeout(() => log.say(`resized · ${innerWidth}×${innerHeight}. stretching.`, { key: 'resize' }), 400);
    }
  }).observe(fieldCanvas);

  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (String(selection).trim().length > 3 && document.querySelector('.hero')?.contains(selection.anchorNode)) {
      log.say('copying the tagline? flattered.', { key: 'select' });
    }
  });

  // The sound switch: off until the visitor turns it on.
  const sound = document.querySelector('[data-sound]');
  sound?.addEventListener('click', async () => {
    synthOn = await synth.toggle(elapsed);
    sound.setAttribute('aria-pressed', String(synthOn));
    const label = sound.querySelector('[data-sound-label]');
    if (label) {
      label.textContent = synthOn ? 'Pause the music' : 'Play the music';
    }
    log.say(synthOn ? `music on · ${BPM} BPM · I’ll hum along.` : 'quiet. okay.', { key: 'music', now: true });
  });

  // What it says when it arrives.
  log.say(visit() ?? 'hi. I’m the page.');
  log.say(greeting());
  const platform = platformLine();
  if (platform) {
    log.say(platform);
  }
  if (still) {
    log.flush(0);
  } else {
    setTimeout(() => {
      if (!agent.boops) {
        log.say('you can pick me up, by the way.', { key: 'hint' });
      }
    }, 9000);
    setTimeout(() => log.say('nothing you do here leaves this tab.', { key: 'privacy' }), 26000);
  }

  layout();
  const seat = home();
  agent.pos = [seat.x, seat.y];
  agent.tail = [
    [seat.x, seat.y],
    [seat.x, seat.y],
  ];
  run();
  document.addEventListener('visibilitychange', run);
  reducedMotion.addEventListener('change', () => location.reload());
}

try {
  start();
} catch (error) {
  keepStill(`it failed to start (${error.message})`);
}
