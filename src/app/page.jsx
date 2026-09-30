'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { generateSecurePin } from '@/lib/pin-generator';
import { syncEngine } from '@/lib/sync-engine';
import { soundEffects } from '@/lib/sound-effects';
import PrintableCardsModal from '@/components/PrintableCardsModal';

export default function SmartBoardPage() {
  const [pin, setPin] = useState('');
  const [pinSecondsLeft, setPinSecondsLeft] = useState(20);
  const [sessionConnected, setSessionConnected] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionStatus, setQuestionStatus] = useState('IDLE'); // 'IDLE', 'ACTIVE', 'ENDED'
  const [submissions, setSubmissions] = useState(new Map()); // studentId -> { status: 'SUBMITTED', choice?: string }
  const [questionStats, setQuestionStats] = useState(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [studentRoster, setStudentRoster] = useState({}); // { [studentId]: 'Ali Yılmaz' }

  const pinTimerRef = useRef(null);

  // Yerel roster yükle
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedRoster = localStorage.getItem('scanquiz_roster');
        if (savedRoster) {
          setStudentRoster(JSON.parse(savedRoster));
        }
      } catch (e) {}
    }
  }, []);

  // 1. PIN Üretimi ve 20 Saniyelik Dinamik Döngü (Session yokken)
  useEffect(() => {
    const renewPin = () => {
      const newPin = generateSecurePin();
      setPin(newPin);
      setPinSecondsLeft(20);
      syncEngine.setRoom(newPin);
      // Yerel oturum için de sakla
      if (typeof window !== 'undefined') {
        localStorage.setItem('scanquiz_active_pin', newPin);
      }
    };

    renewPin();

    const interval = setInterval(() => {
      setPinSecondsLeft((prev) => {
        if (prev <= 1) {
          // Eğer soru aktif değilse PIN'i yenile
          if (!activeQuestion && questionStatus === 'IDLE') {
            renewPin();
            return 20;
          }
          return 20;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeQuestion, questionStatus]);

  // 2. Realtime Event Dinleyicileri (Host ve Öğretmen İstemcilerinden gelen mesajlar)
  useEffect(() => {
    // Host bağlandığında
    const unsubPair = syncEngine.on('host_paired', (payload) => {
      setSessionConnected(true);
      soundEffects.playReveal();
    });

    // Soru Başlatıldığında
    const unsubStart = syncEngine.on('start_question', (question) => {
      setActiveQuestion(question);
      setQuestionStatus('ACTIVE');
      setSubmissions(new Map());
      setQuestionStats(null);
      soundEffects.playReveal();
    });

    // Öğrenci Cevap Gönderdiğinde (Anti-Cheating Korumalı)
    const unsubSubmit = syncEngine.on('student_submitted', (payload) => {
      // payload: { studentId: number, status: 'SUBMITTED' }
      // ŞIK BİLGİSİ STRIPPED (GİZLENMİŞ) OLARAK GELİR!
      setSubmissions((prev) => {
        const next = new Map(prev);
        next.set(payload.studentId, {
          studentId: payload.studentId,
          status: 'SUBMITTED',
          time: Date.now(),
        });
        return next;
      });
      soundEffects.playSubmit();
    });

    // Soru Bitirildiğinde (Cevaplar Açığa Çıkıyor)
    const unsubEnd = syncEngine.on('end_question', (payload) => {
      // payload: { correctAnswer: 'A', results: { [studentId]: 'B' }, stats: { A: 12, B: 2, C: 0, D: 1 } }
      setQuestionStatus('ENDED');
      setQuestionStats(payload);

      if (payload.results) {
        setSubmissions((prev) => {
          const next = new Map();
          Object.entries(payload.results).forEach(([sId, choice]) => {
            const studentId = parseInt(sId, 10);
            next.set(studentId, {
              studentId,
              status: 'REVEALED',
              choice: choice,
              isCorrect: choice === payload.correctAnswer,
            });
          });
          return next;
        });
      }
      soundEffects.playReveal();
    });

    // Roster (Öğrenci İsimleri) Güncellendiğinde
    const unsubRoster = syncEngine.on('roster_updated', (roster) => {
      setStudentRoster(roster || {});
      if (typeof window !== 'undefined') {
        localStorage.setItem('scanquiz_roster', JSON.stringify(roster));
      }
    });

    // Sıfırla / Beklemeye Al
    const unsubReset = syncEngine.on('reset_question', () => {
      setActiveQuestion(null);
      setQuestionStatus('IDLE');
      setSubmissions(new Map());
      setQuestionStats(null);
    });

    return () => {
      unsubPair();
      unsubStart();
      unsubSubmit();
      unsubEnd();
      unsubRoster();
      unsubReset();
    };
  }, []);

  const totalAnswered = submissions.size;

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <main className="page-container" style={{ paddingBottom: '40px' }}>
      {/* Üst Bar */}
      <header className="page-header" style={{ borderRadius: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="logo" style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚡ ScanQuiz</span>
            <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>Akıllı Tahta</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`status-dot ${sessionConnected ? 'connected' : 'connected'}`} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {sessionConnected ? 'Öğretmen Kumandası Bağlı' : 'Tahta Dinlemede (Yerel & Bulut Sync)'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="btn btn-secondary"
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            🖨️ Kartları Yazdır (A4)
          </button>

          <Link href="/host" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            🎮 Tahta Kontrol Paneli (/host)
          </Link>

          <Link href="/ogretmen" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            📷 Mobil Tarayıcı
          </Link>

          <button
            onClick={() => setSoundOn(!soundOn)}
            className="btn btn-secondary btn-icon"
            title={soundOn ? 'Sesi Kapat' : 'Sesi Aç'}
          >
            {soundOn ? '🔊' : '🔇'}
          </button>

          <button
            onClick={toggleFullScreen}
            className="btn btn-secondary btn-icon"
            title="Tam Ekran"
          >
            ⛶
          </button>
        </div>
      </header>

      {/* Soru Yokken: Devasa 20 Saniyelik Dinamik PIN Ekranı */}
      {questionStatus === 'IDLE' && (
        <section className="glass-card page-center" style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <span className="badge badge-warning" style={{ fontSize: '0.9rem', padding: '6px 16px' }}>
              ⏳ 20 SANİYELİK DİNAMİK EŞLEŞME KODU
            </span>
          </div>

          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginBottom: '8px' }}>
            Öğretmen Kumandasından Bağlanın
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '540px', marginBottom: '32px' }}>
            Telefon veya bilgisayarınızdan <strong>/host</strong> veya <strong>/ogretmen</strong> adresine girip bu kodu eşleştirin ya da doğrudan kontrol panelinden başlatın.
          </p>

          {/* 6 Haneli Devasa PIN */}
          <div
            className="pin-display"
            style={{
              fontSize: '6rem',
              letterSpacing: '0.25em',
              textShadow: '0 0 50px rgba(108, 92, 231, 0.5)',
              userSelect: 'all',
              cursor: 'pointer',
            }}
          >
            {pin || '------'}
          </div>

          {/* 20 Saniyelik İlerleme Çubuğu */}
          <div style={{ width: '320px', margin: '24px auto 8px' }}>
            <div className="pin-timer">
              <div
                className="pin-timer-bar"
                style={{
                  width: `${(pinSecondsLeft / 20) * 100}%`,
                  transition: 'width 1s linear',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
              <span>Yenileniyor</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-secondary)' }}>
                {pinSecondsLeft} sn
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '32px' }}>
            <Link href="/host" className="btn btn-primary btn-lg">
              🚀 Kontrol Panelini Aç (/host)
            </Link>
          </div>
        </section>
      )}

      {/* Soru Aktifken veya Soru Bittiğinde: Canlı Soru & Cevap Tahtası */}
      {questionStatus !== 'IDLE' && activeQuestion && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px' }}>
          {/* Sol Kolon: Soru ve Şıklar */}
          <section className="glass-card" style={{ padding: '32px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <span className="badge badge-info" style={{ fontSize: '1rem', padding: '6px 14px' }}>
                Soru #{activeQuestion.id || 1}
              </span>
              <span className={`badge ${questionStatus === 'ACTIVE' ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: '1rem' }}>
                {questionStatus === 'ACTIVE' ? '● Canlı Yanıtlar Alınıyor' : '✓ Soru Tamamlandı'}
              </span>
            </div>

            {/* Soru Metni */}
            <h2 style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.4, marginBottom: '32px', color: '#fff' }}>
              {activeQuestion.text}
            </h2>

            {/* Şıklar Tablosu */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: 'auto' }}>
              {['A', 'B', 'C', 'D'].map((optKey) => {
                const optText = activeQuestion.options?.[optKey] || `Seçenek ${optKey}`;
                const isCorrect = questionStatus === 'ENDED' && activeQuestion.correctAnswer === optKey;
                const isWrong = questionStatus === 'ENDED' && activeQuestion.correctAnswer !== optKey;

                return (
                  <div
                    key={optKey}
                    style={{
                      padding: '20px',
                      borderRadius: '16px',
                      background: isCorrect ? 'rgba(0, 184, 148, 0.25)' : 'var(--bg-card)',
                      border: isCorrect
                        ? '2px solid var(--success)'
                        : isWrong
                        ? '1px solid rgba(255,255,255,0.05)'
                        : '1px solid var(--bg-glass-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      transition: 'all 0.4s ease',
                      boxShadow: isCorrect ? '0 0 30px rgba(0, 184, 148, 0.3)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '12px',
                        background: isCorrect ? 'var(--success)' : `var(--option-${optKey.toLowerCase()})`,
                        color: isCorrect ? '#000' : '#fff',
                        fontWeight: 900,
                        fontSize: '1.3rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {optKey}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: isCorrect ? '#55efc4' : '#f0f0f5' }}>
                      {optText}
                    </div>
                    {isCorrect && (
                      <span style={{ marginLeft: 'auto', fontSize: '1.5rem' }}>✅</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sağ Kolon: Anti-Cheating Öğrenci Kartları ve Bar Chart */}
          <section className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                  {questionStatus === 'ACTIVE' ? '🛡️ Anti-Cheat Canlı Akış' : '📊 Sınıf Analitiği'}
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {questionStatus === 'ACTIVE'
                    ? 'Seçenekler gizlidir, sadece kartı kaldıranlar görünür.'
                    : 'Cevaplar açığa çıktı.'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>
                  {totalAnswered}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}> Yanıt</span>
              </div>
            </div>

            {/* Soru Bittiğinde Bar Chart Gösterimi */}
            {questionStatus === 'ENDED' && questionStats && questionStats.stats && (
              <div className="bar-chart" style={{ padding: '0 0 16px', borderBottom: '1px solid var(--bg-glass-border)' }}>
                {['A', 'B', 'C', 'D'].map((opt) => {
                  const count = questionStats.stats[opt] || 0;
                  const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
                  const isCorrect = activeQuestion.correctAnswer === opt;

                  return (
                    <div key={opt} className="bar-item">
                      <div className={`bar-label option-${opt.toLowerCase()}`}>
                        {opt}
                      </div>
                      <div className="bar-track">
                        <div
                          className={`bar-fill option-${opt.toLowerCase()} ${isCorrect ? 'correct' : ''}`}
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        >
                          {pct > 10 ? `${pct}%` : ''}
                        </div>
                      </div>
                      <div className="bar-stat" style={{ color: isCorrect ? 'var(--success)' : 'inherit', fontWeight: isCorrect ? 800 : 400 }}>
                        %{pct} ({count})
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Öğrenci Kartları Grid */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '480px', marginTop: '16px' }}>
              <div className="student-grid" style={{ padding: 0 }}>
                {Array.from(submissions.values()).map((sub) => {
                  const isRevealed = questionStatus === 'ENDED' && sub.status === 'REVEALED';
                  const studentName = studentRoster[sub.studentId] || `Öğrenci #${sub.studentId}`;

                  return (
                    <div
                      key={sub.studentId}
                      className={`student-card ${
                        isRevealed
                          ? sub.isCorrect
                            ? 'correct'
                            : 'incorrect'
                          : 'submitted'
                      }`}
                      style={{ minHeight: '90px', padding: '12px 8px' }}
                    >
                      <span className="card-id" style={{ fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {studentName}
                      </span>
                      <span style={{ fontSize: '0.75rem', opacity: 0.6, fontFamily: 'var(--font-mono)' }}>
                        #{sub.studentId}
                      </span>
                      {isRevealed ? (
                        <>
                          <span className="card-icon">{sub.isCorrect ? '✅' : '❌'}</span>
                          <span className="card-choice">{sub.choice} Şıkkı</span>
                        </>
                      ) : (
                        <>
                          <span className="card-icon">🎴</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Cevap Geldi</span>
                        </>
                      )}
                    </div>
                  );
                })}

                {submissions.size === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Öğrenciler kartlarını havaya kaldırdıkça burada belirecek...
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Yazdırılabilir Kartlar Modalı */}
      <PrintableCardsModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
      />
    </main>
  );
}
