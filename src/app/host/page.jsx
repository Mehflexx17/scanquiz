'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { syncEngine } from '@/lib/sync-engine';
import { parseQuizFile } from '@/lib/file-parser';
import { soundEffects } from '@/lib/sound-effects';
import PrintableCardsModal from '@/components/PrintableCardsModal';

// Varsayılan hazır sorular
const DEFAULT_QUESTIONS = [
  {
    id: 1,
    text: 'Türkiye Cumhuriyeti hangi yılda ilan edilmiştir?',
    options: {
      A: '1919',
      B: '1920',
      C: '1923',
      D: '1938'
    },
    correctAnswer: 'C',
    durationSec: 45
  },
  {
    id: 2,
    text: 'Güneş sistemindeki en büyük gezegen hangisidir?',
    options: {
      A: 'Mars',
      B: 'Jüpiter',
      C: 'Satürn',
      D: 'Dünya'
    },
    correctAnswer: 'B',
    durationSec: 45
  },
  {
    id: 3,
    text: 'Suyun kimyasal formülü aşağıdakilerden hangisidir?',
    options: {
      A: 'H2O',
      B: 'CO2',
      C: 'NaCl',
      D: 'O2'
    },
    correctAnswer: 'A',
    durationSec: 30
  }
];

export default function HostControlPage() {
  const [targetPin, setTargetPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionState, setQuestionState] = useState('IDLE'); // 'IDLE', 'RUNNING', 'ENDED'
  const [submissions, setSubmissions] = useState(new Map()); // studentId -> { choice, time }
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  // Yerel Tahta PIN'ini otomatik algıla
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPin = localStorage.getItem('scanquiz_active_pin');
      if (savedPin) {
        setTargetPin(savedPin);
        handlePairWithPin(savedPin);
      }
    }
  }, []);

  // Öğrenci tarama verilerini dinle
  useEffect(() => {
    const unsubScan = syncEngine.on('student_scanned_raw', (payload) => {
      // payload: { studentId: number, choice: 'A'|'B'|'C'|'D' }
      if (questionState === 'RUNNING') {
        handleStudentResponse(payload.studentId, payload.choice);
      }
    });

    return () => {
      unsubScan();
    };
  }, [questionState, activeQuestion]);

  const handlePairWithPin = (pinToUse) => {
    const pin = pinToUse || targetPin;
    if (!pin) return;
    syncEngine.setRoom(pin);
    syncEngine.emit('host_paired', { pin });
    setIsPaired(true);
    soundEffects.playSubmit();
  };

  // Öğrenci yanıtı işleme
  const handleStudentResponse = (studentId, choice) => {
    setSubmissions((prev) => {
      const next = new Map(prev);
      next.set(studentId, { choice, time: Date.now() });
      return next;
    });

    // Tahtaya SADECE 'SUBMITTED' bilgisini yayınla (Anti-Cheat)
    syncEngine.emit('student_submitted', {
      studentId: studentId,
      status: 'SUBMITTED'
    });

    soundEffects.playSubmit();
  };

  // Soruyu Başlat
  const handleStartQuestion = (indexToStart = currentIndex) => {
    const q = questions[indexToStart];
    if (!q) return;

    setActiveQuestion(q);
    setQuestionState('RUNNING');
    setSubmissions(new Map());

    syncEngine.emit('start_question', q);
    soundEffects.playReveal();
  };

  // Soruyu Bitir ve Cevapları Tahtaya Aç
  const handleEndQuestion = () => {
    if (!activeQuestion) return;

    setQuestionState('ENDED');

    // İstatistikleri hesapla
    const stats = { A: 0, B: 0, C: 0, D: 0 };
    const rawResults = {};

    submissions.forEach((val, studentId) => {
      rawResults[studentId] = val.choice;
      if (stats[val.choice] !== undefined) {
        stats[val.choice]++;
      }
    });

    // Tahtaya tüm sonuçları aç
    syncEngine.emit('end_question', {
      questionId: activeQuestion.id,
      correctAnswer: activeQuestion.correctAnswer,
      results: rawResults,
      stats: stats
    });

    soundEffects.playReveal();
  };

  // Sıradaki Soruya Geç
  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      handleStartQuestion(nextIdx);
    } else {
      handleResetBoard();
    }
  };

  // Tahtayı Boşalt
  const handleResetBoard = () => {
    setQuestionState('IDLE');
    setActiveQuestion(null);
    setSubmissions(new Map());
    syncEngine.emit('reset_question', {});
  };

  // PDF / Excel Dosyası Yükleme İşleyicisi
  const handleFileUpload = async (file) => {
    if (!file) return;
    setImportStatus('Dosya inceleniyor ve sorular ayıklanıyor...');

    try {
      const parsed = await parseQuizFile(file);
      if (parsed && parsed.length > 0) {
        setQuestions(parsed);
        setCurrentIndex(0);
        setImportStatus(`✅ Başarılı! ${parsed.length} adet soru içe aktarıldı.`);
        soundEffects.playReveal();
      } else {
        setImportStatus('⚠️ Dosyadan soru ayrıştırılamadı. Format: Soru;A;B;C;D;Cevap olmalıdır.');
      }
    } catch (err) {
      setImportStatus(`❌ Hata: ${err.message}`);
    }
  };

  // Simülatör: Test amaçlı sanal öğrenci yanıtı üretme
  const simulateAnswer = (studentId, choice) => {
    handleStudentResponse(studentId, choice);
  };

  return (
    <main className="page-container" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Üst Bar */}
      <header className="page-header" style={{ borderRadius: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="logo" style={{ fontSize: '1.4rem' }}>
            <span>🎮 ScanQuiz Kumandası</span>
          </div>
          <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>
            {isPaired ? `Eşleşti (PIN: ${targetPin})` : 'Yerel Bağlantı Hazır'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/" target="_blank" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            📺 Tahtayı Aç (Sekmede)
          </Link>
          <Link href="/ogretmen" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            📷 Mobil Kamera
          </Link>
          <button onClick={() => setIsPrintModalOpen(true)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            🖨️ Kartları Yazdır
          </button>
        </div>
      </header>

      {/* PIN Bağlantı Kutusu */}
      {!isPaired && (
        <section className="glass-card" style={{ padding: '24px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>Akıllı Tahta PIN Kodu</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Tahtada (/) görünen 6 haneli kodu yazın veya yerel eşleşmeyi kullanın.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="123456"
              maxLength={6}
              value={targetPin}
              onChange={(e) => setTargetPin(e.target.value)}
              className="input"
              style={{ width: '130px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '1.2rem', letterSpacing: '0.1em' }}
            />
            <button onClick={() => handlePairWithPin()} className="btn btn-primary">
              Bağlan
            </button>
            <button onClick={() => handlePairWithPin(localStorage.getItem('scanquiz_active_pin'))} className="btn btn-secondary">
              ⚡ Otomatik Yerel Eşle
            </button>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px' }}>
        {/* Sol Kolon: Canlı Kontrol Kumandası */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Aktif Soru Kontrol Paneli */}
          <section className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span className="badge badge-info">
                Soru {currentIndex + 1} / {questions.length}
              </span>
              <span className={`badge ${questionState === 'RUNNING' ? 'badge-warning' : questionState === 'ENDED' ? 'badge-success' : 'badge-info'}`}>
                Durum: {questionState === 'RUNNING' ? '▶ Soru Tahtada Aktif' : questionState === 'ENDED' ? '⏹ Cevaplar Açıklandı' : 'Beklemede'}
              </span>
            </div>

            {/* Mevcut Soru Metni */}
            <div style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: '12px', marginBottom: '20px', border: '1px solid var(--bg-glass-border)' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '16px' }}>
                {questions[currentIndex]?.text || 'Soru bulunamadı'}
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {['A', 'B', 'C', 'D'].map((opt) => {
                  const isCorrect = questions[currentIndex]?.correctAnswer === opt;
                  return (
                    <div
                      key={opt}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: isCorrect ? 'rgba(0, 184, 148, 0.2)' : 'var(--bg-card)',
                        border: isCorrect ? '1px solid var(--success)' : '1px solid rgba(255,255,255,0.05)',
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <strong style={{ color: isCorrect ? 'var(--success)' : 'var(--accent-secondary)' }}>{opt}:</strong>
                      <span>{questions[currentIndex]?.options?.[opt] || '-'}</span>
                      {isCorrect && <span style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>✅ (Doğru)</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Buton Kontrolleri */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {questionState !== 'RUNNING' ? (
                <button onClick={() => handleStartQuestion()} className="btn btn-success" style={{ flex: 1 }}>
                  ▶ Soruyu Tahtada Başlat
                </button>
              ) : (
                <button onClick={handleEndQuestion} className="btn btn-danger" style={{ flex: 1 }}>
                  ⏹ Soruyu Bitir & Cevapları Açıkla
                </button>
              )}

              <button
                onClick={handleNextQuestion}
                disabled={currentIndex + 1 >= questions.length}
                className="btn btn-primary"
              >
                ⏭ Sıradaki Soru
              </button>

              <button onClick={handleResetBoard} className="btn btn-secondary">
                🔄 Sıfırla
              </button>
            </div>
          </section>

          {/* Öğretmene Özel Canlı Cevap Tablosu (Öğretmen kimin ne dediğini canlı görür!) */}
          <section className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>👨‍🏫 Öğretmene Özel Canlı Akış</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Tahtada şıklar gizlidir fakat siz kimin hangi şıkkı verdiğini buradan canlı takip edebilirsiniz.
                </p>
              </div>
              <span className="badge badge-info">{submissions.size} Öğrenci</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {Array.from(submissions.entries()).map(([studentId, data]) => {
                const isCorrect = activeQuestion && data.choice === activeQuestion.correctAnswer;
                return (
                  <div
                    key={studentId}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      background: 'var(--bg-secondary)',
                      border: `1px solid ${isCorrect ? 'var(--success)' : 'rgba(255,255,255,0.1)'}`,
                      textAlign: 'center',
                      fontSize: '0.85rem'
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>#{studentId}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: isCorrect ? 'var(--success)' : 'var(--danger)' }}>
                      {data.choice}
                    </div>
                  </div>
                );
              })}
              {submissions.size === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                  Henüz gelen yanıt yok. Kamera veya aşağıdaki simülatör ile yanıt gönderilebilir.
                </div>
              )}
            </div>

            {/* Test Amaçlı Hızlı Simülatör (Öğrenci Kartı Yokken Test Etmek İçin) */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--bg-glass-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                🧪 Kamera olmadan test etmek için hızlı öğrenci simülatörü:
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5].map((sId) => (
                  <div key={sId} style={{ display: 'inline-flex', background: 'var(--bg-card)', padding: '4px', borderRadius: '8px', gap: '4px' }}>
                    <span style={{ fontSize: '0.75rem', alignSelf: 'center', paddingLeft: '4px' }}>#{sId}:</span>
                    {['A', 'B', 'C', 'D'].map((ch) => (
                      <button
                        key={ch}
                        onClick={() => simulateAnswer(sId, ch)}
                        style={{
                          background: 'rgba(255,255,255,0.08)',
                          border: 'none',
                          color: '#fff',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Sağ Kolon: PDF / Excel İçe Aktarma & Soru Listesi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Dosya Yükleme Kutusu */}
          <section
            className="glass-card"
            style={{
              padding: '24px',
              border: isDragOver ? '2px dashed var(--accent-primary)' : '1px solid var(--bg-glass-border)',
              background: isDragOver ? 'rgba(108, 92, 231, 0.05)' : 'var(--bg-glass)'
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
            }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>
              📄 PDF veya Excel / CSV Yükle
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Sorularınızı içeren PDF, Excel (.xlsx) veya CSV dosyasını sürükleyip bırakın veya seçin.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.csv,.xlsx,.xls,.txt"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
              }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-primary"
                style={{ flex: 1, padding: '10px' }}
              >
                📁 Dosya Seç (.pdf / .xlsx / .csv)
              </button>
              <button
                onClick={() => { setQuestions(DEFAULT_QUESTIONS); setCurrentIndex(0); setImportStatus('Demo sorular yüklendi.'); }}
                className="btn btn-secondary"
                style={{ padding: '10px' }}
                title="Varsayılan Demo Soruları Yükle"
              >
                Örnek Yükle
              </button>
            </div>

            {importStatus && (
              <div style={{ marginTop: '12px', fontSize: '0.85rem', color: importStatus.includes('✅') ? 'var(--success)' : 'var(--warning)' }}>
                {importStatus}
              </div>
            )}
          </section>

          {/* Yüklenmiş Soru Listesi */}
          <section className="glass-card" style={{ padding: '24px', flex: 1 }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>
              📋 Soru Havuzu ({questions.length} Soru)
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
              {questions.map((q, idx) => {
                const isSelected = idx === currentIndex;
                return (
                  <div
                    key={q.id || idx}
                    onClick={() => setCurrentIndex(idx)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: '10px',
                      background: isSelected ? 'rgba(108, 92, 231, 0.15)' : 'var(--bg-secondary)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '0.9rem', color: isSelected ? 'var(--accent-secondary)' : '#fff' }}>
                        #{idx + 1}
                      </strong>
                      <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                        Cevap: {q.correctAnswer}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <PrintableCardsModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
      />
    </main>
  );
}
