'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from '@/lib/firebase';
import { syncEngine } from '@/lib/sync-engine';
import { requestCameraWithGesture, configureVideoForIOS } from '@/lib/ios-safari-compat';
import { soundEffects } from '@/lib/sound-effects';
import { parseQuizFile } from '@/lib/file-parser';
import { detectArucoMarkers } from '@/lib/aruco-detector';
import { saveUserDataToCloud, loadUserDataFromCloud } from '@/lib/user-data-sync';

// Varsayılan Test Setleri (Sonsuz test desteği)
const INITIAL_TESTS = [
  {
    id: 'test_1',
    name: '8. Sınıf Fen & Genel Kültür',
    questions: [
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
    ]
  },
  {
    id: 'test_2',
    name: '8. Sınıf Matematik & Mantık',
    questions: [
      {
        id: 1,
        text: 'Karekök 144 sayısı aşağıdakilerden hangisine eşittir?',
        options: { A: '10', B: '12', C: '14', D: '16' },
        correctAnswer: 'B'
      },
      {
        id: 2,
        text: 'Bir üçgenin iç açıları toplamı kaç derecedir?',
        options: { A: '90°', B: '180°', C: '270°', D: '360°' },
        correctAnswer: 'B'
      }
    ]
  }
];

// Varsayılan Sınıflar (8/A, 8/B ve Hoca İsimleri)
const INITIAL_CLASSES = {
  '8/A': {
    name: '8/A',
    teacherName: 'Mehmet Hoca',
    students: {
      1: 'Ali Yılmaz', 2: 'Ayşe Kaya', 3: 'Mehmet Demir', 4: 'Zeynep Bal', 5: 'Can Sarı',
      6: 'Burak Şen', 7: 'Elif Yıldız', 8: 'Emre Ak', 9: 'Gamze Kara', 10: 'Oğuzhan Tekin'
    }
  },
  '8/B': {
    name: '8/B',
    teacherName: 'Fatma Hoca',
    students: {
      1: 'Ahmet Çelik', 2: 'Büşra Aydın', 3: 'Cemre Koç', 4: 'Deniz Şahin', 5: 'Ece Yavuz',
      6: 'Furkan Güler', 7: 'Gizem Doğan', 8: 'Hakan Polat', 9: 'İrem Aslan', 10: 'Kaan Taş'
    }
  },
  '9/A': {
    name: '9/A',
    teacherName: 'Ahmet Hoca',
    students: {
      1: 'Murat Öz', 2: 'Seda Kurt', 3: 'Tolga Çetin', 4: 'Yagmur Er', 5: 'Zeki Can'
    }
  }
};

