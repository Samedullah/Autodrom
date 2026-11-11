// Stance, Suspension & Alignment Modification Panel (I key).
// Allows live adjustment of ride height (front/rear), camber (front/rear),
// wheel spacer offset (front/rear), toe alignment (front/rear), spring stiffness,
// damper stiffness, anti-roll bars, steering angle kit, and wheel scale, with
// quick presets (Stock, Track/GT, Drift Spec, Stance/Slammed).

export type StancePresetId = 'stock' | 'track' | 'drift' | 'stance';

export interface StanceConfig {
  frontRideHeightMm: number;    // -80 .. +40 mm
  rearRideHeightMm: number;     // -80 .. +40 mm
  frontCamberDeg: number;       // -12.0 .. +2.0 deg
  rearCamberDeg: number;        // -12.0 .. +2.0 deg
  frontOffsetMm: number;        // -20 .. +60 mm (wheel spacer / track offset per side)
  rearOffsetMm: number;         // -20 .. +60 mm
  frontToeDeg: number;          // -1.5 .. +1.5 deg (- = Toe-Out, + = Toe-In)
  rearToeDeg: number;           // -1.5 .. +1.5 deg
  springStiffnessMult: number;  // 0.50 .. 2.50x
  damperStiffnessMult: number;  // 0.40 .. 2.50x
  antiRollBarMult: number;      // 0.30 .. 2.50x
  steeringLockBonusDeg: number; // 0 .. +15 deg (drift angle kit)
  wheelScale: number;           // 0.88 .. 1.16x
}

export const STANCE_PRESETS: Record<StancePresetId, { label: string; config: StanceConfig }> = {
  stock: {
    label: 'Fabrika (Stock)',
    config: {
      frontRideHeightMm: 0,
      rearRideHeightMm: 0,
      frontCamberDeg: -1.0,
      rearCamberDeg: -1.2,
      frontOffsetMm: 0,
      rearOffsetMm: 0,
      frontToeDeg: 0.0,
      rearToeDeg: 0.15,
      springStiffnessMult: 1.0,
      damperStiffnessMult: 1.0,
      antiRollBarMult: 1.0,
      steeringLockBonusDeg: 0,
      wheelScale: 1.0,
    },
  },
  track: {
    label: 'Pist / GT',
    config: {
      frontRideHeightMm: -32,
      rearRideHeightMm: -26,
      frontCamberDeg: -3.4,
      rearCamberDeg: -2.4,
      frontOffsetMm: 18,
      rearOffsetMm: 20,
      frontToeDeg: -0.20,
      rearToeDeg: 0.30,
      springStiffnessMult: 1.55,
      damperStiffnessMult: 1.45,
      antiRollBarMult: 1.50,
      steeringLockBonusDeg: 2,
      wheelScale: 1.02,
    },
  },
  drift: {
    label: 'Drift Kurulumu',
    config: {
      frontRideHeightMm: -38,
      rearRideHeightMm: -28,
      frontCamberDeg: -5.2,
      rearCamberDeg: -0.6,
      frontOffsetMm: 36,
      rearOffsetMm: 22,
      frontToeDeg: -0.45,
      rearToeDeg: 0.10,
      springStiffnessMult: 1.40,
      damperStiffnessMult: 1.35,
      antiRollBarMult: 1.30,
      steeringLockBonusDeg: 10,
      wheelScale: 1.0,
    },
  },
  stance: {
    label: 'Stance / Basık',
    config: {
      frontRideHeightMm: -68,
      rearRideHeightMm: -68,
      frontCamberDeg: -9.0,
      rearCamberDeg: -10.5,
      frontOffsetMm: 42,
      rearOffsetMm: 48,
      frontToeDeg: 0.0,
      rearToeDeg: 0.15,
      springStiffnessMult: 1.85,
      damperStiffnessMult: 1.65,
      antiRollBarMult: 1.75,
      steeringLockBonusDeg: 0,
      wheelScale: 1.04,
    },
  },
};

