import './styles.css';
import { DriveEngine, type Telemetry } from './engine';
import { STARTER_VEHICLES, VEHICLES, type MapId, type VehicleSpec } from './data';
import { saveGame, loadSave, loadSettings, saveSettings, type SaveData, type GameSettings } from './save';
import { GameInterface, type Screen, type UiAction, type UiSnapshot } from './ui';
import { MultiplayerClient } from './multiplayer';

const gameHost = document.querySelector<HTMLElement>('#game');
const uiHost = document.querySelector<HTMLElement>('#interface');
if (!gameHost || !uiHost) throw new Error('Game surface is missing');

let save: SaveData = loadSave();
let settings: GameSettings = loadSettings();
let currentMap: MapId = save.map;
let activeVehicle: VehicleSpec = VEHICLES.find((vehicle) => vehicle.id === save.activeVehicleId) ?? STARTER_VEHICLES[0];
let currentScreen: Screen = 'main';
let returnScreen: Screen = 'main';
let ui: GameInterface | null = null;
let devCodeResumeDriving = false;
let lastTelemetry: Telemetry = { speedKmh: 0, gear: 1, rpm: 850, drifting: false };
const purchaseLocks = new Set<string>();

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 820px) and (pointer: coarse)').matches || window.matchMedia('(max-width: 600px)').matches;
}

