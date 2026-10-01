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
  const [questionStatus, setQuestionStatus] = useState('IDLE'); // 'IDLE' | 'ACTIVE' | 'ENDED'
  const [submissions, setSubmissions] = useState(new Map()); // studentId -> { studentId, status, choice?, isCorrect? }
  const [resultsData, setResultsData] = useState(null);
  const [studentRoster, setStudentRoster] = useState({});
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const isPairedRef = useRef(isPaired);
  useEffect(() => {
    isPairedRef.current = isPaired;
  }, [isPaired]);

  // 1. PIN Üretimi & 20 Saniyelik Otomatik Yenilenme (Eşleşene kadar)
  useEffect(() => {
    // İlk PIN'i oluştur ve odayı dinlemeye başla
    const initialPin = generateCryptographicPin();
    setBoardPin(initialPin);
    syncEngine.setRoom(initialPin);
    setPinCountdown(20);

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
          return 20;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 2. Realtime Olay Dinleyicileri
  useEffect(() => {
    const unsubPair = syncEngine.on('host_paired', () => {
      setIsPaired(true);
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

    // Anti-Cheat: Öğrenci kartı tarandığında veya gönderildiğinde
    // SMART BOARD EKRANINDA KESİNLİKLE ŞIK (A/B/C/D) GÖSTERİLMEZ!
    // Yalnızca "Answer Received ✉️" gösterilir!
    const handleSubmission = (payload) => {
      if (!payload || !payload.studentId) return;
      const sId = parseInt(payload.studentId, 10);

      setSubmissions((prev) => {
        const next = new Map(prev);
        // Gizli tutuyoruz: choice kaydedilse dahi questionStatus !== 'ENDED' iken renderlanmaz
        next.set(sId, {
          studentId: sId,
          status: 'SUBMITTED',
          maskedText: 'Answer Received ✉️',
          rawChoice: payload.choice || null,
          time: Date.now()
        });
        return next;
      });
      soundEffects.playSubmit();
    };

    const unsubSubmit = syncEngine.on('student_submitted', handleSubmission);
    const unsubScannedRaw = syncEngine.on('student_scanned_raw', handleSubmission);

    // Öğretmen END_QUESTION tetiklediğinde sonuçları açıkla
    const unsubEnd = syncEngine.on('end_question', (payload) => {
      setQuestionStatus('ENDED');
      setResultsData(payload);

      setSubmissions((prev) => {
        const next = new Map(prev);
        const results = payload?.results || {};
        const correctAnswer = payload?.correctAnswer || activeQuestion?.correctAnswer;

        // Hem payload.results hem de mevcut submissions içindeki yanıtları açığa çıkar
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
  }, [activeQuestion]);

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

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Üst Bilgi Başlığı (Header) */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(18, 21, 31, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '16px 24px',
          marginBottom: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
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
                fontSize: '1.1rem',
                color: '#fff',
                boxShadow: '0 0 16px rgba(59, 130, 246, 0.5)'
              }}
            >
              SQ
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.35rem', letterSpacing: '-0.02em', color: '#fff' }}>
              ScanQuiz
            </span>
          </div>

          <span
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              padding: '4px 12px',
              borderRadius: '999px',
              fontSize: '0.8rem',
              fontWeight: 700,
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}
          >
            Akıllı Tahta Görünümü
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: isPaired ? '#10b981' : '#f59e0b',
                boxShadow: isPaired ? '0 0 10px #10b981' : '0 0 10px #f59e0b',
                display: 'inline-block'
              }}
            />
            <span style={{ color: isPaired ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
              {isPaired ? 'Öğretmen Kumandası Eşleşti' : 'Öğretmen Bekleniyor'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setIsPrintModalOpen(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#e5e7eb',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            🖨️ Kartları Yazdır (A4)
          </button>
          <Link
            href="/ogretmen"
            target="_blank"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#fff',
              padding: '8px 18px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📱 Öğretmen Tarayıcı (/ogretmen)
          </Link>
        </div>
      </header>

      {/* DURUM 1: Bekleme Modu - 20 Saniyede Bir Yenilenen Kriptografik PIN */}
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
          <div
            style={{
              background: 'rgba(18, 21, 31, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '24px',
              padding: '48px 40px',
              maxWidth: '680px',
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              backdropFilter: 'blur(20px)'
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: isPaired ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: isPaired ? '#34d399' : '#fbbf24',
                padding: '6px 16px',
                borderRadius: '999px',
                fontWeight: 700,
                fontSize: '0.85rem',
                marginBottom: '20px',
                border: isPaired ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)'
              }}
            >
              {isPaired ? '● OTURUM AKTİF VE EŞLEŞTİ' : 'CANLI KATILIM KODU'}
            </div>

            <h1
              style={{
                fontSize: '2.4rem',
                fontWeight: 800,
                color: '#fff',
                letterSpacing: '-0.03em',
                marginBottom: '10px',
                lineHeight: 1.2
              }}
            >
              {isPaired ? 'Soru Başlatılması Bekleniyor' : 'Öğretmen Cihazınızdan Bağlanın'}
            </h1>

            <p style={{ color: '#9ca3af', fontSize: '1rem', maxWidth: '480px', margin: '0 auto 28px' }}>
              {isPaired
                ? 'Öğretmen cep telefonundan veya kumandadan ilk soruyu başlattığında ekran otomatik güncellenecektir.'
                : 'Telefonunuzdan /ogretmen veya /host sayfasına giderek aşağıdaki 6 haneli kodu girin.'}
            </p>

            {/* 6 Haneli PIN Kutuları */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '12px',
                marginBottom: '24px'
              }}
            >
              {(boardPin || '------').split('').map((digit, i) => (
                <div
                  key={i}
                  style={{
                    width: '64px',
                    height: '84px',
                    background: '#0a0c13',
                    border: '2px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                    fontWeight: 900,
                    fontFamily: 'monospace',
                    color: '#60a5fa',
                    boxShadow: '0 4px 20px rgba(59, 130, 246, 0.2)',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                >
                  {digit}
                </div>
              ))}
            </div>

            {/* 20 Saniyelik Dinamik Sayaç (Eşleşene Kadar) */}
            {!isPaired ? (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.85rem' }}>
                  <span style={{ color: '#9ca3af' }}>Kriptografik PIN Güvenlik Rotasyonu:</span>
                  <span style={{ color: '#60a5fa', fontWeight: 800, fontFamily: 'monospace' }}>
                    {pinCountdown}s sonra yenilenir
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '999px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(pinCountdown / 20) * 100}%`,
                      background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                      transition: 'width 1s linear'
                    }}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  color: '#34d399',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>🔒</span> Oturum kilitlendi ve öğretmen kamerasıyla güvenle eşleştirildi.
              </div>
            )}
          </div>
        </main>
      )}

      {/* DURUM 2 & 3: Soru Aktifken veya Soru Bittiğinde */}
      {questionStatus !== 'IDLE' && activeQuestion && (
        <main
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.25fr) minmax(360px, 0.85fr)',
            gap: '24px',
            alignItems: 'start'
          }}
        >
          {/* Sol Kolon: Soru Metni ve Şıklar */}
          <section
            style={{
              background: 'rgba(18, 21, 31, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '36px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(16px)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 700
                }}
              >
                Soru #{activeQuestion.id || 1}
              </span>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: questionStatus === 'ACTIVE' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                  color: questionStatus === 'ACTIVE' ? '#fbbf24' : '#34d399',
                  padding: '6px 16px',
                  borderRadius: '999px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  border: questionStatus === 'ACTIVE' ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
                }}
              >
                {questionStatus === 'ACTIVE' ? '● Canlı Yanıtlar Toplanıyor' : '✓ Soru Tamamlandı (Sonuçlar)'}
              </span>
            </div>

            <h2
              style={{
                fontSize: '1.9rem',
                fontWeight: 800,
                color: '#fff',
                lineHeight: 1.35,
                letterSpacing: '-0.02em',
                marginBottom: '32px'
              }}
            >
              {activeQuestion.text}
            </h2>

            {/* Şıklar Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
              {['A', 'B', 'C', 'D'].map((opt) => {
                const optText = activeQuestion.options?.[opt] || '-';
                const isEnded = questionStatus === 'ENDED';
                const isCorrect = isEnded && activeQuestion.correctAnswer === opt;
                const isDimmed = isEnded && activeQuestion.correctAnswer !== opt;

                const optColors = {
                  A: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6', text: '#60a5fa' },
                  B: { bg: 'rgba(16, 185, 129, 0.1)', border: '#10b981', text: '#34d399' },
                  C: { bg: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b', text: '#fbbf24' },
                  D: { bg: 'rgba(239, 68, 68, 0.1)', border: '#ef4444', text: '#f87171' }
                };

                return (
                  <div
                    key={opt}
                    style={{
                      background: isCorrect
                        ? 'rgba(16, 185, 129, 0.2)'
                        : isDimmed
                        ? 'rgba(18, 21, 31, 0.4)'
                        : '#141824',
                      border: `2px solid ${isCorrect ? '#10b981' : isDimmed ? 'rgba(255,255,255,0.04)' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: '16px',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      opacity: isDimmed ? 0.45 : 1,
                      transform: isCorrect ? 'scale(1.02)' : 'none',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: isCorrect ? '0 0 24px rgba(16, 185, 129, 0.3)' : 'none'
                    }}
                  >
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        background: isCorrect ? '#10b981' : optColors[opt].bg,
                        color: isCorrect ? '#fff' : optColors[opt].text,
                        border: `1px solid ${isCorrect ? '#10b981' : optColors[opt].border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '1.25rem'
                      }}
                    >
                      {opt}
                    </div>
                    <span
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 600,
                        color: isCorrect ? '#34d399' : '#e5e7eb'
                      }}
                    >
                      {optText}
                    </span>
                    {isCorrect && (
                      <span style={{ marginLeft: 'auto', fontSize: '1.6rem', color: '#34d399', fontWeight: 900 }}>
                        ✓
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sağ Kolon: Anti-Cheat Canlı Akış & Sonuç Dağılımı */}
          <section
            style={{
              background: 'rgba(18, 21, 31, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '28px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(16px)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: '520px'
            }}
          >
            {/* Canlı Sayaç & Anti-Cheat Başlığı */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: '20px'
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
                  {questionStatus === 'ACTIVE' ? 'Anti-Cheating Akışı' : 'Sınıf Sonuç Raporu'}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>
                  {questionStatus === 'ACTIVE'
                    ? '🔒 Öğrenci şıkları tahtada gizlenir, kopya engellenir.'
                    : `Toplam ${totalAnswered} öğrenci | Başarı Oranı: %${accuracyPct}`}
                </p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: 900,
                    fontFamily: 'monospace',
                    color: '#60a5fa',
                    lineHeight: 1
                  }}
                >
                  {totalAnswered}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px', fontWeight: 600 }}>
                  Gelen Yanıt
                </div>
              </div>
            </div>

            {/* END_QUESTION Olduğunda: Sınıf Yüzde Dağılım İstatistikleri */}
            {questionStatus === 'ENDED' && (
              <div
                style={{
                  background: '#0e111a',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '16px',
                  padding: '16px',
                  marginBottom: '20px'
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '12px' }}>
                  📊 Şık Dağılım İstatistikleri
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {['A', 'B', 'C', 'D'].map((opt) => {
                    const count = stats[opt] || 0;
                    const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
                    const isCorrect = activeQuestion.correctAnswer === opt;

                    return (
                      <div key={opt} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 64px', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontWeight: 800, color: isCorrect ? '#34d399' : '#9ca3af', fontSize: '0.9rem' }}>
                          {opt}
                        </span>
                        <div
                          style={{
                            height: '14px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            borderRadius: '999px',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.max(pct, count > 0 ? 5 : 0)}%`,
                              background: isCorrect ? 'linear-gradient(90deg, #10b981, #059669)' : 'rgba(255, 255, 255, 0.2)',
                              borderRadius: '999px',
                              transition: 'width 0.6s ease'
                            }}
                          />
                        </div>
                        <span
                          style={{
                            textAlign: 'right',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            color: isCorrect ? '#34d399' : '#9ca3af',
                            fontFamily: 'monospace'
                          }}
                        >
                          %{pct} ({count})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Öğrenci Kartları Akışı: Anti-Cheat & Açıklama Modu */}
            <div
              style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '10px',
                maxHeight: '380px',
                overflowY: 'auto',
                paddingRight: '4px'
              }}
            >
              {Array.from(submissions.values()).map((sub) => {
                const isRevealed = questionStatus === 'ENDED' && sub.status === 'REVEALED';
                const sName = studentRoster[sub.studentId] || `Öğrenci #${sub.studentId}`;

                // Anti-Cheat: Soru aktifken ŞIK KESİNLİKLE GİZLİDİR.
                // Yalnızca "Answer Received ✉️" gösterilir!
                if (!isRevealed) {
                  return (
                    <div
                      key={sub.studentId}
                      style={{
                        background: '#0d111a',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '12px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                        animation: 'fadeIn 0.3s ease'
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: '#e5e7eb',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%'
                        }}
                        title={sName}
                      >
                        {sName}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '4px' }}>
                        #{sub.studentId}
                      </span>
                      {/* ANTI-CHEAT MANDATORY BADGE */}
                      <span
                        style={{
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#60a5fa',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '4px 6px',
                          borderRadius: '6px',
                          border: '1px solid rgba(59, 130, 246, 0.3)'
                        }}
                      >
                        Answer Received ✉️
                      </span>
                    </div>
                  );
                }

                // Soru Bittiğinde: Green/Red Status Cards
                const cardBg = sub.isCorrect
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)';
                const cardBorder = sub.isCorrect
                  ? '#10b981'
                  : '#ef4444';
                const cardTextColor = sub.isCorrect
                  ? '#34d399'
                  : '#f87171';

                return (
                  <div
                    key={sub.studentId}
                    style={{
                      background: cardBg,
                      border: `2px solid ${cardBorder}`,
                      borderRadius: '12px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      boxShadow: sub.isCorrect
                        ? '0 4px 16px rgba(16, 185, 129, 0.25)'
                        : '0 4px 16px rgba(239, 68, 68, 0.25)',
                      animation: 'scaleIn 0.3s ease'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: '#fff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%'
                      }}
                      title={sName}
                    >
                      {sName}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '4px' }}>
                      #{sub.studentId}
                    </span>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: cardTextColor,
                        fontWeight: 900,
                        fontSize: '1.15rem'
                      }}
                    >
                      <span>{sub.choice}</span>
                      <span>{sub.isCorrect ? '✓' : '✗'}</span>
                    </div>
                  </div>
                );
              })}

              {submissions.size === 0 && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    textAlign: 'center',
                    padding: '48px 16px',
                    color: '#6b7280',
                    fontSize: '0.9rem'
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📡</div>
                  Öğrenciler kartlarını havaya kaldırdıkça yanıtlar burada listelenecektir.
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
      />
    </div>
  );
}
