import type { Socket } from 'socket.io-client';

const CONNECT_TIMEOUT_MS = 30_000;

export interface MultiplayerPlayer {
  id: string;
  name: string;
  vehicleId: string;
  x: number;
  z: number;
  yaw: number;
  steeringAngle: number;
  speedKmh: number;
  drifting: boolean;
  burnout: boolean;
  rearWheelSpinRate: number;
}

export interface LocalPlayerState {
  vehicleId: string;
  x: number;
  z: number;
  yaw: number;
  steeringAngle: number;
  speedKmh: number;
  drifting: boolean;
  burnout: boolean;
  rearWheelSpinRate: number;
}

interface RoomResponse {
  ok: boolean;
  code?: string;
  playerId?: string;
  players?: MultiplayerPlayer[];
  error?: string;
}

export class MultiplayerClient {
  private socket: Socket | null = null;
  private socketPromise: Promise<Socket> | null = null;
  private readonly players = new Map<string, MultiplayerPlayer>();
  private room = '';
  private playerId = '';
  private onStatus: (message: string, connected: boolean) => void = () => undefined;
  private onPlayers: (players: MultiplayerPlayer[]) => void = () => undefined;
  private lastStatus = 'Oda kur veya arkadaşının koduyla katıl.';
  private connectedStatus = false;

  get roomCode(): string { return this.room; }
  get isInRoom(): boolean { return !!this.socket?.connected && this.room.length > 0; }
  get localPlayerId(): string { return this.playerId; }
  get playerCount(): number { return this.isInRoom ? this.players.size + 1 : 1; }
  get statusMessage(): string { return this.lastStatus; }
  get isConnected(): boolean { return this.connectedStatus; }

  setListeners(onStatus: (message: string, connected: boolean) => void, onPlayers: (players: MultiplayerPlayer[]) => void): void {
    this.onStatus = onStatus;
    this.onPlayers = onPlayers;
    this.onStatus(this.lastStatus, this.connectedStatus);
  }

  async createRoom(name: string, vehicleId: string): Promise<boolean> {
    return this.joinRequest('room:create', { name, vehicleId });
  }

  async joinRoom(code: string, name: string, vehicleId: string): Promise<boolean> {
    return this.joinRequest('room:join', { code: code.trim().toUpperCase(), name, vehicleId });
  }

  leaveRoom(): void {
    const socket = this.socket;
    if (socket?.connected) socket.emit('room:leave');
    socket?.disconnect();
    this.room = '';
    this.playerId = '';
    this.players.clear();
    this.publishPlayers();
    this.setStatus('Odadan ayrıldın.', false);
  }

  sendState(state: LocalPlayerState): void {
    if (this.isInRoom) this.socket?.volatile.emit('player:state', state);
  }

  dispose(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  private async joinRequest(event: 'room:create' | 'room:join', payload: Record<string, string>): Promise<boolean> {
    let socket: Socket;
    try {
      socket = await this.getSocket();
    } catch {
      this.setStatus('Multiplayer istemcisi yüklenemedi.', false);
      return false;
    }
    if (!socket.connected) {
      socket.connect();
      await new Promise<void>((resolve, reject) => {
        const onConnect = (): void => {
          window.clearTimeout(timeout);
          socket.off('connect_error', onConnectError);
          resolve();
        };
        const onConnectError = (error: Error): void => {
          window.clearTimeout(timeout);
          socket.off('connect', onConnect);
          reject(error);
        };
        const timeout = window.setTimeout(() => {
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
          reject(new Error('Sunucu bağlantısı 30 saniyede kurulamadı.'));
        }, CONNECT_TIMEOUT_MS);
        socket.once('connect', onConnect);
        socket.once('connect_error', onConnectError);
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Bağlantı kurulamadı.';
        this.setStatus(message, false);
      });
    }
    if (!socket.connected) return false;

    this.setStatus('Odaya bağlanıyor…', false);
    return new Promise((resolve) => {
      socket.timeout(5000).emit(event, payload, (timeoutError: Error | null, response: RoomResponse) => {
        if (timeoutError || !response?.ok || !response.code || !response.playerId) {
          this.setStatus(response?.error ?? 'Odaya katılınamadı.', false);
          resolve(false);
          return;
        }
        this.room = response.code;
        this.playerId = response.playerId;
        this.players.clear();
        for (const player of response.players ?? []) {
          if (player.id !== this.playerId) this.players.set(player.id, player);
        }
        this.publishPlayers();
        this.setStatus('Oda ' + this.room + ' hazır. Arkadaşlarına oda kodunu gönder.', true);
        resolve(true);
      });
    });
  }

  private async getSocket(): Promise<Socket> {
    if (this.socket) return this.socket;
    this.socketPromise ??= import('socket.io-client').then(({ io }) => {
      // Production static hosting (for example Cloudflare Workers) does not
      // start server/index.js. Point at a separately hosted Socket.IO server
      // when configured; local development and the bundled Node server remain
      // same-origin by default.
      const multiplayerUrl = import.meta.env.VITE_MULTIPLAYER_URL || undefined;
      const socket = io(multiplayerUrl, {
        autoConnect: false,
        reconnection: false,
        timeout: CONNECT_TIMEOUT_MS,
      });
      this.socket = socket;
      this.bindSocket(socket, multiplayerUrl);
      return socket;
    });
    return this.socketPromise;
  }

  private bindSocket(socket: Socket, multiplayerUrl?: string): void {
    const endpoint = multiplayerUrl || window.location.origin;
    socket.on('connect', () => {
      console.info('[Multiplayer] Connected', {
        endpoint,
        origin: window.location.origin,
        path: socket.io.opts.path,
        transport: socket.io.engine?.transport.name,
      });
      socket.io.engine?.on('upgrade', (transport) => {
        console.info('[Multiplayer] Transport upgraded', {
          endpoint,
          origin: window.location.origin,
          path: socket.io.opts.path,
          transport: transport.name,
        });
      });
      this.setStatus('Sunucuya bağlandı, oda bekleniyor.', false);
    });
    socket.on('connect_error', (error: Error) => {
      const details = error as Error & { description?: unknown; context?: unknown };
      console.error('[Multiplayer] connect_error', {
        endpoint,
        origin: window.location.origin,
        path: socket.io.opts.path,
        message: error.message,
        description: details.description,
        context: details.context,
      });
      this.setStatus('Multiplayer bağlantı hatası: ' + error.message, false);
    });
    socket.on('disconnect', () => {
      console.warn('[Multiplayer] Disconnected', {
        endpoint,
        origin: window.location.origin,
      });
      this.room = '';
      this.playerId = '';
      this.players.clear();
      this.onPlayers([]);
      this.setStatus('Bağlantı kesildi.', false);
    });
    socket.on('room:player-joined', (player: MultiplayerPlayer) => {
      this.players.set(player.id, player);
      this.publishPlayers();
    });
    socket.on('room:player-left', (id: string) => {
      this.players.delete(id);
      this.publishPlayers();
    });
    socket.on('room:player-state', (player: MultiplayerPlayer) => {
      if (player.id !== this.playerId) {
        this.players.set(player.id, player);
        this.publishPlayers();
      }
    });
    socket.on('room:error', (message: string) => this.setStatus(message, false));
  }

  private setStatus(message: string, connected: boolean): void {
    this.lastStatus = message;
    this.connectedStatus = connected;
    this.onStatus(message, connected);
  }

  private publishPlayers(): void {
    this.onPlayers([...this.players.values()]);
  }
}
