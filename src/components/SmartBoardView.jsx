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
  const [pinCountdown, setPinCountdown] = useState(20);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionStatus, setQuestionStatus] = useState('IDLE');
  const [submissions, setSubmissions] = useState(new Map());
  const [resultsData, setResultsData] = useState(null);
  const [studentRoster, setStudentRoster] = useState({});
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const isPairedRef = useRef(isPaired);
  const activeQuestionRef = useRef(activeQuestion);
  
  useEffect(() => { isPairedRef.current = isPaired; }, [isPaired]);
  useEffect(() => { activeQuestionRef.current = activeQuestion; }, [activeQuestion]);

  // Mobilden girildiyse otomatik /ogretmen sayfasına yönlendir
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
      if (isMobile && window.location.pathname === '/') {
        window.location.replace('/ogretmen');
      }
    }
  }, []);

  // 1. PIN Üretimi & 30 Dakikalık Uzatılmış Süre (İstendiğinde Yenileme)
  const refreshPin = () => {
    const freshPin = generateCryptographicPin();
    setBoardPin(freshPin);
    syncEngine.setRoom(freshPin);
    setPinCountdown(1800); // 30 dakika
  };

  useEffect(() => {
    const initialPin = generateCryptographicPin();
    setBoardPin(initialPin);
    syncEngine.setRoom(initialPin);
    setPinCountdown(1800); // 30 dakika

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
          return 1800;
        }
        return prev - 1;
      });
    }, 1000);

    // Bağlantı durumunu dinle
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
      syncEngine.emit('board_ack', { paired: true, pin: boardPin });
    });

    const unsubRoster = syncEngine.on('roster_updated', (roster) => {
      setStudentRoster(roster || {});
    });

    const unsubStart = syncEngine.on('start_question', (question) => {
      setActiveQuestion(question);
      setQuestionStatus('ACTIVE');
      setSubmissions(new Map());
      setResultsData(null);
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

    // Sonuçları açıkla
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

    const unsubReset = syncEngine.on('reset_question', () => {
      setActiveQuestion(null);
      setQuestionStatus('IDLE');
      setSubmissions(new Map());
      setResultsData(null);
    });

    return () => {
      unsubPair();
      unsubRoster();
      unsubStart();
      unsubSubmit();
      unsubScannedRaw();
      unsubEnd();
      unsubReset();
    };
  }, []);

  const totalAnswered = submissions.size;

  // İstatistikleri hesapla
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

  // Bağlantı durumu rengi
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '0.9rem',
                color: '#fff'
              }}
            >
              SQ
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em', color: '#fff' }}>
              ScanQuiz
            </span>
          </div>

          <span className="badge badge-info">
            Akıllı Tahta
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
              {isPaired ? 'Öğretmen Eşleşti' : 'Öğretmen Bekleniyor'}
            </span>
          </div>

          {/* Sunucu Bağlantı Durumu */}
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
          <Link href="/host" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            🎮 Kumanda Paneli
          </Link>
          <Link
            href="/ogretmen"
            target="_blank"
            className="btn btn-sm btn-primary"
            style={{ textDecoration: 'none' }}
          >
            📱 Kamera Tarayıcı
          </Link>
        </div>
      </header>

      {/* DURUM 1: Bekleme Modu — PIN */}
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
              {isPaired ? '● OTURUM AKTİF' : 'KATILIM KODU'}
            </div>

            <h1 style={{
              fontSize: '2.2rem',
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.03em',
              marginBottom: '10px',
              lineHeight: 1.2
            }}>
              {isPaired ? 'Soru Bekleniyor' : 'Cihazınızdan Bağlanın'}
            </h1>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '480px', margin: '0 auto 28px' }}>
              {isPaired
                ? 'Kumanda panelinden veya telefondaki kameradan soruyu başlatın.'
                : 'Telefonunuzdan /ogretmen veya /host sayfasına giderek aşağıdaki kodu girin.'}
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
                    width: '60px',
                    height: '80px',
                    background: '#0a0c13',
                    border: '2px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.4rem',
                    fontWeight: 900,
                    fontFamily: 'var(--font-mono)',
                    color: '#60a5fa',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {digit}
                </div>
              ))}
            </div>

            {/* PIN Rotasyon Sayacı */}
            {!isPaired ? (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Kod Geçerlilik Süresi:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#60a5fa', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {Math.floor(pinCountdown / 60)} dk {pinCountdown % 60} sn
                    </span>
                    <button
                      onClick={refreshPin}
                      className="btn btn-sm"
                      style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(255,255,255,0.06)' }}
                      title="Yeni bir PIN kodu üret"
                    >
                      ↻ Kodu Yenile
                    </button>
                  </div>
                </div>
                <div style={{
                  width: '100%',
                  height: '5px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: '999px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(pinCountdown / 1800) * 100}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                    transition: 'width 1s linear'
                  }} />
                </div>
              </div>
            ) : (
              <div className="badge badge-success" style={{ padding: '10px 20px', fontSize: '0.85rem' }}>
                🔒 Oturum eşleştirildi ve kilitlendi.
              </div>
            )}
          </div>
        </main>
      )}

      {/* DURUM 2 & 3: Soru Aktif veya Bitti */}
      {questionStatus !== 'IDLE' && activeQuestion && (
        <main
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.25fr) minmax(340px, 0.85fr)',
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
                {questionStatus === 'ACTIVE' ? '● Canlı' : '✓ Tamamlandı'}
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
                        ✓
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sağ Kolon: Canlı Akış & Sonuçlar */}
          <section className="panel" style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '500px'
          }}>
            {/* Başlık */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '14px',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: '16px'
            }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', marginBottom: '2px' }}>
                  {questionStatus === 'ACTIVE' ? 'Canlı Yanıtlar' : 'Sonuç Raporu'}
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {questionStatus === 'ACTIVE'
                    ? '🔒 Şıklar tahtada gizli — kopya engellenir.'
                    : `${totalAnswered} öğrenci | Başarı: %${accuracyPct}`}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#60a5fa', lineHeight: 1 }}>
                  {totalAnswered}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '2px', fontWeight: 600 }}>
                  Yanıt
                </div>
              </div>
            </div>

            {/* İstatistikler (soru bittiyse) */}
            {questionStatus === 'ENDED' && (
              <div className="chart-section">
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '8px' }}>
                  Şık Dağılımı
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

            {/* Öğrenci Kartları */}
            <div className="student-cards-stream" style={{ flex: 1 }}>
              {Array.from(submissions.values()).map((sub) => {
                const isRevealed = questionStatus === 'ENDED' && sub.status === 'REVEALED';
                const sName = studentRoster[sub.studentId] || `#${sub.studentId}`;

                if (!isRevealed) {
                  return (
                    <div key={sub.studentId} className="student-pill submitted">
                      <span className="student-pill-name" title={sName}>{sName}</span>
                      <span className="student-pill-num">#{sub.studentId}</span>
                      <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>✉️ Geldi</span>
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
              })}

              {submissions.size === 0 && (
                <div style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '40px 16px',
                  color: 'var(--text-dim)',
                  fontSize: '0.85rem'
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📡</div>
                  Öğrenciler kartlarını kaldırdıkça yanıtlar burada görünecek.
                </div>
              )}
            </div>
          </section>
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
