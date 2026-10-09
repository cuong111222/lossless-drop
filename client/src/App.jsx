import { useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { Monitor, Smartphone, Upload, CheckCircle } from 'lucide-react';
import './App.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;

function getDeviceName() {
  const saved = localStorage.getItem('myDeviceName');
  if (saved) return saved;
  const ua = navigator.userAgent;
  let base = 'Device';
  if (/iPad|iPhone|iPod/.test(ua)) base = 'iPhone';
  else if (/Android/.test(ua)) base = 'Android';
  else if (/Mac/.test(ua)) base = 'MacBook';
  else if (/Windows/.test(ua)) base = 'Windows';
  
  const newName = `${base} ${Math.floor(Math.random() * 1000)}`;
  localStorage.setItem('myDeviceName', newName);
  return newName;
}

function App() {
  const [peerId, setPeerId] = useState('');
  const [deviceName, setDeviceName] = useState(getDeviceName());
  const [peers, setPeers] = useState([]);
  const [status, setStatus] = useState('Connecting...');
  const [transferProgress, setTransferProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  
  const peerRef = useRef(null);
  const fileInputRef = useRef(null);
  const targetPeerIdRef = useRef(null);

  useEffect(() => {
    let savedId = localStorage.getItem('myPeerId');
    if (!savedId) {
      savedId = 'user-' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('myPeerId', savedId);
    }

    const peer = new Peer(savedId);
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('Ready');
      registerWithServer(id, deviceName);
    });

    peer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'file') {
          setIsTransferring(true);
          setTransferProgress(100);
          
          const blob = new Blob([data.file]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.fileName || 'video-received.mp4';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          setTimeout(() => {
            setIsTransferring(false);
            setTransferProgress(0);
          }, 3000);
        }
      });
      
      conn.on('open', () => {
        setStatus('Connected to another device!');
      });
    });

    peer.on('error', (err) => {
      console.error(err);
      setStatus('Connection error: ' + err.type);
    });

    const interval = setInterval(() => {
      if (peerRef.current && peerRef.current.id) {
        fetchPeers(peerRef.current.id);
        registerWithServer(peerRef.current.id, deviceName);
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, [deviceName]);

  const registerWithServer = async (id, name) => {
    try {
      await fetch(`${SERVER_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: id, deviceName: name })
      });
    } catch (e) {
      console.log('Cannot connect to discovery server');
    }
  };

  const fetchPeers = async (currentId) => {
    try {
      const res = await fetch(`${SERVER_URL}/peers`);
      const data = await res.json();
      const others = data.peers.filter(p => p.peerId !== currentId);
      setPeers(others);
    } catch (e) {
      console.log('Error fetching peers');
    }
  };

  const handleEditName = () => {
    const newName = prompt('Enter your device name:', deviceName);
    if (newName && newName.trim() !== '') {
      setDeviceName(newName.trim());
      localStorage.setItem('myDeviceName', newName.trim());
      if (peerRef.current && peerRef.current.id) {
        registerWithServer(peerRef.current.id, newName.trim());
      }
    }
  };

  const handleDeviceClick = (targetId) => {
    targetPeerIdRef.current = targetId;
    fileInputRef.current.click();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file || !targetPeerIdRef.current) return;

    setStatus(`Sending: ${file.name}...`);
    setIsTransferring(true);
    setTransferProgress(10);

    const conn = peerRef.current.connect(targetPeerIdRef.current);
    
    conn.on('open', () => {
      setTransferProgress(50);
      conn.send({
        type: 'file',
        file: file,
        fileName: file.name
      });
      
      setTransferProgress(100);
      setStatus(`Sent ${file.name} successfully!`);
      
      setTimeout(() => {
        setIsTransferring(false);
        setTransferProgress(0);
        setStatus('Ready');
      }, 3000);
    });
  };

  return (
    <div className="container">
      <header>
        <h1>Video Transfer</h1>
        <div className="status-badge">Status: {status}</div>
      </header>

      <main>
        <div className="my-device">
          <div className="device-icon me">
            {deviceName.includes('iPhone') || deviceName.includes('Android') ? <Smartphone size={48} /> : <Monitor size={48} />}
          </div>
          <h3>Your device: {deviceName} <button onClick={handleEditName} style={{fontSize:'12px', padding:'4px 8px', marginLeft:'8px', borderRadius:'12px', border:'1px solid #ccc', cursor:'pointer', background:'white'}}>✏️ Edit</button></h3>
          <p className="subtitle">Open this page on another device to receive</p>
        </div>

        <div className="radar-section">
          <h2>Nearby Devices</h2>
          {peers.length === 0 ? (
            <div className="empty-state">
              <div className="spinner"></div>
              <p>Searching for devices on the same Wi-Fi...</p>
            </div>
          ) : (
            <div className="peer-list">
              {peers.map((p) => (
                <div key={p.peerId} className="peer-card" onClick={() => handleDeviceClick(p.peerId)}>
                  <div className="device-icon them">
                    {p.deviceName.includes('iPhone') || p.deviceName.includes('Android') ? <Smartphone size={40} /> : <Monitor size={40} />}
                  </div>
                  <h4>{p.deviceName}</h4>
                  <button className="send-btn">
                    <Upload size={16} /> Send File
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {isTransferring && (
          <div className="transfer-overlay">
            <div className="transfer-box">
              {transferProgress < 100 ? <Upload size={48} className="pulse" /> : <CheckCircle size={48} color="green" />}
              <h3>{transferProgress < 100 ? 'Transferring file...' : 'Done!'}</h3>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${transferProgress}%` }}></div>
              </div>
            </div>
          </div>
        )}

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileSelect}
          accept="video/*,image/*"
        />
      </main>
    </div>
  );
}

export default App;
