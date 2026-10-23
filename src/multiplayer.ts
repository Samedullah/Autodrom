import type { Socket } from 'socket.io-client';

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
        const timeout = window.setTimeout(() => reject(new Error('Sunucu bağlantısı zaman aşımına uğradı.')), 7000);
        socket.once('connect', () => { window.clearTimeout(timeout); resolve(); });
        socket.once('connect_error', () => { window.clearTimeout(timeout); reject(new Error('Multiplayer sunucusuna ulaşılamıyor.')); });
      }).catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : 'Bağlantı kurulamadı.', false);
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
      const socket = io({ autoConnect: false, reconnection: false });
      this.socket = socket;
      this.bindSocket(socket);
      return socket;
    });
    return this.socketPromise;
  }

  private bindSocket(socket: Socket): void {
    socket.on('connect', () => this.setStatus('Sunucuya bağlandı, oda bekleniyor.', false));
    socket.on('connect_error', () => this.setStatus('Multiplayer sunucusuna ulaşılamıyor.', false));
    socket.on('disconnect', () => {
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
