'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { syncEngine } from '@/lib/sync-engine';
import { requestCameraWithGesture, configureVideoForIOS } from '@/lib/ios-safari-compat';
import { soundEffects } from '@/lib/sound-effects';

export default function OgretmenScannerPage() {
  // ⚠️ KOD OTONOM DOLDURULMAZ — KUTU BOŞ BAŞLAR
  const [pin, setPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [recentDetections, setRecentDetections] = useState([]);
  const [fps, setFps] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const scannedDebounceRef = useRef(new Map());

  const handlePair = (e) => {
    if (e) e.preventDefault();
    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      alert('Lütfen tahtadaki 6 haneli PIN kodunu girin.');
      return;
    }
    syncEngine.setRoom(cleanPin);
    setIsPaired(true);
    soundEffects.playSubmit();
  };

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await requestCameraWithGesture('environment');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        configureVideoForIOS(videoRef.current);
        await videoRef.current.play();
        setCameraActive(true);
        startLoop();
      }
    } catch (err) {
      setCameraError(err.message || 'Kameraya erişilemedi.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setCameraActive(false);
  };

  const startLoop = () => {
    const canvas = canvasRef.current || document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let frameCount = 0;
    let lastTime = Date.now();

    const loop = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      canvas.width = 640;
      canvas.height = 480;
      ctx.drawImage(videoRef.current, 0, 0, 640, 480);

      frameCount++;
      const now = Date.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
  };

  const recordScan = (studentId, choice) => {
    const now = Date.now();
    const last = scannedDebounceRef.current.get(studentId) || 0;
    if (now - last < 1000) return;
    scannedDebounceRef.current.set(studentId, now);

    syncEngine.emit('student_scanned_raw', { studentId, choice });
    soundEffects.playSubmit();

    setRecentDetections((prev) => [
      { studentId, choice, time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 6)
    ]);
  };

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '16px' }}>
      <header className="panel panel-header" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: '1.1rem', textDecoration: 'none', color: '#fff' }}>
            ScanQuiz
          </Link>
          <span className="badge badge-info">Mobil Tarayıcı</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link href="/host" className="btn btn-sm">Kumanda</Link>
          <span className={`badge ${isPaired ? 'badge-success' : 'badge-warning'}`}>
            {isPaired ? `Oda: ${pin}` : 'Bağlı Değil'}
          </span>
        </div>
      </header>

      {/* PIN Bağlantısı (Kutu boş başlar) */}
      {!isPaired ? (
        <section className="panel" style={{ padding: '24px', textAlign: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '6px' }}>Tahta Kodu</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Akıllı tahtada gördüğünüz 6 haneli katılım kodunu girin.
          </p>

          <form onSubmit={handlePair} style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <input
              type="text"
              placeholder="Örn: 482910"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="input input-pin"
              style={{ width: '180px', padding: '8px', fontSize: '1.3rem' }}
              autoFocus
            />
            <button type="submit" className="btn btn-primary">
              Bağlan
            </button>
          </form>
        </section>
      ) : null}

      {/* Kamera Alanı */}
      <section className="panel" style={{ padding: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Kamera Tarayıcı</h3>
          {cameraActive && <span className="badge badge-success">{fps} FPS</span>}
        </div>

        {cameraError && (
          <div style={{ background: 'var(--danger-subtle)', color: 'var(--danger)', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '12px' }}>
            {cameraError}
          </div>
        )}

        <div style={{ position: 'relative', width: '100%', minHeight: '260px', background: '#000', borderRadius: '10px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }}
          />

          {!cameraActive && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📷</div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
                Öğrenci kartlarını taramak için arka kamerayı açın.
              </p>
              <button onClick={startCamera} className="btn btn-primary btn-lg">
                Kamerayı Aç
              </button>
            </div>
          )}
        </div>

        {cameraActive && (
          <button onClick={stopCamera} className="btn btn-danger" style={{ width: '100%', marginTop: '12px' }}>
            Kamerayı Kapat
          </button>
        )}
      </section>

      {/* Son Tarananlar */}
      <section className="panel" style={{ padding: '16px', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '8px' }}>Son Okunan Kartlar</h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {recentDetections.map((d, i) => (
            <div key={i} style={{ background: '#0e1017', padding: '6px 10px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid var(--border-subtle)' }}>
              <strong>#{d.studentId}</strong>: <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{d.choice}</span> ({d.time})
            </div>
          ))}
          {recentDetections.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Henüz okunan kart yok.</div>
          )}
        </div>
      </section>

      {/* Manuel Test Paneli */}
      <section className="panel" style={{ padding: '16px' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '4px' }}>Hızlı Test Kartları</h4>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Kamera açmadan doğrudan yanıtlara tıklayarak da test edebilirsiniz.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
          {[1, 2, 3, 4, 5, 6].map((sId) => (
            <div key={sId} style={{ background: '#0e1017', padding: '8px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '6px' }}>Öğrenci #{sId}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                {['A', 'B', 'C', 'D'].map((ch) => (
                  <button
                    key={ch}
                    onClick={() => recordScan(sId, ch)}
                    className="btn btn-sm"
                    style={{ padding: '4px' }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
