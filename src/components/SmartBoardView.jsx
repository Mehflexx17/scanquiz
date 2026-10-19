'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { syncEngine } from '@/lib/sync-engine';
import { soundEffects } from '@/lib/sound-effects';
import PrintableCardsModal from '@/components/PrintableCardsModal';

/**
 * Kriptografik güvenli 6 haneli rastgele PIN üretici
 */
function generateCryptographicPin() {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return (100000 + (buffer[0] % 900000)).toString();
  }
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function SmartBoardView() {
  const [boardPin, setBoardPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [pinCountdown, setPinCountdown] = useState(60); // 1 dakika (60 sn)
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionStatus, setQuestionStatus] = useState('IDLE'); // 'IDLE' | 'ACTIVE' | 'ENDED' | 'QUIZ_SUMMARY'
  const [submissions, setSubmissions] = useState(new Map());
  const [resultsData, setResultsData] = useState(null);
  const [quizSummary, setQuizSummary] = useState(null);
  
  // Sınıf & Öğretmen Bilgisi
  const [className, setClassName] = useState('8/A');
  const [teacherName, setTeacherName] = useState('Ders Öğretmeni');
  const [studentRoster, setStudentRoster] = useState({
    1: 'Ali Yılmaz', 2: 'Ayşe Kaya', 3: 'Mehmet Demir', 4: 'Zeynep Bal', 5: 'Can Sarı',
    6: 'Burak Şen', 7: 'Elif Yıldız', 8: 'Emre Ak', 9: 'Gamze Kara', 10: 'Oğuzhan Tekin'
  });

  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [activeTab, setActiveTab] = useState('answered'); // 'answered' | 'pending'

  const isPairedRef = useRef(isPaired);
  const activeQuestionRef = useRef(activeQuestion);
  const boardPinRef = useRef(boardPin);
  
  useEffect(() => { isPairedRef.current = isPaired; }, [isPaired]);
  useEffect(() => { activeQuestionRef.current = activeQuestion; }, [activeQuestion]);
  useEffect(() => { boardPinRef.current = boardPin; }, [boardPin]);

  // Mobilden girildiyse otomatik /ogretmen sayfasına yönlendir
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
      if (isMobile && window.location.pathname === '/') {
        window.location.replace('/ogretmen');
      }
    }
  }, []);

  // 1. PIN Üretimi & 1 Dakikalık Süre (60 saniye)
  const refreshPin = () => {
    const freshPin = generateCryptographicPin();
    setBoardPin(freshPin);
    syncEngine.setRoom(freshPin);
    setPinCountdown(60);
  };

  useEffect(() => {
    const initialPin = generateCryptographicPin();
    setBoardPin(initialPin);
    syncEngine.setRoom(initialPin);
    setPinCountdown(60);

    const timer = setInterval(() => {
      if (isPairedRef.current) {
        clearInterval(timer);
        return;
      }

      setPinCountdown((prev) => {
        if (prev <= 1) {
          const freshPin = generateCryptographicPin();
          setBoardPin(freshPin);
          syncEngine.setRoom(freshPin);
          return 60; // 1 dakika sonra yenile
        }
        return prev - 1;
      });
    }, 1000);

    const unsubStatus = syncEngine.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    return () => {
      clearInterval(timer);
      unsubStatus();
    };
  }, []);

  // 2. Realtime Olay Dinleyicileri
  useEffect(() => {
    const unsubPair = syncEngine.on('host_paired', (payload) => {
      setIsPaired(true);
      soundEffects.playReveal();
      // Telefona tahtanın hazır olduğunu bildir
      syncEngine.emitReliable('board_ack', {
        paired: true,
        pin: boardPinRef.current,
        className,
        teacherName
      }, 4, 300);
    });

    // Sınıf ve Hoca Bilgisi Güncellendiğinde
    const unsubRoster = syncEngine.on('roster_updated', (payload) => {
      if (payload && payload.roster) {
        setStudentRoster(payload.roster);
        if (payload.className) setClassName(payload.className);
        if (payload.teacherName) setTeacherName(payload.teacherName);
      } else if (payload) {
        setStudentRoster(payload);
      }
    });

    // Soru Başlatma
    const unsubStart = syncEngine.on('start_question', (question) => {
      setActiveQuestion(question);
      setQuestionStatus('ACTIVE');
      setSubmissions(new Map());
      setResultsData(null);
      setQuizSummary(null);
      soundEffects.playReveal();
    });

    // Anti-Cheat: Tahtada şıklar GİZLİ kalır
    const handleSubmission = (payload) => {
      if (!payload || !payload.studentId) return;
      const sId = parseInt(payload.studentId, 10);

      setSubmissions((prev) => {
        const next = new Map(prev);
        next.set(sId, {
          studentId: sId,
          status: 'SUBMITTED',
          maskedText: 'Yanıt Geldi ✉️',
          rawChoice: payload.choice || null,
          time: Date.now()
        });
        return next;
      });
      soundEffects.playSubmit();
    };

    const unsubSubmit = syncEngine.on('student_submitted', handleSubmission);
    const unsubScannedRaw = syncEngine.on('student_scanned_raw', handleSubmission);

    // Soru Bitişi ve Cevapların Açıklanması
    const unsubEnd = syncEngine.on('end_question', (payload) => {
      setQuestionStatus('ENDED');
      setResultsData(payload);

      setSubmissions((prev) => {
        const next = new Map(prev);
        const results = payload?.results || {};
        const correctAnswer = payload?.correctAnswer || activeQuestionRef.current?.correctAnswer;
        const allIds = new Set([...next.keys(), ...Object.keys(results).map(Number)]);

        allIds.forEach((sId) => {
          const choice = results[sId] || next.get(sId)?.rawChoice || null;
          const isCorrect = choice && correctAnswer ? choice === correctAnswer : false;
          next.set(sId, {
            studentId: sId,
            status: 'REVEALED',
            choice: choice || '—',
            isCorrect: Boolean(isCorrect),
            time: next.get(sId)?.time || Date.now()
          });
        });

        return next;
      });

      soundEffects.playReveal();
    });

    // Tüm Testin Tamamlanması & Podyum Raporu
    const unsubQuizSummary = syncEngine.on('quiz_completed', (summary) => {
      setQuestionStatus('QUIZ_SUMMARY');
      setQuizSummary(summary);
      soundEffects.playReveal();
    });

    const unsubReset = syncEngine.on('reset_question', () => {
      setActiveQuestion(null);
      setQuestionStatus('IDLE');
      setSubmissions(new Map());
      setResultsData(null);
      setQuizSummary(null);
    });

    return () => {
      unsubPair();
      unsubRoster();
      unsubStart();
      unsubSubmit();
      unsubScannedRaw();
      unsubEnd();
      unsubQuizSummary();
      unsubReset();
    };
  }, []);

  // Cevap Verenler ve Cevap Beklenenler Listeleri
  const allStudentIds = Object.keys(studentRoster).map(Number);
  const answeredList = Array.from(submissions.values());
  const pendingStudents = allStudentIds.filter((id) => !submissions.has(id));
  const totalStudents = allStudentIds.length || (submissions.size || 20);
  const totalAnswered = submissions.size;
  const totalPending = Math.max(0, totalStudents - totalAnswered);

  // İstatistikler (Soru bittiğinde)
  const stats = resultsData?.stats || (() => {
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    submissions.forEach((sub) => {
      if (sub.choice && counts[sub.choice] !== undefined) {
        counts[sub.choice]++;
      }
    });
    return counts;
  })();

  const correctCount = Array.from(submissions.values()).filter((s) => s.isCorrect).length;
  const accuracyPct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  const statusColor = connectionStatus === 'connected' ? '#10b981' 
    : connectionStatus === 'connecting' ? '#f59e0b' 
    : '#ef4444';
  const statusText = connectionStatus === 'connected' ? 'Bağlı' 
    : connectionStatus === 'connecting' ? 'Bağlanıyor...' 
    : 'Bağlantı Yok';

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '16px 24px',
          marginBottom: '24px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '1rem',
                color: '#fff',
                boxShadow: '0 0 16px rgba(59, 130, 246, 0.4)'
              }}
            >
              SQ
            </div>
            <div>
              <span style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em', color: '#fff' }}>
                ScanQuiz
              </span>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Akıllı Tahta Sistemi
              </div>
            </div>
          </div>

          <span className="badge badge-info" style={{ fontWeight: 700 }}>
            🏫 {className} Sınıfı
          </span>

          <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: '#d1d5db' }}>
            👨‍🏫 {teacherName}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isPaired ? '#10b981' : '#f59e0b',
                boxShadow: `0 0 8px ${isPaired ? '#10b981' : '#f59e0b'}`,
                display: 'inline-block'
              }}
            />
            <span style={{ color: isPaired ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
              {isPaired ? 'Öğretmen Bağlı' : 'Öğretmen Bekleniyor'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="btn btn-sm"
          >
            🖨️ Kartları Yazdır
          </button>
          <Link
            href="/ogretmen"
            target="_blank"
            className="btn btn-sm btn-primary"
            style={{ textDecoration: 'none' }}
          >
            📱 Öğretmen Paneli
          </Link>
        </div>
      </header>

      {/* DURUM 1: Bekleme Modu — PIN Girişi (1 Dakika Yenilemeli) */}
      {questionStatus === 'IDLE' && (
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
            textAlign: 'center'
          }}
        >
          <div className="panel" style={{
            padding: '48px 40px',
            maxWidth: '680px',
            width: '100%',
            textAlign: 'center'
          }}>
            <div className={`badge ${isPaired ? 'badge-success' : 'badge-warning'}`} style={{ marginBottom: '20px' }}>
              {isPaired ? '● OTURUM AKTİF VE EŞLEŞTİ' : 'GÜVENLİ KATILIM KODU'}
            </div>

            <h1 style={{
              fontSize: '2.2rem',
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.03em',
              marginBottom: '10px',
              lineHeight: 1.2
            }}>
              {isPaired ? 'Soru Başlatılması Bekleniyor' : 'Öğretmen Cihazından Bağlanın'}
            </h1>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '500px', margin: '0 auto 28px' }}>
              {isPaired
                ? 'Öğretmen telefonundan veya panelinden soru başlattığında soru anında buraya yansıyacaktır.'
                : 'Telefonunuzdan /ogretmen sayfasına gidin ve aşağıdaki 6 haneli katılım kodunu girin.'}
            </p>

            {/* 6 Haneli PIN Kutuları */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '10px',
              marginBottom: '24px'
            }}>
              {(boardPin || '------').split('').map((digit, i) => (
                <div
                  key={i}
                  style={{
                    width: '64px',
                    height: '84px',
                    background: '#0a0c13',
                    border: '2px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                    fontWeight: 900,
                    fontFamily: 'var(--font-mono)',
                    color: '#60a5fa',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {digit}
                </div>
              ))}
            </div>

            {/* PIN Rotasyon Sayacı (1 Dakika / 60 sn) */}
            {!isPaired ? (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Kodun Geçerlilik Süresi:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#60a5fa', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {pinCountdown} sn
                    </span>
                    <button
                      onClick={refreshPin}
                      className="btn btn-sm"
                      style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(255,255,255,0.06)' }}
                      title="Yeni bir PIN kodu üret"
                    >
                      ↻ Hemen Yenile
                    </button>
                  </div>
                </div>
                <div style={{
                  width: '100%',
                  height: '6px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '999px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, (pinCountdown / 60) * 100))}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                    transition: 'width 1s linear'
                  }} />
                </div>
              </div>
            ) : (
              <div className="badge badge-success" style={{ padding: '12px 24px', fontSize: '0.9rem' }}>
                🔒 Tahta başarıyla bağlandı. Sorular kontrol edilebilir.
              </div>
            )}
          </div>
        </main>
      )}

      {/* DURUM 2: Soru Canlı veya Soru Tamamlandı */}
      {(questionStatus === 'ACTIVE' || questionStatus === 'ENDED') && activeQuestion && (
        <main
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) minmax(380px, 0.9fr)',
            gap: '20px',
            alignItems: 'start'
          }}
        >
          {/* Sol Kolon: Soru ve Şıklar */}
          <section className="panel" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span className="badge badge-info">
                Soru #{activeQuestion.id || 1}
              </span>
              <span className={`badge ${questionStatus === 'ACTIVE' ? 'badge-warning' : 'badge-success'}`}>
                {questionStatus === 'ACTIVE' ? '● Canlı Taranıyor' : '✓ Soru Tamamlandı'}
              </span>
            </div>

            <h2 style={{
              fontSize: '1.8rem',
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.35,
              letterSpacing: '-0.02em',
              marginBottom: '28px'
            }}>
              {activeQuestion.text}
            </h2>

            {/* Şıklar */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {['A', 'B', 'C', 'D'].map((opt) => {
                const optText = activeQuestion.options?.[opt] || '-';
                const isEnded = questionStatus === 'ENDED';
                const isCorrect = isEnded && activeQuestion.correctAnswer === opt;
                const isDimmed = isEnded && activeQuestion.correctAnswer !== opt;

                const optBgColors = {
                  A: 'var(--color-opt-a)',
                  B: 'var(--color-opt-b)',
                  C: 'var(--color-opt-c)',
                  D: 'var(--color-opt-d)'
                };

                return (
                  <div
                    key={opt}
                    className={`board-option-item ${isCorrect ? 'is-correct' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                    style={{
                      background: isCorrect
                        ? 'rgba(16, 185, 129, 0.18)'
                        : isDimmed
                        ? 'rgba(18, 21, 31, 0.4)'
                        : 'var(--bg-surface-elevated)',
                      border: `2px solid ${isCorrect ? 'var(--success)' : isDimmed ? 'transparent' : 'var(--border-subtle)'}`,
                      opacity: isDimmed ? 0.4 : 1,
                      transform: isCorrect ? 'scale(1.02)' : 'none',
                    }}
                  >
                    <div className={`opt-letter opt-letter-${opt}`}
                      style={{ background: isCorrect ? 'var(--success)' : optBgColors[opt] }}
                    >
                      {opt}
                    </div>
                    <span style={{
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      color: isCorrect ? '#34d399' : '#e5e7eb'
                    }}>
                      {optText}
                    </span>
                    {isCorrect && (
                      <span style={{ marginLeft: 'auto', fontSize: '1.5rem', color: '#34d399', fontWeight: 900 }}>
                        ✓ DOĞRU ŞIK
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sağ Kolon: Cevap Verenler ve Cevap Vermeyenler Bölünmüş Görünüm */}
          <section className="panel" style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '520px'
          }}>
            {/* Üst İstatistik Barı */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '14px',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: '16px'
            }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', marginBottom: '2px' }}>
                  {questionStatus === 'ACTIVE' ? 'Katılım Durumu' : 'Soru Sonuç Raporu'}
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {questionStatus === 'ACTIVE'
                    ? '🔒 Kopya engelleme devrede — Şıklar gizlidir.'
                    : `Toplam ${totalAnswered} öğrenci | Başarı: %${accuracyPct}`}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '14px', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                    {totalAnswered}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                    Cevap Verdi
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>
                    {totalPending}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                    Bekleniyor
                  </div>
                </div>
              </div>
            </div>

            {/* İki Sekmeli Filtre: Cevap Verenler vs Beklenenler */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button
                onClick={() => setActiveTab('answered')}
                className={`btn btn-sm ${activeTab === 'answered' ? 'btn-primary' : ''}`}
                style={{ flex: 1, fontSize: '0.82rem', padding: '6px' }}
              >
                ✅ Cevap Verenler ({totalAnswered})
              </button>
              <button
                onClick={() => setActiveTab('pending')}
                className={`btn btn-sm ${activeTab === 'pending' ? 'btn-primary' : ''}`}
                style={{ flex: 1, fontSize: '0.82rem', padding: '6px' }}
              >
                ⏳ Cevap Vermeyenler ({totalPending})
              </button>
            </div>

            {/* Soru Bitmişse Şık Dağılım Grafiği */}
            {questionStatus === 'ENDED' && (
              <div className="chart-section" style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '8px' }}>
                  Şık Dağılım Analizi
                </div>
                {['A', 'B', 'C', 'D'].map((opt) => {
                  const count = stats[opt] || 0;
                  const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
                  const isCorrect = activeQuestion.correctAnswer === opt;

                  return (
                    <div key={opt} className="chart-row">
                      <span style={{ fontWeight: 800, color: isCorrect ? '#34d399' : 'var(--text-muted)' }}>
                        {opt}
                      </span>
                      <div className="chart-bar-bg">
                        <div className="chart-bar-fill" style={{
                          width: `${Math.max(pct, count > 0 ? 5 : 0)}%`,
                          background: isCorrect ? 'linear-gradient(90deg, #10b981, #059669)' : 'rgba(255, 255, 255, 0.2)',
                        }} />
                      </div>
                      <span style={{
                        textAlign: 'right',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: isCorrect ? '#34d399' : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)'
                      }}>
                        %{pct} ({count})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SEÇİLEN SEKMEYE GÖRE LİSTE */}
            <div className="student-cards-stream" style={{ flex: 1, maxHeight: '360px', overflowY: 'auto' }}>
              {activeTab === 'answered' ? (
                // CEVAP VERENLER LİSTESİ
                answeredList.length > 0 ? (
                  answeredList.map((sub) => {
                    const isRevealed = questionStatus === 'ENDED' && sub.status === 'REVEALED';
                    const sName = studentRoster[sub.studentId] || `Öğrenci #${sub.studentId}`;

                    if (!isRevealed) {
                      return (
                        <div key={sub.studentId} className="student-pill submitted">
                          <span className="student-pill-name" title={sName}>{sName}</span>
                          <span className="student-pill-num">#{sub.studentId}</span>
                          <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>✉️ Yanıt Alındı</span>
                        </div>
                      );
                    }

                    return (
                      <div key={sub.studentId} className={`student-pill ${sub.isCorrect ? 'revealed-correct' : 'revealed-wrong'}`}>
                        <span className="student-pill-name" title={sName}>{sName}</span>
                        <span className="student-pill-num">#{sub.studentId}</span>
                        <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>
                          {sub.choice} {sub.isCorrect ? '✓' : '✗'}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '30px 10px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📡</div>
                    Henüz kartını kaldıran öğrenci yok. Öğretmen kamerayı sınıfa çevirdikçe burada listelenecek.
                  </div>
                )
              ) : (
                // CEVAP VERMEYENLER / BEKLENENLER LİSTESİ
                pendingStudents.length > 0 ? (
                  pendingStudents.map((sId) => {
                    const sName = studentRoster[sId] || `Öğrenci #${sId}`;
                    return (
                      <div
                        key={sId}
                        className="student-pill"
                        style={{
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#fca5a5'
                        }}
                      >
                        <span className="student-pill-name" title={sName}>{sName}</span>
                        <span className="student-pill-num" style={{ color: '#ef4444' }}>#{sId}</span>
                        <span style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 600 }}>Bekleniyor...</span>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '30px 10px', color: '#34d399', fontSize: '0.88rem', fontWeight: 700 }}>
                    🎉 Harika! Sınıftaki tüm öğrenciler yanıt verdi!
                  </div>
                )
              )}
            </div>
          </section>
        </main>
      )}

      {/* DURUM 3: Test Sonu Şampiyonlar Podyumu & Detaylı Analiz Ekranı */}
      {questionStatus === 'QUIZ_SUMMARY' && quizSummary && (
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Üst Başlık Banner */}
          <div className="panel" style={{
            padding: '32px',
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95))',
            border: '2px solid rgba(59, 130, 246, 0.4)'
          }}>
            <div className="badge badge-success" style={{ marginBottom: '12px' }}>
              🏆 TEST TAMAMLANDI
            </div>
            <h1 style={{ fontSize: '2.4rem', fontWeight: 900, color: '#fff', marginBottom: '8px' }}>
              {quizSummary.testTitle || 'Test Değerlendirme & Şampiyonlar Podyumu'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', maxWidth: '600px', margin: '0 auto' }}>
              Toplam {quizSummary.totalQuestions || 0} soru üzerinden sınıf başarı grafiği ve en çok zorlanılan konular
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
            {/* Sol: Şampiyonlar Podyumu (En Çok Doğru Yapan 3 Kişi) */}
            <section className="panel" style={{ padding: '28px' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>🥇</span> En Çok Doğru Yapan İlk 3 Öğrenci
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {(quizSummary.topStudents || []).slice(0, 3).map((st, idx) => {
                  const medals = ['🥇 1. Sıra (Altın)', '🥈 2. Sıra (Gümüş)', '🥉 3. Sıra (Bronz)'];
                  const borders = ['#fbbf24', '#94a3b8', '#d97706'];
                  const bgGradients = [
                    'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05))',
                    'linear-gradient(135deg, rgba(148, 163, 184, 0.15), rgba(148, 163, 184, 0.05))',
                    'linear-gradient(135deg, rgba(217, 119, 6, 0.15), rgba(217, 119, 6, 0.05))'
                  ];

                  return (
                    <div
                      key={st.studentId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        borderRadius: '14px',
                        background: bgGradients[idx] || 'var(--bg-surface-elevated)',
                        border: `2px solid ${borders[idx] || 'var(--border-subtle)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ fontSize: '1.8rem' }}>
                          {idx === 0 ? '🏆' : idx === 1 ? '🥈' : '🥉'}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.8rem', color: borders[idx], fontWeight: 800 }}>
                            {medals[idx]}
                          </div>
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>
                            {studentRoster[st.studentId] || `Öğrenci #${st.studentId}`}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                          {st.correctCount} Doğru
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          %{st.accuracyPct} Başarı
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desteğe İhtiyacı Olan / En Çok Yanlış Yapanlar */}
              <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--border-subtle)' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f87171', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span> Ek Tekrar Yapması Önerilen Öğrenciler (En Çok Yanlış Yapanlar)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(quizSummary.bottomStudents || []).slice(0, 3).map((st) => (
                    <div
                      key={st.studentId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.25)'
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#fca5a5' }}>
                        {studentRoster[st.studentId] || `Öğrenci #${st.studentId}`}
                      </span>
                      <span style={{ fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
                        {st.wrongCount} Yanlış
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Sağ: Soru Başarı Analizi (En Çok Doğru / Yanlış Yapılan Sorular) */}
            <section className="panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#34d399', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🟢</span> En Çok Doğru Yapılan Sorular (En Kolay)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(quizSummary.mostCorrectQuestions || []).slice(0, 3).map((q) => (
                    <div
                      key={q.questionId}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.25)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 800, color: '#34d399', fontSize: '0.85rem' }}>
                          Soru #{q.questionId}
                        </span>
                        <span style={{ fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                          %{q.successPct} Başarı ({q.correctCount} Doğru)
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {q.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f87171', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔴</span> En Çok Yanlış Yapılan Sorular (En Zor)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(quizSummary.mostWrongQuestions || []).slice(0, 3).map((q) => (
                    <div
                      key={q.questionId}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.25)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 800, color: '#f87171', fontSize: '0.85rem' }}>
                          Soru #{q.questionId}
                        </span>
                        <span style={{ fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
                          %{q.failurePct} Hata ({q.wrongCount} Yanlış)
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#e5e7eb', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {q.text}
                      </div>
                      {q.mostCommonWrongChoice && (
                        <div style={{ fontSize: '0.72rem', color: '#fca5a5' }}>
                          💡 En çok düşülen çeldirici şık: <strong>{q.mostCommonWrongChoice}</strong> (Doğru cevap: {q.correctAnswer})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      )}

      {/* Kart Yazdırma Modalı */}
      <PrintableCardsModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        roster={studentRoster}
      />
    </div>
  );
}
