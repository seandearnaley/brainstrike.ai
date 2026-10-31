// The music of brainstrike.ai's backdrop: a small Web Audio synth that plays
// on the scene's own clock, so the pipes turn on its beat.
//
// It stays silent until the visitor turns it on (browsers allow sound only
// after a gesture anyway). Two 16-bar sections alternate at 100 BPM:
// - Daylight: dreamwave. Pumping saw pads, a plucked FM arpeggio, four on the
//   floor, gated snares, and a dial-up modem chirp into the next section.
// - Night mall: the same tempo in half time, swung, through warped tape. FM
//   electric piano, a fretless FM bass and a shaker.
// Each turn a pipe takes plays a note of the chord; ringing a pipe plays a
// chord in its material's voice, a new pipe rises, a released pull boings.

const SECTION_BARS = 16;
const CHORDS = [
  // Daylight: Fmaj7, G6, Em7, Am9
  [
    [53, 57, 60, 64],
    [55, 59, 62, 64],
    [52, 55, 59, 62],
    [57, 60, 64, 67, 71],
  ],
  // Night mall: Ebm9, Ab13, Dbmaj9, Bbm9
  [
    [51, 54, 58, 61, 65],
    [44, 54, 58, 60, 65],
    [49, 53, 56, 60, 63],
    [46, 49, 53, 56, 60],
  ],
];
const ARP = [0, 2, 4, 6, 7, 5, 3, 1];
const TAPE = [
  { detune: 0, tone: 9500, wow: 4 },
  { detune: -45, tone: 3200, wow: 14 },
];
const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead of the picture

const hz = (note) => 440 * 2 ** ((note - 69) / 12);

