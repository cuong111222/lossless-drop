import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExpressPeerServer } from 'peer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Mount PeerJS server on /peerjs
const peerServer = ExpressPeerServer(server, {
  debug: false,
  path: '/',
  allow_discovery: true,
  generateClientId: () => 'dev_' + Math.random().toString(36).substring(2, 9)
});

app.use('/peerjs', peerServer);

// In-memory stores
// IP -> [{ peerId, deviceName, timestamp }]
const peersStore = new Map();
// PIN (6 digits) -> { peerId, deviceName, createdAt }
const roomStore = new Map();

// Helper to extract real client IP (including Cloudflare)
const getClientIp = (req) => {
  let ip = req.headers['cf-connecting-ip'] || 
           req.headers['x-forwarded-for'] || 
           req.socket.remoteAddress || 
           '';
  
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip === '::1') ip = '127.0.0.1';
  if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
  
  // Local network testing normalization
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '127.0.0.1') {
    return 'LOCAL_NETWORK';
  }
  return ip || 'UNKNOWN';
};

// Clean up old peers (inactive for > 15s)
const cleanupPeers = (ip) => {
  const peers = peersStore.get(ip) || [];
  const now = Date.now();
  const activePeers = peers.filter(p => now - p.timestamp < 15000);
  if (activePeers.length > 0) {
    peersStore.set(ip, activePeers);
  } else {
    peersStore.delete(ip);
  }
};

// Clean up expired rooms (> 15 minutes)
const cleanupRooms = () => {
  const now = Date.now();
  for (const [pin, data] of roomStore.entries()) {
    if (now - data.createdAt > 15 * 60 * 1000) {
      roomStore.delete(pin);
    }
  }
};

// Register peer on local Wi-Fi / IP
app.post('/register', (req, res) => {
  const ip = getClientIp(req);
  const { peerId, deviceName } = req.body;

  if (!peerId || !deviceName) {
    return res.status(400).json({ error: 'Missing peerId or deviceName' });
  }

  cleanupPeers(ip);

  const peers = peersStore.get(ip) || [];
  const existingIndex = peers.findIndex(p => p.peerId === peerId);
  if (existingIndex > -1) {
    peers[existingIndex].timestamp = Date.now();
    peers[existingIndex].deviceName = deviceName;
  } else {
    peers.push({ peerId, deviceName, timestamp: Date.now() });
  }

  peersStore.set(ip, peers);
  res.json({ success: true, ip });
});

// Get peers on same IP
app.get('/peers', (req, res) => {
  const ip = getClientIp(req);
  cleanupPeers(ip);

  const peers = peersStore.get(ip) || [];
  res.json({ peers, ip });
});

// Room PIN pairing (across different networks / 4G / AP isolation)
app.post('/room/create', (req, res) => {
  cleanupRooms();
  const { peerId, deviceName, pin } = req.body;
  if (!peerId || !pin) {
    return res.status(400).json({ error: 'Missing peerId or pin' });
  }

  roomStore.set(pin, {
    peerId,
    deviceName,
    createdAt: Date.now()
  });

  res.json({ success: true, pin });
});

app.get('/room/join/:pin', (req, res) => {
  cleanupRooms();
  const { pin } = req.params;
  const room = roomStore.get(pin);

  if (!room) {
    return res.status(404).json({ error: 'Mã PIN không tồn tại hoặc đã hết hạn.' });
  }

  res.json({ success: true, peer: room });
});

// Serve frontend dist if exists
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

app.use((req, res, next) => {
  if (req.path.startsWith('/peerjs') || req.path.startsWith('/peers') || req.path.startsWith('/register') || req.path.startsWith('/room')) {
    return next();
  }
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('API Server is running. Client build not found in ../client/dist.');
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirDrop Web Server running on port ${PORT}`);
  console.log(`PeerJS endpoint available at /peerjs`);
});
