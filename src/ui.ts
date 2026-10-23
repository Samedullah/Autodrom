import * as THREE from 'three';
import { CLASS_LABELS, MAP_LABELS, STARTER_VEHICLES, VEHICLES, type CarClass, type MapId, type VehicleSpec } from './data';
import type { GameSettings, SaveData } from './save';
import type { DrivingControl, Telemetry } from './engine';
import { createVehicleVisual, disposeVehicleVisual, installGeneratedModel } from './vehicle';

export type Screen = 'main' | 'starter' | 'garage' | 'maps' | 'settings' | 'pause' | 'store' | 'multiplayer' | null;
export type UiAction = 'start' | 'continue' | 'starter' | 'garage' | 'store' | 'maps' | 'settings' | 'pause'
  | 'resume' | 'main' | 'select-starter' | 'buy' | 'activate' | 'choose-map' | 'close' | 'fullscreen' | 'reset-position'
  | 'preview-car' | 'filter-class' | 'clear-filters' | 'redeem-code' | 'close-dev-code' | 'shift-up' | 'shift-down' | 'toggle-drift'
  | 'multiplayer' | 'multiplayer-create' | 'multiplayer-join' | 'multiplayer-leave' | 'copy-room';

export interface UiSnapshot {
  save: SaveData;
  settings: GameSettings;
  map: MapId;
  activeVehicle: VehicleSpec;
}

export interface UiCallbacks {
  onAction: (action: UiAction, id?: string, payload?: { playerName?: string; roomCode?: string }) => void;
  onSettings: (settings: GameSettings) => void;
  onControl: (control: DrivingControl, pressed: boolean) => void;
}

const money = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const RECENT_VEHICLE_IDS = new Set([
  'bmw-m2', 'bmw-m4-gts', 'bugatti-chiron-ss-300', 'koenigsegg-cc850', 'koenigsegg-regera',
  'lamborghini-huracan-lbworks', 'mclaren-720s', 'mercedes-clk-gtr', 'pagani-zonda-cinque',
  'porsche-carrera-gt', 'porsche-911-gt3-rs', 'toyota-supra-a80', 'volkswagen-golf-v', 'volkswagen-golf-gti-mk7', 'bmw-m3-e36-1993', 'bmw-m3-e92-lbworks-v2',
]);

export class GameInterface {
  private readonly callbacks: UiCallbacks;
  private snapshot: UiSnapshot;
  private currentScreen: Screen = null;
  private selectedVehicleId = STARTER_VEHICLES[0].id;
  private category: CarClass | 'ALL' = 'ALL';
  private brandFilter = 'ALL';
  private modelSearch = '';
  private preview: PreviewStage | null = null;
  private readonly hud: HTMLElement;
  private readonly modalHost: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly gearValue: HTMLElement;
  private readonly rpmValue: HTMLElement;
  private readonly rpmRing: HTMLElement;
  private readonly driftBadge: HTMLElement;
  private readonly driftModeButton: HTMLButtonElement;
  private readonly cashValue: HTMLElement;
  private readonly mapValue: HTMLElement;
  private readonly incomeToast: HTMLElement;
  private readonly carName: HTMLElement;
  private readonly className: HTMLElement;
  private readonly messageToast: HTMLElement;
  private readonly devCodeOverlay: HTMLElement;
  private readonly devCodeInput: HTMLInputElement;
  private readonly devCodeStatus: HTMLElement;
  private readonly activeTouchPointers = new Map<number, DrivingControl>();
  private incomeHideTimeout = 0;
  private multiplayerStatus = 'Oda kur veya arkadaşının koduyla katıl.';
  private multiplayerConnected = false;
  private multiplayerRoomCode = '';
  private multiplayerPlayerCount = 1;
  private multiplayerName = 'Sürücü';