export function cloneStanceConfig(src: StanceConfig): StanceConfig {
  return { ...src };
}

export interface StancePanelActions {
  onSelectPreset: (preset: StancePresetId) => void;
  onChange: (changes: Partial<StanceConfig>) => void;
  onReset: () => void;
}

interface StanceSliderSpec {
  key: keyof StanceConfig;
  label: string;
  section: 'stance' | 'alignment' | 'suspension';
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDER_SPECS: StanceSliderSpec[] = [
  // Stance & Fitment (Ride Height, Offset, Wheel Size)
  {
    key: 'frontRideHeightMm',
    label: 'Ön Yükseklik (Front Height)',
    section: 'stance',
    min: -80,
    max: 40,
    step: 2,
    format: (v) => (v > 0 ? `+${v}` : `${v}`) + ' mm',
  },
  {
    key: 'rearRideHeightMm',
    label: 'Arka Yükseklik (Rear Height)',
    section: 'stance',
    min: -80,
    max: 40,
    step: 2,
    format: (v) => (v > 0 ? `+${v}` : `${v}`) + ' mm',
  },
  {
    key: 'frontOffsetMm',
    label: 'Ön Spacer / Offset',
    section: 'stance',
    min: -20,
    max: 60,
    step: 2,
    format: (v) => (v > 0 ? `+${v}` : `${v}`) + ' mm',
  },
  {
    key: 'rearOffsetMm',
    label: 'Arka Spacer / Offset',
    section: 'stance',
    min: -20,
    max: 60,
    step: 2,
    format: (v) => (v > 0 ? `+${v}` : `${v}`) + ' mm',
  },
  {
    key: 'wheelScale',
    label: 'Jant / Lastik Çapı (Scale)',
    section: 'stance',
    min: 0.88,
    max: 1.16,
    step: 0.01,
    format: (v) => Math.round(v * 100) + '%',
  },

  // Alignment & Angle Kit (Camber, Toe, Steering Lock)
  {
    key: 'frontCamberDeg',
    label: 'Ön Kamber (Front Camber)',
    section: 'alignment',
    min: -12.0,
    max: 2.0,
    step: 0.2,
    format: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)) + '°',
  },
  {
    key: 'rearCamberDeg',
    label: 'Arka Kamber (Rear Camber)',
    section: 'alignment',
    min: -12.0,
    max: 2.0,
    step: 0.2,
    format: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)) + '°',
  },
  {
    key: 'frontToeDeg',
    label: 'Ön Toe (Out - / In +)',
    section: 'alignment',
    min: -1.5,
    max: 1.5,
    step: 0.05,
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) + '°',
  },
  {
    key: 'rearToeDeg',
    label: 'Arka Toe (Out - / In +)',
    section: 'alignment',
    min: -1.5,
    max: 1.5,
    step: 0.05,
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) + '°',
  },
  {
    key: 'steeringLockBonusDeg',
    label: 'Ekstra Direksiyon Açısı (Angle Kit)',
    section: 'alignment',
    min: 0,
    max: 15,
    step: 1,
    format: (v) => `+${v.toFixed(0)}°`,
  },

  // Suspension Dynamics (Springs, Dampers, Anti-Roll Bars)
  {
    key: 'springStiffnessMult',
    label: 'Yay Sertliği (Spring Rate)',
    section: 'suspension',
    min: 0.5,
    max: 2.5,
    step: 0.05,
    format: (v) => v.toFixed(2) + 'x',
  },
  {
    key: 'damperStiffnessMult',
    label: 'Amortisör Sertliği (Damper)',
    section: 'suspension',
    min: 0.4,
    max: 2.5,
    step: 0.05,
    format: (v) => v.toFixed(2) + 'x',
  },
  {
    key: 'antiRollBarMult',
    label: 'Viraj Demiri (Anti-Roll Bar)',
    section: 'suspension',
    min: 0.3,
    max: 2.5,
    step: 0.05,
    format: (v) => v.toFixed(2) + 'x',
  },
];