export default function OgretmenScannerPage() {
  // 1. Firebase Google Auth
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rememberMe, setRememberMe] = useState(true); // "Oturumum açık kalsın"
  const [authError, setAuthError] = useState(null); // Firebase auth hata bildirimi
  const [copiedDomain, setCopiedDomain] = useState(false);

  // 2. PIN & Tahta Eşleşmesi
  const [pin, setPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);

  // 3. Mobil Sekmesi ('camera' | 'questions' | 'classes' | 'summary')
  const [activeTab, setActiveTab] = useState('camera');

  // 4. Kamera & ArUco Algılayıcı
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [openCvReady, setOpenCvReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [recentDetections, setRecentDetections] = useState([]);
  const [facingMode, setFacingMode] = useState('environment');

  // 5. Sonsuz Test Yönetimi & Soru Havuzu
  const [tests, setTests] = useState(INITIAL_TESTS);
  const [activeTestId, setActiveTestId] = useState('test_1');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionState, setQuestionState] = useState('IDLE'); // 'IDLE' | 'RUNNING' | 'ENDED'
  const [submissions, setSubmissions] = useState(new Map());
  const [importStatus, setImportStatus] = useState('');
  
  // Test Geçmişi & Kümülatif Sonuçlar (Test Sonu Raporu için)
  const [testQuestionResults, setTestQuestionResults] = useState({}); // { [qId]: { results, correctAnswer, stats } }
  const [quizSummary, setQuizSummary] = useState(null);

  // Yeni Test Ekleme Modal / State
  const [showNewTestModal, setShowNewTestModal] = useState(false);
  const [newTestTitle, setNewTestTitle] = useState('');

  // Yeni Soru Form State
  const [showQuestionCreator, setShowQuestionCreator] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptA, setNewOptA] = useState('');
  const [newOptB, setNewOptB] = useState('');
  const [newOptC, setNewOptC] = useState('');
  const [newOptD, setNewOptD] = useState('');
  const [newCorrectAnswer, setNewCorrectAnswer] = useState('A');

  // 6. Sınıflar (8/A, 8/B) ve Hoca İsimleri
  const [classes, setClasses] = useState(INITIAL_CLASSES);
  const [currentClassKey, setCurrentClassKey] = useState('8/A');
  const [currentTeacherName, setCurrentTeacherName] = useState('Mehmet Hoca');
  const [newClassName, setNewClassName] = useState('');
  const [newTeacherInput, setNewTeacherInput] = useState('');
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

  // Aktif test soruları
  const activeTest = tests.find(t => t.id === activeTestId) || tests[0] || { questions: [] };
  const currentQuestions = activeTest.questions || [];
  const currentRoster = classes[currentClassKey]?.students || {};

  // 1. Firebase Auth Listener & Mobil Redirect Sonucu
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    // Redirect sonucunu kontrol et (mobil yönlendirmeden sonra)
    getRedirectResult(auth).then((result) => {
      if (result && result.user) {
        const fbUser = result.user;
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Öğretmen',
          photoURL: fbUser.photoURL
        });
      }
    }).catch((err) => {
      console.warn('Redirect auth result:', err.message);
    });

    // Auth durumunu dinle — giriş/çıkış/yeniden yükleme
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Öğretmen',
          photoURL: fbUser.photoURL
        });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    // Güvenlik: 6 saniye içinde auth yanıt vermezse loading'i kapat
    const fallback = setTimeout(() => setAuthLoading(false), 6000);

    return () => {
      unsub();
      clearTimeout(fallback);
    };
  }, []);

  // Google Girişinden Sonra Kullanıcının Buluttaki Testlerini ve Sınıflarını Yükle
  useEffect(() => {
    if (user && user.id) {
      loadUserDataFromCloud(user.id).then((cloudData) => {
        if (cloudData.tests && cloudData.tests.length > 0) {
          setTests(cloudData.tests);
          if (cloudData.activeTestId) setActiveTestId(cloudData.activeTestId);
        }
        if (cloudData.classes && Object.keys(cloudData.classes).length > 0) {
          setClasses(cloudData.classes);
          const firstKey = Object.keys(cloudData.classes)[0];
          setCurrentClassKey(firstKey);
          setCurrentTeacherName(cloudData.classes[firstKey]?.teacherName || 'Ders Öğretmeni');
        }
      });
    }
  }, [user?.id]);

  // Google ile Giriş Yap (Tüm Cihazlarda Güvenli Popup + Fallback)
  const handleGoogleLogin = async () => {
    setAuthError(null);
    if (!auth) {
      setAuthError({
        code: 'no-auth',
        message: 'Firebase başlatılamadı. Lütfen internet bağlantınızı kontrol edip sayfayı yenileyin.',
        domain: typeof window !== 'undefined' ? window.location.hostname : ''
      });
      return;
    }

    try {
      // Oturum kalıcılığını ayarla
      const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
      await setPersistence(auth, persistence);

      // Popup ile giriş yap (modern masaüstü ve mobilde en sorunsuz yöntem)
      const result = await signInWithPopup(auth, googleProvider);
      if (result && result.user) {
        const fbUser = result.user;
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Öğretmen',
          photoURL: fbUser.photoURL
        });
        setAuthError(null);
      }
    } catch (err) {
      console.error('Google giriş hatası:', err);
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (err.code === 'auth/unauthorized-domain') {
        setAuthError({
          code: 'auth/unauthorized-domain',
          domain: host,
          message: `Firebase Güvenlik Kuralı: "${host}" adresi Firebase Console'da yetkili alan adları (Authorized Domains) listesinde bulunmuyor.`
        });
      } else if (err.code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (redirErr) {
          setAuthError({
            code: redirErr.code,
            domain: host,
            message: redirErr.message || 'Yönlendirme ile giriş yapılamadı.'
          });
        }
      } else if (err.code === 'auth/popup-closed-by-user') {
        // Kullanıcı popup'ı kapattı
      } else {
        setAuthError({
          code: err.code || 'unknown',
          domain: host,
          message: err.message || 'Giriş yapılırken beklenmedik bir hata oluştu.'
        });
      }
    }
  };

  // Firebase yetkilendirmesi yapılana kadar öğretmenlerin hemen başlamasını sağlayan Hızlı Giriş Modu
  const handleDevLogin = () => {
    setUser({
      id: 'teacher_' + Math.random().toString(36).substring(2, 9),
      email: 'ogretmen@scanquiz.local',
      displayName: 'Öğretmen (Hızlı Test)',
      photoURL: null
    });
    setAuthError(null);
  };

  const handleSignOut = async () => {
    if (auth) {
      try { await fbSignOut(auth); } catch (e) {}
    }
    setUser(null);
  };

  // URL'den PIN parametresi varsa otomatik doldur
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlPin = urlParams.get('pin');
      if (urlPin && urlPin.length >= 4) {
        setPin(urlPin);
      }
    }
  }, []);

  // Tahtadan ACK gelirse eşleşmeyi onayla
  useEffect(() => {
    const unsubAck = syncEngine.on('board_ack', () => {
      setIsPaired(true);
    });
    return () => unsubAck();
  }, []);

  // OpenCV.js Yükleme
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
      // Hızlı, global CDN üzerinden yükle
      script.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js';
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
        // Hızlı fallback
        const alt = document.createElement('script');
        alt.src = 'https://cdnjs.cloudflare.com/ajax/libs/opencv.js/4.8.0/opencv.min.js';
        alt.async = true;
        alt.onload = () => {
          if (window.cv && window.cv.Mat) {
            cvRef.current = window.cv;
            setOpenCvReady(true);
          }
        };
        alt.onerror = () => setOpenCvReady(true); // Pure JS ile çalış
        document.body.appendChild(alt);
      };
      document.body.appendChild(script);

      // Güvenlik timeout: 4 sn içinde OpenCV inmezse kamerayı kilitleme, Pure JS motoruyla anında başlat
      setTimeout(() => {
        setOpenCvReady(true);
      }, 4000);
    } else if (window.cv && window.cv.Mat) {
      cvRef.current = window.cv;
      setOpenCvReady(true);
    }
  }, []);

  // PIN ile Tahtaya Bağlanma (Garanti İletim Burst)
  const handlePair = (e) => {
    if (e) e.preventDefault();
    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      alert('Lütfen akıllı tahtada görünen 6 haneli PIN kodunu girin.');
      return;
    }

    syncEngine.setRoom(cleanPin);
    syncEngine.emitReliable('host_paired', {
      teacherId: user?.id,
      className: currentClassKey,
      teacherName: currentTeacherName,
      timestamp: Date.now()
    }, 5, 400);

    // Sınıf listesini de tahtaya hemen gönder
    syncEngine.emit('roster_updated', {
      className: currentClassKey,
      teacherName: currentTeacherName,
      roster: currentRoster
    });

    setIsPaired(true);
    soundEffects.playSubmit();
  };

  // Kamera Başlat / Durdur
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
      setCameraError(err.message || 'Kameraya erişilemedi. Tarayıcı kamera izinlerini kontrol edin.');
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

  // ArUco Kartı Algılandığında Tetiklenen Callback
  const recordDetection = useCallback((studentId, choice, angle) => {
    const now = Date.now();
    const last = scannedDebounceRef.current.get(studentId) || 0;
    if (now - last < 800) return; // 800ms debounce — çok hızlı tekrar taramayı önler
    scannedDebounceRef.current.set(studentId, now);

    // Tahtaya Realtime olarak yayınla (soru aktif olmasa bile — tahta kendi filtreler)
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

    const studentName = currentRoster[studentId] || `Öğrenci #${studentId}`;
    setRecentDetections((prev) => [
      { studentId, studentName, choice, angle: Math.round(angle), time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 7)
    ]);
  }, [currentRoster]);

  // Bilgisayarla Görü Döngüsü (ArUco DICT_4X4_50)
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

      // ArUco Kart Algılama Motoru (OpenCV Kontur + Perspektif Warp / Pure JS)
      try {
        const detections = detectArucoMarkers(canvas, cvRef.current);
        if (detections && detections.length > 0) {
          detections.forEach((det) => {
            recordDetection(det.studentId, det.choice, det.angle);

            // Kameranın üzerinde yeşil kare ve şık etiketi çiz
            if (overlayCtx && det.corners && det.corners.length === 4) {
              overlayCtx.strokeStyle = '#10b981';
              overlayCtx.lineWidth = 3;
              overlayCtx.beginPath();
              overlayCtx.moveTo(det.corners[0].x, det.corners[0].y);
              overlayCtx.lineTo(det.corners[1].x, det.corners[1].y);
              overlayCtx.lineTo(det.corners[2].x, det.corners[2].y);
              overlayCtx.lineTo(det.corners[3].x, det.corners[3].y);
              overlayCtx.closePath();
              overlayCtx.stroke();

              // Etiket Kutusu
              overlayCtx.fillStyle = '#10b981';
              overlayCtx.font = 'bold 16px sans-serif';
              overlayCtx.fillText(`#${det.studentId} [${det.choice}]`, det.corners[0].x, Math.max(20, det.corners[0].y - 8));
            }
          });
        }
      } catch (err) {
        // Algılama hatası olsa bile kamerayı kilitleme
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);
  };

  // Soru Kontrolleri
  const handleStartQuestion = (idx = currentIndex) => {
    const q = currentQuestions[idx];
    if (!q) return;

    if (!isPaired) {
      if (pin && pin.trim().length >= 4) {
        // PIN zaten girilmişse tahtayı otomatik bağla ve odayı kur
        const cleanPin = pin.trim();
        syncEngine.setRoom(cleanPin);
        syncEngine.emitReliable('host_paired', {
          teacherId: user?.id,
          className: currentClassKey,
          teacherName: currentTeacherName,
          timestamp: Date.now()
        }, 4, 300);
        setIsPaired(true);
      } else {
        const entered = typeof window !== 'undefined' ? window.prompt('Soruyu tahtaya yansıtmak için lütfen akıllı tahtadaki 6 haneli PIN kodunu girin:') : null;
        if (entered && entered.trim().length >= 4) {
          const clean = entered.trim();
          setPin(clean);
          syncEngine.setRoom(clean);
          syncEngine.emitReliable('host_paired', {
            teacherId: user?.id,
            className: currentClassKey,
            teacherName: currentTeacherName,
            timestamp: Date.now()
          }, 4, 300);
          setIsPaired(true);
        } else {
          console.warn('Tahta PIN kodu girilmedi, soru yalnızca telefonda başlatıldı.');
        }
      }
    }

    setActiveQuestion(q);
    setQuestionState('RUNNING');
    setSubmissions(new Map());

    // emitReliable: Tahtaya soruyu 4 burst ile garanti ulaştır
    syncEngine.emitReliable('start_question', q, 4, 400);
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

    // Bu sorunun sonuçlarını kümülatif hafızaya kaydet (test sonu raporu için)
    setTestQuestionResults((prev) => ({
      ...prev,
      [activeQuestion.id]: {
        questionId: activeQuestion.id,
        text: activeQuestion.text,
        correctAnswer: activeQuestion.correctAnswer,
        options: activeQuestion.options,
        results: rawResults,
        stats
      }
    }));

    // emitReliable: tahta cevapları kesinlikle alsın
    syncEngine.emitReliable('end_question', {
      questionId: activeQuestion.id,
      correctAnswer: activeQuestion.correctAnswer,
      results: rawResults,
      stats
    }, 3, 500);

    soundEffects.playReveal();
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < currentQuestions.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      handleStartQuestion(nextIdx);
    } else {
      // Test bitti -> otomatik özet raporu hazırla
      handleCompleteQuiz();
    }
  };

  // TESTİ BİTİR & ŞAMPİYONLAR PODYUMUNU TAHTAYA YANSIT
  const handleCompleteQuiz = () => {
    setQuestionState('IDLE');
    setActiveQuestion(null);

    // Kümülatif Sonuçları Analiz Et
    const studentScores = {}; // { [studentId]: { correct: 0, wrong: 0, total: 0 } }
    const questionAnalytics = [];

    // Tüm öğrencileri listele
    Object.keys(currentRoster).forEach((sId) => {
      studentScores[sId] = { correct: 0, wrong: 0, total: 0 };
    });

    const recordedQIds = Object.keys(testQuestionResults);
    recordedQIds.forEach((qId) => {
      const qData = testQuestionResults[qId];
      const correctAns = qData.correctAnswer;
      let qCorrectCount = 0;
      let qWrongCount = 0;
      const wrongDistractors = { A: 0, B: 0, C: 0, D: 0 };

      Object.entries(qData.results || {}).forEach(([sId, chosenOpt]) => {
        if (!studentScores[sId]) studentScores[sId] = { correct: 0, wrong: 0, total: 0 };
        studentScores[sId].total++;

        if (chosenOpt === correctAns) {
          studentScores[sId].correct++;
          qCorrectCount++;
        } else {
          studentScores[sId].wrong++;
          qWrongCount++;
          if (wrongDistractors[chosenOpt] !== undefined) {
            wrongDistractors[chosenOpt]++;
          }
        }
      });

      // En çok düşülen çeldirici
      let mostCommonWrong = null;
      let maxDistractorCount = 0;
      ['A', 'B', 'C', 'D'].forEach((opt) => {
        if (opt !== correctAns && wrongDistractors[opt] > maxDistractorCount) {
          maxDistractorCount = wrongDistractors[opt];
          mostCommonWrong = opt;
        }
      });

      const totalQAnswers = qCorrectCount + qWrongCount;
      const successPct = totalQAnswers > 0 ? Math.round((qCorrectCount / totalQAnswers) * 100) : 0;
      const failurePct = 100 - successPct;

      questionAnalytics.push({
        questionId: qData.questionId,
        text: qData.text,
        correctAnswer: correctAns,
        correctCount: qCorrectCount,
        wrongCount: qWrongCount,
        successPct,
        failurePct,
        mostCommonWrongChoice: mostCommonWrong
      });
    });

    // 1. Şampiyonlar (En çok doğru yapanlar)
    const sortedStudents = Object.entries(studentScores).map(([sId, data]) => ({
      studentId: Number(sId),
      studentName: currentRoster[sId] || `Öğrenci #${sId}`,
      correctCount: data.correct,
      wrongCount: data.wrong,
      accuracyPct: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
    })).sort((a, b) => b.correctCount - a.correctCount || a.wrongCount - b.wrongCount);

    const topStudents = sortedStudents.slice(0, 3);
    const bottomStudents = [...sortedStudents].sort((a, b) => b.wrongCount - a.wrongCount).filter(s => s.wrongCount > 0).slice(0, 3);

    // 2. En Kolay ve En Zor Sorular
    const mostCorrectQuestions = [...questionAnalytics].sort((a, b) => b.successPct - a.successPct).slice(0, 3);
    const mostWrongQuestions = [...questionAnalytics].sort((a, b) => b.failurePct - a.failurePct).filter(q => q.wrongCount > 0).slice(0, 3);

    const summaryPayload = {
      testTitle: activeTest.name,
      totalQuestions: recordedQIds.length,
      topStudents,
      bottomStudents,
      mostCorrectQuestions,
      mostWrongQuestions,
      timestamp: Date.now()
    };

    setQuizSummary(summaryPayload);
    setActiveTab('summary');

    // Tahtaya Podyum Raporunu fırlat
    syncEngine.emitReliable('quiz_completed', summaryPayload, 4, 400);
    soundEffects.playReveal();

    // Kullanıcı geçmişine kaydet
    if (user?.id) {
      saveUserDataToCloud(user.id, {
        history: [summaryPayload]
      });
    }
  };

  // Yeni Test Ekleme
  const handleCreateTest = (e) => {
    if (e) e.preventDefault();
    const title = newTestTitle.trim();
    if (!title) return;

    const newTest = {
      id: 'test_' + Date.now(),
      name: title,
      questions: []
    };

    const updatedTests = [...tests, newTest];
    setTests(updatedTests);
    setActiveTestId(newTest.id);
    setNewTestTitle('');
    setShowNewTestModal(false);

    saveUserDataToCloud(user?.id, { tests: updatedTests, activeTestId: newTest.id });
    alert(`✓ "${title}" testi oluşturuldu. Şimdi soru ekleyebilirsiniz!`);
  };

  // Dosyadan Soru Yükleme
  const handleFileUpload = async (file) => {
    if (!file) return;
    setImportStatus('Dosya okunuyor...');

    try {
      const parsed = await parseQuizFile(file);
      if (parsed && parsed.length > 0) {
        const updatedTests = tests.map((t) => {
          if (t.id === activeTestId) {
            return { ...t, questions: [...t.questions, ...parsed] };
          }
          return t;
        });
        setTests(updatedTests);
        setImportStatus(`✓ ${parsed.length} soru "${activeTest.name}" testine eklendi.`);
        saveUserDataToCloud(user?.id, { tests: updatedTests });
        soundEffects.playReveal();
      } else {
        setImportStatus('Dosyadan soru okunamadı.');
      }
    } catch (err) {
      setImportStatus('Hata: ' + err.message);
    }
  };

  // Manuel Soru Oluşturma
  const handleCreateQuestion = (e) => {
    if (e) e.preventDefault();
    if (!newQuestionText.trim() || !newOptA.trim() || !newOptB.trim()) {
      alert('Lütfen en az soru metnini ve A, B şıklarını doldurun.');
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

    const updatedTests = tests.map((t) => {
      if (t.id === activeTestId) {
        return { ...t, questions: [...t.questions, newQ] };
      }
      return t;
    });

    setTests(updatedTests);
    saveUserDataToCloud(user?.id, { tests: updatedTests });

    setNewQuestionText('');
    setNewOptA('');
    setNewOptB('');
    setNewOptC('');
    setNewOptD('');
    setShowQuestionCreator(false);
    alert('✓ Soru mevcut teste eklendi ve Google hesabınıza kaydedildi!');
  };

  // Sınıf Değiştirme
  const handleSelectClass = (cKey) => {
    setCurrentClassKey(cKey);
    const target = classes[cKey] || { name: cKey, teacherName: '', students: {} };
    setCurrentTeacherName(target.teacherName || '');

    syncEngine.emit('roster_updated', {
      className: target.name || cKey,
      teacherName: target.teacherName || '',
      roster: target.students || {}
    });
  };

  // Hoca Adını Güncelleme
  const handleUpdateTeacherName = (name) => {
    setCurrentTeacherName(name);
    const updated = {
      ...classes,
      [currentClassKey]: {
        ...classes[currentClassKey],
        teacherName: name
      }
    };
    setClasses(updated);
    saveUserDataToCloud(user?.id, { classes: updated });

    syncEngine.emit('roster_updated', {
      className: currentClassKey,
      teacherName: name,
      roster: currentRoster
    });
  };

  // Yeni Sınıf Ekleme (örn: 8/C)
  const handleAddClass = () => {
    const trimmed = newClassName.trim().toUpperCase();
    if (!trimmed) return;
    if (classes[trimmed]) {
      alert('Bu sınıf zaten mevcut!');
      return;
    }

    const updated = {
      ...classes,
      [trimmed]: {
        name: trimmed,
        teacherName: newTeacherInput.trim() || currentTeacherName,
        students: {}
      }
    };

    setClasses(updated);
    setCurrentClassKey(trimmed);
    setCurrentTeacherName(newTeacherInput.trim() || currentTeacherName);
    setNewClassName('');
    setNewTeacherInput('');

    saveUserDataToCloud(user?.id, { classes: updated });
    syncEngine.emit('roster_updated', {
      className: trimmed,
      teacherName: newTeacherInput.trim() || currentTeacherName,
      roster: {}
    });
    alert(`✓ ${trimmed} sınıfı eklendi!`);
  };

  // Öğrenci Ekleme
  const addStudent = () => {
    const id = parseInt(newStudentId, 10);
    const name = newStudentName.trim();
    if (!id || !name) return;

    const updatedStudents = { ...currentRoster, [id]: name };
    const updatedClasses = {
      ...classes,
      [currentClassKey]: {
        ...classes[currentClassKey],
        students: updatedStudents
      }
    };

    setClasses(updatedClasses);
    saveUserDataToCloud(user?.id, { classes: updatedClasses });
    syncEngine.emit('roster_updated', {
      className: currentClassKey,
      teacherName: currentTeacherName,
      roster: updatedStudents
    });

    setNewStudentId('');
    setNewStudentName('');
  };

  // Toplu Öğrenci Yapıştırma
  const handleBulkImport = () => {
    const lines = bulkNames.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const updatedStudents = { ...currentRoster };
    lines.forEach((name, idx) => {
      updatedStudents[idx + 1] = name;
    });

    const updatedClasses = {
      ...classes,
      [currentClassKey]: {
        ...classes[currentClassKey],
        students: updatedStudents
      }
    };

    setClasses(updatedClasses);
    saveUserDataToCloud(user?.id, { classes: updatedClasses });
    syncEngine.emit('roster_updated', {
      className: currentClassKey,
      teacherName: currentTeacherName,
      roster: updatedStudents
    });

    setBulkNames('');
    alert(`✓ ${lines.length} öğrenci ${currentClassKey} sınıfına aktarıldı.`);
  };

  // Katılım Hesaplama
  const allStudentIds = Object.keys(currentRoster).map(Number);
  const pendingStudents = allStudentIds.filter(id => !submissions.has(id));
  const answeredCount = submissions.size;
  const pendingCount = pendingStudents.length;

  // GOOGLE LOGIN GATE (Oturum açılmadıysa zorunlu giriş ekranı)
  if (!user && !authLoading) {
    return (
      <div style={{
        maxWidth: '440px',
        margin: '40px auto',
        padding: '24px 20px',
        minHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center'
      }}>
        <div className="panel" style={{
          padding: '40px 28px',
          width: '100%',
          border: '2px solid rgba(59, 130, 246, 0.35)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.8rem',
            margin: '0 auto 20px',
            boxShadow: '0 0 24px rgba(59, 130, 246, 0.5)'
          }}>
            🎓
          </div>

          <h1 style={{ fontSize: '1.7rem', fontWeight: 900, color: '#fff', marginBottom: '8px' }}>
            Öğretmen Paneli
          </h1>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '28px', lineHeight: 1.6 }}>
            Testleriniz, sınıf listeleriniz ve geçmiş raporlarınız Google hesabınıza bağlı olarak tüm cihazlarda hazır gelir. Hesabınız yoksa ilk girişte otomatik oluşturulur.
          </p>

          <button
            id="btn-google-login"
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
              borderRadius: '12px',
              padding: '14px 20px',
              fontSize: '1rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(255, 255, 255, 0.15)',
              marginBottom: '18px',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(255,255,255,0.15)'; }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.43 7.37 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.1z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.27 2.57 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
            </svg>
            Google ile Giriş Yap
          </button>

          {/* Oturumum açık kalsın checkbox */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            userSelect: 'none',
            marginBottom: '20px'
          }}>
            <input
              type="checkbox"
              id="remember-me-check"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
              style={{
                width: '16px',
                height: '16px',
                accentColor: '#3b82f6',
                cursor: 'pointer'
              }}
            />
            Oturumumu açık tut
          </label>

          {/* Firebase Yetki Hatası Rehberi (Eğer auth/unauthorized-domain oluşursa) */}
          {authError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
              textAlign: 'left',
              fontSize: '0.85rem',
              color: '#fca5a5'
            }}>
              <div style={{ fontWeight: 800, color: '#ef4444', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚠️ Firebase Alan Adı İzni Gerekli
              </div>
              <p style={{ margin: '0 0 10px 0', lineHeight: 1.5, color: '#e5e7eb' }}>
                Google güvenliği nedeniyle <strong>{authError.domain}</strong> alan adının Firebase Authentication yetkili alan adlarına eklenmesi gerekmektedir:
              </p>
              
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  readOnly
                  value={authError.domain}
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    color: '#38bdf8',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem'
                  }}
                />
                <button
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(authError.domain);
                      setCopiedDomain(true);
                      setTimeout(() => setCopiedDomain(false), 2500);
                    }
                  }}
                  style={{
                    background: copiedDomain ? '#10b981' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {copiedDomain ? '✓ Kopyalandı' : '📋 Kopyala'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <a
                  href="https://console.firebase.google.com/project/scanquiz-1f5e3/authentication/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '0.78rem'
                  }}
                >
                  🔗 Firebase Console Ayarları Aç ↗
                </a>
              </div>
            </div>
          )}

          {/* Hızlı Test Girişi (Firebase ayarını beklemeden anında test etmek için) */}
          <div style={{
            paddingTop: '16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <button
              onClick={handleDevLogin}
              style={{
                width: '100%',
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#60a5fa',
                border: '1px dashed rgba(59, 130, 246, 0.4)',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.22)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.12)'; }}
            >
              ⚡ Hızlı Test Girişi (Öğretmen Modu)
            </button>
            <div style={{ fontSize: '0.74rem', color: '#6b7280', marginTop: '6px' }}>
              Firebase alan adı onayını beklemeden kamera ve test özelliklerini hemen deneyebilirsiniz.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '12px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 1. ÜST ÇUBUK: Profil, Sınıf & Tahta PIN Eşleşme */}
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
            {isPaired ? `Oda: ${pin}` : 'Tahta Bekleniyor'}
          </span>
        </div>

        {/* Kullanıcı Profili & Çıkış */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user?.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName}
              style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #3b82f6' }}
            />
          )}
          <span style={{ fontSize: '0.78rem', color: '#e5e7eb', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.displayName || user?.email?.split('@')[0] || 'Öğretmen'}
          </span>
          <button
            onClick={handleSignOut}
            className="btn btn-sm"
            style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'rgba(255,255,255,0.06)' }}
          >
            Çıkış
          </button>
        </div>
      </header>

      {/* 2. TAHTA PIN EŞLEŞTİRME KUTUSU (Bağlı değilse) */}
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

      {/* 3. MOBİL DÖRT SEKMELİ GEZİNME MENÜSÜ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        {[
          { key: 'camera', label: '📷 Kamera' },
          { key: 'questions', label: '📝 Testler' },
          { key: 'classes', label: '🏫 Sınıflar' },
          { key: 'summary', label: '🏆 Rapor' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 4px',
              borderRadius: '10px',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.78rem',
              cursor: 'pointer',
              background: activeTab === tab.key ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#12151f',
              color: activeTab === tab.key ? '#fff' : '#9ca3af',
              boxShadow: activeTab === tab.key ? '0 2px 10px rgba(59, 130, 246, 0.3)' : 'none'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SEKME 1: KAMERA TARAYICI & CANLI SORU KONTROLÜ */}
      {activeTab === 'camera' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Kamera Canlı Önizleme */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: '280px',
            background: '#000',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '2px solid rgba(59, 130, 246, 0.3)'
          }}>
            <video
              ref={videoRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              playsInline
              muted
            />
            <canvas
              ref={overlayCanvasRef}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />

            {!cameraActive && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(10, 13, 20, 0.85)',
                color: '#fff',
                padding: '20px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '10px' }}>📸</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px' }}>
                  Kamera Başlatılmadı
                </div>
                <button onClick={startCamera} className="btn btn-primary" style={{ padding: '10px 20px', fontSize: '0.9rem' }}>
                  Kamerayı Aç
                </button>
              </div>
            )}

            {cameraActive && (
              <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                right: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                pointerEvents: 'none'
              }}>
                <span className="badge badge-success" style={{ fontSize: '0.72rem', pointerEvents: 'auto' }}>
                  FPS: {fps} | ArUco Aktif
                </span>
                <button
                  onClick={stopCamera}
                  className="btn btn-sm"
                  style={{ pointerEvents: 'auto', background: 'rgba(239, 68, 68, 0.85)', color: '#fff', fontSize: '0.72rem', padding: '4px 10px' }}
                >
                  Kapat
                </button>
              </div>
            )}
          </div>

          {cameraError && (
            <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '10px', color: '#fca5a5', fontSize: '0.8rem' }}>
              {cameraError}
            </div>
          )}

          {/* Soru Kontrol Paneli */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                {activeTest.name} ({currentIndex + 1}/{currentQuestions.length})
              </span>
              <span className={`badge ${questionState === 'RUNNING' ? 'badge-warning' : 'badge-success'}`}>
                {questionState === 'RUNNING' ? '● Canlı Taranıyor' : questionState === 'ENDED' ? '✓ Soru Bitti' : 'Beklemede'}
              </span>
            </div>

            {currentQuestions[currentIndex] && (
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', marginBottom: '14px', lineHeight: 1.3 }}>
                {currentQuestions[currentIndex].text}
              </h3>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {questionState === 'IDLE' && (
                <button
                  onClick={() => handleStartQuestion(currentIndex)}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '10px' }}
                >
                  ▶ Soruyu Başlat
                </button>
              )}

              {questionState === 'RUNNING' && (
                <button
                  onClick={handleEndQuestion}
                  className="btn"
                  style={{ flex: 1, padding: '10px', background: '#f59e0b', color: '#000', fontWeight: 800 }}
                >
                  ⏹ Cevapları Açıkla
                </button>
              )}

              {questionState === 'ENDED' && (
                <button
                  onClick={handleNextQuestion}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '10px' }}
                >
                  {currentIndex + 1 < currentQuestions.length ? '⏭ Sonraki Soru' : '🏆 Testi Bitir & Raporla'}
                </button>
              )}

              {/* Her an testi bitirip podyumu açabilme butonu */}
              <button
                onClick={handleCompleteQuiz}
                className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.08)', fontSize: '0.75rem', padding: '8px' }}
                title="Tüm testi tamamlayıp şampiyonları tahtada göster"
              >
                🏆 Testi Bitir
              </button>
            </div>
          </div>

          {/* CEVAP VERENLER & BEKLENENLER LİSTESİ */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff' }}>
                Sınıf Katılımı ({currentClassKey} - {currentTeacherName})
              </div>
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.78rem' }}>
                <span style={{ color: '#34d399', fontWeight: 700 }}>✓ {answeredCount} Geldi</span>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>⏳ {pendingCount} Bekleniyor</span>
              </div>
            </div>

            {/* Henüz Vermeyenler Bölümü (Öğretmenin kime kamera çevireceğini bilmesi için) */}
            {pendingCount > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 700, marginBottom: '6px' }}>
                  ⚠️ Henüz Kart Göstermeyenler:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {pendingStudents.map((sId) => (
                    <span
                      key={sId}
                      style={{
                        padding: '3px 8px',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: '#fca5a5'
                      }}
                    >
                      #{sId} {currentRoster[sId] || ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Son Tarananlar */}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                Son Başarılı Taramalar:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                {recentDetections.map((det, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      borderRadius: '8px',
                      fontSize: '0.78rem'
                    }}
                  >
                    <span style={{ color: '#fff', fontWeight: 700 }}>
                      #{det.studentId} {det.studentName}
                    </span>
                    <span style={{ color: '#34d399', fontWeight: 900, fontFamily: 'monospace' }}>
                      Şık: {det.choice} ({det.time})
                    </span>
                  </div>
                ))}

                {recentDetections.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    Kamera açılıp kart gösterildiğinde buraya anında yansır.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEKME 2: TESTLER & SORU YÖNETİMİ (Sonsuz Test & Soru Havuzu) */}
      {activeTab === 'questions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Test Seçici ve Yeni Test Oluştur Butonu */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff' }}>
                Test Setleri ({tests.length})
              </div>
              <button
                onClick={() => setShowNewTestModal(true)}
                className="btn btn-sm btn-primary"
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                + Yeni Test Ekle
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              {tests.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTestId(t.id);
                    setCurrentIndex(0);
                    setQuestionState('IDLE');
                    setActiveQuestion(null);
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    background: activeTestId === t.id ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                    color: activeTestId === t.id ? '#fff' : '#9ca3af'
                  }}
                >
                  {t.name} ({t.questions?.length || 0})
                </button>
              ))}
            </div>
          </div>

          {/* Dosya Yükleme & Manuel Soru Ekleme Butonları */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.xlsx,.xls,.csv,.txt"
              style={{ display: 'none' }}
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn"
              style={{ flex: 1, padding: '10px', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa' }}
            >
              📂 PDF / Excel / Word Yükle
            </button>
            <button
              onClick={() => setShowQuestionCreator(!showQuestionCreator)}
              className="btn btn-primary"
              style={{ flex: 1, padding: '10px', fontSize: '0.8rem' }}
            >
              ✍️ Yeni Soru Yaz
            </button>
          </div>

          {importStatus && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '0.78rem' }}>
              {importStatus}
            </div>
          )}

          {/* Manuel Soru Yazıcı Formu */}
          {showQuestionCreator && (
            <form onSubmit={handleCreateQuestion} className="panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 800, color: '#fff', fontSize: '0.9rem' }}>
                Yeni Soru Oluştur
              </div>

              <textarea
                placeholder="Soru metnini yazın..."
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.85rem' }}
                required
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="A Şıkkı"
                  value={newOptA}
                  onChange={(e) => setNewOptA(e.target.value)}
                  style={{ padding: '8px', borderRadius: '6px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
                  required
                />
                <input
                  type="text"
                  placeholder="B Şıkkı"
                  value={newOptB}
                  onChange={(e) => setNewOptB(e.target.value)}
                  style={{ padding: '8px', borderRadius: '6px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
                  required
                />
                <input
                  type="text"
                  placeholder="C Şıkkı"
                  value={newOptC}
                  onChange={(e) => setNewOptC(e.target.value)}
                  style={{ padding: '8px', borderRadius: '6px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
                />
                <input
                  type="text"
                  placeholder="D Şıkkı"
                  value={newOptD}
                  onChange={(e) => setNewOptD(e.target.value)}
                  style={{ padding: '8px', borderRadius: '6px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Doğru Cevap:</span>
                {['A', 'B', 'C', 'D'].map((opt) => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="correctOpt"
                      value={opt}
                      checked={newCorrectAnswer === opt}
                      onChange={() => setNewCorrectAnswer(opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>

              <button type="submit" className="btn btn-primary" style={{ padding: '8px', marginTop: '4px' }}>
                Kaydet & Teste Ekle
              </button>
            </form>
          )}

          {/* Soru Listesi */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentQuestions.map((q, idx) => (
              <div
                key={q.id || idx}
                style={{
                  padding: '12px',
                  background: 'var(--bg-surface-elevated)',
                  border: idx === currentIndex ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                  borderRadius: '12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#60a5fa' }}>
                    #{idx + 1} Soru
                  </span>
                  <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                    Doğru: {q.correctAnswer}
                  </span>
                </div>
                <div style={{ fontSize: '0.88rem', color: '#fff', fontWeight: 600, marginBottom: '8px' }}>
                  {q.text}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div>A: {q.options?.A}</div>
                  <div>B: {q.options?.B}</div>
                  <div>C: {q.options?.C}</div>
                  <div>D: {q.options?.D}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SEKME 3: SINIFLAR (8/A, 8/B) VE HOCA İSİMLERİ */}
      {activeTab === 'classes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Sınıf Seçici */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff', marginBottom: '10px' }}>
              Sınıf Seçimi
            </div>
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
              {Object.keys(classes).map((cKey) => (
                <button
                  key={cKey}
                  onClick={() => handleSelectClass(cKey)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: currentClassKey === cKey ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.06)',
                    color: currentClassKey === cKey ? '#fff' : '#9ca3af'
                  }}
                >
                  {cKey} ({Object.keys(classes[cKey]?.students || {}).length} Öğrenci)
                </button>
              ))}
            </div>
          </div>

          {/* Hoca İsmi Düzenleme */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
              {currentClassKey} Sınıfı Ders Öğretmeni İsmi:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={currentTeacherName}
                onChange={(e) => handleUpdateTeacherName(e.target.value)}
                placeholder="Örn: Mehmet Hoca"
                style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          {/* Yeni Sınıf Ekleme */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
              + Yeni Sınıf Ekle
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Sınıf Adı (örn: 8/C)"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="text"
                placeholder="Hoca İsmi"
                value={newTeacherInput}
                onChange={(e) => setNewTeacherInput(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
              />
              <button onClick={handleAddClass} className="btn btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem' }}>
                Ekle
              </button>
            </div>
          </div>

          {/* Öğrenci Ekleme & Roster */}
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', marginBottom: '10px' }}>
              {currentClassKey} Öğrenci Listesi ({Object.keys(currentRoster).length})
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="number"
                placeholder="Kart No (1-50)"
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                style={{ width: '100px', padding: '8px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
              />
              <input
                type="text"
                placeholder="Öğrenci Adı Soyadı"
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.8rem' }}
              />
              <button onClick={addStudent} className="btn btn-primary" style={{ padding: '8px 12px', fontSize: '0.8rem' }}>
                Ekle
              </button>
            </div>

            {/* Toplu Yapıştırma */}
            <details style={{ marginBottom: '14px', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '8px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#60a5fa', fontWeight: 700 }}>
                📋 e-Okul / Excel'den Toplu İsim Yapıştır
              </summary>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  placeholder="Her satıra bir öğrenci ismi yapıştırın..."
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  rows={4}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.78rem' }}
                />
                <button onClick={handleBulkImport} className="btn btn-sm btn-primary">
                  Listeyi Aktar
                </button>
              </div>
            </details>

            {/* Mevcut Öğrenciler */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
              {Object.entries(currentRoster).map(([id, name]) => (
                <div
                  key={id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--bg-surface-elevated)',
                    borderRadius: '8px',
                    fontSize: '0.8rem'
                  }}
                >
                  <span style={{ color: '#fff', fontWeight: 600 }}>
                    <strong style={{ color: '#60a5fa', marginRight: '6px' }}>#{id}</strong>
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SEKME 4: ŞAMPİYONLAR PODYUMU & TEST SONU RAPORU */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {quizSummary ? (
            <div className="panel" style={{ padding: '20px' }}>
              <div style={{ textAlign: 'center', marginBottom: '18px' }}>
                <div style={{ fontSize: '2rem', marginBottom: '6px' }}>🏆</div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#fff', marginBottom: '4px' }}>
                  {quizSummary.testTitle || 'Test Değerlendirmesi'}
                </h2>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Toplam {quizSummary.totalQuestions} soru tamamlandı
                </div>
              </div>

              {/* İlk 3 Öğrenci (Podyum) */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fbbf24', marginBottom: '10px' }}>
                  🥇 En Çok Doğru Yapan İlk 3 Kişi
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(quizSummary.topStudents || []).slice(0, 3).map((st, idx) => (
                    <div
                      key={st.studentId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: '10px',
                        background: idx === 0 ? 'rgba(251, 191, 36, 0.15)' : 'var(--bg-surface-elevated)',
                        border: idx === 0 ? '1px solid #fbbf24' : '1px solid var(--border-subtle)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}</span>
                        <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                          {st.studentName}
                        </span>
                      </div>
                      <span style={{ fontWeight: 800, color: '#34d399', fontSize: '0.85rem' }}>
                        {st.correctCount} Doğru (%{st.accuracyPct})
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* En Çok Yanlış Yapanlar */}
              {(quizSummary.bottomStudents || []).length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f87171', marginBottom: '10px' }}>
                    ⚠️ En Çok Yanlış Yapan Öğrenciler
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {quizSummary.bottomStudents.slice(0, 3).map((st) => (
                      <div
                        key={st.studentId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.08)',
                          fontSize: '0.8rem'
                        }}
                      >
                        <span style={{ color: '#fca5a5', fontWeight: 600 }}>{st.studentName}</span>
                        <span style={{ color: '#ef4444', fontWeight: 800 }}>{st.wrongCount} Yanlış</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* En Çok Doğru ve Yanlış Yapılan Sorular */}
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#34d399', marginBottom: '8px' }}>
                  🟢 En Çok Doğru Yapılan Soru
                </div>
                {quizSummary.mostCorrectQuestions?.[0] && (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', fontSize: '0.8rem', color: '#e5e7eb', marginBottom: '12px' }}>
                    <strong>Soru #{quizSummary.mostCorrectQuestions[0].questionId}:</strong> {quizSummary.mostCorrectQuestions[0].text} (%{quizSummary.mostCorrectQuestions[0].successPct} Doğru)
                  </div>
                )}

                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f87171', marginBottom: '8px' }}>
                  🔴 En Çok Yanlış Yapılan Soru
                </div>
                {quizSummary.mostWrongQuestions?.[0] && (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.08)', fontSize: '0.8rem', color: '#e5e7eb' }}>
                    <div><strong>Soru #{quizSummary.mostWrongQuestions[0].questionId}:</strong> {quizSummary.mostWrongQuestions[0].text} (%{quizSummary.mostWrongQuestions[0].failurePct} Yanlış)</div>
                    {quizSummary.mostWrongQuestions[0].mostCommonWrongChoice && (
                      <div style={{ color: '#fca5a5', fontSize: '0.72rem', marginTop: '4px' }}>
                        En çok düşülen çeldirici: <strong>{quizSummary.mostWrongQuestions[0].mostCommonWrongChoice}</strong> (Doğru: {quizSummary.mostWrongQuestions[0].correctAnswer})
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📊</div>
              Henüz tamamlanmış bir test oturumu yok. Soruları çözüp "Testi Bitir" butonuna bastığınızda detaylı sınıf analizi ve şampiyonlar podyumu burada belirecektir.
            </div>
          )}
        </div>
      )}

      {/* YENİ TEST EKLEME MODALI */}
      {showNewTestModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px'
        }}>
          <div className="panel" style={{ maxWidth: '400px', width: '100%', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', marginBottom: '14px' }}>
              Yeni Test Oluştur
            </h3>
            <form onSubmit={handleCreateTest} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                placeholder="Test Başlığı (Örn: 8. Sınıf İnkılap Tarihi)"
                value={newTestTitle}
                onChange={(e) => setNewTestTitle(e.target.value)}
                style={{ padding: '10px', borderRadius: '8px', background: '#0a0d14', border: '1px solid var(--border-subtle)', color: '#fff', fontSize: '0.85rem' }}
                autoFocus
                required
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowNewTestModal(false)}
                  className="btn"
                  style={{ background: 'transparent' }}
                >
                  İptal
                </button>
                <button type="submit" className="btn btn-primary">
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
