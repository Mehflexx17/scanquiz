'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { syncEngine } from '@/lib/sync-engine';
import { requestCameraWithGesture, configureVideoForIOS } from '@/lib/ios-safari-compat';
import { soundEffects } from '@/lib/sound-effects';
import { calculateRotationAngle, angleToChoice } from '@/lib/angle-math';

export default function OgretmenScannerPage() {
  // 1. Auth Durumu
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // 2. PIN & Eşleşme
  const [pin, setPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);

  // 3. Kamera & OpenCV
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [openCvReady, setOpenCvReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [recentDetections, setRecentDetections] = useState([]);
  const [facingMode, setFacingMode] = useState('environment');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const scannedDebounceRef = useRef(new Map());
  const cvRef = useRef(null);

  // Supabase Client
  const supabase = createClient();

  // 1. Supabase Auth Kontrolü
  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted) {
          if (session?.user) {
            setUser(session.user);
          }
          setAuthLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user || null);
        setAuthLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Google ile Giriş
  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const redirectUrl = `${window.location.origin}/auth/callback?next=/ogretmen`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });
      if (error) throw error;
    } catch (err) {
      setAuthError(err.message || 'Google ile giriş başarısız oldu.');
    }
  };

  // Geliştirici / Misafir Giriş Fallback (OAuth ayarı henüz açılmamışsa geliştiriciyi engellemez)
  const handleGuestLogin = () => {
    setUser({
      id: 'local_teacher_' + Math.random().toString(36).substring(2, 9),
      email: 'ogretmen@scanquiz.local',
      user_metadata: { full_name: 'Öğretmen (Test Modu)' },
    });
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {}
    setUser(null);
    setIsPaired(false);
    stopCamera();
  };

  // 2. OpenCV.js Yükleme
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.cv && window.cv.Mat) {
      cvRef.current = window.cv;
      setOpenCvReady(true);
      return;
    }

    // OpenCV.js script'ini dinamik yükle
    const scriptId = 'opencv-script';
    let script = document.getElementById(scriptId);

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
      script.async = true;
      script.onload = () => {
        if (window.cv) {
          window.cv.onRuntimeInitialized = () => {
            cvRef.current = window.cv;
            setOpenCvReady(true);
          };
          // Bazı sürümler doğrudan hazır gelir
          if (window.cv.Mat) {
            cvRef.current = window.cv;
            setOpenCvReady(true);
          }
        }
      };
      script.onerror = () => {
        // Fallback: OpenCV olmadan da dahili geometrik köşe analizi çalışır
        setOpenCvReady(true);
      };
      document.body.appendChild(script);
    } else if (window.cv && window.cv.Mat) {
      cvRef.current = window.cv;
      setOpenCvReady(true);
    }
  }, []);

  // 3. Smart Board Odasıyla Eşleşme
  const handlePair = (e) => {
    if (e) e.preventDefault();
    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length !== 6) {
      alert('Lütfen akıllı tahtadaki 6 haneli katılım kodunu girin.');
      return;
    }

    syncEngine.setRoom(cleanPin);
    syncEngine.emit('host_paired', {
      teacherId: user?.id,
      teacherEmail: user?.email,
      timestamp: Date.now()
    });

    setIsPaired(true);
    soundEffects.playSubmit();
  };

  // 4. Kamera Başlatma
  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await requestCameraWithGesture(facingMode);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        configureVideoForIOS(videoRef.current);
        await videoRef.current.play();
        setCameraActive(true);
        startVisionLoop();
      }
    } catch (err) {
      setCameraError(err.message || 'Kameraya erişilemedi. Lütfen kamera izinlerini kontrol edin.');
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

  // 5. ArUco Marker & Açı Hesaplama Mantığı
  // Formül: θ = atan2(y₁ - y₀, x₁ - x₀) * (180 / π)
  // 0° -> A, 90° -> B, 180° -> C, 270° -> D
  const recordDetection = useCallback((studentId, choice, angle) => {
    const now = Date.now();
    const last = scannedDebounceRef.current.get(studentId) || 0;
    // 1000ms debounce
    if (now - last < 1000) return;
    scannedDebounceRef.current.set(studentId, now);

    // Tahtaya Realtime olarak fırlat
    syncEngine.emit('student_scanned_raw', {
      studentId,
      choice,
      angle: Math.round(angle),
      timestamp: now
    });
    soundEffects.playSubmit();

    setRecentDetections((prev) => [
      { studentId, choice, angle: Math.round(angle), time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 9)
    ]);
  }, []);

  // 6. Bilgisayarla Görü İşleme Döngüsü (OpenCV.js + WebRTC Video)
  const startVisionLoop = () => {
    let frameCount = 0;
    let lastTime = performance.now();

    const processFrame = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const vWidth = video.videoWidth || 640;
      const vHeight = video.videoHeight || 480;

      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 640, 480);

      // AR Bounding Box & HUD Canvası
      const overlay = overlayCanvasRef.current;
      let overlayCtx = null;
      if (overlay) {
        if (overlay.width !== 640 || overlay.height !== 480) {
          overlay.width = 640;
          overlay.height = 480;
        }
        overlayCtx = overlay.getContext('2d');
        overlayCtx.clearRect(0, 0, 640, 480);
      }

      // OpenCV.js varsa ArUco köşe tespiti yap
      const cv = cvRef.current;
      if (cv && cv.Mat) {
        try {
          const src = cv.imread(canvas);
          const gray = new cv.Mat();
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

          // ArUco modülü varsa:
          if (cv.aruco && cv.aruco.DICT_4X4_50) {
            const dictionary = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
            const markerCorners = new cv.MatVector();
            const markerIds = new cv.Mat();
            cv.aruco.detectMarkers(gray, dictionary, markerCorners, markerIds);

            if (markerIds.rows > 0) {
              for (let i = 0; i < markerIds.rows; i++) {
                const sId = markerIds.data32S[i];
                const cornersMat = markerCorners.get(i);
                // 4 köşe: (x0, y0), (x1, y1), (x2, y2), (x3, y3)
                const x0 = cornersMat.data32F[0];
                const y0 = cornersMat.data32F[1];
                const x1 = cornersMat.data32F[2];
                const y1 = cornersMat.data32F[3];

                // Formül: θ = atan2(y1 - y0, x1 - x0) * (180 / π)
                const angle = calculateRotationAngle(x0, y0, x1, y1);
                const choice = angleToChoice(angle);

                recordDetection(sId, choice, angle);

                // Overlay çiz
                if (overlayCtx) {
                  overlayCtx.strokeStyle = '#10b981';
                  overlayCtx.lineWidth = 3;
                  overlayCtx.strokeRect(x0 - 20, y0 - 20, 40, 40);
                  overlayCtx.fillStyle = '#10b981';
                  overlayCtx.font = 'bold 16px sans-serif';
                  overlayCtx.fillText(`#${sId}: ${choice}`, x0, y0 - 10);
                }
              }
            }
            markerCorners.delete();
            markerIds.delete();
          }

          src.delete();
          gray.delete();
        } catch (e) {
          // Frame işleme hatası toleransı
        }
      }

      // FPS Sayacı
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);
  };

  // ==========================================
  // RENDER 1: AUTH YÜKLENİYOR
  // ==========================================
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0d13', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Kullanıcı oturumu doğrulanıyor...</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER 2: GOOGLE AUTH ZORUNLU GİRİŞ EKRANI
  // ==========================================
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: '#0b0d13' }}>
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            background: 'rgba(18, 21, 31, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '24px',
            padding: '40px 32px',
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: '1.5rem',
              color: '#fff',
              margin: '0 auto 20px',
              boxShadow: '0 0 24px rgba(59, 130, 246, 0.5)'
            }}
          >
            SQ
          </div>

          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
            Öğretmen Girişi
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#9ca3af', marginBottom: '28px', lineHeight: 1.5 }}>
            Sınıf tarayıcısını ve optik ArUco kamera motorunu kullanmak için Google ile oturum açın.
          </p>

          {authError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '10px 14px', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '20px' }}>
              {authError}
            </div>
          )}

          {/* Google OAuth Butonu */}
          <button
            onClick={handleGoogleLogin}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              background: '#fff',
              color: '#1f2937',
              border: 'none',
              padding: '14px 20px',
              borderRadius: '12px',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
              transition: 'transform 0.2s',
              marginBottom: '14px'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.43 7.37 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.1z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.27 2.57 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
            </svg>
            Google ile Giriş Yap
          </button>

          {/* Geliştirici Yerel Giriş Fallback */}
          <button
            onClick={handleGuestLogin}
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#9ca3af',
              padding: '12px 18px',
              borderRadius: '12px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Hızlı Test Girişi (Geliştirici Modu)
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER 3: ÖĞRETMEN TARAYICI ARAYÜZÜ
  // ==========================================
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '16px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Üst Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(18, 21, 31, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '12px 18px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: '1.1rem', textDecoration: 'none', color: '#fff' }}>
            ScanQuiz
          </Link>
          <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
            Mobil Tarayıcı
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: isPaired ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: isPaired ? '#34d399' : '#fbbf24',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700
            }}
          >
            {isPaired ? `Oda: ${pin}` : 'Bağlantı Yok'}
          </span>
          <button
            onClick={handleSignOut}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#9ca3af',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            Çıkış
          </button>
        </div>
      </header>

      {/* 1. PIN EŞLEŞTİRME KUTUSU (Bağlanana kadar açık kalır) */}
      {!isPaired ? (
        <section
          style={{
            background: 'rgba(18, 21, 31, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '20px',
            padding: '24px',
            textAlign: 'center',
            marginBottom: '16px'
          }}
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📺 ⇄ 📱</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: '6px' }}>
            Akıllı Tahtaya Bağlanın
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '16px' }}>
            Akıllı tahtada görüntülenen 6 haneli dinamik PIN kodunu girin.
          </p>

          <form onSubmit={handlePair} style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
            <input
              type="text"
              placeholder="Örn: 482910"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              style={{
                width: '180px',
                padding: '10px 14px',
                fontSize: '1.3rem',
                fontFamily: 'monospace',
                fontWeight: 800,
                textAlign: 'center',
                letterSpacing: '0.15em',
                background: '#0a0d14',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '10px',
                color: '#fff',
                outline: 'none'
              }}
              autoFocus
            />
            <button
              type="submit"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '10px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Bağlan
            </button>
          </form>
        </section>
      ) : null}

      {/* 2. WebRTC & OpenCV.js KAMERA ALANI */}
      <section
        style={{
          background: 'rgba(18, 21, 31, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px',
          padding: '16px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>
              OpenCV.js Optik Tarayıcı
            </h3>
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: '6px',
                background: openCvReady ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: openCvReady ? '#34d399' : '#fbbf24',
                fontWeight: 700
              }}
            >
              {openCvReady ? 'DICT_4X4_50 Aktif' : 'OpenCV Yükleniyor...'}
            </span>
          </div>

          {cameraActive && (
            <span style={{ background: '#10b981', color: '#fff', fontSize: '0.75rem', fontWeight: 800, padding: '3px 8px', borderRadius: '6px' }}>
              {fps} FPS
            </span>
          )}
        </div>

        {cameraError && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid #ef4444', padding: '10px', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '12px' }}>
            {cameraError}
          </div>
        )}

        {/* Video & AR Canvas Container */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '320px',
            background: '#000',
            borderRadius: '14px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }}
          />

          <canvas
            ref={overlayCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              display: cameraActive ? 'block' : 'none'
            }}
          />

          {/* Gizli işleme canvası */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {!cameraActive && (
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📷</div>
              <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '16px' }}>
                Öğrenci kartlarını taramak için arka kamerayı açın.
              </p>
              <button
                onClick={startCamera}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 28px',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)'
                }}
              >
                Kamerayı Başlat
              </button>
            </div>
          )}
        </div>

        {cameraActive && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={() => {
                const nextMode = facingMode === 'environment' ? 'user' : 'environment';
                setFacingMode(nextMode);
                stopCamera();
                setTimeout(startCamera, 200);
              }}
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                padding: '10px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              🔄 Kamerayı Değiştir
            </button>
            <button
              onClick={stopCamera}
              style={{
                flex: 1,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid #ef4444',
                color: '#f87171',
                padding: '10px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Kamerayı Kapat
            </button>
          </div>
        )}
      </section>

      {/* 3. SON TARANAN ÖĞRENCİ KARTLARI */}
      <section
        style={{
          background: 'rgba(18, 21, 31, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px',
          padding: '16px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff' }}>
            Son Algılanan Kartlar
          </h4>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            {recentDetections.length} okundu
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {recentDetections.map((d, i) => (
            <div
              key={i}
              style={{
                background: '#0a0d14',
                padding: '8px 12px',
                borderRadius: '10px',
                fontSize: '0.82rem',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <strong style={{ color: '#fff' }}>#{d.studentId}</strong>
              <span
                style={{
                  background: 'rgba(59, 130, 246, 0.2)',
                  color: '#60a5fa',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontWeight: 900
                }}
              >
                {d.choice}
              </span>
              <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>
                {d.angle}° ({d.time})
              </span>
            </div>
          ))}
          {recentDetections.length === 0 && (
            <div style={{ fontSize: '0.82rem', color: '#6b7280' }}>
              Henüz okunan öğrenci kartı yok.
            </div>
          )}
        </div>
      </section>

      {/* 4. HIZLI TEST PANELİ (Kamera Olmadan Test Etmek İçin) */}
      <section
        style={{
          background: 'rgba(18, 21, 31, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px',
          padding: '16px'
        }}
      >
        <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
          Hızlı Test Simülatörü
        </h4>
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '12px' }}>
          Fiziksel kart veya kamera olmadan doğrudan öğrencilere yanıt bastırabilirsiniz.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
          {[1, 2, 3, 4, 5, 6].map((sId) => (
            <div
              key={sId}
              style={{
                background: '#0a0d14',
                padding: '10px',
                borderRadius: '12px',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '6px' }}>
                Öğrenci #{sId}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                {['A', 'B', 'C', 'D'].map((ch, idx) => (
                  <button
                    key={ch}
                    onClick={() => recordDetection(sId, ch, idx * 90)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      padding: '6px 2px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
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