export function createSynth(bpm) {
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  const sectionLength = SECTION_BARS * 4 * beat;
  let ctx = null;
  let bus = null;
  let on = false;
  let offset = 0; // audio time minus scene time
  let next = 0; // the next sixteenth to schedule
  let resync = true;
  let lastTurn = -1;
  let tapeSection = -1;

  const sectionAt = (t) => Math.floor(t / sectionLength) % 2;
  const chordAt = (t) => CHORDS[sectionAt(t)][Math.floor(t / (beat * 4)) % 4];

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
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = TAPE[0].tone;
    tone.connect(limiter);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(tone);

    // A long reverb from decaying noise.
    const verb = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 3);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = ir.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      }
    }
    verb.buffer = ir;
    const verbIn = ctx.createGain();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.5;
    verbIn.connect(verb).connect(verbOut).connect(master);

    // Pads and bass duck under every Daylight kick.
    const pump = ctx.createGain();
    pump.connect(master);

    // Tape wow: one slow wobble every oscillator's pitch follows.
    const wowSource = ctx.createOscillator();
    wowSource.frequency.value = 0.5;
    const wow = ctx.createGain();
    wow.gain.value = TAPE[0].wow;
    wowSource.connect(wow);
    wowSource.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.random() * 2 - 1;
    }
    bus = { analyser, bins: new Uint8Array(analyser.frequencyBinCount), detune: 0, master, noise, pump, tone, verb: verbIn, wow };
  }

  // An oscillator that follows the tape's pitch.
  function osc(type, frequency, at, end) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.detune.value = bus.detune;
    bus.wow.connect(o.detune);
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

  function out(node, reverb, destination = bus.master) {
    node.connect(destination);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      node.connect(send).connect(bus.verb);
    }
  }

  // Two-operator FM: the bell, pluck, electric piano and bass all come from
  // this, with a different ratio and brightness.
  function fm(at, note, level, length, ratio, index, tine) {
    const f = hz(note);
    const end = at + length + 1.6;
    const carrier = osc('sine', f, at, end);
    const mod = osc('sine', f * ratio, at, end);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * index, at);
    depth.gain.exponentialRampToValueAtTime(f * 0.1 + 1, at + Math.min(0.9, length + 0.3));
    mod.connect(depth).connect(carrier.frequency);
    if (tine) {
      const t = osc('sine', f * 14, at, at + 0.2);
      const td = ctx.createGain();
      td.gain.setValueAtTime(f * 0.7, at);
      td.gain.exponentialRampToValueAtTime(1, at + 0.06);
      t.connect(td).connect(carrier.frequency);
    }
    const g = envelope(at, level, 0.004, length + 1.2);
    carrier.connect(g);
    return g;
  }

  const epiano = (at, note, level, length) => out(fm(at, note, level, length, 1, 2.2, true), 0.3, bus.pump);
  const bell = (at, note, level) => out(fm(at, note, level, 1.4, 3.5, 3, false), 0.5);
  const pluck = (at, note, level) => out(fm(at, note, level, 0.12, 2, 1.6, false), 0.35);
  const kalimba = (at, note, level) => out(fm(at, note, level, 0.5, 7, 1.2, false), 0.45);

  // Detuned saws, through a sweeping low-pass (pad) or two vowel formants
  // (choir).
  function swell(at, notes, length, level, choir) {
    const sum = ctx.createGain();
    sum.gain.value = 0.12;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.9);
    g.gain.setValueAtTime(level, at + length);
    g.gain.linearRampToValueAtTime(0, at + length + 1.6);
    if (choir) {
      for (const [frequency, q] of [
        [750, 5],
        [1200, 7],
      ]) {
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = frequency;
        formant.Q.value = q;
        sum.connect(formant).connect(g);
      }
    } else {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, at);
      filter.frequency.linearRampToValueAtTime(2200, at + length * 0.5);
      filter.frequency.linearRampToValueAtTime(800, at + length + 1);
      sum.connect(filter).connect(g);
    }
    for (const note of notes) {
      for (const detune of [-8, 8]) {
        const o = osc('sawtooth', hz(note), at, at + length + 1.7);
        o.detune.value += detune;
        o.connect(sum);
      }
    }
    out(g, 0.7, bus.pump);
  }

  function bass(at, note, length, level) {
    const g = fm(at, note, level, length, 1, 1.3, false);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    g.connect(filter);
    out(filter, 0, bus.pump);
  }

  function kick(at, level, pump) {
    const o = osc('sine', 120, at, at + 0.4);
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    const g = envelope(at, level, 0.002, 0.32);
    o.connect(g);
    out(g, 0);
    if (pump) {
      bus.pump.gain.cancelScheduledValues(at);
      bus.pump.gain.setValueAtTime(0.35, at);
      bus.pump.gain.setTargetAtTime(1, at + 0.03, 0.09);
    }
  }

  function noiseHit(at, frequency, type, level, length) {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(g);
    out(g, 0);
    src.start(at, Math.random() * 0.5, length + 0.05);
  }

  // The 1980s gated snare: a burst of noise held flat, then cut.
  function snare(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.setValueAtTime(level * 0.75, at + 0.16);
    g.gain.linearRampToValueAtTime(0, at + 0.2);
    src.connect(filter).connect(g);
    out(g, 0.2);
    src.start(at, Math.random() * 0.5, 0.25);
    const body = osc('triangle', 190, at, at + 0.12);
    const bg = envelope(at, level * 0.6, 0.002, 0.1);
    body.connect(bg);
    out(bg, 0);
  }

  // A dial-up modem's handshake, cut down to a musical chirp.
  function chirp(at) {
    for (const [from, to] of [
      [1100, 2300],
      [1650, 1250],
    ]) {
      const o = osc('square', from, at, at + 0.95);
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(to, at + 0.85);
      const warble = ctx.createOscillator();
      warble.frequency.value = 31;
      const depth = ctx.createGain();
      depth.gain.value = from * 0.05;
      warble.connect(depth).connect(o.frequency);
      warble.start(at);
      warble.stop(at + 0.95);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 2;
      const g = envelope(at, 0.03, 0.05, 0.85);
      o.connect(filter).connect(g);
      out(g, 0.6);
    }
  }

  // A tape slowing to a stop, into Night mall.
  function tapeStop(at) {
    const o = osc('sawtooth', 220, at, at + 0.7);
    o.frequency.setValueAtTime(220, at);
    o.frequency.exponentialRampToValueAtTime(30, at + 0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, at);
    filter.frequency.exponentialRampToValueAtTime(200, at + 0.6);
    const g = envelope(at, 0.06, 0.01, 0.6);
    o.connect(filter).connect(g);
    out(g, 0.4);
  }

  // The tape's pitch, wobble and tone move to the section's over a beat.
  function setTape(section, at) {
    if (section === tapeSection) {
      return;
    }
    tapeSection = section;
    const tape = TAPE[section];
    bus.detune = tape.detune;
    bus.tone.frequency.setTargetAtTime(tape.tone, at, beat * 0.5);
    bus.wow.gain.setTargetAtTime(tape.wow, at, beat * 0.5);
  }

  // One sixteenth note of the arrangement.
  function play(step, at) {
    const t = step * sixteenth;
    const section = sectionAt(t);
    const bar = Math.floor(step / 16) % SECTION_BARS;
    const inBar = step % 16;
    const chord = chordAt(t);
    if (step % (SECTION_BARS * 16) === 0) {
      setTape(section, at);
      if (section === 1) {
        tapeStop(at - beat * 0.5);
      }
    }
    if (section === 0) {
      if (inBar === 0) {
        swell(at, chord, beat * 4 - 0.2, 0.24, false);
      }
      if (inBar % 4 === 0) {
        kick(at, bar < 4 ? 0.45 : 0.7, true);
      }
      if (bar >= 4) {
        const tones = [...chord, ...chord.map((n) => n + 12)];
        pluck(at, tones[ARP[step % 8] % tones.length] + 12, 0.032);
        if (inBar % 4 === 2) {
          noiseHit(at, 8000, 'highpass', 0.03, 0.06);
        }
      }
      if (bar >= 8) {
        if (inBar === 4 || inBar === 12) {
          snare(at, 0.28);
        }
        if (inBar % 2 === 0) {
          bass(at, chord[0] - 24, sixteenth * 1.6, 0.2);
        }
      }
      if (bar === SECTION_BARS - 1 && inBar === 12) {
        chirp(at);
      }
    } else {
      // Half time and swung: every other sixteenth lands late.
      const swung = at + (step % 2 ? sixteenth * 0.28 : 0);
      const nextChord = chordAt(t + beat * 4);
      if (inBar === 0) {
        chord.slice(1).forEach((n) => epiano(at, n, 0.05, beat * 1.4));
        bass(at, chord[0] - 12, beat * 1.2, 0.22);
      }
      if (inBar === 6) {
        chord.slice(1).forEach((n) => epiano(swung, n, 0.035, beat * 0.6));
      }
      if (inBar === 7) {
        bass(swung, chord[0] - 5, beat * 0.5, 0.16);
      }
      if (inBar === 10) {
        bass(at, chord[0], beat * 0.7, 0.16);
      }
      if (inBar === 14) {
        bass(at, nextChord[0] - 13, beat * 0.4, 0.15);
      }
      if (inBar === 0 || inBar === 6) {
        kick(swung, 0.5, false);
      }
      if (inBar === 8) {
        snare(at, 0.24);
      }
      noiseHit(swung, 7500, 'highpass', step % 2 ? 0.02 : 0.01, 0.05);
    }
  }

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
      tapeSection = -1;
      setTape(sectionAt(t), ctx.currentTime);
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

    // A pipe turned at scene time `at`: one note of the chord, at most one a
    // sixteenth.
    turn(at, material) {
      if (!on || at - lastTurn < sixteenth * 0.9) {
        return;
      }
      lastTurn = at;
      const chord = chordAt(at);
      const note = chord[Math.floor(Math.random() * chord.length)] + 24;
      const when = Math.max(at + offset, ctx.currentTime);
      if (sectionAt(at) === 1) {
        epiano(when, note, 0.04, 0.3);
      } else if (material === 1 || material === 4) {
        kalimba(when, note, 0.05);
      } else {
        bell(when, note, 0.045);
      }
    },

    // A rung pipe plays the chord in its material's voice.
    ring(t, material) {
      if (!on) {
        return;
      }
      const at = Math.max(t + offset + 0.01, ctx.currentTime);
      const chord = chordAt(t);
      if (material === 0) {
        chord.forEach((n, i) => bell(at + i * 0.04, n + 24, 0.05));
      } else if (material === 1) {
        chord.forEach((n, i) => pluck(at + i * 0.03, n + 24, 0.05));
      } else if (material === 2) {
        swell(at, chord.map((n) => n + 12), beat * 2, 0.3, true);
      } else if (material === 3) {
        chord.forEach((n) => epiano(at, n + 12, 0.05, beat));
      } else {
        chord.forEach((n, i) => kalimba(at + i * 0.05, n + 24, 0.05));
      }
    },

    // A new pipe: three notes rising.
    spawn(t) {
      if (!on) {
        return;
      }
      const at = Math.max(t + offset + 0.01, ctx.currentTime);
      chordAt(t)
        .slice(0, 3)
        .forEach((n, i) => pluck(at + i * 0.07, n + 24 + (i === 2 ? 12 : 0), 0.05));
    },

    // A released pull: a rubbery drop in pitch.
    snap(t) {
      if (!on) {
        return;
      }
      const at = Math.max(t + offset + 0.01, ctx.currentTime);
      const o = osc('sine', 620, at, at + 0.32);
      o.frequency.setValueAtTime(620, at);
      o.frequency.exponentialRampToValueAtTime(150, at + 0.25);
      const g = envelope(at, 0.12, 0.002, 0.3);
      o.connect(g);
      out(g, 0.3);
    },

    // Six levels from low to high, 0 to 1, or null while the music is off.
    levels() {
      if (!on) {
        return null;
      }
      bus.analyser.getByteFrequencyData(bus.bins);
      const bands = [1, 2, 4, 7, 11, 16];
      return bands.map((bin) => bus.bins[bin] / 255);
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