const PRESET_ORDER: StancePresetId[] = ['stock', 'track', 'drift', 'stance'];

export class StancePanel {
  private readonly root: HTMLElement;
  private readonly presetButtons = new Map<StancePresetId, HTMLButtonElement>();
  private readonly sliders: Array<{
    key: keyof StanceConfig;
    input: HTMLInputElement;
    valueEl: HTMLElement;
    format: (v: number) => string;
  }> = [];

  constructor(private readonly actions: StancePanelActions) {
    this.root = document.createElement('aside');
    this.root.className = 'tire-debug-panel stance-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Süspansiyon, Kamber ve Offset Modifikasyon Menüsü');

    const presetsHtml = PRESET_ORDER.map(
      (id) => `<button type="button" data-stance-preset="${id}">${STANCE_PRESETS[id].label}</button>`,
    ).join('');

    const renderSection = (section: StanceSliderSpec['section']) =>
      SLIDER_SPECS.filter((s) => s.section === section)
        .map(
          (s) =>
            `<label class="tire-debug-row">` +
            `<span>${s.label} <b data-stance-val="${s.key}">0</b></span>` +
            `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" data-stance-slider="${s.key}">` +
            `</label>`,
        )
        .join('');

    this.root.innerHTML =
      `<header><b>STANCE & SÜSPANSİYON</b><span>I ile kapat</span></header>` +
      `<div class="tire-debug-section-title">Hazır Kurulumlar</div>` +
      `<div class="tire-profile-grid stance-preset-grid">${presetsHtml}</div>` +
      `<div class="tire-debug-section-title">Basıklık, Offset & Jant (Fitment)</div>` +
      `<div class="tire-sliders">${renderSection('stance')}</div>` +
      `<div class="tire-debug-section-title">Kamber, Toe & Açı Kiti (Alignment)</div>` +
      `<div class="tire-sliders">${renderSection('alignment')}</div>` +
      `<div class="tire-debug-section-title">Yay, Amortisör & Viraj Demiri</div>` +
      `<div class="tire-sliders">${renderSection('suspension')}</div>` +
      `<div class="stance-footer">` +
      `<button type="button" class="tire-reset-btn" data-stance-reset>Fabrika Ayarlarına Dön</button>` +
      `</div>`;

    for (const id of PRESET_ORDER) {
      const btn = this.root.querySelector(`[data-stance-preset="${id}"]`) as HTMLButtonElement;
      this.presetButtons.set(id, btn);
      btn.addEventListener('click', () => this.actions.onSelectPreset(id));
    }

    const resetBtn = this.root.querySelector('[data-stance-reset]') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => this.actions.onReset());

    for (const spec of SLIDER_SPECS) {
      const input = this.root.querySelector(`[data-stance-slider="${spec.key}"]`) as HTMLInputElement;
      const valueEl = this.root.querySelector(`[data-stance-val="${spec.key}"]`) as HTMLElement;
      this.sliders.push({ key: spec.key, input, valueEl, format: spec.format });
      input.addEventListener('input', () => {
        const val = Number(input.value);
        valueEl.textContent = spec.format(val);
        this.actions.onChange({ [spec.key]: val });
      });
    }

    // Prevent key presses inside the panel from triggering driving controls (except I to toggle).
    this.root.addEventListener('keydown', (event) => {
      const k = event.key.toLowerCase();
      if (k !== 'i' && k !== 'ı' && k !== 'i̇' && event.code !== 'KeyI') event.stopPropagation();
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

  syncControls(config: StanceConfig, activePreset: StancePresetId | null): void {
    if (!this.open) return;
    for (const [id, btn] of this.presetButtons) {
      btn.classList.toggle('is-active', id === activePreset);
    }
    for (const s of this.sliders) {
      const val = config[s.key];
      if (document.activeElement !== s.input) {
        s.input.value = String(val);
      }
      s.valueEl.textContent = s.format(val);
    }
  }
}
