// The music of brainstrike.ai: soft machine pop at 90 BPM, played by a small
// Web Audio synth on the page's own clock.
//
// It stays silent until the visitor turns it on (browsers allow sound only
// after a gesture anyway). Warm pads and felt keys move through four chords;
// a sub, a soft kick, a clap and ticks keep a slow, swung pulse; every fourth
// phrase drops to the pad and keys for a breath. The agent plays along: each
// thought it logs is a small vowel chirp in key, a boop is a felt note, waking
// up is a rising phrase, and while it naps the band drops out to the pad.

// Four chords, one bar each, in MIDI notes: Dbmaj9, Bbm9, Gbmaj9, Ab6/9.
const CHORDS = [
  [49, 56, 60, 63, 68],
  [46, 53, 58, 61, 65],
  [42, 49, 54, 58, 61],
  [44, 51, 56, 60, 63],
];
const SWING = 0.12; // every other sixteenth lands this much late
const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead of the picture
const VOWELS = [
  [800, 1200],
  [350, 2200],
  [500, 900],
  [650, 1700],
  [300, 800],
];

const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createSynth(bpm) {
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  let ctx = null;
  let bus = null;
  let on = false;
  let napping = false;
  let offset = 0; // audio time minus scene time
  let next = 0; // the next sixteenth to schedule
  let resync = true;

  const chordAt = (t) => CHORDS[Math.floor(t / (beat * 4)) % CHORDS.length];

  function build() {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 4;
    limiter.connect(ctx.destination);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    limiter.connect(analyser);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    // A soft room from decaying noise.
    const verb = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = ir.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
      }
    }
    verb.buffer = ir;
    const verbIn = ctx.createGain();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.45;
    verbIn.connect(verb).connect(verbOut).connect(master);

    // A dotted-eighth echo that darkens as it repeats.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = beat * 0.75;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 4000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const delayIn = ctx.createGain();
    delayIn.connect(delay).connect(damp).connect(feedback).connect(delay);
    damp.connect(master);

    // Pads, keys and the sub duck a little under the kick; the sub is warmed
    // by a gentle saturator.
    const pump = ctx.createGain();
    pump.connect(master);
    const warm = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < curve.length; i += 1) {
      curve[i] = Math.tanh((i / 128 - 1) * 2.2);
    }
    warm.curve = curve;
    warm.connect(pump);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.random() * 2 - 1;
    }
    bus = { analyser, bins: new Uint8Array(analyser.frequencyBinCount), delay: delayIn, master, noise, pump, verb: verbIn, warm };
  }

  function osc(type, frequency, at, end) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start(at);
    o.stop(end);
    return o;
  }

  // A gain envelope: up to `level` over `attack`, then down to silence.
  function envelope(at, level, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  function out(node, reverb, echo, destination = bus.master) {
    node.connect(destination);
    for (const [amount, target] of [
      [reverb, bus.verb],
      [echo, bus.delay],
    ]) {
      if (amount > 0) {
        const send = ctx.createGain();
        send.gain.value = amount;
        node.connect(send).connect(target);
      }
    }
  }

  // Felt keys: a soft two-operator FM tone through a low-pass.
  function felt(at, note, level, length) {
    const f = hz(note);
    const end = at + length + 1.2;
    const carrier = osc('sine', f, at, end);
    const mod = osc('sine', f, at, end);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 0.9, at);
    depth.gain.exponentialRampToValueAtTime(f * 0.05 + 1, at + Math.min(0.6, length + 0.2));
    mod.connect(depth).connect(carrier.frequency);
    const g = envelope(at, level, 0.003, length + 0.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    carrier.connect(g).connect(filter);
    out(filter, 0.45, 0.15, bus.pump);
  }

  function pad(at, notes, length, level) {
    const sum = ctx.createGain();
    sum.gain.value = 0.1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, at);
    filter.frequency.linearRampToValueAtTime(1600, at + length * 0.5);
    filter.frequency.linearRampToValueAtTime(700, at + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.8);
    g.gain.setValueAtTime(level, at + length);
    g.gain.linearRampToValueAtTime(0, at + length + 1.2);
    sum.connect(filter).connect(g);
    for (const note of notes) {
      for (const detune of [-7, 7]) {
        const o = osc('triangle', hz(note), at, at + length + 1.3);
        o.detune.value = detune;
        o.connect(sum);
      }
    }
    out(g, 0.6, 0, bus.pump);
  }

  function sub(at, note, length, level) {
    const o = osc('sine', hz(note), at, at + length + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.01);
    g.gain.setValueAtTime(level, at + length * 0.8);
    g.gain.linearRampToValueAtTime(0, at + length);
    o.connect(g).connect(bus.warm);
  }

  function kick(at, level) {
    const o = osc('sine', 110, at, at + 0.35);
    o.frequency.setValueAtTime(115, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.1);
    const g = envelope(at, level, 0.002, 0.28);
    o.connect(g);
    out(g, 0, 0);
    bus.pump.gain.cancelScheduledValues(at);
    bus.pump.gain.setValueAtTime(0.6, at);
    bus.pump.gain.setTargetAtTime(1, at + 0.02, 0.1);
  }

  function tick(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(filter).connect(g);
    out(g, 0.05, 0);
    src.start(at, Math.random() * 0.5, 0.06);
  }

  function clap(at, level) {
    for (const lag of [0, 0.011, 0.023]) {
      const src = ctx.createBufferSource();
      src.buffer = bus.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1500;
      filter.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, at + lag);
      g.gain.exponentialRampToValueAtTime(0.0001, at + lag + 0.12);
      src.connect(filter).connect(g);
      out(g, 0.25, 0);
      src.start(at + lag, Math.random() * 0.5, 0.15);
    }
  }

  // The agent's voice: a saw gliding into its note through two vowel
  // formants that slide from one vowel to another.
  function chirp(at, note, level, length) {
    const f = hz(note);
    const o = osc('sawtooth', f, at, at + length + 0.05);
    o.frequency.setValueAtTime(f * 0.8, at);
    o.frequency.exponentialRampToValueAtTime(f, at + length * 0.4);
    const from = pick(VOWELS);
    const to = pick(VOWELS);
    const g = envelope(at, level, 0.008, length);
    for (const k of [0, 1]) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.Q.value = 9;
      formant.frequency.setValueAtTime(from[k], at);
      formant.frequency.linearRampToValueAtTime(to[k], at + length);
      o.connect(formant).connect(g);
    }
    out(g, 0.3, 0.25);
  }

  // One sixteenth note of the arrangement.
  function play(step, at) {
    const t = step * sixteenth;
    const chord = chordAt(t);
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const swung = at + (step % 2 ? sixteenth * SWING : 0);
    // Every fourth four-bar phrase, and whenever the agent naps, the band
    // drops out to the pad and keys.
    const breath = napping || Math.floor(bar / 4) % 4 === 3;
    if (inBar === 0) {
      pad(at, chord, beat * 4 - 0.2, napping ? 0.14 : 0.2);
      chord.slice(1).forEach((n, i) => felt(at + i * 0.02, n, napping ? 0.03 : 0.045, beat * 1.5));
    }
    if (!napping && [3, 6, 11, 14].includes(inBar) && Math.random() < (breath ? 0.4 : 0.6)) {
      felt(swung, pick(chord.slice(1)) + 12, 0.04, 0.4);
    }
    if (breath) {
      return;
    }
    if (inBar === 0) {
      sub(at, chord[0] - 12, beat * 1.5, 0.22);
    }
    if (inBar === 0 || inBar === 10) {
      kick(swung, 0.45);
    }
    if (inBar === 8) {
      clap(at, 0.09);
    }
    if (inBar % 2 === 1) {
      tick(swung, 0.018);
    }
  }

  const when = (t) => Math.max(t + offset + 0.01, ctx.currentTime);

  return {
    // `t` is the scene time.
    async toggle(t) {
      if (!ctx) {
        build();
      }
      if (on) {
        on = false;
        bus.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
        setTimeout(() => {
          if (!on) {
            ctx.suspend();
          }
        }, 600);
        return false;
      }
      await ctx.resume();
      on = true;
      resync = true;
      next = Math.ceil(t / sixteenth);
      bus.master.gain.cancelScheduledValues(ctx.currentTime);
      bus.master.gain.setTargetAtTime(0.75, ctx.currentTime, 0.3);
      return true;
    },

    update(t) {
      if (!on) {
        return;
      }
      // The scene's clock and the audio clock drift apart a little; re-anchor
      // if they part by more than a few frames.
      if (resync || Math.abs(ctx.currentTime - (t + offset)) > 0.08) {
        offset = ctx.currentTime - t + 0.05;
        resync = false;
      }
      next = Math.max(next, Math.ceil(t / sixteenth));
      while (next * sixteenth < t + LOOKAHEAD) {
        play(next, next * sixteenth + offset);
        next += 1;
      }
    },

    // The agent logged a thought: a small chirp in key.
    say(t) {
      if (on) {
        chirp(when(t), pick(chordAt(t)) + 24, 0.035, 0.14 + Math.random() * 0.12);
      }
    },

    // The agent woke up: a rising phrase.
    spawn(t) {
      if (on) {
        chordAt(t)
          .slice(1, 4)
          .forEach((n, i) => felt(when(t) + i * 0.09, n + 12, 0.05, 0.3));
      }
    },

    // A boop: one felt note and a happy chirp.
    snap(t) {
      if (on) {
        const chord = chordAt(t);
        felt(when(t), chord[chord.length - 1] + 12, 0.06, 0.3);
        chirp(when(t) + 0.05, chord[2] + 24, 0.04, 0.12);
      }
    },

    // While the agent naps the band drops out to the pad and keys.
    nap(asleep) {
      napping = asleep;
    },

    // Six levels from low to high, 0 to 1, or null while the music is off.
    levels() {
      if (!on) {
        return null;
      }
      bus.analyser.getByteFrequencyData(bus.bins);
      return [1, 2, 4, 7, 11, 16].map((bin) => bus.bins[bin] / 255);
    },

    pause() {
      if (ctx && on) {
        ctx.suspend();
      }
    },

    resume() {
      if (ctx && on) {
        ctx.resume();
        resync = true;
      }
    },

    stop() {
      on = false;
      ctx?.suspend();
    },
  };
}
