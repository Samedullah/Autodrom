import type { EnvironmentState } from './environment';

// Developer panel (P): time of day, day/night cycle and rain controls, plus
// live renderer numbers. Plain DOM, outside the game UI; it only reports
// changes through `onChange`.

export interface DebugInfo {
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  position: { x: number; y: number; z: number };
  speedKmh: number;
  mapId: string;
  vehicle: string;
  wetness: number;
  sun: number;
  fill: number;
  environment: number;
  headlight: number;
  bakes: number;
  quality: string;
}

const CYCLE_OPTIONS: Array<[number, string]> = [[6, '6 dk'], [12, '12 dk'], [24, '24 dk'], [48, '48 dk'], [120, '2 saat']];

function clock(hours: number): string {
  const minutes = Math.floor(hours * 60) % (24 * 60);
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

export class DebugPanel {
  private readonly root: HTMLElement;
  private readonly time: HTMLInputElement;
  private readonly timeValue: HTMLElement;
  private readonly running: HTMLInputElement;
  private readonly cycle: HTMLSelectElement;
  private readonly rain: HTMLInputElement;
  private readonly rainValue: HTMLElement;
  private readonly stats: HTMLElement;

  constructor(private readonly onChange: (changes: Partial<EnvironmentState>) => void) {
    this.root = document.createElement('aside');
    this.root.className = 'debug-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Geliştirici paneli');
    this.root.innerHTML =
      '<header><b>DEBUG</b><span>P ile kapat</span></header>' +
      '<label class="debug-row"><span>Saat <b data-time-value>13:00</b></span><input type="range" min="0" max="24" step="0.05" data-time></label>' +
      '<div class="debug-row debug-inline"><label><input type="checkbox" data-running> Gün döngüsü</label>' +
        '<select data-cycle aria-label="Bir günün süresi">' + CYCLE_OPTIONS.map(([minutes, label]) => '<option value="' + minutes + '">' + label + ' = 1 gün</option>').join('') + '</select></div>' +
      '<div class="debug-presets"><button type="button" data-hour="6.4">Şafak</button><button type="button" data-hour="12">Öğle</button><button type="button" data-hour="17.6">Gün batımı</button><button type="button" data-hour="23">Gece</button></div>' +
      '<label class="debug-row"><span>Yağmur <b data-rain-value>0%</b></span><input type="range" min="0" max="1" step="0.01" data-rain></label>' +
      '<pre class="debug-stats" data-stats></pre>';
    this.time = this.root.querySelector('[data-time]') as HTMLInputElement;
    this.timeValue = this.root.querySelector('[data-time-value]') as HTMLElement;
    this.running = this.root.querySelector('[data-running]') as HTMLInputElement;
    this.cycle = this.root.querySelector('[data-cycle]') as HTMLSelectElement;
    this.rain = this.root.querySelector('[data-rain]') as HTMLInputElement;
    this.rainValue = this.root.querySelector('[data-rain-value]') as HTMLElement;
    this.stats = this.root.querySelector('[data-stats]') as HTMLElement;
    this.time.addEventListener('input', () => this.onChange({ timeOfDay: Number(this.time.value) }));
    this.running.addEventListener('change', () => this.onChange({ cycleRunning: this.running.checked }));
    this.cycle.addEventListener('change', () => this.onChange({ cycleMinutes: Number(this.cycle.value) }));
    this.rain.addEventListener('input', () => this.onChange({ rain: Number(this.rain.value) }));
    this.root.addEventListener('click', (event) => {
      const hour = (event.target as HTMLElement).closest<HTMLElement>('[data-hour]')?.dataset.hour;
      if (hour !== undefined) this.onChange({ timeOfDay: Number(hour) });
    });
    // Keys typed into the panel must not drive the car.
    this.root.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'p') event.stopPropagation();
    });
    document.body.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  toggle(): boolean {
    this.root.hidden = !this.root.hidden;
    return this.open;
  }

  /** Brings the controls in line with the environment (the clock may be running). */
  showState(state: EnvironmentState): void {
    if (document.activeElement !== this.time) this.time.value = String(state.timeOfDay);
    this.timeValue.textContent = clock(state.timeOfDay);
    this.running.checked = state.cycleRunning;
    if (document.activeElement !== this.cycle) this.cycle.value = String(state.cycleMinutes);
    if (document.activeElement !== this.rain) this.rain.value = String(state.rain);
    this.rainValue.textContent = Math.round(state.rain * 100) + '%';
  }

  showInfo(info: DebugInfo): void {
    const p = info.position;
    this.stats.textContent =
      'FPS        ' + info.fps.toFixed(0) + '\n' +
      'Draw call  ' + info.drawCalls + '\n' +
      'Üçgen      ' + info.triangles.toLocaleString('tr-TR') + '\n' +
      'Geometri   ' + info.geometries + '  Doku ' + info.textures + '\n' +
      'Kalite     ' + info.quality + '\n' +
      'Harita     ' + info.mapId + '\n' +
      'Araç       ' + info.vehicle + '\n' +
      'Hız        ' + info.speedKmh.toFixed(0) + ' km/sa\n' +
      'Konum      ' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1) + '\n' +
      'Islaklık   ' + Math.round(info.wetness * 100) + '%\n' +
      'Işık       güneş ' + info.sun.toFixed(2) + '  dolgu ' + info.fill.toFixed(2) + '\n' +
      '           ortam ' + info.environment.toFixed(2) + '  far ' + info.headlight.toFixed(0) + '\n' +
      'Ortam bake ' + info.bakes;
  }

  dispose(): void {
    this.root.remove();
  }
}
