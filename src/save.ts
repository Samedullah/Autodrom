import { ECONOMY, MAP_LABELS, type MapId, VEHICLES } from './data';

const SAVE_KEY = 'autodrom.save.v1';
const SETTINGS_KEY = 'autodrom.settings.v1';
const vehicleIds = new Set(VEHICLES.map((vehicle) => vehicle.id));
const vehicleIdAliases: Record<string, string> = { 'rally-gt': 'm3-e36' };

function normalizeVehicleId(id: string): string {
  return vehicleIdAliases[id] ?? id;
}

export interface SaveData {
  version: 1;
  cash: number;
  ownedVehicles: string[];
  activeVehicleId: string | null;
  starterChosen: boolean;
  map: MapId;
}

export interface GameSettings {
  quality: 'low' | 'medium' | 'high' | 'ultra';
  shadows: boolean;
  effects: boolean;
  cameraFollow: number;
  fpsLimit: 30 | 60 | 0;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high', shadows: true, effects: true, cameraFollow: 0.12, fpsLimit: 60,
};

export function createDefaultSave(): SaveData {
  return { version: 1, cash: ECONOMY.startingCash, ownedVehicles: [], activeVehicleId: null, starterChosen: false, map: 'city-highway' };
}

function readObject(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData {
  const raw = readObject(SAVE_KEY);
  if (!raw) return createDefaultSave();
  const owned = Array.isArray(raw.ownedVehicles)
    ? raw.ownedVehicles.filter((id): id is string => typeof id === 'string').map(normalizeVehicleId).filter((id) => vehicleIds.has(id))
    : [];
  const savedActive = typeof raw.activeVehicleId === 'string' ? normalizeVehicleId(raw.activeVehicleId) : null;
  const active = savedActive && vehicleIds.has(savedActive) ? savedActive : null;
  const cash = typeof raw.cash === 'number' && Number.isFinite(raw.cash) ? Math.max(0, Math.floor(raw.cash)) : ECONOMY.startingCash;
  // Older saves selected either environment; both now lead to the connected world.
  const map: MapId = 'city-highway';
  const starterChosen = raw.starterChosen === true && !!active && owned.includes(active);
  if (!starterChosen && active && owned.length > 0 && raw.starterChosen === true) {
    owned.splice(owned.indexOf(active), 1);
  }
  return { version: 1, cash, ownedVehicles: [...new Set(owned)], activeVehicleId: starterChosen ? active : null, starterChosen, map };
}

export function saveGame(save: SaveData): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage may be unavailable */ }
}

export function loadSettings(): GameSettings {
  const raw = readObject(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  const quality = raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'ultra' ? raw.quality : 'high';
  const fpsLimit = raw.fpsLimit === 30 || raw.fpsLimit === 0 ? raw.fpsLimit : 60;
  return {
    quality,
    shadows: typeof raw.shadows === 'boolean' ? raw.shadows : DEFAULT_SETTINGS.shadows,
    effects: typeof raw.effects === 'boolean' ? raw.effects : DEFAULT_SETTINGS.effects,
    cameraFollow: typeof raw.cameraFollow === 'number' ? Math.min(0.24, Math.max(0.04, raw.cameraFollow)) : DEFAULT_SETTINGS.cameraFollow,
    fpsLimit,
  };
}

export function saveSettings(settings: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage may be unavailable */ }
}

export function isValidMap(value: string): value is MapId {
  return value in MAP_LABELS;
}