  constructor(host: HTMLElement, snapshot: UiSnapshot, callbacks: UiCallbacks) {
    this.snapshot = snapshot;
    this.callbacks = callbacks;
    host.innerHTML = '<div class="hud-layer">' +
      '<header class="topbar">' +
        '<div class="brand-lockup"><span class="brand-mark">A</span><span><b>AUTODROM</b><small>DRIVE&nbsp; / &nbsp;BUILD</small></span></div>' +
        '<div class="cash-card"><span class="cash-label">GARAJ BAKİYESİ</span><strong id="cash-value">₺10.000</strong><i class="cash-dot"></i></div>' +
        '<div class="top-meta"><span class="live-chip"><i></i> CANLI SÜRÜŞ</span><span class="map-pill" id="map-value">ŞEHİR İÇİ</span><button class="multiplayer-toggle" type="button" data-action="multiplayer" aria-label="Multiplayer odaları">ONLINE</button><button class="drift-mode-toggle" type="button" data-action="toggle-drift" aria-label="Drift modunu aç" aria-pressed="false"><span>DRIFT</span><b>KAPALI</b></button><button class="icon-button pause-button" data-action="pause" aria-label="Oyunu duraklat">Ⅱ</button></div>' +
      '</header>' +
      '<nav class="side-rail" aria-label="Oyun menüsü">' +
        '<button class="rail-button" data-action="store" aria-label="Araç mağazası"><span>◈</span><small>MAĞAZA</small></button>' +
        '<button class="rail-button" data-action="garage" aria-label="Garaj"><span>▣</span><small>GARAJ</small></button>' +
        '<span class="rail-divider"></span>' +
        '<button class="rail-button" data-action="maps" aria-label="Harita seç"><span>⌖</span><small>HARİTA</small></button>' +
        '<button class="rail-button" data-action="settings" aria-label="Ayarlar"><span>⚙</span><small>AYARLAR</small></button>' +
      '</nav>' +
      '<div class="vehicle-chip"><span class="vehicle-chip-label">AKTİF ARAÇ</span><b id="car-name">METRO S1</b><span class="class-chip" id="class-name">ŞEHİR</span></div>' +
      '<div class="speed-cluster">' +
        '<div class="speed-ring" id="rpm-ring"><div class="speed-inner"><small>HIZ</small><strong id="speed-value">0</strong><span>KM/SA</span></div></div>' +
        '<div class="gear-panel"><span>VİTES</span><b id="gear-value">1</b><small><span id="rpm-value">850</span> RPM</small></div>' +
        '<div class="drift-indicator" id="drift-indicator">DRIFT</div>' +
      '</div>' +
      '<div class="drive-hint"><span>W</span><span>A</span><span>S</span><span>D</span><i>GAZ / DİREKSİYON</i><em></em><kbd>Q</kbd><kbd>E</kbd><i>VİTES</i><em></em><kbd>SPACE</kbd><i>EL FRENİ</i></div>' +
      '<div class="touch-controls" aria-label="Dokunmatik sürüş kontrolleri">' +
        '<div class="touch-steering" aria-label="Direksiyon"><button type="button" class="touch-button steer-button" data-control="left" aria-label="Sola dön"><span>‹</span></button><button type="button" class="touch-button steer-button" data-control="right" aria-label="Sağa dön"><span>›</span></button></div>' +
        '<div class="touch-pedals" aria-label="Pedallar"><button type="button" class="touch-button brake-button" data-control="brake" aria-label="Fren"><span>FREN</span></button><div class="touch-pedal-stack"><button type="button" class="touch-button handbrake-button" data-control="handbrake" aria-label="El freni"><span>EL FRENİ</span></button><button type="button" class="touch-button gas-button" data-control="gas" aria-label="Gaz"><span>GAZ</span></button></div></div>' +
        '<div class="touch-gears" aria-label="Vites"><button type="button" class="touch-button shift-button" data-action="shift-down" aria-label="Vitesi düşür"><span>− VİTES</span></button><button type="button" class="touch-button shift-button" data-action="shift-up" aria-label="Vitesi yükselt"><span>+ VİTES</span></button></div>' +
      '</div>' +
      '<div class="income-toast" id="income-toast"></div>' +
      '<div class="message-toast" id="message-toast"></div>' +
      '<div class="dev-code-overlay" id="dev-code-overlay" hidden><section class="dev-code-panel" role="dialog" aria-modal="true" aria-labelledby="dev-code-title">' +
        '<div class="dev-code-heading"><span class="dev-code-mark">⌘</span><button class="close-button" data-action="close-dev-code" aria-label="Kapat">×</button></div>' +
        '<div class="eyebrow">GELİŞTİRİCİ ERİŞİMİ</div><h2 id="dev-code-title">Dev Code</h2>' +
        '<p>Gizli kodu girerek oyun bakiyene ödül ekle.</p>' +
        '<form class="dev-code-form" data-dev-code-form><label for="dev-code-input">KOD</label><input id="dev-code-input" type="text" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Kodu yaz" aria-describedby="dev-code-status">' +
        '<div class="dev-code-status" id="dev-code-status" aria-live="polite">Kod büyük/küçük harfe duyarlı değil.</div>' +
        '<button class="button-primary full" type="submit"><span>KODU KULLAN</span><b>↗</b></button></form>' +
        '<small class="dev-code-shortcut">T ile aç · ESC ile kapat</small></section></div>' +
      '<div class="mini-status"><span class="status-dot"></span> OYUN KAYDI AÇIK <span class="status-separator">·</span> 3 SN GELİR DÖNGÜSÜ</div>' +
      '<div id="modal-host"></div>' +
    '</div>';
    this.hud = host.querySelector('.hud-layer') as HTMLElement;
    this.modalHost = host.querySelector('#modal-host') as HTMLElement;
    this.speedValue = host.querySelector('#speed-value') as HTMLElement;
    this.gearValue = host.querySelector('#gear-value') as HTMLElement;
    this.rpmValue = host.querySelector('#rpm-value') as HTMLElement;
    this.rpmRing = host.querySelector('#rpm-ring') as HTMLElement;
    this.driftBadge = host.querySelector('#drift-indicator') as HTMLElement;
    this.driftModeButton = host.querySelector('.drift-mode-toggle') as HTMLButtonElement;
    this.cashValue = host.querySelector('#cash-value') as HTMLElement;
    this.mapValue = host.querySelector('#map-value') as HTMLElement;
    this.incomeToast = host.querySelector('#income-toast') as HTMLElement;
    this.messageToast = host.querySelector('#message-toast') as HTMLElement;
    this.devCodeOverlay = host.querySelector('#dev-code-overlay') as HTMLElement;
    this.devCodeInput = host.querySelector('#dev-code-input') as HTMLInputElement;
    this.devCodeStatus = host.querySelector('#dev-code-status') as HTMLElement;
    this.carName = host.querySelector('#car-name') as HTMLElement;
    this.className = host.querySelector('#class-name') as HTMLElement;
    host.addEventListener('click', this.onClick);
    host.addEventListener('submit', this.onSubmit);
    host.addEventListener('keydown', this.onKeyDown);
    host.addEventListener('input', this.onInput);
    host.addEventListener('change', this.onChange);
    host.addEventListener('pointerdown', this.onControlPointerDown);
    window.addEventListener('pointerup', this.onControlPointerEnd);
    window.addEventListener('pointercancel', this.onControlPointerEnd);
    window.addEventListener('blur', this.releaseTouchControls);
    this.updateSnapshot(snapshot);
    this.open('main');
  }

