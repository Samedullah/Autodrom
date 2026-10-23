export interface VehicleAudioState {
  dt: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  drift: number;
  active: boolean;
}

type SoundLayer = 'idle' | 'load' | 'skid';

const AUDIO_FILES: Record<SoundLayer, string> = {
  idle: '/assets/audio/cars/default/engine-idle.ogg',
  load: '/assets/audio/cars/default/engine-load.ogg',
  skid: '/assets/audio/cars/default/tire-skid.ogg',
};

const IDLE_RPM = 851;
const REDLINE_RPM = 7050;
const LOAD_WINDOW_SECONDS = 0.22;
const LOAD_CROSSFADE_SECONDS = 0.025;
const LIMITER_HZ = 18;

/** Small Web Audio layer for the player's vehicle. Missing audio files stay silent. */
export class VehicleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly gains: Partial<Record<SoundLayer, GainNode>> = {};
  private readonly sources: Partial<Record<SoundLayer, AudioBufferSourceNode>> = {};
  private loadScrubber: ScriptProcessorNode | null = null;
  private readonly buffers: Partial<Record<SoundLayer, AudioBuffer>> = {};
  private loading: Promise<void> | null = null;
  private rpm = IDLE_RPM;
  private disposed = false;

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
      }
      if (this.context.state !== 'running') await this.context.resume();
      this.loading ??= this.loadBuffers();
      await this.loading;
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
    const targetRpm = state.gear === 0 ? freeRevTarget : Math.max(state.rpm, freeRevTarget);
    const rpmResponse = throttle > 0 ? 7 : 3;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-rpmResponse * Math.max(0, state.dt)));

    const rpmBlend = Math.min(1, Math.max(0, (this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const audible = state.active ? 1 : 0;
    const idleGain = audible * (0.23 + (1 - throttle) * 0.08) * (1 - rpmBlend * 0.9);
    const loadGain = audible * (0.06 + throttle * 0.62) * (0.28 + rpmBlend * 0.72);
    const skidGain = audible * Math.min(1, Math.max(0, state.drift)) * 0.55;
    const now = context.currentTime;

    this.setLayer('idle', idleGain, 1, now);
    this.setLayer('load', loadGain, 1, now);
    this.updateLoadScrubber(this.rpm, this.rpm >= REDLINE_RPM - 30);
    this.setLayer('skid', skidGain, 0.9 + Math.min(0.3, state.drift * 0.3), now);
  }

  dispose(): void {
    this.disposed = true;
    for (const source of Object.values(this.sources)) {
      try { source?.stop(); } catch { /* a source may not have started */ }
      source?.disconnect();
    }
    this.loadScrubber?.disconnect();
    this.loadScrubber = null;
    this.master?.disconnect();
    for (const gain of Object.values(this.gains)) gain?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
    this.master = null;
  }

  private async loadBuffers(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await Promise.all((Object.entries(AUDIO_FILES) as [SoundLayer, string][]).map(async ([layer, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        this.buffers[layer] = await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        // Files will be added later; silently skip absent or unsupported clips.
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
    this.startLoadScrubber();
  }

  /** Play a short fixed-speed window from the RPM-mapped point in the recorded sweep. */
  private startLoadScrubber(): void {
    const context = this.context;
    const buffer = this.buffers.load;
    const gain = this.gains.load;
    if (!context || !buffer || !gain || this.loadScrubber || this.disposed) return;

    const node = context.createScriptProcessor(2048, 0, Math.max(1, buffer.numberOfChannels));
    const windowSize = Math.min(LOAD_WINDOW_SECONDS, buffer.duration);
    const fadeSize = Math.min(LOAD_CROSSFADE_SECONDS, windowSize / 4);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    let phase = 0;
    let sampleOffset = 0;
    const processorState = { targetOffset: 0, limiter: false };
    let limiterPhase = 0;
    node.onaudioprocess = (event) => {
      const out = event.outputBuffer;
      const sampleRate = out.sampleRate;
      const windowSamples = Math.max(1, Math.floor(windowSize * sampleRate));
      const fadeSamples = Math.max(1, Math.floor(fadeSize * sampleRate));
      const available = Math.max(0, buffer.duration - windowSize);
      const maxStart = Math.floor(available * sampleRate);
      for (let channel = 0; channel < out.numberOfChannels; channel++) {
        const output = out.getChannelData(channel);
        const input = channels[Math.min(channel, channels.length - 1)];
        for (let i = 0; i < output.length; i++) {
          const pos = phase;
          const base = Math.min(maxStart, Math.floor(sampleOffset)) + pos;
          const nextBase = Math.min(maxStart, Math.floor(processorState.targetOffset)) + pos;
          const oldSample = input[Math.min(input.length - 1, base)];
          const newSample = input[Math.min(input.length - 1, nextBase)];
          // Change RPM position only at window boundaries; playback inside each
          // window stays at 1x, so the sample itself determines engine tone.
          const blend = Math.min(1, Math.max(0, (phase - (windowSamples - fadeSamples)) / fadeSamples));
          const mix = oldSample * (1 - blend) + newSample * blend;
          let limiterGain = 1;
          if (processorState.limiter) {
            limiterGain = Math.sin(limiterPhase * Math.PI * 2) > 0.15 ? 1 : 0.28;
            limiterPhase += LIMITER_HZ / sampleRate;
            if (limiterPhase >= 1) limiterPhase -= 1;
          }
          output[i] = mix * limiterGain;
        }
      }
      phase += out.length;
      if (phase >= windowSamples) {
        phase %= windowSamples;
        sampleOffset = processorState.targetOffset;
      }
    };
    node.connect(gain);
    this.loadScrubber = node;
    this.mapLoadRpm(this.rpm, buffer, (offset) => { processorState.targetOffset = offset; sampleOffset = offset; });
    Object.assign(node, { processorState });
  }

  private updateLoadScrubber(rpm: number, atLimiter: boolean): void {
    const buffer = this.buffers.load;
    const node = this.loadScrubber;
    if (!buffer || !node) return;
    this.mapLoadRpm(rpm, buffer, (offset) => {
      const state = (node as ScriptProcessorNode & { processorState?: { targetOffset: number; limiter: boolean } }).processorState;
      if (state) {
        state.targetOffset = offset;
        state.limiter = atLimiter;
      }
    });
  }

  private mapLoadRpm(rpm: number, buffer: AudioBuffer, set: (offset: number) => void): void {
    const blend = Math.min(1, Math.max(0, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const windowSize = Math.min(LOAD_WINDOW_SECONDS, buffer.duration);
    set(blend * Math.max(0, buffer.duration - windowSize) * buffer.sampleRate);
  }

  private setLayer(layer: SoundLayer, volume: number, playbackRate: number, now: number): void {
    const gain = this.gains[layer];
    const source = this.sources[layer];
    if (!gain || !source) return;
    gain.gain.setTargetAtTime(volume, now, 0.08);
    source.playbackRate.setTargetAtTime(playbackRate, now, 0.08);
  }
}
