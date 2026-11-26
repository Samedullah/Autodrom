export interface VehicleAudioState {
  dt: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  drift: number;
  rain: number;
  active: boolean;
}

type SoundLayer = 'idle' | 'load' | 'skid';
type WeatherClip = 'rain' | 'thunder';

const AUDIO_FILES: Record<SoundLayer, string> = {
  idle: '/assets/audio/cars/default/engine-idle.ogg',
  load: '/assets/audio/cars/default/engine-load.ogg',
  skid: '/assets/audio/cars/default/tire-skid.ogg',
};

// Candidate locations checked in order so yagmur.ogg / simsek.ogg work whether placed
// in public/assets/audio/, public/assets/audio/weather/, public/assets/audio/cars/default/, or public/.
const WEATHER_CANDIDATES: Record<WeatherClip, readonly string[]> = {
  rain: [
    '/assets/audio/yagmur.ogg',
    '/assets/audio/weather/yagmur.ogg',
    '/assets/audio/cars/default/yagmur.ogg',
    '/yagmur.ogg',
  ],
  thunder: [
    '/assets/audio/simsek.ogg',
    '/assets/audio/weather/simsek.ogg',
    '/assets/audio/cars/default/simsek.ogg',
    '/simsek.ogg',
  ],
};

const RAIN_MAX_VOLUME = 0.88;
const THUNDER_VOLUME = 0.85;
const WEATHER_RETRY_SECONDS = 6;

const IDLE_RPM = 851;
const REDLINE_RPM = 7050;
const LOAD_WINDOW_SECONDS = 0.16;
// Share of each grain spent crossfading into the next one.
const LOAD_CROSSFADE_SHARE = 0.5;
const LIMITER_HZ = 18;
// Lift-off backfire: overall loudness and the rpm below which the exhaust stays quiet.
const POP_VOLUME = 0.55;
const POP_MIN_RPM = 3000;

const SCRUBBER_WORKLET_NAME = 'autodrom-load-scrubber';
const SCRUBBER_WORKLET_CODE = `
class AutodromLoadScrubber extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;
    this.length = 0;
    this.step = 1;
    this.windowSamples = 2048;
    this.fadeSamples = 1024;
    this.targetOffset = 0;
    this.limiter = false;
    this.current = 0;
    this.previous = 0;
    this.fade = 1;
    this.counter = 0;
    this.limiterPhase = 0;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'init') {
        this.channels = msg.channels;
        this.length = msg.channels[0] ? msg.channels[0].length : 0;
        this.step = msg.step;
        this.windowSamples = msg.windowSamples;
        this.fadeSamples = msg.fadeSamples;
        this.targetOffset = msg.targetOffset;
        this.current = msg.targetOffset;
      } else if (msg.type === 'state') {
        this.targetOffset = msg.targetOffset;
        this.limiter = msg.limiter;
      }
    };
  }
  read(ch, pos) {
    const idx = Math.min(this.length - 2, Math.max(0, pos));
    const base = idx | 0;
    const t = idx - base;
    return ch[base] * (1 - t) + ch[base + 1] * t;
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !this.channels || this.length < 4) return true;
    const nFrames = out[0].length;
    const nOut = out.length;
    const nIn = this.channels.length;
    for (let i = 0; i < nFrames; i++) {
      if (this.counter >= this.windowSamples - this.fadeSamples || this.current >= this.length - 2) {
        this.previous = this.current;
        this.current = Math.min(this.targetOffset, Math.max(0, this.length - 2 - this.windowSamples * this.step));
        this.fade = 0;
        this.counter = 0;
      }
      let limiterGain = 1;
      if (this.limiter) {
        limiterGain = Math.sin(this.limiterPhase * 6.2831853) > 0.15 ? 1 : 0.28;
        this.limiterPhase += ${LIMITER_HZ} / sampleRate;
        if (this.limiterPhase >= 1) this.limiterPhase -= 1;
      }
      const fadeIn = this.fade < 1 ? Math.sin(this.fade * 1.5707963) : 1;
      const fadeOut = this.fade < 1 ? Math.cos(this.fade * 1.5707963) : 0;
      for (let c = 0; c < nOut; c++) {
        const input = this.channels[c < nIn ? c : nIn - 1];
        let s = this.read(input, this.current) * fadeIn;
        if (this.fade < 1) s += this.read(input, this.previous) * fadeOut;
        out[c][i] = s * limiterGain;
      }
      this.current += this.step;
      if (this.fade < 1) {
        this.previous += this.step;
        this.fade = Math.min(1, this.fade + 1 / this.fadeSamples);
      }
      this.counter++;
    }
    return true;
  }
}
registerProcessor('${SCRUBBER_WORKLET_NAME}', AutodromLoadScrubber);
`;

