import React, { useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Smartphone, Monitor, Upload, Download, CheckCircle2, 
  Edit3, QrCode, Wifi, KeyRound, Play, X, RefreshCw, 
  ShieldCheck, Zap, AlertCircle, Copy, Check
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import './App.css';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8 MB backpressure threshold

function getDeviceName() {
  const saved = localStorage.getItem('dropbridge_deviceName');
  if (saved) return saved;
  const ua = navigator.userAgent;
  let base = 'Thiết bị';
  if (/iPad|iPhone|iPod/.test(ua)) base = 'iPhone';
  else if (/Android/.test(ua)) base = 'Android Phone';
  else if (/Macintosh|Mac OS X/.test(ua)) base = 'MacBook';
  else if (/Windows/.test(ua)) base = 'Windows PC';
  else if (/Linux/.test(ua)) base = 'Linux';
  
  const newName = `${base} ${Math.floor(100 + Math.random() * 900)}`;
  localStorage.setItem('dropbridge_deviceName', newName);
  return newName;
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
  const [peerId, setPeerId] = useState('');
  const [deviceName, setDeviceName] = useState(getDeviceName());
  const [peers, setPeers] = useState([]);
  const [activeTab, setActiveTab] = useState('wifi'); // 'wifi' | 'pin'
  const [status, setStatus] = useState('Khởi tạo kết nối P2P...');
  const [isPeerReady, setIsPeerReady] = useState(false);

  // Room PIN state
  const [myPin, setMyPin] = useState('');
  const [inputPin, setInputPin] = useState('');
  const [isCopiedPin, setIsCopiedPin] = useState(false);
  const [pinError, setPinError] = useState('');

  // Transfer State
  const [transferState, setTransferState] = useState(null); 
  // { mode: 'sending'|'receiving', fileName, fileSize, progress, speed, bytesDone, totalBytes, eta, url, mimeType, error }
  
  // Received media modal
  const [receivedFile, setReceivedFile] = useState(null);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const fileInputRef = useRef(null);
  const targetPeerRef = useRef(null);

  // Chunks buffer for receiving
  const rxBufferRef = useRef([]);
  const rxMetaRef = useRef(null);
  const rxStartTimeRef = useRef(0);
  const rxLastBytesRef = useRef(0);

  // Initialize PeerJS
  useEffect(() => {
    let savedId = localStorage.getItem('dropbridge_peerId');
    if (!savedId) {
      savedId = 'db_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('dropbridge_peerId', savedId);
    }

    const isSecure = window.location.protocol === 'https:';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Connect to embedded PeerServer or fallback to PeerJS cloud
    let peerInstance = null;
    try {
      peerInstance = new Peer(savedId, {
        host: isLocal ? window.location.hostname : window.location.hostname,
        port: isLocal ? 3001 : (isSecure ? 443 : 80),
        path: '/peerjs',
        secure: isSecure,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
    } catch (e) {
      peerInstance = new Peer(savedId);
    }

    peerRef.current = peerInstance;

    peerInstance.on('open', (id) => {
      setPeerId(id);
      setIsPeerReady(true);
      setStatus('Sẵn sàng kết nối');
      registerWithServer(id, deviceName);
      generatePin(id);
    });

    peerInstance.on('connection', (conn) => {
      connRef.current = conn;
      setupConnectionHandlers(conn);
    });

    peerInstance.on('error', (err) => {
      console.warn('Peer error, fallback to cloud:', err);
      if (err.type === 'server-error' || err.type === 'socket-error') {
        // Fallback to default PeerJS cloud
        try {
          const fallbackPeer = new Peer(savedId);
          peerRef.current = fallbackPeer;
          fallbackPeer.on('open', (id) => {
            setPeerId(id);
            setIsPeerReady(true);
            setStatus('Sẵn sàng (Cloud P2P)');
            registerWithServer(id, deviceName);
            generatePin(id);
          });
          fallbackPeer.on('connection', (conn) => {
            connRef.current = conn;
            setupConnectionHandlers(conn);
          });
        } catch (_) {}
      }
    });

    // Check URL parameters for Auto-Join via PIN
    const params = new URLSearchParams(window.location.search);
    const pinParam = params.get('pin');
    if (pinParam) {
      setInputPin(pinParam);
      setActiveTab('pin');
    }

    // Polling discovery peers on same Wi-Fi
    const interval = setInterval(() => {
      if (peerRef.current && peerRef.current.id) {
        fetchPeers(peerRef.current.id);
        registerWithServer(peerRef.current.id, deviceName);
      }
    }, 3500);

    return () => {
      clearInterval(interval);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [deviceName]);

  const registerWithServer = async (id, name) => {
    try {
      await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: id, deviceName: name })
      });
    } catch (_) {}
  };

  const fetchPeers = async (currentId) => {
    try {
      const res = await fetch('/peers');
      const data = await res.json();
      if (data.peers) {
        setPeers(data.peers.filter(p => p.peerId !== currentId));
      }
    } catch (_) {}
  };

  const generatePin = async (id) => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setMyPin(pin);
    try {
      await fetch('/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: id, deviceName, pin })
      });
    } catch (_) {}
  };

  const handleJoinPin = async (e) => {
    e.preventDefault();
    setPinError('');
    const targetPin = inputPin.trim();
    if (!targetPin || targetPin.length < 6) {
      setPinError('Vui lòng nhập đủ 6 chữ số mã PIN');
      return;
    }

    try {
      setStatus(`Đang tìm mã PIN ${targetPin}...`);
      const res = await fetch(`/room/join/${targetPin}`);
      const data = await res.json();
      if (!res.ok || !data.peer) {
        setPinError(data.error || 'Không tìm thấy thiết bị với mã PIN này');
        return;
      }

      handleDeviceClick(data.peer.peerId, data.peer.deviceName);
    } catch (err) {
      setPinError('Lỗi kết nối máy chủ');
    }
  };

  // Setup connection event handlers
  const setupConnectionHandlers = (conn) => {
    conn.on('data', (data) => {
      handleIncomingData(data, conn);
    });

    conn.on('open', () => {
      setStatus(`Đã liên kết với ${conn.metadata?.deviceName || 'thiết bị đối tác'}!`);
    });

    conn.on('close', () => {
      setStatus('Kết nối P2P đã đóng');
    });

    conn.on('error', (err) => {
      console.error('Conn error:', err);
    });
  };

  // Handle incoming chunked data packets
  const handleIncomingData = (data, conn) => {
    if (data.type === 'file-start') {
      rxBufferRef.current = [];
      rxMetaRef.current = data;
      rxStartTimeRef.current = Date.now();
      rxLastBytesRef.current = 0;

      setTransferState({
        mode: 'receiving',
        fileName: data.name,
        fileSize: data.size,
        mimeType: data.mimeType,
        progress: 0,
        speed: 0,
        bytesDone: 0,
        totalBytes: data.size,
        eta: 'Đang tính...'
      });
      setStatus(`Đang nhận: ${data.name}`);
    } else if (data.type === 'file-chunk') {
      rxBufferRef.current.push(data.chunk);
      const currentBytes = rxBufferRef.current.reduce((acc, c) => acc + c.byteLength, 0);
      const total = rxMetaRef.current?.size || 1;
      const progress = Math.min(100, Math.round((currentBytes / total) * 100));

      const elapsedSec = (Date.now() - rxStartTimeRef.current) / 1000;
      const speed = elapsedSec > 0.5 ? Math.round(currentBytes / elapsedSec) : 0;
      const remainingBytes = total - currentBytes;
      const etaSec = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;

      setTransferState(prev => prev ? ({
        ...prev,
        progress,
        speed,
        bytesDone: currentBytes,
        eta: etaSec > 0 ? `${etaSec}s` : 'Sắp xong'
      }) : null);
    } else if (data.type === 'file-end') {
      const meta = rxMetaRef.current;
      const blob = new Blob(rxBufferRef.current, { type: meta?.mimeType || 'application/octet-stream' });
      const fileUrl = URL.createObjectURL(blob);

      // Trigger Celebration
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });

      // Auto trigger download for mobile compatibility
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = meta?.name || 'video_received.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setReceivedFile({
        name: meta?.name || 'File đã nhận',
        size: meta?.size || 0,
        url: fileUrl,
        mimeType: meta?.mimeType || 'video/mp4'
      });

      setTransferState(null);
      setStatus('Nhận video thành công!');
    }
  };

  const handleDeviceClick = (targetId, targetName = '') => {
    targetPeerRef.current = { id: targetId, name: targetName };
    fileInputRef.current.click();
  };

  // High-performance chunked file sender with backpressure
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file || !targetPeerRef.current) return;

    const targetId = targetPeerRef.current.id;
    setStatus(`Đang kết nối tới ${targetPeerRef.current.name || 'thiết bị'}...`);

    let conn = connRef.current;
    if (!conn || conn.peer !== targetId || !conn.open) {
      conn = peerRef.current.connect(targetId, {
        metadata: { deviceName },
        reliable: true
      });
      connRef.current = conn;
      setupConnectionHandlers(conn);

      await new Promise((resolve, reject) => {
        conn.on('open', resolve);
        conn.on('error', reject);
        setTimeout(() => reject(new Error('Hết thời gian chờ kết nối')), 8000);
      }).catch(err => {
        alert('Không thể kết nối trực tiếp đến thiết bị: ' + err.message);
        return;
      });
    }

    // Start Sending in Chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    conn.send({
      type: 'file-start',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      totalChunks
    });

    setTransferState({
      mode: 'sending',
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      speed: 0,
      bytesDone: 0,
      totalBytes: file.size,
      eta: 'Đang chuẩn bị...'
    });

    const startTime = Date.now();
    let offset = 0;
    let chunkIndex = 0;

    const dataChannel = conn.dataChannel;

    while (offset < file.size) {
      // Backpressure Check: wait if buffer gets full
      if (dataChannel && dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await new Promise(res => {
          const checkInterval = setInterval(() => {
            if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT / 2) {
              clearInterval(checkInterval);
              res();
            }
          }, 30);
        });
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      conn.send({
        type: 'file-chunk',
        chunk: buffer,
        index: chunkIndex
      });

      offset += buffer.byteLength;
      chunkIndex++;

      const elapsedSec = (Date.now() - startTime) / 1000;
      const speed = elapsedSec > 0.3 ? Math.round(offset / elapsedSec) : 0;
      const remainingBytes = file.size - offset;
      const etaSec = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;
      const progress = Math.min(100, Math.round((offset / file.size) * 100));

      setTransferState(prev => prev ? ({
        ...prev,
        progress,
        speed,
        bytesDone: offset,
        eta: etaSec > 0 ? `${etaSec}s còn lại` : 'Sắp xong'
      }) : null);
    }

    // Finished
    conn.send({ type: 'file-end' });

    confetti({
      particleCount: 60,
      spread: 60,
      origin: { y: 0.7 }
    });

    setTimeout(() => {
      setTransferState(null);
      setStatus(`Đã gửi thành công ${file.name}!`);
    }, 1500);

    // Reset input
    e.target.value = '';
  };

  const handleEditName = () => {
    const newName = prompt('Nhập tên gợi nhớ cho thiết bị của bạn:', deviceName);
    if (newName && newName.trim() !== '') {
      const clean = newName.trim();
      setDeviceName(clean);
      localStorage.setItem('dropbridge_deviceName', clean);
      if (peerRef.current?.id) {
        registerWithServer(peerRef.current.id, clean);
      }
    }
  };

  const copyPinUrl = () => {
    const url = `${window.location.origin}?pin=${myPin}`;
    navigator.clipboard.writeText(url);
    setIsCopiedPin(true);
    setTimeout(() => setIsCopiedPin(false), 2000);
  };

  return (
    <div className="app-layout">
      {/* AD SLOT: TOP LEADERBOARD BANNER */}
      <div className="ad-container ad-top">
        <div className="ad-label">Sponsored Advertisement</div>
        <div className="ad-placeholder">
          <span>Google AdSense Banner (728x90 / 320x50 Responsive)</span>
        </div>
      </div>

      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="logo-badge">
            <Zap size={22} className="logo-icon" />
            <span className="logo-text">DropBridge</span>
          </div>
          <p className="header-desc">Chuyển Video iOS sang Android tức thì (P2P 4K)</p>
          <div className="status-pill">
            <span className="pulse-dot"></span>
            {status}
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="tab-bar">
          <button 
            className={`tab-btn ${activeTab === 'wifi' ? 'active' : ''}`}
            onClick={() => setActiveTab('wifi')}
          >
            <Wifi size={16} /> Quét Wi-Fi Cùng Mạng
          </button>
          <button 
            className={`tab-btn ${activeTab === 'pin' ? 'active' : ''}`}
            onClick={() => setActiveTab('pin')}
          >
            <KeyRound size={16} /> Mã PIN / QR (4G & Khác Mạng)
          </button>
        </div>

        <main className="main-content">
          {/* User Device Badge */}
          <div className="my-device-card">
            <div className="my-device-avatar">
              {deviceName.includes('iPhone') || deviceName.includes('Android') ? <Smartphone size={32} /> : <Monitor size={32} />}
            </div>
            <div className="my-device-info">
              <span className="info-label">Thiết bị của bạn:</span>
              <div className="device-name-row">
                <span className="device-name-text">{deviceName}</span>
                <button className="edit-btn" onClick={handleEditName} title="Đổi tên thiết bị">
                  <Edit3 size={14} /> Đổi tên
                </button>
              </div>
            </div>
          </div>

          {/* TAB 1: SAME WI-FI RADAR */}
          {activeTab === 'wifi' && (
            <section className="section-block">
              <div className="section-header">
                <h3>Thiết bị lân cận</h3>
                <span className="section-hint">Cùng kết nối Wi-Fi</span>
              </div>

              {peers.length === 0 ? (
                <div className="radar-radar-box">
                  <div className="radar-circle">
                    <div className="radar-wave wave1"></div>
                    <div className="radar-wave wave2"></div>
                    <div className="radar-wave wave3"></div>
                    <div className="radar-center">
                      <Wifi size={28} className="pulse" />
                    </div>
                  </div>
                  <p className="radar-title">Đang quét thiết bị cùng Wi-Fi...</p>
                  <p className="radar-desc">Hãy mở trang web này trên iPhone hoặc Android còn lại để tự động tìm thấy nhau.</p>
                </div>
              ) : (
                <div className="peer-grid">
                  {peers.map((p) => (
                    <div 
                      key={p.peerId} 
                      className="peer-card-modern" 
                      onClick={() => handleDeviceClick(p.peerId, p.deviceName)}
                    >
                      <div className="peer-avatar">
                        {p.deviceName.includes('iPhone') || p.deviceName.includes('Android') ? <Smartphone size={28} /> : <Monitor size={28} />}
                      </div>
                      <h4 className="peer-title">{p.deviceName}</h4>
                      <button className="peer-action-btn">
                        <Upload size={14} /> Gửi Video / File
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TAB 2: PIN / QR CODE (FOR 4G OR AP ISOLATION) */}
          {activeTab === 'pin' && (
            <section className="section-block pin-block">
              <div className="pin-card-wrapper">
                <h4>Ghép đôi bằng mã PIN 6 số</h4>
                <p className="pin-desc">Dùng khi 1 máy bật 4G, hoặc mạng Wi-Fi bật chế độ chặn thiết bị nội bộ.</p>

                {myPin && (
                  <div className="my-pin-display">
                    <span className="pin-title">Mã PIN của máy này:</span>
                    <div className="pin-number">{myPin}</div>
                    
                    <div className="qr-wrapper">
                      <QRCodeSVG 
                        value={`${window.location.origin}?pin=${myPin}`}
                        size={140}
                        level="M"
                        includeMargin={true}
                      />
                      <span className="qr-label">Quét mã QR bằng camera điện thoại</span>
                    </div>

                    <button className="copy-link-btn" onClick={copyPinUrl}>
                      {isCopiedPin ? <Check size={16} /> : <Copy size={16} />}
                      {isCopiedPin ? 'Đã sao chép link ghép đôi!' : 'Sao chép link kết nối'}
                    </button>
                  </div>
                )}

                <div className="pin-separator">
                  <span>HOẶC NHẬP MÃ PIN MÁY KHÁC</span>
                </div>

                <form onSubmit={handleJoinPin} className="pin-input-form">
                  <input 
                    type="number" 
                    placeholder="Nhập mã 6 chữ số..." 
                    value={inputPin}
                    onChange={(e) => setInputPin(e.target.value)}
                    maxLength={6}
                    className="pin-input-box"
                  />
                  <button type="submit" className="pin-connect-btn">
                    Kết nối ngay
                  </button>
                </form>
                {pinError && <div className="pin-error-msg"><AlertCircle size={14} /> {pinError}</div>}
              </div>
            </section>
          )}

          {/* Hidden File Picker */}
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileSelect}
            accept="video/*,image/*,application/*"
          />

          {/* SEO & EDUCATIONAL SECTION FOR ADSENSE APPROVAL */}
          <section className="seo-section">
            <h3>Vì sao nên dùng DropBridge để chuyển Video?</h3>
            <div className="feature-grid">
              <div className="feature-item">
                <Zap size={20} className="feature-icon" />
                <div>
                  <strong>Tốc độ mạng nội bộ cực cao:</strong> Video 4K 1GB truyền trực tiếp qua sóng Wi-Fi P2P trong vài chục giây.
                </div>
              </div>
              <div className="feature-item">
                <ShieldCheck size={20} className="feature-icon" />
                <div>
                  <strong>Bảo mật 100% riêng tư:</strong> File không lưu lên bất kỳ đám mây nào, truyền thẳng máy sang máy.
                </div>
              </div>
              <div className="feature-item">
                <Smartphone size={20} className="feature-icon" />
                <div>
                  <strong>Không cần cài đặt app:</strong> Hoạt động ngay trên Safari (iPhone) và Chrome (Android/PC).
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* AD SLOT: FOOTER BANNER */}
      <div className="ad-container ad-bottom">
        <div className="ad-label">Sponsored Advertisement</div>
        <div className="ad-placeholder">
          <span>Google AdSense Banner (728x90 Responsive)</span>
        </div>
      </div>

      {/* MODAL: LIVE TRANSFER PROGRESS & IN-MODAL AD */}
      {transferState && (
        <div className="modal-backdrop">
          <div className="transfer-modal-card">
            <div className="transfer-modal-header">
              <div className="transfer-icon-pulse">
                {transferState.mode === 'sending' ? <Upload size={32} /> : <Download size={32} />}
              </div>
              <h3>{transferState.mode === 'sending' ? 'Đang gửi video...' : 'Đang nhận video...'}</h3>
              <p className="transfer-filename">{transferState.fileName}</p>
            </div>

            {/* Progress Bar & Details */}
            <div className="progress-details">
              <div className="progress-bar-container">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${transferState.progress}%` }}
                ></div>
              </div>

              <div className="stats-row">
                <span className="stat-percent">{transferState.progress}%</span>
                <span className="stat-speed">{formatSpeed(transferState.speed)}</span>
                <span className="stat-eta">{transferState.eta}</span>
              </div>

              <div className="stats-size">
                {formatBytes(transferState.bytesDone)} / {formatBytes(transferState.totalBytes)}
              </div>
            </div>

            {/* AD BANNER INSIDE TRANSFER MODAL (High CTR) */}
            <div className="modal-ad-box">
              <div className="ad-label">Quảng cáo tài trợ trong lúc chờ truyền file</div>
              <div className="modal-ad-placeholder">
                <span>Quảng cáo Ads/Banner tương tác (300x100)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECEIVED FILE PREVIEW */}
      {receivedFile && (
        <div className="modal-backdrop">
          <div className="preview-modal-card">
            <button className="close-preview-btn" onClick={() => setReceivedFile(null)}>
              <X size={20} />
            </button>

            <div className="preview-header">
              <CheckCircle2 size={40} className="success-icon" />
              <h3>Đã nhận thành công!</h3>
              <p className="preview-name">{receivedFile.name} ({formatBytes(receivedFile.size)})</p>
            </div>

            {/* Video player preview if it's video */}
            {receivedFile.mimeType.includes('video') ? (
              <div className="video-player-container">
                <video 
                  src={receivedFile.url} 
                  controls 
                  playsInline 
                  className="inline-video-player"
                />
              </div>
            ) : receivedFile.mimeType.includes('image') ? (
              <div className="image-player-container">
                <img src={receivedFile.url} alt="Received media" className="inline-image-player" />
              </div>
            ) : null}

            <div className="preview-actions">
              <a 
                href={receivedFile.url} 
                download={receivedFile.name} 
                className="save-btn"
              >
                <Download size={18} /> Lưu / Tải lại vào máy
              </a>
              <button className="done-btn" onClick={() => setReceivedFile(null)}>
                Xong
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
