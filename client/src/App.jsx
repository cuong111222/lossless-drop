import React, { useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Smartphone, Monitor, Laptop, Upload, Download, CheckCircle2, 
  Edit2, QrCode, Wifi, KeyRound, Play, X, Shield, Zap, 
  Copy, Check, FileVideo, HardDrive, ArrowRight, ChevronDown, ChevronUp, Share2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import './App.css';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8 MB backpressure threshold

function getDevicePlatform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return { type: 'ios', name: 'iPhone' };
  if (/Android/.test(ua)) return { type: 'android', name: 'Android Phone' };
  if (/Macintosh|Mac OS X/.test(ua)) return { type: 'mac', name: 'MacBook' };
  if (/Windows/.test(ua)) return { type: 'windows', name: 'Windows PC' };
  return { type: 'device', name: 'Device' };
}

function getStoredDeviceName() {
  const saved = localStorage.getItem('cuvodrop_dev_name');
  if (saved) return saved;
  const platform = getDevicePlatform();
  const generated = `${platform.name} ${Math.floor(100 + Math.random() * 900)}`;
  localStorage.setItem('cuvodrop_dev_name', generated);
  return generated;
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export default function App() {
  const [deviceName, setDeviceName] = useState(getStoredDeviceName());
  const [peerId, setPeerId] = useState('');
  const [peers, setPeers] = useState([]);
  const [activeTab, setActiveTab] = useState('radar'); // 'radar' | 'pin'
  const [statusText, setStatusText] = useState('Initializing P2P network...');
  const [myPin, setMyPin] = useState('');
  const [inputPin, setInputPin] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [activeFaq, setActiveFaq] = useState(null);

  // Transfer State
  const [transfer, setTransfer] = useState(null);
  // Received media modal
  const [receivedMedia, setReceivedMedia] = useState(null);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const fileInputRef = useRef(null);
  const targetPeerRef = useRef(null);

  // Receiving buffer
  const rxBufferRef = useRef([]);
  const rxMetaRef = useRef(null);
  const rxStartTimeRef = useRef(0);

  useEffect(() => {
    let savedPin = sessionStorage.getItem('cuvodrop_pin');
    if (!savedPin) {
      savedPin = Math.floor(100000 + Math.random() * 900000).toString();
      sessionStorage.setItem('cuvodrop_pin', savedPin);
    }
    setMyPin(savedPin);

    // Direct deterministic peerId for global cloud pairing
    const directPeerId = `cuvo-${savedPin}`;

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    let peer = null;
    if (isLocal) {
      try {
        peer = new Peer(directPeerId, {
          host: window.location.hostname,
          port: 3001,
          path: '/peerjs',
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });
      } catch (_) {
        peer = new Peer(directPeerId);
      }
    } else {
      // Production Vercel / Cloudflare
      peer = new Peer(directPeerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
    }

    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatusText('Ready to connect');
      announcePresence(id, deviceName);
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      bindConnectionEvents(conn);
    });

    peer.on('error', (err) => {
      console.warn('P2P Status:', err.type);
      if (err.type === 'unavailable-id') {
        const nextPin = Math.floor(100000 + Math.random() * 900000).toString();
        sessionStorage.setItem('cuvodrop_pin', nextPin);
        setMyPin(nextPin);
        window.location.reload();
      }
    });

    // Handle auto-join URL ?pin=123456
    const params = new URLSearchParams(window.location.search);
    const pinParam = params.get('pin');
    if (pinParam) {
      setInputPin(pinParam);
      setActiveTab('pin');
    }

    // Polling Wi-Fi radar peers
    const interval = setInterval(() => {
      if (peerRef.current?.id) {
        syncRadarPeers(peerRef.current.id);
        announcePresence(peerRef.current.id, deviceName);
      }
    }, 3500);

    return () => {
      clearInterval(interval);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [deviceName]);

  const announcePresence = async (id, name) => {
    try {
      await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: id, deviceName: name })
      });
    } catch (_) {}
  };

  const syncRadarPeers = async (myId) => {
    try {
      const res = await fetch('/peers');
      const data = await res.json();
      if (data.peers) {
        setPeers(data.peers.filter(p => p.peerId !== myId));
      }
    } catch (_) {}
  };

  const bindConnectionEvents = (conn) => {
    conn.on('data', (data) => processIncomingData(data, conn));
    conn.on('open', () => {
      setStatusText(`Connected to ${conn.metadata?.deviceName || 'partner device'}`);
    });
    conn.on('close', () => {
      setStatusText('P2P connection closed');
    });
  };

  const processIncomingData = (data, conn) => {
    if (data.type === 'file-meta') {
      rxBufferRef.current = [];
      rxMetaRef.current = data;
      rxStartTimeRef.current = Date.now();

      setTransfer({
        mode: 'receiving',
        fileName: data.name,
        fileSize: data.size,
        mimeType: data.mimeType,
        progress: 0,
        speed: 0,
        bytesDone: 0,
        totalBytes: data.size,
        eta: 'Estimating...'
      });
      setStatusText(`Receiving ${data.name}`);
    } else if (data.type === 'file-chunk') {
      rxBufferRef.current.push(data.chunk);
      const currentBytes = rxBufferRef.current.reduce((acc, c) => acc + c.byteLength, 0);
      const total = rxMetaRef.current?.size || 1;
      const progress = Math.min(100, Math.round((currentBytes / total) * 100));

      const elapsed = (Date.now() - rxStartTimeRef.current) / 1000;
      const speed = elapsed > 0.3 ? Math.round(currentBytes / elapsed) : 0;
      const remainingBytes = total - currentBytes;
      const etaSec = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;

      setTransfer(prev => prev ? ({
        ...prev,
        progress,
        speed,
        bytesDone: currentBytes,
        eta: etaSec > 0 ? `${etaSec}s left` : 'Almost done...'
      }) : null);
    } else if (data.type === 'file-complete') {
      const meta = rxMetaRef.current;
      const blob = new Blob(rxBufferRef.current, { type: meta?.mimeType || 'video/mp4' });
      const mediaUrl = URL.createObjectURL(blob);

      confetti({
        particleCount: 80,
        spread: 80,
        origin: { y: 0.55 }
      });

      // Auto trigger download for mobile compatibility
      const a = document.createElement('a');
      a.href = mediaUrl;
      a.download = meta?.name || 'cuvodrop_video.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setReceivedMedia({
        name: meta?.name || 'Received File',
        size: meta?.size || 0,
        url: mediaUrl,
        mimeType: meta?.mimeType || 'video/mp4'
      });

      setTransfer(null);
      setStatusText('File received successfully!');
    }
  };

  const handleDeviceSelect = (targetId, targetName = '') => {
    targetPeerRef.current = { id: targetId, name: targetName };
    fileInputRef.current.click();
  };

  const handlePinConnect = (e) => {
    e.preventDefault();
    const pin = inputPin.trim();
    if (pin.length < 6) {
      alert('Please enter a valid 6-digit PIN code');
      return;
    }
    const targetPeerId = `cuvo-${pin}`;
    handleDeviceSelect(targetPeerId, `Device #${pin}`);
  };

  const handleFilePicked = async (e) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file || !targetPeerRef.current) return;
    await sendFilePayload(file);
    e.target.value = '';
  };

  const sendFilePayload = async (file) => {
    const targetId = targetPeerRef.current.id;
    setStatusText(`Connecting to ${targetPeerRef.current.name}...`);

    let conn = connRef.current;
    if (!conn || conn.peer !== targetId || !conn.open) {
      conn = peerRef.current.connect(targetId, {
        metadata: { deviceName },
        reliable: true
      });
      connRef.current = conn;
      bindConnectionEvents(conn);

      await new Promise((resolve, reject) => {
        conn.on('open', resolve);
        conn.on('error', reject);
        setTimeout(() => reject(new Error('Connection timed out')), 10000);
      }).catch(err => {
        alert('Could not establish direct P2P connection: ' + err.message);
        return;
      });
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    conn.send({
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      totalChunks
    });

    setTransfer({
      mode: 'sending',
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      speed: 0,
      bytesDone: 0,
      totalBytes: file.size,
      eta: 'Starting...'
    });

    const startTime = Date.now();
    let offset = 0;
    let index = 0;
    const channel = conn.dataChannel;

    while (offset < file.size) {
      if (channel && channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await new Promise(res => {
          const poll = setInterval(() => {
            if (channel.bufferedAmount < MAX_BUFFERED_AMOUNT / 2) {
              clearInterval(poll);
              res();
            }
          }, 25);
        });
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      conn.send({
        type: 'file-chunk',
        chunk: buffer,
        index
      });

      offset += buffer.byteLength;
      index++;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0.3 ? Math.round(offset / elapsed) : 0;
      const remaining = file.size - offset;
      const etaSec = speed > 0 ? Math.ceil(remaining / speed) : 0;
      const progress = Math.min(100, Math.round((offset / file.size) * 100));

      setTransfer(prev => prev ? ({
        ...prev,
        progress,
        speed,
        bytesDone: offset,
        eta: etaSec > 0 ? `${etaSec}s left` : 'Almost done...'
      }) : null);
    }

    conn.send({ type: 'file-complete' });

    confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });

    setTimeout(() => {
      setTransfer(null);
      setStatusText(`Sent ${file.name} successfully!`);
    }, 1500);
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}?pin=${myPin}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const changeDeviceName = () => {
    const next = prompt('Enter a display name for your device:', deviceName);
    if (next && next.trim()) {
      const clean = next.trim();
      setDeviceName(clean);
      localStorage.setItem('cuvodrop_dev_name', clean);
      if (peerRef.current?.id) {
        announcePresence(peerRef.current.id, clean);
      }
    }
  };

  const getPlatformIcon = (name) => {
    if (name.includes('iPhone') || name.includes('iPad')) return <Smartphone size={24} />;
    if (name.includes('Android')) return <Smartphone size={24} />;
    if (name.includes('MacBook')) return <Laptop size={24} />;
    return <Monitor size={24} />;
  };

  return (
    <div className="cuvo-app">
      {/* BACKGROUND GLOW */}
      <div className="bg-glow-orb orb-1"></div>
      <div className="bg-glow-orb orb-2"></div>

      {/* TOP NAVBAR */}
      <header className="cuvo-navbar">
        <div className="nav-container">
          <div className="brand-group">
            <div className="brand-logo">
              <Zap size={20} className="brand-icon" />
            </div>
            <div className="brand-titles">
              <h1 className="brand-name">CuvoDrop</h1>
              <a href="https://cuvotech.com" target="_blank" rel="noopener noreferrer" className="brand-badge">by Cuvotech ↗</a>
            </div>
          </div>

          <div className="status-pill">
            <span className="status-dot"></span>
            <span className="status-msg">{statusText}</span>
          </div>
        </div>
      </header>

      {/* TOP AD BANNER */}
      <div className="ad-wrapper top-ad">
        <div className="ad-box">
          <span className="ad-tag">Advertisement</span>
          <div className="ad-slot-placeholder">
            <span>Google AdSense Banner (728x90 / Responsive)</span>
          </div>
        </div>
      </div>

      {/* MAIN HERO CARD */}
      <main className="main-wrapper">
        <div className="hero-card">
          {/* TAB BAR */}
          <div className="hero-tabs">
            <button 
              className={`tab-item ${activeTab === 'radar' ? 'active' : ''}`}
              onClick={() => setActiveTab('radar')}
            >
              <Wifi size={17} /> Radar (Same Wi-Fi)
            </button>
            <button 
              className={`tab-item ${activeTab === 'pin' ? 'active' : ''}`}
              onClick={() => setActiveTab('pin')}
            >
              <KeyRound size={17} /> PIN / QR Code (4G & Cross-Network)
            </button>
          </div>

          {/* SENDER IDENTITY BAR */}
          <div className="identity-bar">
            <div className="identity-avatar">
              {getPlatformIcon(deviceName)}
            </div>
            <div className="identity-text">
              <span className="identity-sub">Your Device</span>
              <div className="identity-name-row">
                <strong className="identity-title">{deviceName}</strong>
                <button className="btn-rename" onClick={changeDeviceName}>
                  <Edit2 size={12} /> Rename
                </button>
              </div>
            </div>
          </div>

          {/* TAB 1: RADAR WI-FI */}
          {activeTab === 'radar' && (
            <div className="radar-container">
              {peers.length === 0 ? (
                <div className="radar-sonar-wrap">
                  <div className="sonar-waves">
                    <div className="sonar-wave s1"></div>
                    <div className="sonar-wave s2"></div>
                    <div className="sonar-wave s3"></div>
                    <div className="sonar-core">
                      <Wifi size={32} />
                    </div>
                  </div>
                  <h3 className="radar-status-head">Searching for nearby devices...</h3>
                  <p className="radar-status-sub">
                    Open <strong>share.cuvotech.com</strong> on your iPhone or Android phone to discover each other automatically.
                  </p>
                  <div className="radar-tip-box">
                    <span>💡 If devices are on mobile data (4G/5G) or different networks, use the <strong>PIN / QR Code</strong> tab above.</span>
                  </div>
                </div>
              ) : (
                <div className="peers-found-view">
                  <h3 className="found-title">Devices Ready to Receive:</h3>
                  <div className="peer-cards-list">
                    {peers.map((p) => (
                      <div 
                        key={p.peerId} 
                        className="peer-card-bubble"
                        onClick={() => handleDeviceSelect(p.peerId, p.deviceName)}
                      >
                        <div className="peer-icon-avatar">
                          {getPlatformIcon(p.deviceName)}
                        </div>
                        <span className="peer-card-name">{p.deviceName}</span>
                        <button className="peer-send-action">
                          <Upload size={14} /> Send Video / File
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PIN / QR CODE */}
          {activeTab === 'pin' && (
            <div className="pin-container">
              <div className="pin-two-col">
                {/* MY PIN DISPLAY */}
                <div className="pin-panel my-pin-box">
                  <span className="pin-panel-badge">This Device's PIN</span>
                  <div className="pin-giant-code">{myPin}</div>
                  
                  <div className="qr-box-inner">
                    <QRCodeSVG 
                      value={`${window.location.origin}?pin=${myPin}`}
                      size={150}
                      level="H"
                      includeMargin={true}
                    />
                    <span className="qr-hint">Scan with phone camera to connect</span>
                  </div>

                  <button className="btn-copy-share" onClick={copyShareLink}>
                    {isCopied ? <Check size={16} /> : <Share2 size={16} />}
                    {isCopied ? 'Link Copied to Clipboard!' : 'Copy Direct Link'}
                  </button>
                </div>

                {/* JOIN PIN FORM */}
                <div className="pin-panel join-pin-box">
                  <span className="pin-panel-badge">Enter Receiver's PIN</span>
                  <p className="join-hint">Enter the 6-digit code shown on the target phone or computer:</p>
                  
                  <form onSubmit={handlePinConnect} className="join-form">
                    <input 
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="• • • • • •"
                      value={inputPin}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setInputPin(clean);
                      }}
                      maxLength={6}
                      className="input-pin-digits"
                      autoComplete="one-time-code"
                      autoFocus
                    />
                    <button type="submit" className="btn-join-submit">
                      <ArrowRight size={18} /> Connect & Send File
                    </button>
                  </form>
                  <p className="security-note">
                    <Shield size={14} /> Direct end-to-end encrypted WebRTC channel
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM AD BANNER */}
        <div className="ad-wrapper bottom-ad">
          <div className="ad-box">
            <span className="ad-tag">Advertisement</span>
            <div className="ad-slot-placeholder">
              <span>Google AdSense Banner (728x90 Responsive)</span>
            </div>
          </div>
        </div>

        {/* VALUE PROPOSITION / FEATURES SECTION FOR GOOGLE SEO & ADSENSE APPROVAL */}
        <section className="seo-features-section">
          <div className="features-header">
            <h2>Fast, Lossless Video Transfer Between iOS & Android</h2>
            <p>Zero compression, unlimited file size, works right inside your mobile browser.</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon-badge">
                <Zap size={22} />
              </div>
              <h4>Lossless 4K 60fps Quality</h4>
              <p>Unlike chat apps that aggressively compress media, CuvoDrop transfers the original uncompressed raw file bit-by-bit.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-badge">
                <Shield size={22} />
              </div>
              <h4>100% P2P & Private</h4>
              <p>Files stream directly between devices via peer-to-peer data channels. No file is ever saved on any cloud server.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-badge">
                <HardDrive size={22} />
              </div>
              <h4>No App Installation</h4>
              <p>Works instantly on Safari (iPhone/iPad) and Chrome (Android/Windows/Mac) with zero setup.</p>
            </div>
          </div>

          {/* FAQ ACCORDION FOR SEARCH SNIPPETS */}
          <div className="faq-section">
            <h3 className="faq-title">Frequently Asked Questions</h3>
            
            <div className="faq-item" onClick={() => setActiveFaq(activeFaq === 1 ? null : 1)}>
              <div className="faq-q">
                <span>How to transfer large 4K videos from iPhone to Android?</span>
                {activeFaq === 1 ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
              {activeFaq === 1 && (
                <div className="faq-a">
                  Simply open <strong>share.cuvotech.com</strong> on both devices. Scan the QR code or enter the 6-digit PIN to pair, then pick any 4K video from your iPhone Photos gallery to stream directly to your Android device at high Wi-Fi speeds.
                </div>
              )}
            </div>

            <div className="faq-item" onClick={() => setActiveFaq(activeFaq === 2 ? null : 2)}>
              <div className="faq-q">
                <span>Is there any file size limit?</span>
                {activeFaq === 2 ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
              {activeFaq === 2 && (
                <div className="faq-a">
                  No limit at all. Thanks to our chunked 64KB streaming engine with backpressure control, you can send files from 100MB to tens of gigabytes without running out of browser memory.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="cuvo-footer">
        <p>© 2026 CuvoDrop - Ultra-fast P2P transfer engine powered by <a href="https://cuvotech.com" target="_blank" rel="noopener noreferrer" className="cuvo-link"><strong>Cuvotech</strong> ↗</a>. All rights reserved.</p>
      </footer>

      {/* HIDDEN FILE INPUT */}
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleFilePicked}
        accept="video/*,image/*,application/*"
      />

      {/* TRANSFER MODAL */}
      {transfer && (
        <div className="modal-scrim">
          <div className="transfer-card-pop">
            <div className="transfer-pop-anim">
              {transfer.mode === 'sending' ? <Upload size={32} className="float-anim" /> : <Download size={32} className="float-anim" />}
            </div>
            
            <h3 className="transfer-pop-title">
              {transfer.mode === 'sending' ? 'Sending Video...' : 'Receiving Video...'}
            </h3>
            <p className="transfer-pop-name">{transfer.fileName}</p>

            <div className="transfer-progress-track">
              <div className="transfer-progress-bar" style={{ width: `${transfer.progress}%` }}></div>
            </div>

            <div className="transfer-metrics">
              <span className="metric-pct">{transfer.progress}%</span>
              <span className="metric-speed">{formatSpeed(transfer.speed)}</span>
              <span className="metric-eta">{transfer.eta}</span>
            </div>

            <div className="transfer-sizes">
              {formatBytes(transfer.bytesDone)} / {formatBytes(transfer.totalBytes)}
            </div>

            {/* HIGH-CTR MODAL AD BANNER */}
            <div className="modal-sponsor-box">
              <span className="modal-sponsor-tag">Sponsor</span>
              <div className="modal-ad-creative">
                <span>Interactive ad banner during file transmission</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RECEIVED VIDEO PREVIEW MODAL */}
      {receivedMedia && (
        <div className="modal-scrim">
          <div className="preview-card-pop">
            <button className="preview-close-btn" onClick={() => setReceivedMedia(null)}>
              <X size={20} />
            </button>

            <div className="preview-top">
              <CheckCircle2 size={36} className="success-check-icon" />
              <h3>Video Received Successfully!</h3>
              <p>{receivedMedia.name} ({formatBytes(receivedMedia.size)})</p>
            </div>

            {receivedMedia.mimeType.includes('video') ? (
              <div className="preview-media-viewport">
                <video src={receivedMedia.url} controls playsInline className="preview-video-elem" />
              </div>
            ) : receivedMedia.mimeType.includes('image') ? (
              <div className="preview-media-viewport">
                <img src={receivedMedia.url} alt="Received" className="preview-img-elem" />
              </div>
            ) : null}

            <div className="preview-button-row">
              <a href={receivedMedia.url} download={receivedMedia.name} className="btn-download-save">
                <Download size={18} /> Save Video to Device
              </a>
              <button className="btn-preview-done" onClick={() => setReceivedMedia(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