  private onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const actionElement = target.closest<HTMLElement>('[data-action]');
    if (actionElement) {
      const action = actionElement.dataset.action as UiAction;
      const id = actionElement.dataset.id;
      if (action === 'preview-car' && id) {
        this.selectedVehicleId = id;
        this.renderScreen();
        return;
      }
      if (action === 'multiplayer-create' || action === 'multiplayer-join') {
        const playerName = this.modalHost.querySelector<HTMLInputElement>('[data-player-name]')?.value.trim() || 'Sürücü';
        const roomCode = this.modalHost.querySelector<HTMLInputElement>('[data-room-code]')?.value.trim().toUpperCase();
        this.multiplayerName = playerName.slice(0, 18) || 'Sürücü';
        try { localStorage.setItem('autodrom.multiplayer.name', this.multiplayerName); } catch { /* storage may be unavailable */ }
        this.callbacks.onAction(action, undefined, { playerName, roomCode });
        return;
      }
      if (action === 'filter-class') {
        this.category = actionElement.dataset.category as CarClass | 'ALL';
        this.updateCatalogResults();
        return;
      }
      if (action === 'clear-filters') {
        this.category = 'ALL';
        this.brandFilter = 'ALL';
        this.modelSearch = '';
        this.updateCatalogResults();
        return;
      }
      this.callbacks.onAction(action, id);
      return;
    }
  };

  private onSubmit = (event: Event): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-dev-code-form]')) return;
    event.preventDefault();
    this.callbacks.onAction('redeem-code', this.devCodeInput.value);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !this.devCodeOverlay.hidden) {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onAction('close-dev-code');
    }
  };

  private onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.matches('[data-model-search]')) {
      this.modelSearch = target.value;
      this.updateCatalogResults();
      return;
    }
    if (!target.dataset.setting) return;
    const settings = { ...this.snapshot.settings };
    const key = target.dataset.setting as keyof GameSettings;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      if (key === 'shadows') settings.shadows = target.checked;
      if (key === 'effects') settings.effects = target.checked;
    } else if (target instanceof HTMLInputElement && target.type === 'range') {
      if (key === 'cameraFollow') settings.cameraFollow = Number(target.value) / 100;
    } else if (key === 'quality') {
      settings.quality = target.value as GameSettings['quality'];
    } else if (key === 'resolutionScale') {
      settings.resolutionScale = Number(target.value) as GameSettings['resolutionScale'];
    } else if (key === 'fpsLimit') {
      settings.fpsLimit = Number(target.value) as GameSettings['fpsLimit'];
    } else if (key === 'transmissionMode') {
      settings.transmissionMode = target.value as GameSettings['transmissionMode'];
    }
    this.snapshot.settings = settings;
    this.callbacks.onSettings(settings);
    if (key === 'cameraFollow') {
      const output = this.modalHost.querySelector('[data-camera-value]');
      if (output) output.textContent = percent.format(settings.cameraFollow * 100) + '%';
    }
  };

  private onChange = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (!target.matches('[data-brand-filter]')) return;
    this.brandFilter = target.value;
    this.updateCatalogResults();
  };

  private onControlPointerDown = (event: PointerEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-control]');
    if (!button || this.currentScreen !== null || this.activeTouchPointers.has(event.pointerId)) return;
    const control = button.dataset.control as DrivingControl | undefined;
    if (!control) return;
    event.preventDefault();
    this.activeTouchPointers.set(event.pointerId, control);
    button.setPointerCapture?.(event.pointerId);
    if ([...this.activeTouchPointers.values()].filter((active) => active === control).length === 1) {
      this.callbacks.onControl(control, true);
    }
  };

  private onControlPointerEnd = (event: PointerEvent): void => {
    const control = this.activeTouchPointers.get(event.pointerId);
    if (!control) return;
    this.activeTouchPointers.delete(event.pointerId);
    if (![...this.activeTouchPointers.values()].includes(control)) this.callbacks.onControl(control, false);
  };

  private releaseTouchControls = (): void => {
    const controls = new Set(this.activeTouchPointers.values());
    this.activeTouchPointers.clear();
    for (const control of controls) this.callbacks.onControl(control, false);
  };

  updateSnapshot(snapshot: UiSnapshot, renderModal = true): void {
    this.snapshot = snapshot;
    this.cashValue.textContent = '₺' + money.format(snapshot.save.cash);
    this.mapValue.textContent = MAP_LABELS[snapshot.map].toLocaleUpperCase('tr-TR');
    this.carName.textContent = snapshot.activeVehicle.shortName;
    this.className.textContent = CLASS_LABELS[snapshot.activeVehicle.category];
    if (this.currentScreen && renderModal) this.renderScreen();
  }

  updateTelemetry(telemetry: Telemetry): void {
    this.speedValue.textContent = String(Math.round(telemetry.speedKmh));
    this.gearValue.textContent = telemetry.gear === -1 ? 'R' : telemetry.gear === 0 ? 'N' : String(telemetry.gear);
    this.rpmValue.textContent = telemetry.rpm.toLocaleString('tr-TR');
    const normalizedRpm = Math.max(0, Math.min(1, (telemetry.rpm - 850) / (7050 - 850)));
    const limiter = telemetry.rpm >= 6900;
    const color = limiter ? '#ff4f59' : telemetry.rpm >= 5200 ? '#f2b45f' : '#79dda6';
    this.rpmRing.style.setProperty('--rpm-progress', (normalizedRpm * 270).toFixed(1) + 'deg');
    this.rpmRing.style.setProperty('--rpm-color', color);
    this.rpmRing.classList.toggle('limiter', limiter);
    this.rpmValue.parentElement?.classList.toggle('limiter', limiter);
    this.driftBadge.classList.toggle('active', telemetry.drifting);
  }

  setDriftModeEnabled(enabled: boolean): void {
    this.driftModeButton.classList.toggle('active', enabled);
    this.driftModeButton.setAttribute('aria-pressed', String(enabled));
    this.driftModeButton.setAttribute('aria-label', enabled ? 'Drift modunu kapat' : 'Drift modunu aç');
    this.driftModeButton.querySelector('b')!.textContent = enabled ? 'AÇIK' : 'KAPALI';
  }

  setMultiplayerInfo(status: string, connected: boolean, roomCode = '', playerCount = 1): void {
    const shouldRerender = status !== this.multiplayerStatus
      || connected !== this.multiplayerConnected
      || roomCode !== this.multiplayerRoomCode;
    this.multiplayerStatus = status;
    this.multiplayerConnected = connected;
    this.multiplayerRoomCode = roomCode;
    this.multiplayerPlayerCount = playerCount;
    if (this.currentScreen !== 'multiplayer') return;
    if (shouldRerender) {
      this.renderScreen();
      return;
    }
    const count = this.modalHost.querySelector<HTMLElement>('.multiplayer-room > small');
    if (count) count.textContent = this.multiplayerPlayerCount + ' / 8 oyuncu';
  }

  showIncome(amount: number): void {
    window.clearTimeout(this.incomeHideTimeout);
    this.incomeToast.innerHTML = '<b>+₺' + money.format(amount) + '</b><span>SÜRÜŞ GELİRİ</span>';
    this.incomeToast.classList.remove('show');
    void this.incomeToast.offsetWidth;
    this.incomeToast.classList.add('show');
    this.incomeHideTimeout = window.setTimeout(() => this.incomeToast.classList.remove('show'), 1000);
  }

  showMessage(title: string, body: string, error: boolean): void {
    this.messageToast.innerHTML = '<b>' + escapeHtml(title) + '</b><span>' + escapeHtml(body) + '</span>';
    this.messageToast.classList.toggle('error', error);
    this.messageToast.classList.remove('show');
    void this.messageToast.offsetWidth;
    this.messageToast.classList.add('show');
    window.setTimeout(() => this.messageToast.classList.remove('show'), 3800);
  }

  isDevCodeOpen(): boolean {
    return !this.devCodeOverlay.hidden;
  }

  openDevCode(): void {
    this.devCodeInput.value = '';
    this.devCodeStatus.textContent = 'Kod büyük/küçük harfe duyarlı değil.';
    this.devCodeStatus.classList.remove('error', 'success');
    this.devCodeOverlay.hidden = false;
    window.requestAnimationFrame(() => this.devCodeInput.focus());
  }

  closeDevCode(): void {
    this.devCodeOverlay.hidden = true;
  }

  showDevCodeStatus(message: string, error = true): void {
    this.devCodeStatus.textContent = message;
    this.devCodeStatus.classList.toggle('error', error);
    this.devCodeStatus.classList.toggle('success', !error);
  }

  open(screen: Screen): void {
    if (screen === 'store' && this.currentScreen !== 'store') {
      this.category = 'ALL';
      this.brandFilter = 'ALL';
      this.modelSearch = '';
    }
    this.currentScreen = screen;
    if (!screen) {
      this.destroyPreview();
      this.modalHost.innerHTML = '';
      this.hud.classList.remove('has-modal');
      this.hud.classList.add('is-driving');
      return;
    }
    this.releaseTouchControls();
    this.hud.classList.remove('is-driving');
    this.hud.classList.add('has-modal');
    this.renderScreen();
  }

  private renderScreen(): void {
    this.destroyPreview();
    const screen = this.currentScreen;
    if (!screen) return;
    this.modalHost.innerHTML = this.screenMarkup(screen);
    const previewHost = this.modalHost.querySelector<HTMLElement>('[data-preview]');
    if (previewHost) {
      const vehicle = screen === 'main'
        ? this.snapshot.activeVehicle
        : VEHICLES.find((item) => item.id === this.selectedVehicleId) ?? this.snapshot.activeVehicle;
      this.preview = new PreviewStage(previewHost, vehicle);
    }
  }

  private screenMarkup(screen: Exclude<Screen, null>): string {
    if (screen === 'main') return this.mainMenu();
    if (screen === 'starter') return this.starterMenu();
    if (screen === 'store') return this.storeMenu(false);
    if (screen === 'garage') return this.storeMenu(true);
    if (screen === 'maps') return this.mapMenu(false);
    if (screen === 'multiplayer') return this.multiplayerMenu();
    if (screen === 'settings') return this.settingsMenu(false);
    return this.pauseMenu();
  }

  private mainMenu(): string {
    const hasSave = this.snapshot.save.starterChosen && !!this.snapshot.save.activeVehicleId;
    const active = this.snapshot.activeVehicle;
    return '<div class="modal-shell menu-shell">' +
      '<div class="menu-backdrop-grid"></div>' +
      '<div class="menu-content">' +
        '<div class="menu-copy"><div class="eyebrow"><i></i> AÇIK DÜNYA SÜRÜŞÜ · SEZON 01</div>' +
          '<h1>Yolu<br><span>sen çiz.</span></h1>' +
          '<p>Direksiyona geç, her kilometrede kazan ve kendi otomobil koleksiyonunu kur.</p>' +
          '<div class="menu-actions">' +
            '<button class="button-primary" data-action="' + (hasSave ? 'continue' : 'starter') + '"><span>' + (hasSave ? 'SÜRÜŞE DEVAM ET' : 'İLK ARACINI SEÇ') + '</span><b>↗</b></button>' +
            '<button class="button-quiet" data-action="maps"><span>HARİTA SEÇİMİ</span><b>⌖</b></button>' +
          '</div>' +
          '<div class="menu-footnote"><span>WASD</span> sürüş <i>·</i> <span>Q / E</span> vites <i>·</i> <span>SPACE</span> el freni <i>·</i> <span>SOL TUŞLA SÜRÜKLE / TELEFONDA KAYDIR</span> kamera</div>' +
        '</div>' +
        '<div class="menu-vehicle-card"><div class="preview-caption"><div><small>' + (this.snapshot.save.starterChosen ? 'GARAJDA' : 'ÖRNEK ARAÇ') + '</small><b>' + escapeHtml(active.name) + '</b></div><span class="class-chip">' + CLASS_LABELS[active.category] + '</span></div>' +
          '<div class="menu-preview" data-preview></div>' +
          '<div class="menu-stats"><div><small>MAKS. HIZ</small><b>' + active.maxSpeed + '<i>km/sa</i></b></div><div><small>GÜÇ</small><b>' + active.power + '<i>hp</i></b></div><div><small>DEĞER</small><b>₺' + money.format(active.price) + '</b></div></div>' +
        '</div>' +
        '<div class="menu-bottom"><span>AUTODROM / DRIVE & BUILD</span><span>BUILD 0.1.0 <i>·</i> YEREL KAYIT AÇIK</span></div>' +
      '</div>' +
      '<div class="menu-corner"><span>IST</span><i></i> 06:24 AM</div>' +
    '</div>';
  }

  private starterMenu(): string {
    const selected = VEHICLES.find((item) => item.id === this.selectedVehicleId && item.starterChoice) ?? STARTER_VEHICLES[0];
    const cards = STARTER_VEHICLES.map((vehicle) => {
      const active = vehicle.id === selected.id ? ' selected' : '';
      return '<button class="starter-card' + active + '" data-action="preview-car" data-id="' + vehicle.id + '">' +
        '<span class="starter-card-index">0' + (STARTER_VEHICLES.indexOf(vehicle) + 1) + '</span><span class="starter-card-copy"><b>' + escapeHtml(vehicle.name) + '</b><small>' + escapeHtml(vehicle.subtitle) + '</small></span>' +
        '<span class="free-tag">ÜCRETSİZ</span><span class="starter-card-speed">' + vehicle.maxSpeed + '<i>km/sa</i></span></button>';
    }).join('');
    return '<div class="modal-shell selection-shell"><div class="selection-header"><button class="back-button" data-action="main">← <span>ANA MENÜ</span></button><div class="eyebrow">01 / BAŞLANGIÇ GARAJI</div><div class="selection-step">ARACINI SEÇ <i>—</i> SÜRÜŞE BAŞLA</div></div>' +
      '<div class="selection-layout"><div class="selection-list"><div class="selection-title"><small>İLK SEÇİMİN</small><h2>İyi bir<br>başlangıç.</h2><p>Bir otomobil seç. Üç araç da ücretsiz; başlangıç bakiyen değişmez.</p>' + cards +
          '<div class="starter-balance"><span>BAŞLANGIÇ BAKİYESİ</span><b>₺' + money.format(this.snapshot.save.cash) + '</b><i>Koleksiyon seçimine bağlı olarak değişmez</i></div>' +
          '<button class="button-primary full" data-action="select-starter" data-id="' + selected.id + '"><span>' + escapeHtml(selected.name) + ' İLE SÜRÜŞE BAŞLA</span><b>↗</b></button>' +
        '</div><div class="selection-preview"><div class="preview-large" data-preview></div><div class="selection-car-caption"><div><span class="class-chip">' + CLASS_LABELS[selected.category] + '</span><h3>' + escapeHtml(selected.name) + '</h3><p>' + escapeHtml(selected.subtitle) + '</p></div><div class="selection-price"><small>PİYASA DEĞERİ</small><b>₺' + money.format(selected.price) + '</b></div></div>' +
          '<div class="spec-bars">' + specBar('HIZ', selected.maxSpeed, 360, 'km/sa') + specBar('HIZLANMA', selected.acceleration, 27, 'm/s²') + specBar('YOL TUTUŞU', selected.handling, 1, '/10') + '</div></div></div></div>';
  }

  private storeMenu(garageOnly: boolean): string {
    const currentId = this.selectedVehicleId;
    const selected = VEHICLES.find((vehicle) => vehicle.id === currentId) ?? this.snapshot.activeVehicle;
    const owned = new Set(this.snapshot.save.ownedVehicles);
    const categories: Array<CarClass | 'ALL'> = ['ALL', 'EKONOMI', 'SEHIR', 'SPORT', 'PERFORMANS', 'SUPER'];
    const brands = [...new Set(VEHICLES.map((vehicle) => vehicle.brand))].sort((a, b) => a.localeCompare(b, 'tr'));
    const filters = '<div class="catalog-toolbar"><label class="brand-filter"><span>MARKA</span><select data-brand-filter aria-label="Markaya göre filtrele"><option value="ALL"' + (this.brandFilter === 'ALL' ? ' selected' : '') + '>Tüm markalar</option>' +
      brands.map((brand) => '<option value="' + escapeHtml(brand) + '"' + (this.brandFilter === brand ? ' selected' : '') + '>' + escapeHtml(brand) + '</option>').join('') +
      '</select></label><label class="model-search"><span>MODEL ARA</span><input type="search" data-model-search value="' + escapeHtml(this.modelSearch) + '" placeholder="Marka veya model" autocomplete="off" aria-label="Marka veya model ara"></label>' +
      '<button class="clear-filters" data-action="clear-filters" aria-label="Filtreleri temizle">TEMİZLE</button></div><div class="category-filter">' + categories.map((category) => {
      const label = category === 'ALL' ? 'TÜMÜ' : CLASS_LABELS[category];
      return '<button class="' + (this.category === category ? 'active' : '') + '" data-action="filter-class" data-category="' + category + '">' + label + '</button>';
    }).join('') + '</div>';
    const filtered = this.getFilteredVehicles(garageOnly).sort((a, b) =>
      Number(RECENT_VEHICLE_IDS.has(b.id)) - Number(RECENT_VEHICLE_IDS.has(a.id)),
    );
    const list = filtered.map((vehicle) => {
      const isOwned = owned.has(vehicle.id);
      const isActive = this.snapshot.save.activeVehicleId === vehicle.id;
      return '<button class="catalog-row' + (selected.id === vehicle.id ? ' selected' : '') + '" data-action="preview-car" data-id="' + vehicle.id + '">' +
        '<span class="catalog-swatch" style="--car-color:' + vehicle.bodyColor + '"><i></i></span>' +
        '<span class="catalog-name"><b>' + escapeHtml(vehicle.name) + '</b><small>' + escapeHtml(vehicle.brand) + ' · ' + CLASS_LABELS[vehicle.category] + ' · ' + vehicle.maxSpeed + ' KM/SA</small></span>' +
        '<span class="catalog-price ' + (isOwned ? 'owned' : 'for-sale') + '">' + (isOwned ? (isActive ? 'AKTİF' : 'SAHİP') : '₺' + money.format(vehicle.price)) + '</span>' +
      '</button>';
    }).join('');
    const isOwned = owned.has(selected.id);
    const isActive = this.snapshot.save.activeVehicleId === selected.id;
    const purchase = isOwned
      ? (isActive ? '<button class="button-secondary full" disabled><span>ŞU ANDA AKTİF</span><b>✓</b></button>' : '<button class="button-primary full" data-action="activate" data-id="' + selected.id + '"><span>BU ARACI KULLAN</span><b>↗</b></button>')
      : '<button class="button-primary full" data-action="buy" data-id="' + selected.id + '"><span>₺' + money.format(selected.price) + ' · SATIN AL</span><b>↗</b></button>';
    const title = garageOnly ? 'Garajım' : 'Araç mağazası';
    const priceReference = selected.realSpecs?.turkeyPriceTry
      ? '<div class="detail-price-reference">Türkiye fiyat referansı: ₺' + money.format(selected.realSpecs.turkeyPriceTry) + '<small>' + escapeHtml(selected.realSpecs.turkeyPriceNote ?? '') + '</small></div>'
      : '';
    const realSpecs = selected.realSpecs;
    const facts = realSpecs
      ? '<div class="detail-facts"><span><small>MODEL YILI</small><b>' + (realSpecs.modelYear ?? 'Belirtilmemiş') + '</b></span>' +
        '<span><small>GÜÇ · HACİM</small><b>' + (realSpecs.powerHp ? realSpecs.powerHp + ' bg' : 'Belirtilmemiş') + ' · ' + (realSpecs.engineDisplacementCc ? money.format(realSpecs.engineDisplacementCc) + ' cc' : '—') + '</b></span>' +
        '<span><small>TORK · AĞIRLIK</small><b>' + (realSpecs.torqueNm ? realSpecs.torqueNm + ' Nm' : 'Belirtilmemiş') + ' · ' + (realSpecs.weightKg ? realSpecs.weightKg + ' kg' : '—') + '</b></span>' +
        '<span><small>TAHRİK · ŞANZIMAN</small><b>' + escapeHtml(realSpecs.drive ?? 'Belirtilmemiş') + ' · ' + escapeHtml(realSpecs.transmission ?? 'Belirtilmemiş') + '</b></span></div>' +
        (realSpecs.note ? '<p class="detail-source-note">' + escapeHtml(realSpecs.note) + '</p>' : '')
      : '<p class="detail-source-note">Bu Autodrom modeli kurgusaldır; üretici teknik verisi bulunmuyor.</p>';
    return '<div class="modal-shell side-modal"><section class="catalog-panel"><div class="panel-topline"><div><div class="eyebrow">' + (garageOnly ? 'KOLEKSİYON' : 'ARAÇ PAZARI') + '</div><h2>' + title + '</h2></div><button class="close-button" data-action="close" aria-label="Kapat">×</button></div>' +
        '<div class="catalog-count"><span>' + (garageOnly ? 'GARAJ ARAÇLARI' : VEHICLES.length + ' ARAÇ') + ' <small data-catalog-results>' + filtered.length + ' sonuç</small></span><b>' + owned.size + ' / ' + VEHICLES.length + ' SAHİP</b></div>' + filters +
        '<div class="catalog-list">' + (list || '<div class="empty-state">Bu filtrelerle eşleşen araç yok. Marka/model aramasını değiştirin veya filtreleri temizleyin.</div>') + '</div>' +
        '<div class="catalog-footer"><span>GÜNCEL BAKİYE</span><b>₺' + money.format(this.snapshot.save.cash) + '</b></div></section>' +
      '<section class="vehicle-detail"><div class="detail-topline"><button class="back-button" data-action="close">← <span>SÜRÜŞE DÖN</span></button><span class="class-chip">' + CLASS_LABELS[selected.category] + '</span></div>' +
        '<div class="detail-preview" data-preview></div>' +
        '<div class="detail-heading"><div><div class="eyebrow">' + escapeHtml(selected.brand + ' · ' + selected.subtitle).toLocaleUpperCase('tr-TR') + '</div><h2>' + escapeHtml(selected.name) + '</h2></div><div class="detail-market"><small>OYUN FİYATI</small><b>₺' + money.format(selected.price) + '</b></div></div>' +
        '<div class="detail-specs">' + specBar('MAKS. HIZ', selected.maxSpeed, 360, 'km/sa') + specBar('HIZLANMA', selected.acceleration, 27, 'm/s²') + specBar('FREN', selected.braking, 26, 'm/s²') + specBar('YOL TUTUŞU', selected.handling, 1, '/10') + '</div>' +
        facts + '<div class="detail-game-note">OYUN AYARI: ' + selected.power + ' güç · ' + selected.maxSpeed + ' km/sa azami hız · ' + selected.acceleration + ' hızlanma</div>' + priceReference +
        '<div class="detail-action">' + purchase + '<small>' + (isOwned ? (isActive ? 'Aktif araç olarak seçildi.' : 'Bu araç garajında kayıtlı.') : 'Satın alma tutarı tek seferde bakiyenden düşer.') + '</small></div></section></div>';
  }

  private getFilteredVehicles(garageOnly: boolean): VehicleSpec[] {
    const owned = new Set(this.snapshot.save.ownedVehicles);
    const query = normalizeSearch(this.modelSearch);
    return VEHICLES.filter((vehicle) => {
      if (garageOnly && !owned.has(vehicle.id)) return false;
      if (this.brandFilter !== 'ALL' && vehicle.brand !== this.brandFilter) return false;
      if (this.category !== 'ALL' && vehicle.category !== this.category) return false;
      if (!query) return true;
      return normalizeSearch(vehicle.brand + ' ' + vehicle.name + ' ' + vehicle.shortName).includes(query);
    });
  }

  private updateCatalogResults(): void {
    const list = this.modalHost.querySelector<HTMLElement>('.catalog-list');
    if (!list || (this.currentScreen !== 'store' && this.currentScreen !== 'garage')) return;
    const garageOnly = this.currentScreen === 'garage';
    const filtered = this.getFilteredVehicles(garageOnly);
    const owned = new Set(this.snapshot.save.ownedVehicles);
    const selected = VEHICLES.find((vehicle) => vehicle.id === this.selectedVehicleId) ?? this.snapshot.activeVehicle;
    list.innerHTML = filtered.length
      ? filtered.map((vehicle) => {
          const isOwned = owned.has(vehicle.id);
          const isActive = this.snapshot.save.activeVehicleId === vehicle.id;
          return '<button class="catalog-row' + (selected.id === vehicle.id ? ' selected' : '') + '" data-action="preview-car" data-id="' + vehicle.id + '">' +
            '<span class="catalog-swatch" style="--car-color:' + vehicle.bodyColor + '"><i></i></span>' +
            '<span class="catalog-name"><b>' + escapeHtml(vehicle.name) + '</b><small>' + escapeHtml(vehicle.brand) + ' · ' + CLASS_LABELS[vehicle.category] + ' · ' + vehicle.maxSpeed + ' KM/SA</small></span>' +
            '<span class="catalog-price ' + (isOwned ? 'owned' : 'for-sale') + '">' + (isOwned ? (isActive ? 'AKTİF' : 'SAHİP') : '₺' + money.format(vehicle.price)) + '</span>' +
          '</button>';
        }).join('')
      : '<div class="empty-state">Bu filtrelerle eşleşen araç yok. Marka/model aramasını değiştirin veya filtreleri temizleyin.</div>';
    const results = this.modalHost.querySelector<HTMLElement>('[data-catalog-results]');
    if (results) results.textContent = filtered.length + ' sonuç';
    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-action="filter-class"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.category === this.category);
    });
    const brand = this.modalHost.querySelector<HTMLSelectElement>('[data-brand-filter]');
    if (brand && brand.value !== this.brandFilter) brand.value = this.brandFilter;
    const search = this.modalHost.querySelector<HTMLInputElement>('[data-model-search]');
    if (search && search.value !== this.modelSearch && search !== document.activeElement) search.value = this.modelSearch;
  }

  private mapMenu(inGame: boolean): string {
    const maps: Array<{ id: MapId; title: string; description: string; image: string; tag: string }> = [
      { id: 'city-highway', title: 'Şehir + Otoban', description: 'Şehir caddelerinden bağlantı yoluyla çevre otobanına kesintisiz sürüş. Hız kapılarında 200 km/sa ile geçip ₺5.000 kazan.', image: 'city-highway', tag: 'TEK, BAĞLI DÜNYA' },
    ];
    return '<div class="modal-shell centered-modal"><div class="panel-topline"><div><div class="eyebrow">SÜRÜŞ ORTAMI</div><h2>Harita seçimi</h2></div><button class="close-button" data-action="' + (inGame || this.snapshot.save.starterChosen ? 'close' : 'main') + '">×</button></div>' +
      '<p class="modal-description">Şehir caddeleri ve çevre otobanı aynı haritada birbirine bağlı.</p><div class="map-cards">' +
      maps.map((map) => '<button class="map-card ' + map.image + (this.snapshot.map === map.id ? ' current' : '') + '" data-action="choose-map" data-id="' + map.id + '">' +
        '<span class="map-art"><i></i><b></b><em></em></span><span class="map-tag">' + map.tag + '</span>' +
        '<span class="map-card-copy"><b>' + map.title + '</b><small>' + map.description + '</small></span><span class="map-card-bottom">' + (this.snapshot.map === map.id ? 'ŞU ANKİ HARİTA' : 'HARİTAYA GİT') + '<i>↗</i></span></button>').join('') +
      '</div><div class="modal-footer-note"><span>₺' + money.format(this.snapshot.save.cash) + '</span> · ' + this.snapshot.save.ownedVehicles.length + ' ARAÇ GARDA KAYITLI</div></div>';
  }

  private settingsMenu(inGame: boolean): string {
    const settings = this.snapshot.settings;
    return '<div class="modal-shell centered-modal settings-modal"><div class="panel-topline"><div><div class="eyebrow">SÜRÜŞÜNÜ KİŞİSELLEŞTİR</div><h2>Ayarlar</h2></div><button class="close-button" data-action="' + (inGame || this.snapshot.save.starterChosen ? 'close' : 'main') + '">×</button></div>' +
      '<div class="settings-grid"><section class="settings-section"><div class="settings-section-head"><span>01</span><div><b>GRAFİK</b><small>Görsel kalite ve performans</small></div></div>' +
        '<label class="setting-row"><span><b>Görüntü kalitesi</b><small>Doku, gölge ve çizim uzaklığı</small></span><select data-setting="quality"><option value="low"' + selected(settings.quality === 'low') + '>Düşük</option><option value="medium"' + selected(settings.quality === 'medium') + '>Orta</option><option value="high"' + selected(settings.quality === 'high') + '>Yüksek</option><option value="ultra"' + selected(settings.quality === 'ultra') + '>Aşırı Yüksek</option></select></label>' +
        '<label class="setting-row"><span><b>Çözünürlük ölçeği</b><small>Düşük ölçek FPS’i artırabilir</small></span><select data-setting="resolutionScale"><option value="0.5"' + selected(settings.resolutionScale === 0.5) + '>%50</option><option value="0.7"' + selected(settings.resolutionScale === 0.7) + '>%70</option><option value="0.85"' + selected(settings.resolutionScale === 0.85) + '>%85</option><option value="1"' + selected(settings.resolutionScale === 1) + '>%100</option></select></label>' +
        '<label class="setting-row"><span><b>Yumuşak gölgeler</b><small>Gölge haritasını açıp kapat</small></span><input type="checkbox" data-setting="shadows"' + checked(settings.shadows) + '></label>' +
        '<label class="setting-row"><span><b>Drift izleri</b><small>Sürüş efektlerini göster</small></span><input type="checkbox" data-setting="effects"' + checked(settings.effects) + '></label>' +
        '<label class="setting-row"><span><b>Kare hızı sınırı</b><small>Akıcılık ve güç tüketimi dengesi</small></span><select data-setting="fpsLimit"><option value="30"' + selected(settings.fpsLimit === 30) + '>30 FPS</option><option value="60"' + selected(settings.fpsLimit === 60) + '>60 FPS</option><option value="0"' + selected(settings.fpsLimit === 0) + '>Sınırsız</option></select></label>' +
        '<button class="setting-row fullscreen-row" data-action="fullscreen"><span><b>Tam ekran</b><small>Tarayıcının desteklediği ekran görünümü</small></span><i>↗</i></button>' +
      '</section><section class="settings-section"><div class="settings-section-head"><span>02</span><div><b>KAMERA & KONTROLLER</b><small>Takip hissini ve sürüşü ayarla</small></div></div>' +
        '<label class="setting-row"><span><b>Vites sistemi</b><small>Otomatikte 6.700 dev/dak yükseltir, uygun devirde küçültür</small></span><select data-setting="transmissionMode"><option value="manual"' + selected(settings.transmissionMode === 'manual') + '>Manuel</option><option value="automatic"' + selected(settings.transmissionMode === 'automatic') + '>Otomatik</option></select></label>' +
        '<label class="setting-row range-row"><span><b>Kamera takibi</b><small>Yumuşak takip <strong data-camera-value>' + percent.format(settings.cameraFollow * 100) + '%</strong></small></span><input type="range" min="4" max="24" value="' + Math.round(settings.cameraFollow * 100) + '" data-setting="cameraFollow"></label>' +
        '<div class="control-guide"><div><kbd>W</kbd><span>Gaz</span></div><div><kbd>S</kbd><span>Fren / geri</span></div><div><kbd>A</kbd><kbd>D</kbd><span>Direksiyon</span></div><div><kbd>Q</kbd><kbd>E</kbd><span>Vites (dokunmatik − / +)</span></div><div><kbd>SPACE</kbd><span>El freni & drift</span></div><div><kbd>ESC</kbd><span>Duraklat</span></div></div>' +
      '</section></div><div class="settings-bottom"><span>AYARLAR BU TARAYICIDA KAYDEDİLİR</span><button class="button-primary compact" data-action="close"><span>UYGULA</span><b>✓</b></button></div></div>';
  }

  private pauseMenu(): string {
    return '<div class="modal-shell pause-shell"><div class="pause-card"><div class="eyebrow"><i></i> OYUN DURAKLATILDI</div><h2>Bir nefes<br><span>al.</span></h2><p>Sürüş gelirleri menülerde bekler. Hazır olduğunda yola dön.</p>' +
      '<button class="button-primary full" data-action="resume"><span>SÜRÜŞE DÖN</span><b>↗</b></button>' +
      '<div class="pause-actions"><button data-action="store">ARAÇ MAĞAZASI <i>◈</i></button><button data-action="garage">GARAJIM <i>▣</i></button><button data-action="maps">HARİTA SEÇ <i>⌖</i></button><button data-action="settings">AYARLAR <i>⚙</i></button></div>' +
      '<button class="return-menu" data-action="main">ANA MENÜYE DÖN <span>↗</span></button></div><div class="pause-side"><span>AKTİF ARAÇ</span><b>' + escapeHtml(this.snapshot.activeVehicle.name) + '</b><i>' + MAP_LABELS[this.snapshot.map].toLocaleUpperCase('tr-TR') + ' · ₺' + money.format(this.snapshot.save.cash) + '</i></div></div>';
  }

  private multiplayerMenu(): string {
    const room = this.multiplayerRoomCode;
    return '<div class="modal-shell centered-modal multiplayer-modal"><div class="panel-topline"><div><div class="eyebrow">ÇEVRİM İÇİ SÜRÜŞ</div><h2>Arkadaşlarınla sür</h2></div><button class="close-button" data-action="close" aria-label="Kapat">×</button></div>' +
      '<p class="modal-description">Oda kur, altı haneli kodu arkadaşına gönder ve aynı yolda buluş.</p>' +
      '<label class="multiplayer-field"><span>SÜRÜCÜ ADI</span><input data-player-name maxlength="18" value="' + escapeHtml(this.multiplayerName) + '" autocomplete="nickname"></label>' +
      (this.multiplayerConnected
        ? '<div class="multiplayer-room"><span>ODA KODU</span><b>' + escapeHtml(room) + '</b><small>' + this.multiplayerPlayerCount + ' / 8 oyuncu</small><button class="button-secondary" data-action="copy-room">KODU KOPYALA</button></div>'
        : '<label class="multiplayer-field"><span>ARKADAŞININ ODA KODU</span><input data-room-code maxlength="6" placeholder="ABC123" autocomplete="off"></label>') +
      '<div class="multiplayer-status' + (this.multiplayerConnected ? ' connected' : '') + '" role="status">' + escapeHtml(this.multiplayerStatus) + '</div>' +
      (this.multiplayerConnected
        ? '<button class="button-secondary multiplayer-leave" data-action="multiplayer-leave">ODADAN AYRIL</button>'
        : '<div class="multiplayer-actions"><button class="button-primary" data-action="multiplayer-create"><span>ODA KUR</span><b>↗</b></button><button class="button-secondary" data-action="multiplayer-join">KODA KATIL</button></div>') +
      '</div>';
  }

  private destroyPreview(): void {
    this.preview?.dispose();
    this.preview = null;
  }
}

class PreviewStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  private readonly visual: ReturnType<typeof createVehicleVisual>;
  private readonly observer: ResizeObserver;
  private frameId = 0;
  private angle = -0.28;
  private lastFrameTime = 0;
  private lastRenderTime = 0;
  private dragging = false;
  private lastX = 0;

  constructor(private readonly host: HTMLElement, vehicle: VehicleSpec) {
    this.scene.background = new THREE.Color('#202925');
    this.scene.fog = new THREE.Fog('#202925', 10, 30);
    const key = new THREE.DirectionalLight('#fff1d1', 3.2);
    key.position.set(-5, 8, 7);
    this.scene.add(key, new THREE.HemisphereLight('#e4f2e8', '#55615a', 2));
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 3.8, 0.15, 64),
      new THREE.MeshStandardMaterial({ color: '#4a554e', roughness: 0.6, metalness: 0.3 }),
    );
    platform.position.y = -0.08;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.45, 0.014, 5, 96),
      new THREE.MeshBasicMaterial({ color: '#a7c8ae', transparent: true, opacity: 0.54 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.visual = createVehicleVisual(vehicle);
    this.scene.add(this.visual.root);
    void installGeneratedModel(this.visual, vehicle).then(() => this.fitCamera());
    this.camera.position.set(6.2, 3.1, 7.4);
    this.camera.lookAt(0, 0.72, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'preview-canvas';
    this.host.appendChild(this.renderer.domElement);
    this.host.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
    this.fitCamera();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastX = event.clientX;
    this.host.setPointerCapture?.(event.pointerId);
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.angle += (event.clientX - this.lastX) * 0.008;
    this.lastX = event.clientX;
  };
  private onPointerUp = (): void => { this.dragging = false; };

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.fitCamera();
  }

  private fitCamera(): void {
    this.visual.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.visual.root);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.1));
    const distance = Math.max(
      sphere.radius / Math.sin(verticalFov / 2),
      sphere.radius / Math.sin(horizontalFov / 2),
    ) * 1.14;
    const direction = new THREE.Vector3(6.2, 3.1, 7.4).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.lookAt(sphere.center.x, sphere.center.y + sphere.radius * 0.02, sphere.center.z);
  }

  private frame = (time: number): void => {
    const elapsed = this.lastFrameTime ? Math.min((time - this.lastFrameTime) / 1000, 0.1) : 0;
    this.lastFrameTime = time;
    if (!this.dragging) this.angle += elapsed * 0.06;
    if (time - this.lastRenderTime >= 1000 / 30) {
      this.visual.root.rotation.y = this.angle;
      this.renderer.render(this.scene, this.camera);
      this.lastRenderTime = time;
    }
    this.frameId = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    if (this.renderer.domElement.parentElement === this.host) this.host.removeChild(this.renderer.domElement);
    this.renderer.dispose();
    disposeVehicleVisual(this.visual);
    disposeSceneResources(this.scene);
  }
}

function specBar(label: string, value: number, max: number, unit: string): string {
  const fill = Math.max(6, Math.min(100, (value / max) * 100));
  return '<div class="spec-row"><div><span>' + label + '</span><b>' + value + '<i>' + unit + '</i></b></div><span class="spec-track"><i style="width:' + fill + '%"></i></span></div>';
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR').replaceAll('ı', 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function disposeSceneResources(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      const assigned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of assigned) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

function checked(value: boolean): string { return value ? ' checked' : ''; }
function selected(value: boolean): string { return value ? ' selected' : ''; }
