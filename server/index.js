import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store: IP -> [{ peerId, deviceName, timestamp }]
const peersStore = new Map();

// Helper to clean up old peers (inactive for > 1 minute)
const cleanupPeers = (ip) => {
    const peers = peersStore.get(ip) || [];
    const now = Date.now();
    const activePeers = peers.filter(p => now - p.timestamp < 60000);
    if (activePeers.length > 0) {
        peersStore.set(ip, activePeers);
    } else {
        peersStore.delete(ip);
    }
};

app.post('/register', (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Fix for local testing (IPv6 localhost)
    if (ip === '::1') ip = '127.0.0.1';
    if (ip && ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];

    const { peerId, deviceName } = req.body;
    
    if (!peerId || !deviceName) {
        return res.status(400).json({ error: 'Missing peerId or deviceName' });
    }

    cleanupPeers(ip);
    
    const peers = peersStore.get(ip) || [];
    // Remove existing entry for this peerId if any
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

app.get('/peers', (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip === '::1') ip = '127.0.0.1';
    if (ip && ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];

    cleanupPeers(ip);
    
    const peers = peersStore.get(ip) || [];
    res.json({ peers });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Discovery Server running on http://0.0.0.0:${PORT}`);
});

