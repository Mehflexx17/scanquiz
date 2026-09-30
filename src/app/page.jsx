'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { generateSecurePin } from '@/lib/pin-generator';
import { syncEngine } from '@/lib/sync-engine';
import { soundEffects } from '@/lib/sound-effects';
import PrintableCardsModal from '@/components/PrintableCardsModal';

export default function SmartBoardPage() {
  const [boardPin, setBoardPin] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionStatus, setQuestionStatus] = useState('IDLE'); // 'IDLE' | 'ACTIVE' | 'ENDED'
  const [submissions, setSubmissions] = useState(new Map());
  const [resultsData, setResultsData] = useState(null);
  const [studentRoster, setStudentRoster] = useState({});
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // 1. Bu Tahta İçin Benzersiz 6 Haneli PIN Üret
  useEffect(() => {
    const pin = generateSecurePin();
    setBoardPin(pin);
    syncEngine.setRoom(pin);
  }, []);

  // 2. Realtime Olay Dinleyicileri
  useEffect(() => {
    const unsubPair = syncEngine.on('host_paired', () => {
      setIsConnected(true);
      soundEffects.playReveal();
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

    const unsubSubmit = syncEngine.on('student_submitted', (payload) => {
      // payload: { studentId: number, status: 'SUBMITTED' } (ŞIK GİZLİDİR)
      setSubmissions((prev) => {
        const next = new Map(prev);
        next.set(payload.studentId, {
          studentId: payload.studentId,
          status: 'SUBMITTED',
          time: Date.now()
        });
        return next;
      });
      soundEffects.playSubmit();
    });

    const unsubEnd = syncEngine.on('end_question', (payload) => {
      setQuestionStatus('ENDED');
      setResultsData(payload);

      if (payload.results) {
        setSubmissions((prev) => {
          const next = new Map();
          Object.entries(payload.results).forEach(([sId, choice]) => {
            const studentId = parseInt(sId, 10);
            next.set(studentId, {
              studentId,
              status: 'REVEALED',
              choice,
              isCorrect: choice === payload.correctAnswer
            });
          });
          return next;
        });
      }
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
      unsubEnd();
      unsubReset();
    };
  }, []);

  const totalAnswered = submissions.size;

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>
      {/* Üst Bilgi Çubuğu */}
      <header className="panel panel-header" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
            ScanQuiz
          </span>
          <span className="badge badge-info">Akıllı Tahta</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            <span className={`status-indicator ${isConnected ? 'online' : 'online'}`} />
            <span>{isConnected ? 'Kumanda Bağlandı' : 'Oturum Dinleniyor'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setIsPrintModalOpen(true)} className="btn btn-sm">
            Kartları Yazdır (A4)
          </button>
          <Link href="/host" target="_blank" className="btn btn-sm btn-primary">
            Kontrol Paneli (/host)
          </Link>
        </div>
      </header>

      {/* Bekleme Durumu: Sade, Şık PIN Ekranı */}
      {questionStatus === 'IDLE' && (
        <main className="board-pin-box">
          <span className="badge badge-warning" style={{ marginBottom: '16px' }}>
            KATILIM KODU
          </span>

          <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
            Öğretmen Kumandasından Bağlanın
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '6px' }}>
            Telefon veya bilgisayarınızdan <strong>/host</strong> sayfasına girip bu 6 haneli kodu yazın.
          </p>

          <div className="board-pin-digits">
            {boardPin || '------'}
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            Her sınıf ve tahta için benzersiz oturum kodu oluşturulur.
          </p>
        </main>
      )}

      {/* Soru Aktifken veya Bittiğinde */}
      {questionStatus !== 'IDLE' && activeQuestion && (
        <main className="board-question-wrap">
          {/* Sol Panel: Soru ve Şıklar */}
          <section className="panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="badge badge-info">Soru #{activeQuestion.id || 1}</span>
              <span className={`badge ${questionStatus === 'ACTIVE' ? 'badge-warning' : 'badge-success'}`}>
                {questionStatus === 'ACTIVE' ? '● Canlı Yanıtlar Alınıyor' : '✓ Soru Tamamlandı'}
              </span>
            </div>

            <h2 className="board-q-text">
              {activeQuestion.text}
            </h2>

            <div className="board-options-grid">
              {['A', 'B', 'C', 'D'].map((opt) => {
                const optText = activeQuestion.options?.[opt] || '-';
                const isEnded = questionStatus === 'ENDED';
                const isCorrect = isEnded && activeQuestion.correctAnswer === opt;
                const isDimmed = isEnded && activeQuestion.correctAnswer !== opt;

                return (
                  <div
                    key={opt}
                    className={`board-option-item ${isCorrect ? 'is-correct' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                  >
                    <div className={`opt-letter opt-letter-${opt}`}>{opt}</div>
                    <span style={{ color: isCorrect ? '#34d399' : 'inherit' }}>{optText}</span>
                    {isCorrect && <span style={{ marginLeft: 'auto', fontSize: '1.4rem' }}>✓</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sağ Panel: Anti-Cheat Canlı Akış & Sonuçlar */}
          <section className="panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {questionStatus === 'ACTIVE' ? 'Anti-Cheat Yanıt Akışı' : 'Sonuç Dağılımı'}
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {questionStatus === 'ACTIVE' ? 'Şıklar gizlidir, kopya engellenir.' : 'Doğru ve yanlış yanıtlar açıklandı.'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                  {totalAnswered}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Katılımcı</div>
              </div>
            </div>

            {/* Soru Bittiğinde Bar Grafiği */}
            {questionStatus === 'ENDED' && resultsData && resultsData.stats && (
              <div className="chart-section">
                {['A', 'B', 'C', 'D'].map((opt) => {
                  const count = resultsData.stats[opt] || 0;
                  const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
                  const isCorrect = activeQuestion.correctAnswer === opt;

                  return (
                    <div key={opt} className="chart-row">
                      <span style={{ color: `var(--color-opt-${opt.toLowerCase()})` }}>{opt}</span>
                      <div className="chart-bar-bg">
                        <div
                          className="chart-bar-fill"
                          style={{
                            width: `${Math.max(pct, 3)}%`,
                            background: isCorrect ? 'var(--success)' : `var(--color-opt-${opt.toLowerCase()})`
                          }}
                        />
                      </div>
                      <span style={{ textAlign: 'right', fontSize: '0.85rem', color: isCorrect ? 'var(--success)' : 'var(--text-muted)' }}>
                        %{pct} ({count})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Öğrenci Kartları Akışı */}
            <div className="student-cards-stream">
              {Array.from(submissions.values()).map((sub) => {
                const isRevealed = questionStatus === 'ENDED' && sub.status === 'REVEALED';
                const sName = studentRoster[sub.studentId] || `Öğrenci #${sub.studentId}`;

                return (
                  <div
                    key={sub.studentId}
                    className={`student-pill ${
                      isRevealed
                        ? sub.isCorrect
                          ? 'revealed-correct'
                          : 'revealed-wrong'
                        : 'submitted'
                    }`}
                  >
                    <span className="student-pill-name" title={sName}>{sName}</span>
                    <span className="student-pill-num">#{sub.studentId}</span>
                    {isRevealed && (
                      <strong style={{ fontSize: '1rem', marginTop: '2px' }}>
                        {sub.choice} {sub.isCorrect ? '✓' : '✗'}
                      </strong>
                    )}
                  </div>
                );
              })}

              {submissions.size === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 16px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                  Öğrenciler kartlarını kaldırdıkça burada belirecektir.
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      <PrintableCardsModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
      />
    </div>
  );
}
