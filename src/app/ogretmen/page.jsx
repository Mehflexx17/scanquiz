'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { auth, googleProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from '@/lib/firebase';
import { syncEngine } from '@/lib/sync-engine';
import { requestCameraWithGesture, configureVideoForIOS } from '@/lib/ios-safari-compat';
import { soundEffects } from '@/lib/sound-effects';
import { calculateRotationAngle, angleToChoice } from '@/lib/angle-math';
import { parseQuizFile } from '@/lib/file-parser';

const DEFAULT_QUESTIONS = [
  {
    id: 1,
    text: 'Türkiye Cumhuriyeti hangi yılda ilan edilmiştir?',
    options: { A: '1919', B: '1920', C: '1923', D: '1938' },
    correctAnswer: 'C'
  },
  {
    id: 2,
    text: 'Güneş sistemindeki en büyük gezegen hangisidir?',
    options: { A: 'Mars', B: 'Jüpiter', C: 'Satürn', D: 'Dünya' },
    correctAnswer: 'B'
  },
  {
    id: 3,
    text: 'Suyun kimyasal formülü aşağıdakilerden hangisidir?',
    options: { A: 'H2O', B: 'CO2', C: 'NaCl', D: 'O2' },
    correctAnswer: 'A'
  }
];

export default function OgretmenScannerPage() {
  // 1. Firebase Auth Durumu
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 2. PIN & Eşleşme
  const [pin, setPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);

  // 3. Aktif Mobil Sekmesi ('camera' | 'questions' | 'classes')
  const [activeTab, setActiveTab] = useState('camera');

  // 4. Kamera & OpenCV
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [openCvReady, setOpenCvReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [recentDetections, setRecentDetections] = useState([]);
  const [facingMode, setFacingMode] = useState('environment');

  // 5. Quiz & Soru Yönetimi (Telefondan Kontrol)
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionState, setQuestionState] = useState('IDLE'); // 'IDLE' | 'RUNNING' | 'ENDED'
  const [submissions, setSubmissions] = useState(new Map());
  const [importStatus, setImportStatus] = useState('');

  // Soru Oluşturucu Form State
  const [showQuestionCreator, setShowQuestionCreator] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptA, setNewOptA] = useState('');
  const [newOptB, setNewOptB] = useState('');
  const [newOptC, setNewOptC] = useState('');
  const [newOptD, setNewOptD] = useState('');
  const [newCorrectAnswer, setNewCorrectAnswer] = useState('A');

  // 6. Sınıflar & Roster Yönetimi
  const [classes, setClasses] = useState({
    '9-A': { 1: 'Ali Yılmaz', 2: 'Ayşe Kaya', 3: 'Mehmet Demir', 4: 'Zeynep Bal', 5: 'Can Sarı' },
    '9-B': { 1: 'Burak Şen', 2: 'Elif Yıldız', 3: 'Emre Ak', 4: 'Gamze Kara', 5: 'Oğuzhan Tekin' }
  });
  const [currentClass, setCurrentClass] = useState('9-A');
  const [roster, setRoster] = useState({});
  const [newClassName, setNewClassName] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [bulkNames, setBulkNames] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const scannedDebounceRef = useRef(new Map());
  const cvRef = useRef(null);
  const fileInputRef = useRef(null);

  // 1. Firebase Auth Listener
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || 'Öğretmen',
          photoURL: fbUser.photoURL
        });
      } else {
        // Oturum açılmamışsa da öğretmen arayüzüne serbest erişim ver
        setUser({
          id: 'teacher_guest',
          email: '',
          displayName: 'Öğretmen',
          photoURL: null
        });
      }
      setAuthLoading(false);
    });

    return () => unsub();
  }, []);

  // Google ile Giriş Yap (Firebase)
  const handleGoogleLogin = async () => {
    if (!auth) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.warn('Google giriş hatası:', err.message);
    }
  };

  const handleSignOut = async () => {
    if (auth) {
      try { await fbSignOut(auth); } catch (e) {}
    }
    setUser({ id: 'teacher_guest', email: '', displayName: 'Öğretmen', photoURL: null });
  };

  // 2. Sınıfları ve Soru Listesini LocalStorage'dan Yükle
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedClasses = localStorage.getItem('scanquiz_classes');
        const savedCurrent = localStorage.getItem('scanquiz_current_class');
        if (savedClasses) {
          const parsed = JSON.parse(savedClasses);
          setClasses(parsed);
          const active = savedCurrent && parsed[savedCurrent] ? savedCurrent : Object.keys(parsed)[0];
          if (active) {
            setCurrentClass(active);
            setRoster(parsed[active] || {});
          }
        } else {
          setRoster(classes['9-A']);
        }
      } catch (e) {}
    }
  }, []);

  // 3. OpenCV.js Yükleme
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.cv && window.cv.Mat) {
      cvRef.current = window.cv;
      setOpenCvReady(true);
      return;
    }

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
          if (window.cv.Mat) {
            cvRef.current = window.cv;
            setOpenCvReady(true);
          }
        }
      };
      script.onerror = () => {
        setOpenCvReady(true);
      };
      document.body.appendChild(script);
    } else if (window.cv && window.cv.Mat) {
      cvRef.current = window.cv;
      setOpenCvReady(true);
    }
  }, []);

  // 4. PIN ile Tahtaya Bağlanma
  const handlePair = (e) => {
    if (e) e.preventDefault();
    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      alert('Lütfen akıllı tahtadaki geçerli PIN kodunu girin.');
      return;
    }

    syncEngine.setRoom(cleanPin);
    syncEngine.emit('host_paired', {
      teacherId: user?.id,
      timestamp: Date.now()
    });

    setIsPaired(true);
    soundEffects.playSubmit();
  };

  // 5. Kamera Başlatma / Durdurma
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
      setCameraError(err.message || 'Kameraya erişilemedi. Lütfen tarayıcı kamera izinlerini kontrol edin.');
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

  // 6. ArUco Kartı Algılandığında
  const recordDetection = useCallback((studentId, choice, angle) => {
    const now = Date.now();
    const last = scannedDebounceRef.current.get(studentId) || 0;
    if (now - last < 1000) return;
    scannedDebounceRef.current.set(studentId, now);

    // Tahtaya Realtime olarak fırlat
    syncEngine.emit('student_scanned_raw', {
      studentId,
      choice,
      angle: Math.round(angle),
      timestamp: now
    });

    setSubmissions((prev) => {
      const next = new Map(prev);
      next.set(studentId, { choice, time: now });
      return next;
    });

    soundEffects.playSubmit();

    const studentName = roster[studentId] || `Öğrenci #${studentId}`;
    setRecentDetections((prev) => [
      { studentId, studentName, choice, angle: Math.round(angle), time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 9)
    ]);
  }, [roster]);

  // 7. OpenCV.js Bilgisayarla Görü Döngüsü
  const startVisionLoop = () => {
    let frameCount = 0;
    let lastTime = performance.now();

    const processFrame = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 640, 480);

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

      // FPS Sayacı
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }

      const cv = cvRef.current;
      if (cv && cv.Mat) {
        try {
          const src = cv.imread(canvas);
          const gray = new cv.Mat();
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

          // ArUco DICT_4X4_50 Tespiti
          if (cv.aruco) {
            const dictionary = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
            const corners = new cv.MatVector();
            const ids = new cv.Mat();
            const parameters = new cv.aruco.DetectorParameters();

            cv.aruco.detectMarkers(gray, dictionary, corners, ids, parameters);

            if (ids.rows > 0) {
              for (let i = 0; i < ids.rows; i++) {
                const markerId = ids.data32S[i];
                const studentId = markerId + 1; // 0 index -> Öğrenci 1

                const cornerMat = corners.get(i);
                const p0 = { x: cornerMat.data32F[0], y: cornerMat.data32F[1] };
                const p1 = { x: cornerMat.data32F[2], y: cornerMat.data32F[3] };
                const p2 = { x: cornerMat.data32F[4], y: cornerMat.data32F[5] };
                const p3 = { x: cornerMat.data32F[6], y: cornerMat.data32F[7] };

                const angle = calculateRotationAngle(p0, p1, p2, p3);
                const choice = angleToChoice(angle);

                recordDetection(studentId, choice, angle);

                if (overlayCtx) {
                  overlayCtx.strokeStyle = '#10b981';
                  overlayCtx.lineWidth = 3;
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(p0.x, p0.y);
                  overlayCtx.lineTo(p1.x, p1.y);
                  overlayCtx.lineTo(p2.x, p2.y);
                  overlayCtx.lineTo(p3.x, p3.y);
                  overlayCtx.closePath();
                  overlayCtx.stroke();

                  overlayCtx.fillStyle = '#10b981';
                  overlayCtx.font = 'bold 16px monospace';
                  overlayCtx.fillText(`#${studentId} [${choice}]`, p0.x, p0.y - 10);
                }
              }
            }

            corners.delete();
            ids.delete();
            parameters.delete();
          }

          src.delete();
          gray.delete();
        } catch (e) {}
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);
  };

  // 8. Soru Kontrolleri (Soruyu Başlat / Bitir / Sonraki)
  const handleStartQuestion = (idx = currentIndex) => {
    const q = questions[idx];
    if (!q) return;

    setActiveQuestion(q);
    setQuestionState('RUNNING');
    setSubmissions(new Map());

    syncEngine.emit('start_question', q);
    soundEffects.playReveal();
  };

  const handleEndQuestion = () => {
    if (!activeQuestion) return;

    setQuestionState('ENDED');
    const stats = { A: 0, B: 0, C: 0, D: 0 };
    const rawResults = {};

    submissions.forEach((val, studentId) => {
      rawResults[studentId] = val.choice;
      if (stats[val.choice] !== undefined) stats[val.choice]++;
    });

    syncEngine.emit('end_question', {
      questionId: activeQuestion.id,
      correctAnswer: activeQuestion.correctAnswer,
      results: rawResults,
      stats
    });

    soundEffects.playReveal();
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      handleStartQuestion(nextIdx);
    } else {
      setQuestionState('IDLE');
      setActiveQuestion(null);
      syncEngine.emit('reset_question', {});
    }
  };

  // 9. Telefondan Soru Dosyası Yükleme (.pdf, .xlsx, .csv, .txt)
  const handleFileUpload = async (file) => {
    if (!file) return;
    setImportStatus('Dosya işleniyor...');

    try {
      const parsed = await parseQuizFile(file);
      if (parsed && parsed.length > 0) {
        setQuestions(parsed);
        setCurrentIndex(0);
        setImportStatus(`✓ ${parsed.length} adet soru başarıyla aktarıldı.`);
        soundEffects.playReveal();
      } else {
        setImportStatus('Dosyadan soru okunamadı.');
      }
    } catch (err) {
      setImportStatus('Hata: ' + err.message);
    }
  };

  // 10. Hocanın Yeni Soru Oluşturucusu
  const handleCreateQuestion = (e) => {
    if (e) e.preventDefault();
    if (!newQuestionText.trim() || !newOptA.trim() || !newOptB.trim()) {
      alert('Lütfen en az soru metnini ve A, B şıklarını girin.');
      return;
    }

    const newQ = {
      id: Date.now(),
      text: newQuestionText.trim(),
      options: {
        A: newOptA.trim(),
        B: newOptB.trim(),
        C: newOptC.trim() || '-',
        D: newOptD.trim() || '-'
      },
      correctAnswer: newCorrectAnswer
    };

    setQuestions((prev) => [...prev, newQ]);
    setNewQuestionText('');
    setNewOptA('');
    setNewOptB('');
    setNewOptC('');
    setNewOptD('');
    setShowQuestionCreator(false);
    alert('✓ Soru havuzuna eklendi!');
  };

  // 11. Sınıf Değiştirme & Yeni Sınıf Ekleme
  const handleSelectClass = (cName) => {
    setCurrentClass(cName);
    const targetRoster = classes[cName] || {};
    setRoster(targetRoster);
    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_current_class', cName);
      localStorage.setItem('scanquiz_roster', JSON.stringify(targetRoster));
    }
    syncEngine.emit('roster_updated', targetRoster);
  };

  const handleAddClass = () => {
    const trimmed = newClassName.trim().toUpperCase();
    if (!trimmed) return;
    if (classes[trimmed]) {
      alert('Bu sınıf zaten mevcut!');
      return;
    }
    const updated = { ...classes, [trimmed]: {} };
    setClasses(updated);
    setCurrentClass(trimmed);
    setRoster({});
    setNewClassName('');
    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_classes', JSON.stringify(updated));
      localStorage.setItem('scanquiz_current_class', trimmed);
      localStorage.setItem('scanquiz_roster', JSON.stringify({}));
    }
    syncEngine.emit('roster_updated', {});
    alert(`✓ ${trimmed} sınıfı eklendi!`);
  };

  const saveRoster = (newRoster) => {
    setRoster(newRoster);
    const updated = { ...classes, [currentClass]: newRoster };
    setClasses(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_classes', JSON.stringify(updated));
      localStorage.setItem('scanquiz_roster', JSON.stringify(newRoster));
    }
    syncEngine.emit('roster_updated', newRoster);
  };

  const addStudent = () => {
    const id = parseInt(newStudentId, 10);
    const name = newStudentName.trim();
    if (!id || !name) return;

    const updated = { ...roster, [id]: name };
    saveRoster(updated);
    setNewStudentId('');
    setNewStudentName('');
  };

  const removeStudent = (id) => {
    const updated = { ...roster };
    delete updated[id];
    saveRoster(updated);
  };

  const handleBulkImport = () => {
    const lines = bulkNames.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const updated = { ...roster };
    lines.forEach((name, idx) => {
      updated[idx + 1] = name;
    });
    saveRoster(updated);
    setBulkNames('');
    alert(`${lines.length} öğrenci ${currentClass} sınıfına aktarıldı.`);
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '12px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 1. ÜST ÇUBUK: Logo, Google Giriş / Profil & Oda Durumu */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(18, 21, 31, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '12px 16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: '1.1rem', textDecoration: 'none', color: '#fff' }}>
            ScanQuiz
          </Link>
          <span style={{
            background: isPaired ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            color: isPaired ? '#34d399' : '#fbbf24',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontWeight: 700
          }}>
            {isPaired ? `Oda: ${pin}` : 'Tahtaya Bağlanın'}
          </span>
        </div>

        {/* Firebase Google Giriş / Profil Alanı */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user && user.email ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {user.photoURL && (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #3b82f6' }}
                />
              )}
              <span style={{ fontSize: '0.78rem', color: '#e5e7eb', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.displayName}
              </span>
              <button onClick={handleSignOut} className="btn btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem' }}>
                Çıkış
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#fff',
                color: '#1f2937',
                border: 'none',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.43 7.37 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.1z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.27 2.57 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
              </svg>
              Google Giriş
            </button>
          )}
        </div>
      </header>

      {/* 2. PIN BAĞLANTISI (Bağlı değilse) */}
      {!isPaired && (
        <section
          style={{
            background: 'rgba(18, 21, 31, 0.95)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '16px',
            padding: '16px',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '8px' }}>
            Akıllı tahtada görünen 6 haneli kodu girin:
          </div>
          <form onSubmit={handlePair} style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <input
              type="text"
              placeholder="Örn: 482910"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              style={{
                width: '140px',
                padding: '8px 12px',
                fontSize: '1.2rem',
                fontFamily: 'monospace',
                fontWeight: 800,
                textAlign: 'center',
                letterSpacing: '0.1em',
                background: '#0a0d14',
                border: '1px solid rgba(59, 130, 246, 0.5)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none'
              }}
              autoFocus
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>
              Bağlan
            </button>
          </form>
        </section>
      )}

      {/* 3. MOBİL SEKME MENÜSÜ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
        <button
          onClick={() => setActiveTab('camera')}
          style={{
            padding: '10px 4px',
            borderRadius: '10px',
            border: 'none',
            fontWeight: 800,
            fontSize: '0.82rem',
            cursor: 'pointer',
            background: activeTab === 'camera' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#12151f',
            color: activeTab === 'camera' ? '#fff' : '#9ca3af'
          }}
        >
          📷 Kamera Tara
        </button>
        <button
          onClick={() => setActiveTab('questions')}
          style={{
            padding: '10px 4px',
            borderRadius: '10px',
            border: 'none',
            fontWeight: 800,
            fontSize: '0.82rem',
            cursor: 'pointer',
            background: activeTab === 'questions' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#12151f',
            color: activeTab === 'questions' ? '#fff' : '#9ca3af'
          }}
        >
          📝 Sorular ({questions.length})
        </button>
        <button
          onClick={() => setActiveTab('classes')}
          style={{
            padding: '10px 4px',
            borderRadius: '10px',
            border: 'none',
            fontWeight: 800,
            fontSize: '0.82rem',
            cursor: 'pointer',
            background: activeTab === 'classes' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#12151f',
            color: activeTab === 'classes' ? '#fff' : '#9ca3af'
          }}
        >
          👥 Sınıflar ({currentClass})
        </button>
      </div>

      {/* ======================================================== */}
      {/* SEKME 1: KAMERA TARAYICI & OPTİK ARUCO MOTORU */}
      {/* ======================================================== */}
      {activeTab === 'camera' && (
        <section
          style={{
            background: 'rgba(18, 21, 31, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '14px'
          }}
        >
          {/* Kamera Başlık & Durum */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>
                Optik Kart Tarayıcı
              </span>
              <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: openCvReady ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: openCvReady ? '#34d399' : '#fbbf24', fontWeight: 700 }}>
                {openCvReady ? 'ArUco DICT_4X4_50' : 'Yükleniyor...'}
              </span>
            </div>
            {cameraActive && (
              <span style={{ background: '#10b981', color: '#fff', fontSize: '0.72rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px' }}>
                {fps} FPS
              </span>
            )}
          </div>

          {cameraError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid #ef4444', padding: '8px 12px', borderRadius: '8px', fontSize: '0.82rem', marginBottom: '10px' }}>
              {cameraError}
            </div>
          )}

          {/* Video Container */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '280px',
              background: '#000',
              borderRadius: '12px',
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
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: cameraActive ? 'block' : 'none' }}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {!cameraActive && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📷</div>
                <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '14px' }}>
                  Öğrenci kartlarını taramak için kamerayı başlatın.
                </p>
                <button
                  onClick={startCamera}
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '12px',
                    fontSize: '0.95rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
                  }}
                >
                  Kamerayı Başlat
                </button>
              </div>
            )}
          </div>

          {cameraActive && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                onClick={() => {
                  const nextMode = facingMode === 'environment' ? 'user' : 'environment';
                  setFacingMode(nextMode);
                  stopCamera();
                  setTimeout(startCamera, 200);
                }}
                className="btn btn-sm"
                style={{ flex: 1 }}
              >
                🔄 Kamera Çevir
              </button>
              <button onClick={stopCamera} className="btn btn-sm btn-danger" style={{ flex: 1 }}>
                Kamerayı Kapat
              </button>
            </div>
          )}

          {/* Son Algılanan Kartlar */}
          <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#e5e7eb' }}>
                Canlı Algılanan Yanıtlar ({recentDetections.length})
              </span>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxHeight: '110px', overflowY: 'auto' }}>
              {recentDetections.map((d, i) => (
                <div key={i} style={{ background: '#0a0d14', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
                  <strong style={{ color: '#fff' }}>#{d.studentId}</strong>
                  <span style={{ color: '#9ca3af' }}>{d.studentName}</span>
                  <span style={{ background: 'rgba(59, 130, 246, 0.25)', color: '#60a5fa', padding: '1px 6px', borderRadius: '4px', fontWeight: 900 }}>
                    {d.choice}
                  </span>
                </div>
              ))}
              {recentDetections.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                  Henüz okunan kart yok.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ======================================================== */}
      {/* SEKME 2: SORULAR, QUIZ KONTROLÜ & SORU OLUŞTURUCU */}
      {/* ======================================================== */}
      {activeTab === 'questions' && (
        <section
          style={{
            background: 'rgba(18, 21, 31, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {/* Canlı Soru Kontrol Butonları */}
          <div style={{ background: '#0a0d14', padding: '12px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className="badge badge-info">Soru {currentIndex + 1} / {questions.length}</span>
              <span className={`badge ${questionState === 'RUNNING' ? 'badge-warning' : questionState === 'ENDED' ? 'badge-success' : 'badge-info'}`}>
                {questionState === 'RUNNING' ? 'Yayında' : questionState === 'ENDED' ? 'Cevaplar Açıklandı' : 'Hazır'}
              </span>
            </div>

            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
              {questions[currentIndex]?.text}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' }}>
              {['A', 'B', 'C', 'D'].map((opt) => {
                const isCorrect = questions[currentIndex]?.correctAnswer === opt;
                return (
                  <div key={opt} style={{ padding: '6px 8px', borderRadius: '6px', background: isCorrect ? 'rgba(16, 185, 129, 0.15)' : '#12151f', border: isCorrect ? '1px solid var(--success)' : '1px solid transparent', fontSize: '0.8rem' }}>
                    <strong style={{ color: isCorrect ? 'var(--success)' : '#9ca3af' }}>{opt}: </strong>
                    <span style={{ color: '#e5e7eb' }}>{questions[currentIndex]?.options?.[opt]}</span>
                  </div>
                );
              })}
            </div>

            {/* Soru Başlat / Bitir / Sonraki */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {questionState === 'IDLE' && (
                <button onClick={() => handleStartQuestion()} className="btn btn-primary" style={{ flex: 1, padding: '10px' }}>
                  ▶ Soruyu Başlat
                </button>
              )}
              {questionState === 'RUNNING' && (
                <button onClick={handleEndQuestion} className="btn btn-warning" style={{ flex: 1, padding: '10px' }}>
                  ■ Cevapları Göster
                </button>
              )}
              {questionState === 'ENDED' && (
                <button onClick={handleNextQuestion} className="btn btn-success" style={{ flex: 1, padding: '10px' }}>
                  {currentIndex + 1 < questions.length ? 'Sonraki Soru →' : 'Tamamla'}
                </button>
              )}
            </div>
          </div>

          {/* Telefondan Dosya Yükle */}
          <div style={{ background: '#0e1017', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
              📁 Telefondan Soru Dosyası Yükle
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.csv,.xlsx,.xls,.txt"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => fileInputRef.current?.click()} className="btn btn-sm btn-primary" style={{ flex: 1 }}>
                Dosya Seç (.pdf / .xlsx / .csv)
              </button>
              <button
                onClick={() => setShowQuestionCreator(!showQuestionCreator)}
                className="btn btn-sm btn-success"
              >
                + Manuel Soru Yaz
              </button>
            </div>
            {importStatus && (
              <div style={{ marginTop: '8px', fontSize: '0.78rem', color: importStatus.startsWith('✓') ? '#34d399' : '#f87171' }}>
                {importStatus}
              </div>
            )}
          </div>

          {/* Hocanın Manuel Soru Oluşturucusu Formu */}
          {showQuestionCreator && (
            <form onSubmit={handleCreateQuestion} style={{ background: '#0a0d14', padding: '14px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.4)' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
                ✏️ Yeni Soru Oluştur
              </div>
              <textarea
                rows={2}
                placeholder="Soru metnini yazın..."
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                className="input"
                style={{ width: '100%', marginBottom: '8px', fontSize: '0.85rem' }}
                required
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="A Şıkkı"
                  value={newOptA}
                  onChange={(e) => setNewOptA(e.target.value)}
                  className="input"
                  style={{ fontSize: '0.82rem' }}
                  required
                />
                <input
                  type="text"
                  placeholder="B Şıkkı"
                  value={newOptB}
                  onChange={(e) => setNewOptB(e.target.value)}
                  className="input"
                  style={{ fontSize: '0.82rem' }}
                  required
                />
                <input
                  type="text"
                  placeholder="C Şıkkı"
                  value={newOptC}
                  onChange={(e) => setNewOptC(e.target.value)}
                  className="input"
                  style={{ fontSize: '0.82rem' }}
                />
                <input
                  type="text"
                  placeholder="D Şıkkı"
                  value={newOptD}
                  onChange={(e) => setNewOptD(e.target.value)}
                  className="input"
                  style={{ fontSize: '0.82rem' }}
                />
              </div>

              {/* Doğru Cevap Seçimi */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Doğru Cevap:</span>
                {['A', 'B', 'C', 'D'].map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setNewCorrectAnswer(ch)}
                    style={{
                      background: newCorrectAnswer === ch ? '#10b981' : '#1f2433',
                      color: '#fff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="submit" className="btn btn-sm btn-primary" style={{ flex: 1 }}>
                  ✓ Soru Havuzuna Ekle
                </button>
                <button type="button" onClick={() => setShowQuestionCreator(false)} className="btn btn-sm">
                  İptal
                </button>
              </div>
            </form>
          )}

          {/* Soru Listesi */}
          <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {questions.map((q, idx) => (
              <div
                key={q.id || idx}
                onClick={() => setCurrentIndex(idx)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: idx === currentIndex ? 'rgba(59, 130, 246, 0.15)' : '#0e1017',
                  border: idx === currentIndex ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{ fontSize: '0.82rem', color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                  <strong>#{idx + 1}</strong> {q.text}
                </span>
                <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                  {q.correctAnswer}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ======================================================== */}
      {/* SEKME 3: SINIF YÖNETİMİ & ÖĞRENCİ LİSTESİ */}
      {/* ======================================================== */}
      {activeTab === 'classes' && (
        <section
          style={{
            background: 'rgba(18, 21, 31, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {/* Sınıf Seçimi ve Yeni Sınıf Ekle */}
          <div style={{ background: '#0a0d14', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff' }}>Aktif Sınıf:</span>
              <select
                value={currentClass}
                onChange={(e) => handleSelectClass(e.target.value)}
                className="input"
                style={{ padding: '6px 10px', fontSize: '0.85rem', fontWeight: 700 }}
              >
                {Object.keys(classes).map((cName) => (
                  <option key={cName} value={cName}>
                    {cName} ({Object.keys(classes[cName] || {}).length} Öğrenci)
                  </option>
                ))}
              </select>
            </div>

            {/* Yeni Sınıf Aç */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="Yeni Sınıf (Örn: 10-C)"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                className="input"
                style={{ flex: 1, padding: '6px 8px', fontSize: '0.82rem' }}
              />
              <button onClick={handleAddClass} className="btn btn-sm btn-primary">
                + Sınıf Ekle
              </button>
            </div>
          </div>

          {/* Tekli Öğrenci Ekle */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="number"
              placeholder="Kart No (1-50)"
              value={newStudentId}
              onChange={(e) => setNewStudentId(e.target.value)}
              className="input"
              style={{ width: '100px', fontSize: '0.82rem' }}
            />
            <input
              type="text"
              placeholder="Öğrenci Adı Soyadı"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              className="input"
              style={{ flex: 1, fontSize: '0.82rem' }}
            />
            <button onClick={addStudent} className="btn btn-sm btn-success">
              + Ekle
            </button>
          </div>

          {/* Mevcut Sınıf Öğrenci Listesi */}
          <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(roster).sort(([a],[b]) => parseInt(a)-parseInt(b)).map(([sId, sName]) => (
              <div key={sId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: '#0e1017', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span><strong style={{ color: 'var(--primary)' }}>#{sId}: </strong>{sName}</span>
                <button onClick={() => removeStudent(sId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px 4px' }}>✕</button>
              </div>
            ))}
            {Object.keys(roster).length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '14px', color: '#6b7280', fontSize: '0.8rem' }}>
                Bu sınıfta henüz öğrenci yok.
              </div>
            )}
          </div>

          {/* Toplu Yapıştırma */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '4px' }}>
              Toplu İsim Yapıştır (Alt alta):
            </div>
            <textarea
              rows={2}
              value={bulkNames}
              onChange={(e) => setBulkNames(e.target.value)}
              placeholder="Ali Yılmaz&#10;Ayşe Kaya"
              className="input"
              style={{ width: '100%', fontSize: '0.8rem', marginBottom: '6px' }}
            />
            <button onClick={handleBulkImport} className="btn btn-sm btn-primary" style={{ width: '100%' }}>
              {currentClass} Sınıfına Toplu Ekle
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