function requestMobileFullscreen(): void {
  if (!isMobileViewport() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  void document.documentElement.requestFullscreen().catch(() => undefined);
}

// Browsers that require a user gesture reject this initial attempt; start/select actions retry it.
requestMobileFullscreen();

function snapshot(): UiSnapshot {
  return { save, settings, map: currentMap, activeVehicle };
}

function updateUi(renderModal = true): void {
  ui?.updateSnapshot(snapshot(), renderModal);
}

const engine = new DriveEngine(gameHost, activeVehicle, currentMap, settings, {
  onIncome: (amount) => {
    save.cash += amount;
    saveGame(save);
    updateUi(false);
    ui?.showIncome(amount);
  },
  onMissionComplete: (amount) => {
    save.cash += amount;
    saveGame(save);
    updateUi(false);
    ui?.showMessage('HIZ GÖREVİ TAMAMLANDI', '200 km/sa hız kapısından geçtin. ₺' + amount.toLocaleString('tr-TR') + ' kazandın.', false);
  },
  onMissionFailed: () => {
    ui?.showMessage('HIZ YETERSİZ', '₺5.000 ödül için hız kapısından en az 200 km/sa ile geç.', true);
  },
  onDevCode: () => toggleDevCodePanel(),
  onTelemetry: (telemetry) => {
    lastTelemetry = telemetry;
    ui?.updateTelemetry(telemetry);
  },
  onEscape: () => {
    if (ui?.isDevCodeOpen()) {
      closeDevCodePanel();
      return;
    }
    if (currentScreen === null) setScreen('pause');
    else if (currentScreen === 'pause') returnToPrevious();
  },
});
const multiplayer = new MultiplayerClient();
engine.setMultiplayer(multiplayer);

ui = new GameInterface(uiHost, snapshot(), {
  onAction: handleAction,
  onControl: (control, pressed) => engine.setTouchControl(control, pressed),
  onSettings: (nextSettings) => {
    settings = nextSettings;
    saveSettings(settings);
    engine.setSettings(settings);
    updateUi(false);
  },
});
multiplayer.setListeners(
  (status, connected) => ui?.setMultiplayerInfo(status, connected, multiplayer.roomCode, multiplayer.playerCount),
  (players) => {
    engine.setRemotePlayers(players);
    ui?.setMultiplayerInfo(multiplayer.statusMessage, multiplayer.isConnected, multiplayer.roomCode, multiplayer.playerCount);
  },
);
ui.updateTelemetry(lastTelemetry);

function toggleDevCodePanel(): void {
  if (!ui) return;
  if (ui.isDevCodeOpen()) {
    closeDevCodePanel();
    return;
  }
  devCodeResumeDriving = currentScreen === null;
  engine.setDrivingEnabled(false);
  ui.openDevCode();
}

function closeDevCodePanel(): void {
  if (!ui?.isDevCodeOpen()) return;
  ui.closeDevCode();
  if (devCodeResumeDriving && currentScreen === null) engine.setDrivingEnabled(true);
  devCodeResumeDriving = false;
}

function setScreen(screen: Screen): void {
  currentScreen = screen;
  ui?.open(screen);
  engine.setDrivingEnabled(screen === null);
}

function openSubscreen(screen: Exclude<Screen, null>): void {
  returnScreen = currentScreen;
  setScreen(screen);
}

function returnToPrevious(): void {
  setScreen(returnScreen);
}

function handleAction(action: UiAction, id?: string, payload?: { playerName?: string; roomCode?: string }): void {
  if (action === 'multiplayer') {
    openSubscreen('multiplayer');
    return;
  }
  if (action === 'multiplayer-create' || action === 'multiplayer-join') {
    const playerName = payload?.playerName ?? 'Sürücü';
    const roomCode = payload?.roomCode ?? '';
    const request = action === 'multiplayer-create'
      ? multiplayer.createRoom(playerName, activeVehicle.id)
      : multiplayer.joinRoom(roomCode, playerName, activeVehicle.id);
    void request;
    return;
  }
  if (action === 'multiplayer-leave') {
    multiplayer.leaveRoom();
    return;
  }
  if (action === 'copy-room') {
    if (multiplayer.roomCode) void navigator.clipboard?.writeText(multiplayer.roomCode);
    return;
  }
  if (action === 'toggle-drift') {
    ui?.setDriftModeEnabled(engine.toggleDriftMode());
    return;
  }
  if (action === 'start' || action === 'continue' || action === 'starter' || action === 'select-starter') {
    requestMobileFullscreen();
  }
  if (action === 'shift-up') {
    engine.shiftUp();
    return;
  }
  if (action === 'shift-down') {
    engine.shiftDown();
    return;
  }
  if (action === 'close-dev-code') {
    closeDevCodePanel();
    return;
  }
  if (action === 'redeem-code') {
    if ((id ?? '').trim().toLowerCase() !== 'dev code') {
      ui?.showDevCodeStatus('Kod geçersiz. Tekrar dene.');
      return;
    }
    save.cash += 5_000_000;
    saveGame(save);
    updateUi(false);
    closeDevCodePanel();
    ui?.showMessage('GİZLİ KOD KABUL EDİLDİ', 'Bakiyene ₺5.000.000 eklendi.', false);
    return;
  }
  if (action === 'start' || action === 'continue') {
    if (!save.starterChosen) {
      openSubscreen('starter');
      return;
    }
    setScreen(null);
    engine.setMap(currentMap);
    engine.setVehicle(activeVehicle);
    return;
  }
  if (action === 'starter') {
    if (save.starterChosen) {
      setScreen(null);
      engine.setVehicle(activeVehicle);
    } else {
      openSubscreen('starter');
    }
    return;
  }
  if (action === 'select-starter' && id) {
    const selected = STARTER_VEHICLES.find((vehicle) => vehicle.id === id);
    if (!selected || save.starterChosen) return;
    save = {
      ...save,
      cash: 10000,
      ownedVehicles: [selected.id],
      activeVehicleId: selected.id,
      starterChosen: true,
    };
    activeVehicle = selected;
    saveGame(save);
    engine.setVehicle(selected);
    setScreen(null);
    updateUi(false);
    return;
  }
  if (action === 'pause') {
    if (currentScreen === 'pause') returnToPrevious();
    else openSubscreen('pause');
    return;
  }
  if (action === 'resume') {
    returnScreen = null;
    setScreen(null);
    return;
  }
  if (action === 'close') {
    returnToPrevious();
    return;
  }
  if (action === 'main') {
    returnScreen = 'main';
    setScreen('main');
    return;
  }
  if (action === 'store' || action === 'garage' || action === 'maps' || action === 'settings') {
    const next: Exclude<Screen, null> = action === 'store' ? 'store' : action === 'garage' ? 'garage' : action;
    if (currentScreen !== next) openSubscreen(next);
    return;
  }
  if (action === 'choose-map' && id) {
    const mapId: MapId = 'city-highway';
    const previous = returnScreen;
    currentMap = mapId;
    save.map = mapId;
    saveGame(save);
    engine.setMap(mapId);
    if (previous === null) setScreen(null);
    else if (previous === 'pause') setScreen('pause');
    else if (previous === 'starter') setScreen('starter');
    else setScreen('main');
    updateUi();
    return;
  }
  if (action === 'buy' && id) {
    purchaseVehicle(id);
    return;
  }
  if (action === 'activate' && id) {
    activateVehicle(id);
    return;
  }
  if (action === 'fullscreen') {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  }
}

function purchaseVehicle(id: string): void {
  if (purchaseLocks.has(id)) return;
  const vehicle = VEHICLES.find((item) => item.id === id);
  if (!vehicle) return;
  if (save.ownedVehicles.includes(id)) {
    activateVehicle(id);
    return;
  }
  if (save.cash < vehicle.price) {
    ui?.showMessage('Bakiye yetersiz', 'Bu araç için ₺' + (vehicle.price - save.cash).toLocaleString('tr-TR') + ' daha kazanmalısın.', true);
    return;
  }
  purchaseLocks.add(id);
  save = { ...save, cash: save.cash - vehicle.price, ownedVehicles: [...save.ownedVehicles, id], activeVehicleId: id };
  activeVehicle = vehicle;
  saveGame(save);
  engine.setVehicle(vehicle);
  updateUi();
  ui?.showMessage(vehicle.name + ' garaja eklendi', 'Araç bedeli bakiyenden bir kez düşüldü.', false);
  purchaseLocks.delete(id);
}

function activateVehicle(id: string): void {
  if (!save.ownedVehicles.includes(id)) return;
  const vehicle = VEHICLES.find((item) => item.id === id);
  if (!vehicle) return;
  activeVehicle = vehicle;
  save = { ...save, activeVehicleId: id };
  saveGame(save);
  engine.setVehicle(vehicle);
  updateUi();
}

window.addEventListener('beforeunload', () => {
  save.map = currentMap;
  saveGame(save);
  saveSettings(settings);
  multiplayer.dispose();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Oyun işlemi tamamlanamadı:', event.reason);
});
