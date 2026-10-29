// The music of brainstrike.ai's backdrop: a small Web Audio synth that plays
// on the scene's own clock, so every kick lands with the picture's.
//
// It stays silent until the visitor turns it on (browsers allow sound only
// after a gesture anyway). The arrangement grows with the scene's area: pads,
// kick and hats; then an arpeggio; then offbeat bass and claps; then the
// arpeggio an octave up. Strikes, shape changes and releases play their own
// notes, and a riser leads into every change of shape.

// Four chords, two bars each, in MIDI notes: Dmaj9, Bm9, Gmaj9 and Asus.
const CHORDS = [
  [50, 54, 57, 61, 64],
  [47, 50, 54, 57, 61],
  [43, 47, 50, 54, 57],
  [45, 50, 52, 57, 59],
];
const ARP = [0, 2, 4, 1, 3, 5, 2, 6];
const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead of the picture

const hz = (note) => 440 * 2 ** ((note - 69) / 12);

export function createSynth(bpm) {
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  let ctx = null;
  let bus = null;
  let on = false;
  let offset = 0; // audio time minus scene time
  let next = 0; // the next sixteenth to schedule
  let area = 0;
  let resync = true;

  const chordAt = (t) => CHORDS[Math.floor(t / (beat * 8)) % CHORDS.length];

  function build() {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    // A long, dark reverb from decaying noise.
    const verb = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 2.8);
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
    const delay = ctx.createDelay(2);
    delay.delayTime.value = beat * 0.75;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const delayIn = ctx.createGain();
    delayIn.connect(delay).connect(damp).connect(feedback).connect(delay);
    damp.connect(master);
    damp.connect(verbIn);

    // Pads and bass duck under every kick.
    const pump = ctx.createGain();
    pump.connect(master);
    const padVerb = ctx.createGain();
    padVerb.gain.value = 0.6;
    pump.connect(padVerb).connect(verbIn);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.random() * 2 - 1;
    }
    bus = { delay: delayIn, master, noise, pump, verb: verbIn };
  }

  // A gain envelope: up to `level` at `at`, down to silence over `decay`.
  function envelope(at, level, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    return g;
  }

  function send(node, target, level) {
    const g = ctx.createGain();
    g.gain.value = level;
    node.connect(g).connect(target);
  }

  function kick(at, level) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(46, at + 0.13);
    o.connect(envelope(at, level, 0.36)).connect(bus.master);
    o.start(at);
    o.stop(at + 0.4);
    bus.pump.gain.cancelScheduledValues(at);
    bus.pump.gain.setValueAtTime(0.35, at);
    bus.pump.gain.setTargetAtTime(1, at + 0.02, beat * 0.22);
  }

  function noiseHit(at, { decay, freq, level, reverb = 0, type }) {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const g = envelope(at, level, decay);
    src.connect(filter).connect(g).connect(bus.master);
    if (reverb > 0) {
      send(g, bus.verb, reverb);
    }
    src.start(at, Math.random() * 0.5, decay + 0.05);
  }

  function pad(at, notes, length) {
    for (const note of notes) {
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(note);
        o.detune.value = detune;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, at);
        filter.frequency.linearRampToValueAtTime(1800, at + length * 0.5);
        filter.frequency.linearRampToValueAtTime(700, at + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.02, at + 0.8);
        g.gain.setValueAtTime(0.02, at + length - 0.2);
        g.gain.linearRampToValueAtTime(0, at + length + 1.2);
        o.connect(filter).connect(g).connect(bus.pump);
        o.start(at);
        o.stop(at + length + 1.3);
      }
    }
  }

  function pluck(at, note, level, echo) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, at);
    filter.frequency.exponentialRampToValueAtTime(320, at + 0.28);
    const g = envelope(at, level, 0.32);
    o.connect(filter).connect(g).connect(bus.master);
    send(g, bus.delay, echo);
    send(g, bus.verb, 0.3);
    o.start(at);
    o.stop(at + 0.35);
  }

  // An FM bell, for strikes: bright at first, then a pure tone.
  function bell(at, note, level) {
    const carrier = ctx.createOscillator();
    carrier.frequency.value = hz(note);
    const mod = ctx.createOscillator();
    mod.frequency.value = hz(note) * 3.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(hz(note) * 2.4, at);
    depth.gain.exponentialRampToValueAtTime(1, at + 1.2);
    mod.connect(depth).connect(carrier.frequency);
    const g = envelope(at, level, 1.8);
    carrier.connect(g).connect(bus.master);
    send(g, bus.delay, 0.45);
    send(g, bus.verb, 0.5);
    for (const o of [carrier, mod]) {
      o.start(at);
      o.stop(at + 1.9);
    }
  }

  function bass(at, note) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 2;
    o.connect(filter).connect(envelope(at, 0.13, 0.2)).connect(bus.pump);
    o.start(at);
    o.stop(at + 0.22);
  }

  // Filtered noise sweeping up over one beat, into a change of shape.
  function riser(at) {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(400, at);
    filter.frequency.exponentialRampToValueAtTime(7000, at + beat);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.07, at + beat * 0.95);
    g.gain.linearRampToValueAtTime(0, at + beat);
    src.connect(filter).connect(g).connect(bus.master);
    send(g, bus.verb, 0.6);
    src.start(at);
    src.stop(at + beat + 0.05);
  }

  // One sixteenth note of the arrangement.
  function play(step, at) {
    const inBeat = step % 4;
    const beatIndex = Math.floor(step / 4);
    const chord = chordAt(step * sixteenth);
    const part = area % 4;
    if (inBeat === 0) {
      kick(at, beatIndex % 4 === 0 ? 0.85 : 0.7);
    }
    noiseHit(at, inBeat === 2 ? { decay: 0.09, freq: 7000, level: 0.05, type: 'highpass' } : { decay: 0.035, freq: 8000, level: 0.016, type: 'highpass' });
    if (part >= 2 && inBeat === 0 && beatIndex % 2 === 1) {
      noiseHit(at, { decay: 0.18, freq: 1600, level: 0.15, reverb: 0.5, type: 'bandpass' });
    }
    if (step % 32 === 0) {
      pad(at, chord, beat * 8);
    }
    if (part >= 2 && inBeat === 2) {
      bass(at, chord[0] - 12);
    }
    if (part >= 1) {
      const tones = [...chord.slice(1), ...chord.slice(1).map((n) => n + 12)];
      pluck(at, tones[ARP[step % 8]] + (part === 3 ? 24 : 12), 0.03, 0.3);
    }
    if (step % 64 === 60) {
      riser(at);
    }
  }

  return {
    // The scene time `at`, in audio time.
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
      bus.master.gain.setTargetAtTime(0.8, ctx.currentTime, 0.25);
      return true;
    },

    update(t, sceneArea) {
      if (!on) {
        return;
      }
      area = sceneArea;
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

    strike(at) {
      if (on) {
        const chord = chordAt(at);
        bell(at + offset, chord[Math.floor(Math.random() * chord.length)] + 24, 0.09);
      }
    },

    morph(t) {
      if (on) {
        chordAt(t).forEach((note, i) => pluck(t + offset + 0.01 + i * 0.035, note + 24, 0.05, 0.4));
      }
    },

    // A release: a rubbery drop in pitch.
    snap(t) {
      if (!on) {
        return;
      }
      const at = t + offset + 0.01;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(620, at);
      o.frequency.exponentialRampToValueAtTime(150, at + 0.25);
      const g = envelope(at, 0.12, 0.3);
      o.connect(g).connect(bus.master);
      send(g, bus.verb, 0.3);
      o.start(at);
      o.stop(at + 0.32);
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