const registeredContexts = new WeakSet<AudioContext>();

/** Small Web Audio layer for the player's vehicle. Missing audio files stay silent. */
export class VehicleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly gains: Partial<Record<SoundLayer, GainNode>> = {};
  private readonly sources: Partial<Record<SoundLayer, AudioBufferSourceNode>> = {};
  private loadScrubber: AudioNode | null = null;
  private loadWorkletPort: MessagePort | null = null;
  private scrubberStarting = false;
  private lastSentOffset = -1;
  private lastSentLimiter = false;
  // Where in the recorded sweep the engine's RPM sits (recording samples), and the limiter.
  private readonly loadState = { targetOffset: 0, limiter: false };
  private readonly buffers: Partial<Record<SoundLayer, AudioBuffer>> = {};
  private loading: Promise<void> | null = null;
  private downloads: Promise<Partial<Record<SoundLayer, ArrayBuffer>>> | null = null;
  private rpm = IDLE_RPM;
  private disposed = false;
  // Overrun pops/crackles (synthesised, no asset needed).
  private popGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private recentThrottle = 0;   // decaying peak of recent throttle, detects a lift-off
  private overrunTime = -1;      // seconds since the throttle was lifted (-1 = on throttle)
  private nextPopAt = 0;        // context time of the next allowed random crackle
  // Weather audio: seamless rain loop (yagmur.ogg) and one-shot thunder strikes (simsek.ogg).
  private readonly weatherBuffers: Partial<Record<WeatherClip, AudioBuffer>> = {};
  private readonly weatherRaw: Partial<Record<WeatherClip, ArrayBuffer>> = {};
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private thunderGain: GainNode | null = null;
  private weatherLoading = false;
  private lastWeatherRetryAt = -Infinity;

  async unlock(): Promise<void> {
    if (this.disposed || typeof window === 'undefined') return;
    try {
      if (!this.context) {
        const AudioContextConstructor = window.AudioContext;
        if (!AudioContextConstructor) return;
        this.context = new AudioContextConstructor();
        this.master = this.context.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(this.context.destination);
        for (const layer of Object.keys(AUDIO_FILES) as SoundLayer[]) {
          const gain = this.context.createGain();
          gain.gain.value = 0;
          gain.connect(this.master);
          this.gains[layer] = gain;
        }
        this.popGain = this.context.createGain();
        this.popGain.gain.value = POP_VOLUME;
        this.popGain.connect(this.master);
        this.noiseBuffer = this.createNoiseBuffer(this.context);

        this.rainFilter = this.context.createBiquadFilter();
        this.rainFilter.type = 'lowpass';
        this.rainFilter.frequency.value = 5000;
        this.rainGain = this.context.createGain();
        this.rainGain.gain.value = 0;
        this.rainFilter.connect(this.rainGain);
        this.rainGain.connect(this.master);

        this.thunderGain = this.context.createGain();
        this.thunderGain.gain.value = THUNDER_VOLUME;
        this.thunderGain.connect(this.master);
      }
      if (this.context.state !== 'running') await this.context.resume();
      this.loading ??= this.loadBuffers();
      await this.loading;
      await this.decodeWeatherBuffers();
      this.startLoops();
    } catch {
      // Audio is optional; browser policy or a missing device must not affect driving.
    }
  }

  update(state: VehicleAudioState): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.disposed) return;

    const throttle = state.active ? Math.min(1, Math.max(0, state.throttle)) : 0;
    const speedBlend = Math.min(1, Math.max(0, state.speedKmh / 180));
    const freeRevTarget = IDLE_RPM + throttle * (REDLINE_RPM - IDLE_RPM)
      * (state.gear === 0 ? 1 : speedBlend < 0.06 ? 0.48 : 0.08);
    // In gear the engine model already gives the real rpm (clutch slip, wheelspin, limiter).
    const targetRpm = state.gear === 0 ? freeRevTarget : state.rpm;
    const rpmResponse = state.gear === 0 ? (throttle > 0 ? 7 : 3) : 18;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-rpmResponse * Math.max(0, state.dt)));

    const rpmBlend = Math.min(1, Math.max(0, (this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const audible = state.active ? 1 : 0;
    const idleGain = audible * (0.23 + (1 - throttle) * 0.08) * (1 - rpmBlend * 0.9);
    // Off-throttle (engine braking / overrun) floor raised so lifting off stays audible;
    // full-throttle level is unchanged (0.22 + 0.46 = 0.68).
    const loadGain = audible * (0.22 + throttle * 0.46) * (0.28 + rpmBlend * 0.72);
    const skidGain = audible * Math.min(1, Math.max(0, state.drift)) * 0.55;
    const now = context.currentTime;

    this.setLayer('idle', idleGain, 1, now);
    this.setLayer('load', loadGain, 1, now);
    this.updateLoadScrubber(this.rpm, this.rpm >= REDLINE_RPM - 30);
    this.setLayer('skid', skidGain, 0.9 + Math.min(0.3, state.drift * 0.3), now);
    this.updateOverrun(state, throttle, now);
    this.updateRainAudio(state.rain, speedBlend, state.active, now);
  }

  /** Plays a one-shot thunder clap (simsek.ogg) with slight natural distance & pitch variation. */
  playThunder(intensity = 1, immediate = false): void {
    void this.unlock().then(() => {
      const context = this.context;
      const out = this.thunderGain;
      if (!context || context.state !== 'running' || !out || this.disposed) return;
      const buffer = this.weatherBuffers.thunder;
      if (!buffer) {
        this.retryMissingWeather(context.currentTime, () => this.playThunder(intensity, true));
        return;
      }
      const now = context.currentTime;
      const delay = immediate ? 0.015 : 0.06 + Math.random() * 0.24;
      const startAt = now + delay;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 0.88 + Math.random() * 0.22;
      const strikeGain = context.createGain();
      strikeGain.gain.value = Math.min(1.25, Math.max(0.35, intensity)) * (0.85 + Math.random() * 0.25);
      source.connect(strikeGain).connect(out);
      source.onended = () => {
        source.disconnect();
        strikeGain.disconnect();
      };
      source.start(startAt);
    });
  }

  private updateRainAudio(rainAmount: number, speedBlend: number, drivingActive: boolean, now: number): void {
    const rain = Math.min(1, Math.max(0, rainAmount));
    if (rain > 0.01 && !this.weatherBuffers.rain) {
      this.retryMissingWeather(now);
    }
    if (rain > 0.005 && !this.rainSource && this.weatherBuffers.rain) {
      this.startRainLoop();
    }
    if (!this.rainGain || !this.rainFilter) return;
    // Audible right from 5-15% drizzle (~0.17 gain, crisp 3.6+ kHz drops) and scaling steadily
    // up to a loud 0.88 downpour at 100%.
    const focusShare = drivingActive ? 1 : 0.85;
    const intensityCurve = 0.16 + 0.84 * Math.pow(rain, 1.05);
    const targetGain = rain > 0.005
      ? intensityCurve * RAIN_MAX_VOLUME * (1 + 0.16 * speedBlend) * focusShare
      : 0;
    this.rainGain.gain.setTargetAtTime(targetGain, now, 0.12);
    const cutoffHz = 3600 + rain * 8400 + speedBlend * 1400;
    this.rainFilter.frequency.setTargetAtTime(cutoffHz, now, 0.16);
    if (this.rainSource) {
      const rate = 0.96 + rain * 0.10 + speedBlend * 0.05;
      this.rainSource.playbackRate.setTargetAtTime(rate, now, 0.16);
    }
  }

  /** Lift-off backfire: a burst of pops right after the lift, then sparse crackles while overrunning at high rpm. */
  private updateOverrun(state: VehicleAudioState, throttle: number, now: number): void {
    const dt = Math.max(0, state.dt);
    const wasOnThrottle = this.recentThrottle;
    this.recentThrottle = Math.max(throttle, this.recentThrottle * Math.exp(-dt / 0.35));
    if (!state.active) { this.overrunTime = -1; return; }

    if (throttle > 0.2) { this.overrunTime = -1; return; }
    const rpmFactor = Math.min(1, Math.max(0, (this.rpm - POP_MIN_RPM) / (REDLINE_RPM - POP_MIN_RPM)));
    if (this.overrunTime < 0) {
      // Fresh lift: only a real lift (was clearly on the gas) at decent rpm triggers the burst.
      this.overrunTime = 0;
      if (wasOnThrottle > 0.55 && rpmFactor > 0) {
        const count = 2 + Math.round(rpmFactor * 4 + Math.random() * 2);
        let t = now + 0.04 + Math.random() * 0.06;
        for (let i = 0; i < count; i += 1) {
          this.schedulePop(t, (0.55 + rpmFactor * 0.45) * (1 - i / (count + 2)));
          t += 0.045 + Math.random() * 0.11;
        }
        this.nextPopAt = t + 0.1;
      }
      return;
    }
    this.overrunTime += dt;
    // Sparse crackle while still coasting at high rpm, fading out over ~2.5 s.
    const overrunFade = Math.max(0, 1 - this.overrunTime / 2.5);
    if (rpmFactor > 0.15 && overrunFade > 0 && now >= this.nextPopAt) {
      this.schedulePop(now + 0.01, 0.35 * rpmFactor * overrunFade + 0.1);
      this.nextPopAt = now + 0.08 + Math.random() * 0.35 / Math.max(0.3, rpmFactor);
    }
  }

  private schedulePop(at: number, strength: number): void {
    const context = this.context;
    const out = this.popGain;
    const noise = this.noiseBuffer;
    if (!context || !out || !noise || strength <= 0) return;
    const level = Math.min(1, strength) * (0.8 + Math.random() * 0.4);

    // Sharp crack: a short noise burst through a band-pass, fast exponential decay.
    const source = context.createBufferSource();
    source.buffer = noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.5;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 + Math.random() * 1400;
    band.Q.value = 0.9;
    const crackGain = context.createGain();
    const crackLength = 0.05 + Math.random() * 0.05;
    crackGain.gain.setValueAtTime(0.0001, at);
    crackGain.gain.exponentialRampToValueAtTime(level, at + 0.003);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, at + crackLength);
    source.connect(band).connect(crackGain).connect(out);
    source.start(at, Math.random() * (noise.duration - 0.2), crackLength + 0.02);

    // Low "thump" body of the pop: a quick downward pitch sweep.
    const thump = context.createOscillator();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(140 + Math.random() * 60, at);
    thump.frequency.exponentialRampToValueAtTime(45, at + 0.08);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.0001, at);
    thumpGain.gain.exponentialRampToValueAtTime(level * 0.9, at + 0.004);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
    thump.connect(thumpGain).connect(out);
    thump.start(at);
    thump.stop(at + 0.12);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  dispose(): void {
    this.disposed = true;
    for (const source of Object.values(this.sources)) {
      try { source?.stop(); } catch { /* a source may not have started */ }
      source?.disconnect();
    }
    try { this.rainSource?.stop(); } catch { /* may not have started */ }
    this.rainSource?.disconnect();
    this.rainSource = null;
    this.rainFilter?.disconnect();
    this.rainFilter = null;
    this.rainGain?.disconnect();
    this.rainGain = null;
    this.thunderGain?.disconnect();
    this.thunderGain = null;
    this.loadScrubber?.disconnect();
    this.loadScrubber = null;
    this.loadWorkletPort = null;
    this.master?.disconnect();
    this.popGain?.disconnect();
    this.popGain = null;
    for (const gain of Object.values(this.gains)) gain?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
    this.master = null;
  }

  // Downloads the clips ahead of time (no user gesture needed), so sound can
  // start the moment the first input unlocks the audio context.
  prefetch(): Promise<void> {
    if (!this.downloads) {
      this.downloads = (async () => {
        const files: Partial<Record<SoundLayer, ArrayBuffer>> = {};
        await Promise.all((Object.entries(AUDIO_FILES) as [SoundLayer, string][]).map(async ([layer, url]) => {
          try {
            const response = await fetch(url);
            if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) {
              files[layer] = await response.arrayBuffer();
            }
          } catch {
            // Files will be added later; silently skip absent clips.
          }
        }));
        await this.fetchMissingWeatherRaw();
        return files;
      })();
    }
    return this.downloads.then(() => undefined);
  }

  private async loadBuffers(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await this.prefetch();
    const files = await this.downloads!;
    await Promise.all((Object.entries(files) as [SoundLayer, ArrayBuffer][]).map(async ([layer, data]) => {
      try {
        // decodeAudioData detaches its input, so decode a copy.
        this.buffers[layer] = await context.decodeAudioData(data.slice(0));
      } catch {
        // Unsupported clip: skip it.
      }
    }));
  }

  private startLoops(): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.disposed) return;
    for (const layer of Object.keys(AUDIO_FILES) as SoundLayer[]) {
      const buffer = this.buffers[layer];
      const gain = this.gains[layer];
      if (!buffer || !gain || this.sources[layer] || layer === 'load') continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      this.sources[layer] = source;
    }
    this.startRainLoop();
    this.startLoadScrubber();
  }

  private startRainLoop(): void {
    const context = this.context;
    const buffer = this.weatherBuffers.rain;
    const filter = this.rainFilter;
    if (!context || context.state !== 'running' || !buffer || !filter || this.rainSource || this.disposed) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    source.start();
    this.rainSource = source;
  }

  private async fetchMissingWeatherRaw(): Promise<void> {
    await Promise.all((Object.keys(WEATHER_CANDIDATES) as WeatherClip[]).map(async (clip) => {
      if (this.weatherRaw[clip] || this.weatherBuffers[clip]) return;
      for (const url of WEATHER_CANDIDATES[clip]) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('text/html')) continue;
          const buf = await response.arrayBuffer();
          if (buf.byteLength > 64) {
            this.weatherRaw[clip] = buf;
            break;
          }
        } catch {
          // Try next candidate path.
        }
      }
    }));
  }

  private async decodeWeatherBuffers(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await Promise.all((Object.keys(WEATHER_CANDIDATES) as WeatherClip[]).map(async (clip) => {
      if (this.weatherBuffers[clip] || !this.weatherRaw[clip]) return;
      try {
        this.weatherBuffers[clip] = await context.decodeAudioData(this.weatherRaw[clip]!.slice(0));
      } catch {
        delete this.weatherRaw[clip];
      }
    }));
  }

  private retryMissingWeather(now: number, onLoaded?: () => void): void {
    if (this.weatherLoading || now - this.lastWeatherRetryAt < WEATHER_RETRY_SECONDS) return;
    this.lastWeatherRetryAt = now;
    this.weatherLoading = true;
    void (async () => {
      try {
        await this.fetchMissingWeatherRaw();
        await this.decodeWeatherBuffers();
        if (this.weatherBuffers.rain && !this.rainSource) this.startRainLoop();
        if (onLoaded && this.weatherBuffers.thunder) onLoaded();
      } finally {
        this.weatherLoading = false;
      }
    })();
  }

  /**
   * Plays the recorded rev sweep at its own speed from the RPM-mapped point. Every
   * window a new grain starts at the current RPM position and the previous one fades
   * out under it (equal-power, half-window overlap), so the tone follows the RPM
   * without clicks and a steady RPM loops one short stretch seamlessly.
   */
  private startLoadScrubber(): void {
    const context = this.context;
    const buffer = this.buffers.load;
    const gain = this.gains.load;
    if (!context || !buffer || !gain || this.loadScrubber || this.scrubberStarting || this.disposed) return;

    this.mapLoadRpm(this.rpm, buffer);
    const channelCount = Math.max(1, buffer.numberOfChannels);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const step = buffer.sampleRate / context.sampleRate;
    const windowSamples = Math.max(64, Math.floor(Math.min(LOAD_WINDOW_SECONDS, buffer.duration / 2) * context.sampleRate));
    const fadeSamples = Math.max(32, Math.floor(windowSamples * LOAD_CROSSFADE_SHARE));

    // Prefer AudioWorkletNode so audio synthesis runs off the main UI/render thread.
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      this.scrubberStarting = true;
      void (async () => {
        try {
          if (!registeredContexts.has(context)) {
            const blobUrl = URL.createObjectURL(new Blob([SCRUBBER_WORKLET_CODE], { type: 'application/javascript' }));
            try {
              await context.audioWorklet.addModule(blobUrl);
              registeredContexts.add(context);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }
          if (this.disposed || this.context !== context) return;
          const worklet = new AudioWorkletNode(context, SCRUBBER_WORKLET_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [channelCount],
          });
          worklet.port.postMessage({
            type: 'init',
            channels: channels.map((ch) => ch.slice(0)),
            step,
            windowSamples,
            fadeSamples,
            targetOffset: this.loadState.targetOffset,
          });
          worklet.connect(gain);
          this.loadScrubber = worklet;
          this.loadWorkletPort = worklet.port;
          this.lastSentOffset = this.loadState.targetOffset;
          this.lastSentLimiter = this.loadState.limiter;
          return;
        } catch {
          // Fall back to zero-allocation ScriptProcessorNode below.
        } finally {
          this.scrubberStarting = false;
        }
        this.startFallbackScriptScrubber(context, buffer, gain, channels, step, windowSamples, fadeSamples);
      })();
      return;
    }

    this.startFallbackScriptScrubber(context, buffer, gain, channels, step, windowSamples, fadeSamples);
  }

  private startFallbackScriptScrubber(
    context: AudioContext,
    buffer: AudioBuffer,
    gain: GainNode,
    channels: Float32Array[],
    step: number,
    windowSamples: number,
    fadeSamples: number,
  ): void {
    if (this.disposed || this.loadScrubber) return;
    const outChannels = Math.max(1, buffer.numberOfChannels);
    const node = context.createScriptProcessor(2048, 0, outChannels);
    const outputs = new Array<Float32Array>(outChannels);
    const length = buffer.length;
    const state = this.loadState;
    let current = state.targetOffset;
    let previous = 0;
    let fade = 1;
    let counter = 0;
    let limiterPhase = 0;

    const read = (channel: Float32Array, position: number): number => {
      const index = Math.min(length - 2, Math.max(0, position));
      const base = index | 0;
      const t = index - base;
      return channel[base] * (1 - t) + channel[base + 1] * t;
    };

    node.onaudioprocess = (event) => {
      const out = event.outputBuffer;
      const sampleRate = out.sampleRate;
      const nCh = out.numberOfChannels;
      for (let c = 0; c < nCh; c += 1) outputs[c] = out.getChannelData(c);
      for (let i = 0; i < out.length; i += 1) {
        if (counter >= windowSamples - fadeSamples || current >= length - 2) {
          previous = current;
          current = Math.min(state.targetOffset, Math.max(0, length - 2 - windowSamples * step));
          fade = 0;
          counter = 0;
        }
        let limiterGain = 1;
        if (state.limiter) {
          limiterGain = Math.sin(limiterPhase * Math.PI * 2) > 0.15 ? 1 : 0.28;
          limiterPhase += LIMITER_HZ / sampleRate;
          if (limiterPhase >= 1) limiterPhase -= 1;
        }
        const fadeIn = fade < 1 ? Math.sin(fade * Math.PI * 0.5) : 1;
        const fadeOut = fade < 1 ? Math.cos(fade * Math.PI * 0.5) : 0;
        for (let c = 0; c < nCh; c += 1) {
          const input = channels[Math.min(c, channels.length - 1)];
          let sample = read(input, current) * fadeIn;
          if (fade < 1) sample += read(input, previous) * fadeOut;
          outputs[c][i] = sample * limiterGain;
        }
        current += step;
        if (fade < 1) {
          previous += step;
          fade = Math.min(1, fade + 1 / fadeSamples);
        }
        counter += 1;
      }
    };
    node.connect(gain);
    this.loadScrubber = node;
  }

  private updateLoadScrubber(rpm: number, atLimiter: boolean): void {
    const buffer = this.buffers.load;
    if (!buffer || !this.loadScrubber) return;
    this.mapLoadRpm(rpm, buffer);
    this.loadState.limiter = atLimiter;
    if (this.loadWorkletPort && (Math.abs(this.loadState.targetOffset - this.lastSentOffset) > 24 || atLimiter !== this.lastSentLimiter)) {
      this.lastSentOffset = this.loadState.targetOffset;
      this.lastSentLimiter = atLimiter;
      this.loadWorkletPort.postMessage({
        type: 'state',
        targetOffset: this.loadState.targetOffset,
        limiter: atLimiter,
      });
    }
  }

  private mapLoadRpm(rpm: number, buffer: AudioBuffer): void {
    const blend = Math.min(1, Math.max(0, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const windowSize = Math.min(LOAD_WINDOW_SECONDS, buffer.duration / 2);
    this.loadState.targetOffset = blend * Math.max(0, buffer.duration - windowSize) * buffer.sampleRate;
  }

  private setLayer(layer: SoundLayer, volume: number, playbackRate: number, now: number): void {
    const gain = this.gains[layer];
    if (!gain) return;
    // The load layer has no looping source (the RPM scrubber feeds its gain), so its
    // volume must be set even without one; only looping sources take a playback rate.
    gain.gain.setTargetAtTime(volume, now, 0.08);
    this.sources[layer]?.playbackRate.setTargetAtTime(playbackRate, now, 0.08);
  }
}
