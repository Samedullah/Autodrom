import {
  TIRE_PROFILES,
  type SingleTireTelemetry,
  type TireDebugState,
  type TireEditTarget,
  type TireProfileId,
  type TireTuningParams,
} from './chassis';

// Developer tire physics & telemetry panel (L key).
// Allows live switching between tire compounds (Street, Sport, Semi-Slick,
// Drift Compound), editing parameters for all tires, front/rear axles, or
// individual wheels (FL, FR, RL, RR), resetting to default, and inspecting
// real-time 4-wheel telemetry with zero overhead when closed.

export interface TireDebugActions {
  onSelectProfile: (profile: TireProfileId) => void;
  onSelectTarget: (target: TireEditTarget) => void;
  onChangeParam: (changes: Partial<TireTuningParams>) => void;
  onReset: () => void;
}

interface SliderBinding {
  key: keyof TireTuningParams;
  input: HTMLInputElement;
  valueEl: HTMLElement;
  format: (v: number) => string;
}

interface WheelTelemetryDom {
  contact: HTMLElement;
  slipAngle: HTMLElement;
  slipRatio: HTMLElement;
  normalLoad: HTMLElement;
  longForce: HTMLElement;
  latForce: HTMLElement;
  gripUse: HTMLElement;
  gripBar: HTMLElement;
  angSpeed: HTMLElement;
}

const PROFILE_LIST: Array<{ id: TireProfileId; label: string }> = [
  { id: 'street', label: 'Street' },
  { id: 'sport', label: 'Sport' },
  { id: 'semi-slick', label: 'Semi-Slick' },
  { id: 'drift', label: 'Drift Compound' },
];

const TARGET_LIST: Array<{ id: TireEditTarget; label: string }> = [
  { id: 'all', label: 'Tümü (4 Lastik)' },
  { id: 'front', label: 'Ön Aks (FL + FR)' },
  { id: 'rear', label: 'Arka Aks (RL + RR)' },
  { id: 'fl', label: 'Sol Ön (FL)' },
  { id: 'fr', label: 'Sağ Ön (FR)' },
  { id: 'rl', label: 'Sol Arka (RL)' },
  { id: 'rr', label: 'Sağ Arka (RR)' },
];

