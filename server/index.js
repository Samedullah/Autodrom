import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Server } from 'socket.io';

const port = Number(process.env.PORT || 3001);
const root = resolve(process.cwd(), 'dist');
const manifestPath = resolve(process.cwd(), 'public/assets/models/manifest.json');
const modelIds = new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).models);
const maxPlayers = 8;
const rooms = new Map();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const httpServer = createServer((request, response) => {
  if (request.url?.startsWith('/socket.io/')) return;
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const requested = resolve(root, '.' + pathname);
  const safePath = requested === root || requested.startsWith(root + sep);
  const file = safePath && existsSync(requested) && statSync(requested).isFile() ? requested : resolve(root, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Build the game first with npm run build.');
    return;
  }
  response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});

const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 16_384 });

function cleanName(value) {
  return typeof value === 'string' ? value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Sürücü' : 'Sürücü';
}

function cleanVehicle(value) {
  return typeof value === 'string' && modelIds.has(value) ? value : modelIds.values().next().value;
}

function createCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function playerFor(socket, payload = {}) {
  return {
    id: socket.id,
    name: cleanName(payload.name),
    vehicleId: cleanVehicle(payload.vehicleId),
    x: 0,
    z: 0,
    yaw: 0,
    steeringAngle: 0,
    speedKmh: 0,
    drifting: false,
    burnout: false,
    rearWheelSpinRate: 0,
  };
}

function removeFromRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.leave(code);
  const room = rooms.get(code);
  socket.data.roomCode = '';
  if (!room) return;
  room.players.delete(socket.id);
  socket.to(code).emit('room:player-left', socket.id);
  if (room.players.size === 0) rooms.delete(code);
}

function joinSocket(socket, room, code, player, ack) {
  if (room.players.size >= maxPlayers) {
    ack({ ok: false, error: 'Oda dolu (en fazla 8 oyuncu).' });
    return;
  }
  socket.join(code);
  socket.data.roomCode = code;
  room.players.set(socket.id, player);
  ack({ ok: true, code, playerId: socket.id, players: [...room.players.values()] });
  socket.to(code).emit('room:player-joined', player);
}

io.on('connection', (socket) => {
  socket.data.roomCode = '';
  socket.on('room:create', (payload = {}, ack = () => undefined) => {
    removeFromRoom(socket);
    const code = createCode();
    const room = { players: new Map() };
    rooms.set(code, room);
    joinSocket(socket, room, code, playerFor(socket, payload), ack);
  });
  socket.on('room:join', (payload = {}, ack = () => undefined) => {
    removeFromRoom(socket);
    const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      ack({ ok: false, error: 'Oda kodu 6 karakter olmalı.' });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      ack({ ok: false, error: 'Bu kodla açık oda bulunamadı.' });
      return;
    }
    joinSocket(socket, room, code, playerFor(socket, payload), ack);
  });
  socket.on('player:state', (payload = {}) => {
    const code = socket.data.roomCode;
    const player = rooms.get(code)?.players.get(socket.id);
    if (!player) return;
    const finite = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
    if (!finite(payload.x, 20_000) || !finite(payload.z, 20_000) || !finite(payload.yaw, 100) || !finite(payload.steeringAngle, 1.5) || !finite(payload.speedKmh, 1_000)) return;
    player.x = payload.x;
    player.z = payload.z;
    player.yaw = payload.yaw;
    player.steeringAngle = payload.steeringAngle;
    player.speedKmh = payload.speedKmh;
    player.drifting = payload.drifting === true;
    player.burnout = payload.burnout === true;
    player.rearWheelSpinRate = finite(payload.rearWheelSpinRate, 36) ? payload.rearWheelSpinRate : 0;
    player.vehicleId = cleanVehicle(payload.vehicleId);
    socket.to(code).volatile.emit('room:player-state', player);
  });
  socket.on('room:leave', () => removeFromRoom(socket));
  socket.on('disconnect', () => removeFromRoom(socket));
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Autodrom multiplayer server listening on http://0.0.0.0:${port}`);
});
