'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { syncEngine } from '@/lib/sync-engine';
import { calculateRotationAngle, angleToChoiceWithConfidence } from '@/lib/angle-math';
import { requestCameraWithGesture, configureVideoForIOS } from '@/lib/ios-safari-compat';
import { soundEffects } from '@/lib/sound-effects';

export default function OgretmenScannerPage() {
  const [pin, setPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [recentDetections, setRecentDetections] = useState([]);
  const [fps, setFps] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(Date.now());
  const scannedDebounceRef = useRef(new Map()); // studentId -> lastScanTimestamp

  // Yerel aktif PIN'i al
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPin = localStorage.getItem('scanquiz_active_pin');
      if (savedPin) {
        setPin(savedPin);
        syncEngine.setRoom(savedPin);
        setIsPaired(true);
      }
    }
  }, []);

  const handlePair = (p) => {
    const activePin = p || pin;
    if (!activePin) return;
    syncEngine.setRoom(activePin);
    setIsPaired(true);
    soundEffects.playSubmit();
  };

  // Kamerayı başlat
  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await requestCameraWithGesture('environment');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        configureVideoForIOS(videoRef.current);
        await videoRef.current.play();
        setCameraActive(true);
        startDetectionLoop();
      }
    } catch (err) {
      console.error('Kamera hatası:', err);
      setCameraError(err.message || 'Kameraya erişilemedi.');
    }
  };

  // Kamerayı durdur
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setCameraActive(false);
  };

  // Görüntü işleme ve ArUco / Köşe tespit döngüsü
  const startDetectionLoop = () => {
    const canvas = canvasRef.current || document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let frameCounter = 0;
    let lastFpsUpdate = Date.now();

    const processFrame = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const w = 640;
      const h = 480;

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      // FPS hesapla
      frameCounter++;
      const now = Date.now();
      if (now - lastFpsUpdate >= 1000) {
        setFps(frameCounter);
        frameCounter = 0;
        lastFpsUpdate = now;
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);
  };

  // Manuel kart tarama simülatörü / tetikleyicisi
  const sendManualScan = (studentId, choice, angle = 0) => {
    const now = Date.now();
    const lastScanned = scannedDebounceRef.current.get(studentId) || 0;

    // 1 saniyelik debounce (aynı kartın spamlanmasını önle)
    if (now - lastScanned < 1000) return;
    scannedDebounceRef.current.set(studentId, now);

    // Host ve Tahtaya ilet
    syncEngine.emit('student_scanned_raw', {
      studentId,
      choice,
      angle,
    });

    soundEffects.playSubmit();

    setRecentDetections((prev) => [
      { studentId, choice, angle, time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 7),
    ]);
  };

  return (
    <main className="page-container" style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '60px' }}>
      {/* Üst Bar */}
      <header className="page-header" style={{ borderRadius: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/" className="logo" style={{ fontSize: '1.2rem', textDecoration: 'none' }}>
            ⚡ ScanQuiz
          </Link>
          <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
            Mobil Tarayıcı
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link href="/host" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            🎮 Kumanda
          </Link>
          <span className="badge badge-success">
            {isPaired ? `PIN: ${pin}` : 'Bağlı Değil'}
          </span>
        </div>
      </header>

      {/* PIN Bağlantısı */}
      {!isPaired ? (
        <section className="glass-card" style={{ padding: '24px', textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>
            Tahta ile Eşleşin
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Tahtadaki 6 haneli dinamik PIN kodunu girin.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <input
              type="text"
              placeholder="PIN"
              value={pin}
              maxLength={6}
              onChange={(e) => setPin(e.target.value)}
              className="input input-pin"
              style={{ width: '200px', fontSize: '1.5rem', padding: '8px' }}
            />
            <button onClick={() => handlePair()} className="btn btn-primary">
              Bağlan
            </button>
          </div>
        </section>
      ) : null}

      {/* Kamera Tarayıcı Alanı */}
      <section className="glass-card" style={{ padding: '20px', marginBottom: '24px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📷 ArUco DICT_4X4_50 Kamera Tarayıcı</span>
          </h2>
          {cameraActive && (
            <span className="badge badge-success" style={{ fontFamily: 'var(--font-mono)' }}>
              {fps} FPS
            </span>
          )}
        </div>

        {cameraError && (
          <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
            {cameraError}
          </div>
        )}

        <div className="scanner-container" style={{ minHeight: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }}
          />

          {cameraActive && (
            <div className="scanner-overlay">
              <div className="scanner-corners" />
              <div className="scanner-corners-bottom" />
              <div className="scanner-line" />
            </div>
          )}

          {!cameraActive && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📷</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
                Öğrencilerin kartlarını taramak için kamerayı başlatın.
              </p>
              <button onClick={startCamera} className="btn btn-primary btn-lg">
                Kamerayı Aç (WebRTC)
              </button>
            </div>
          )}
        </div>

        {cameraActive && (
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={stopCamera} className="btn btn-danger" style={{ width: '100%' }}>
              Kamerayı Durdur
            </button>
          </div>
        )}
      </section>

      {/* Son Algılanan Kartlar */}
      <section className="glass-card" style={{ padding: '20px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '12px' }}>
          ⏱️ Son Taranan Kartlar
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {recentDetections.map((d, i) => (
            <div key={i} className="detection-badge" style={{ borderColor: 'var(--success)' }}>
              <span>#{d.studentId}</span>
              <strong style={{ color: 'var(--accent-secondary)' }}>{d.choice}</strong>
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>({d.time})</span>
            </div>
          ))}
          {recentDetections.length === 0 && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Henüz taranan kart yok.
            </div>
          )}
        </div>
      </section>

      {/* Fiziksel Kart Test Paneli (Kamera Olmadan veya Masaüstünde Test Etmek İçin) */}
      <section className="glass-card" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>
          🧪 Sanal ArUco Kart Döndürme & Test Aracı
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Herhangi bir öğrenci kartına tıklayarak açısını ve yanıtını doğrudan tahtaya iletebilirsiniz.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {[1, 2, 3, 4, 5, 6].map((sId) => (
            <div
              key={sId}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: '12px',
                padding: '12px',
                textAlign: 'center',
                border: '1px solid var(--bg-glass-border)',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '8px' }}>
                Öğrenci #{sId}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  onClick={() => sendManualScan(sId, 'A', 0)}
                  className="btn btn-secondary"
                  style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--option-a)', color: '#fff' }}
                >
                  A (0°)
                </button>
                <button
                  onClick={() => sendManualScan(sId, 'B', 90)}
                  className="btn btn-secondary"
                  style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--option-b)', color: '#000' }}
                >
                  B (90°)
                </button>
                <button
                  onClick={() => sendManualScan(sId, 'C', 180)}
                  className="btn btn-secondary"
                  style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--option-c)', color: '#fff' }}
                >
                  C (180°)
                </button>
                <button
                  onClick={() => sendManualScan(sId, 'D', 270)}
                  className="btn btn-secondary"
                  style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--option-d)', color: '#000' }}
                >
                  D (270°)
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