const SLIDER_SPECS: Array<{
  key: keyof TireTuningParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = [
  { key: 'frictionCoeff', label: 'Friction Coefficient', min: 0.5, max: 1.8, step: 0.02, format: (v) => v.toFixed(2) },
  { key: 'longStiffness', label: 'Longitudinal Stiffness', min: 0.4, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'latStiffness', label: 'Lateral Stiffness', min: 0.4, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'peakSlipAngleDeg', label: 'Peak Slip Angle', min: 3.0, max: 18.0, step: 0.5, format: (v) => v.toFixed(1) + '°' },
  { key: 'peakSlipRatio', label: 'Peak Longitudinal Slip', min: 0.04, max: 0.35, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'postPeakGrip', label: 'Post-Peak Grip', min: 0.4, max: 1.0, step: 0.02, format: (v) => Math.round(v * 100) + '%' },
  { key: 'loadSensitivity', label: 'Load Sensitivity', min: 0.0, max: 0.45, step: 0.01, format: (v) => v.toFixed(2) },
];

const WHEEL_LABELS = ['FL (Sol Ön)', 'FR (Sağ Ön)', 'RL (Sol Arka)', 'RR (Sağ Arka)'] as const;

export class TireDebugPanel {
  private readonly root: HTMLElement;
  private readonly profileButtons = new Map<TireProfileId, HTMLButtonElement>();
  private readonly targetSelect: HTMLSelectElement;
  private readonly sliders: SliderBinding[] = [];
  private readonly wheelDoms: WheelTelemetryDom[] = [];

  constructor(private readonly actions: TireDebugActions) {
    this.root = document.createElement('aside');
    this.root.className = 'tire-debug-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Lastik Fiziği Debug Paneli');

    const profilesHtml = PROFILE_LIST.map(
      (p) => `<button type="button" data-tire-profile="${p.id}" title="${TIRE_PROFILES[p.id].label}">${p.label}</button>`,
    ).join('');

    const targetsHtml = TARGET_LIST.map(
      (t) => `<option value="${t.id}">${t.label}</option>`,
    ).join('');

    const slidersHtml = SLIDER_SPECS.map(
      (s) =>
        `<label class="tire-debug-row">` +
        `<span>${s.label} <b data-val="${s.key}">0</b></span>` +
        `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" data-slider="${s.key}">` +
        `</label>`,
    ).join('');

    const wheelsHtml = WHEEL_LABELS.map(
      (title, idx) =>
        `<div class="tire-card" data-wheel="${idx}">` +
        `<div class="tire-card-head"><b>${title}</b><span class="tire-contact" data-w-contact="${idx}">TEMAS</span></div>` +
        `<div class="tire-grip-bar"><i data-w-bar="${idx}"></i></div>` +
        `<div class="tire-card-grid">` +
        `<span>Slip Angle: <b data-w-sa="${idx}">0.0°</b></span>` +
        `<span>Slip Ratio: <b data-w-sr="${idx}">0.00</b></span>` +
        `<span>Normal Load: <b data-w-fz="${idx}">0 N</b></span>` +
        `<span>Grip Use: <b data-w-gu="${idx}">0%</b></span>` +
        `<span>Long Force: <b data-w-fx="${idx}">0 N</b></span>` +
        `<span>Lat Force: <b data-w-fy="${idx}">0 N</b></span>` +
        `<span class="tire-wide">Wheel Speed: <b data-w-om="${idx}">0.0 rad/s</b></span>` +
        `</div>` +
        `</div>`,
    ).join('');

    this.root.innerHTML =
      `<header><b>TIRE PHYSICS DEBUG</b><span>L ile kapat</span></header>` +
      `<div class="tire-debug-section-title">Lastik Profili</div>` +
      `<div class="tire-profile-grid">${profilesHtml}</div>` +
      `<div class="tire-debug-inline">` +
      `<label>Düzenleme Hedefi <select data-tire-target>${targetsHtml}</select></label>` +
      `<button type="button" class="tire-reset-btn" data-tire-reset>Reset to Default</button>` +
      `</div>` +
      `<div class="tire-sliders">${slidersHtml}</div>` +
      `<div class="tire-debug-section-title">Canlı Lastik Telemetrisi (4 Tekerlek)</div>` +
      `<div class="tire-telemetry-grid">${wheelsHtml}</div>`;

    for (const p of PROFILE_LIST) {
      const btn = this.root.querySelector(`[data-tire-profile="${p.id}"]`) as HTMLButtonElement;
      this.profileButtons.set(p.id, btn);
      btn.addEventListener('click', () => this.actions.onSelectProfile(p.id));
    }

    this.targetSelect = this.root.querySelector('[data-tire-target]') as HTMLSelectElement;
    this.targetSelect.addEventListener('change', () => {
      this.actions.onSelectTarget(this.targetSelect.value as TireEditTarget);
    });

    const resetBtn = this.root.querySelector('[data-tire-reset]') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => this.actions.onReset());

    for (const spec of SLIDER_SPECS) {
      const input = this.root.querySelector(`[data-slider="${spec.key}"]`) as HTMLInputElement;
      const valueEl = this.root.querySelector(`[data-val="${spec.key}"]`) as HTMLElement;
      this.sliders.push({ key: spec.key, input, valueEl, format: spec.format });
      input.addEventListener('input', () => {
        const val = Number(input.value);
        valueEl.textContent = spec.format(val);
        this.actions.onChangeParam({ [spec.key]: val });
      });
    }

    for (let i = 0; i < 4; i += 1) {
      this.wheelDoms.push({
        contact: this.root.querySelector(`[data-w-contact="${i}"]`) as HTMLElement,
        slipAngle: this.root.querySelector(`[data-w-sa="${i}"]`) as HTMLElement,
        slipRatio: this.root.querySelector(`[data-w-sr="${i}"]`) as HTMLElement,
        normalLoad: this.root.querySelector(`[data-w-fz="${i}"]`) as HTMLElement,
        longForce: this.root.querySelector(`[data-w-fx="${i}"]`) as HTMLElement,
        latForce: this.root.querySelector(`[data-w-fy="${i}"]`) as HTMLElement,
        gripUse: this.root.querySelector(`[data-w-gu="${i}"]`) as HTMLElement,
        gripBar: this.root.querySelector(`[data-w-bar="${i}"]`) as HTMLElement,
        angSpeed: this.root.querySelector(`[data-w-om="${i}"]`) as HTMLElement,
      });
    }

    // Prevent key presses inside the panel from triggering vehicle controls (except L to toggle).
    this.root.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'l') event.stopPropagation();
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

  private targetTireParams(state: TireDebugState): TireTuningParams {
    switch (state.target) {
      case 'fl':
        return state.tires[0];
      case 'fr':
        return state.tires[1];
      case 'rl':
        return state.tires[2];
      case 'rr':
        return state.tires[3];
      case 'rear':
        return state.tires[2];
      case 'front':
      case 'all':
      default:
        return state.tires[0];
    }
  }

  syncControls(state: TireDebugState): void {
    if (!this.open) return;
    for (const [id, btn] of this.profileButtons) {
      btn.classList.toggle('is-active', id === state.profile);
    }
    if (document.activeElement !== this.targetSelect) {
      this.targetSelect.value = state.target;
    }
    const params = this.targetTireParams(state);
    for (const s of this.sliders) {
      const val = params[s.key];
      if (document.activeElement !== s.input) {
        s.input.value = String(val);
      }
      s.valueEl.textContent = s.format(val);
    }
  }

  updateTelemetry(state: TireDebugState): void {
    if (!this.open) return;
    for (let i = 0; i < 4; i += 1) {
      const t: SingleTireTelemetry = state.telemetry[i];
      const dom = this.wheelDoms[i];
      dom.contact.textContent = t.grounded ? 'TEMAS' : 'HAVADA';
      dom.contact.classList.toggle('is-air', !t.grounded);
      dom.slipAngle.textContent = (t.slipAngleDeg >= 0 ? '+' : '') + t.slipAngleDeg.toFixed(1) + '°';
      dom.slipRatio.textContent = (t.slipRatio >= 0 ? '+' : '') + t.slipRatio.toFixed(2);
      dom.normalLoad.textContent = Math.round(t.normalLoadN) + ' N';
      dom.longForce.textContent = Math.round(t.longForceN) + ' N';
      dom.latForce.textContent = Math.round(t.latForceN) + ' N';
      const utilPct = Math.round(t.gripUtilization * 100);
      dom.gripUse.textContent = utilPct + '%';
      const barPct = Math.min(100, Math.max(0, utilPct));
      dom.gripBar.style.width = barPct + '%';
      dom.gripBar.style.background = utilPct > 98 ? '#ff6b5b' : utilPct > 78 ? '#f5b942' : '#7be3a2';
      dom.angSpeed.textContent = t.wheelAngularSpeed.toFixed(1) + ' rad/s';
    }
  }
}
