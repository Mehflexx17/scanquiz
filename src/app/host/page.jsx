'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { syncEngine } from '@/lib/sync-engine';
import { parseQuizFile } from '@/lib/file-parser';
import { soundEffects } from '@/lib/sound-effects';
import PrintableCardsModal from '@/components/PrintableCardsModal';

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

export default function HostControlPage() {
  // ⚠️ KOD OTONOM DOLDURULMAZ — KUTU BOŞ BAŞLAR
  const [targetPin, setTargetPin] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionState, setQuestionState] = useState('IDLE'); // 'IDLE' | 'RUNNING' | 'ENDED'
  const [submissions, setSubmissions] = useState(new Map());
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  // Sınıflar ve Öğrenci Listesi
  const [classes, setClasses] = useState({
    '9-A': { 1: 'Ali Yılmaz', 2: 'Ayşe Kaya', 3: 'Mehmet Demir', 4: 'Zeynep Bal', 5: 'Can Sarı' },
    '9-B': { 1: 'Burak Şen', 2: 'Elif Yıldız', 3: 'Emre Ak', 4: 'Gamze Kara', 5: 'Oğuzhan Tekin' }
  });
  const [currentClass, setCurrentClass] = useState('9-A');
  const [roster, setRoster] = useState({
    1: 'Ali Yılmaz',
    2: 'Ayşe Kaya',
    3: 'Mehmet Demir',
    4: 'Zeynep Bal',
    5: 'Can Sarı'
  });
  const [newClassName, setNewClassName] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [bulkNames, setBulkNames] = useState('');

  const fileInputRef = useRef(null);

  // Yerel Sınıflar ve Roster'ı yükle
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
          const savedRoster = localStorage.getItem('scanquiz_roster');
          if (savedRoster) {
            const parsed = JSON.parse(savedRoster);
            setRoster(parsed);
            setClasses({ '9-A': parsed });
          }
        }
      } catch (e) {}
    }
  }, []);

  // Öğrenci tarama verilerini dinle
  useEffect(() => {
    const unsubScan = syncEngine.on('student_scanned_raw', (payload) => {
      if (questionState === 'RUNNING') {
        handleStudentResponse(payload.studentId, payload.choice);
      }
    });

    return () => unsubScan();
  }, [questionState, activeQuestion]);

  // Öğretmen tahtadaki kodu elle girip bağlandığında
  const handlePair = (e) => {
    if (e) e.preventDefault();
    const cleanPin = targetPin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      alert('Lütfen tahtada görünen geçerli bir PIN kodu girin.');
      return;
    }

    syncEngine.setRoom(cleanPin);
    syncEngine.emit('host_paired', { pin: cleanPin });
    setIsPaired(true);
    soundEffects.playSubmit();
  };

  const handleStudentResponse = (studentId, choice) => {
    setSubmissions((prev) => {
      const next = new Map(prev);
      next.set(studentId, { choice, time: Date.now() });
      return next;
    });

    // Tahtaya şıksız yayın
    syncEngine.emit('student_submitted', {
      studentId,
      status: 'SUBMITTED'
    });

    soundEffects.playSubmit();
  };

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
      handleResetBoard();
    }
  };

  const handleResetBoard = () => {
    setQuestionState('IDLE');
    setActiveQuestion(null);
    setSubmissions(new Map());
    syncEngine.emit('reset_question', {});
  };

  // Sınıf ve Roster Güncellemeleri
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
    const updatedClasses = { ...classes, [trimmed]: {} };
    setClasses(updatedClasses);
    setCurrentClass(trimmed);
    setRoster({});
    setNewClassName('');
    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_classes', JSON.stringify(updatedClasses));
      localStorage.setItem('scanquiz_current_class', trimmed);
      localStorage.setItem('scanquiz_roster', JSON.stringify({}));
    }
    syncEngine.emit('roster_updated', {});
  };

  const handleDeleteClass = (cName) => {
    const classKeys = Object.keys(classes);
    if (classKeys.length <= 1) {
      alert('En az bir sınıf kalmalıdır!');
      return;
    }
    if (!confirm(`"${cName}" sınıfını silmek istediğinize emin misiniz?`)) return;

    const updatedClasses = { ...classes };
    delete updatedClasses[cName];
    setClasses(updatedClasses);

    const fallback = Object.keys(updatedClasses)[0];
    setCurrentClass(fallback);
    const targetRoster = updatedClasses[fallback] || {};
    setRoster(targetRoster);

    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_classes', JSON.stringify(updatedClasses));
      localStorage.setItem('scanquiz_current_class', fallback);
      localStorage.setItem('scanquiz_roster', JSON.stringify(targetRoster));
    }
    syncEngine.emit('roster_updated', targetRoster);
  };

  const saveRoster = (newRoster) => {
    setRoster(newRoster);
    const updatedClasses = { ...classes, [currentClass]: newRoster };
    setClasses(updatedClasses);
    if (typeof window !== 'undefined') {
      localStorage.setItem('scanquiz_classes', JSON.stringify(updatedClasses));
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
    alert(`${lines.length} adet öğrenci ${currentClass} sınıfına eklendi.`);
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setImportStatus('Dosya işleniyor...');

    try {
      const parsed = await parseQuizFile(file);
      if (parsed && parsed.length > 0) {
        setQuestions(parsed);
        setCurrentIndex(0);
        setImportStatus(`✓ ${parsed.length} soru aktarıldı.`);
        soundEffects.playReveal();
      } else {
        setImportStatus('Dosyadan soru okunamadı.');
      }
    } catch (err) {
      setImportStatus('Hata: ' + err.message);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      {/* Üst Çubuk */}
      <header className="panel panel-header" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>
            ScanQuiz Kumanda
          </span>
          <span className={`badge ${isPaired ? 'badge-success' : 'badge-warning'}`}>
            {isPaired ? `Oda: ${targetPin}` : 'Eşleşme Bekleniyor'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#0e1017', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-subtle)', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sınıf:</span>
            <select
              value={currentClass}
              onChange={(e) => handleSelectClass(e.target.value)}
              style={{
                background: 'transparent',
                color: 'var(--primary)',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {Object.keys(classes).map((cName) => (
                <option key={cName} value={cName} style={{ background: '#131620', color: '#fff' }}>
                  {cName} ({Object.keys(classes[cName] || {}).length} Öğr.)
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => setIsRosterModalOpen(true)} className="btn btn-sm">
            Sınıflar & Öğrenci Listesi
          </button>
          <button onClick={() => setIsPrintModalOpen(true)} className="btn btn-sm">
            Kartları Yazdır
          </button>
          <Link href="/ogretmen" className="btn btn-sm btn-primary">
            Mobil Kamera
          </Link>
        </div>
      </header>

      {/* PIN Eşleşme Alanı (Otonom doldurma KALDIRILDI) */}
      {!isPaired && (
        <section className="panel" style={{ padding: '24px', marginBottom: '20px' }}>
          <form onSubmit={handlePair} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Tahta Bağlantısı</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Akıllı tahtanın ekranında gördüğünüz 6 haneli katılım kodunu girin.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Örn: 482910"
                maxLength={6}
                value={targetPin}
                onChange={(e) => setTargetPin(e.target.value.replace(/\D/g, ''))}
                className="input"
                style={{ width: '140px', fontFamily: 'var(--font-mono)', fontSize: '1.1rem', textAlign: 'center' }}
                autoFocus
              />
              <button type="submit" className="btn btn-primary">
                Tahtaya Bağlan
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Ana Çalışma Alanı */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px' }}>
        {/* Sol Kolon: Aktif Soru Kontrolleri */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section className="panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span className="badge badge-info">Soru {currentIndex + 1} / {questions.length}</span>
              <span className={`badge ${questionState === 'RUNNING' ? 'badge-warning' : questionState === 'ENDED' ? 'badge-success' : 'badge-info'}`}>
                {questionState === 'RUNNING' ? 'Yayında' : questionState === 'ENDED' ? 'Cevaplar Açıklandı' : 'Hazır'}
              </span>
            </div>

            <div style={{ background: '#0e1017', padding: '18px', borderRadius: '10px', marginBottom: '20px', border: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px' }}>
                {questions[currentIndex]?.text}
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {['A', 'B', 'C', 'D'].map((opt) => {
                  const isCorrect = questions[currentIndex]?.correctAnswer === opt;
                  return (
                    <div
                      key={opt}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isCorrect ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: isCorrect ? '1px solid var(--success)' : '1px solid transparent',
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <strong style={{ color: isCorrect ? 'var(--success)' : 'var(--text-muted)' }}>{opt}:</strong>
                      <span>{questions[currentIndex]?.options?.[opt] || '-'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {questionState !== 'RUNNING' ? (
                <button onClick={() => handleStartQuestion()} className="btn btn-success" style={{ flex: 1 }}>
                  Soruyu Tahtada Başlat
                </button>
              ) : (
                <button onClick={handleEndQuestion} className="btn btn-danger" style={{ flex: 1 }}>
                  Soruyu Bitir (Cevapları Açıkla)
                </button>
              )}

              <button
                onClick={handleNextQuestion}
                disabled={currentIndex + 1 >= questions.length}
                className="btn"
              >
                Sıradaki Soru
              </button>

              <button onClick={handleResetBoard} className="btn">
                Sıfırla
              </button>
            </div>
          </section>

          {/* Öğretmene Özel Canlı Akış */}
          <section className="panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Canlı Yanıtlar (Öğretmen Görünümü)</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tahtada şıklar gizlidir fakat kimin ne dediğini buradan anlık görebilirsiniz.
                </p>
              </div>
              <span className="badge badge-info">{submissions.size} Katılımcı</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {Array.from(submissions.entries()).map(([studentId, data]) => {
                const isCorrect = activeQuestion && data.choice === activeQuestion.correctAnswer;
                const sName = roster[studentId] || `Öğrenci #${studentId}`;

                return (
                  <div
                    key={studentId}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      background: '#0e1017',
                      border: `1px solid ${isCorrect ? 'var(--success)' : 'var(--border-subtle)'}`,
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sName}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: isCorrect ? 'var(--success)' : 'var(--danger)', marginTop: '2px' }}>
                      {data.choice}
                    </div>
                  </div>
                );
              })}

              {submissions.size === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  Henüz gelen yanıt yok. Kamera veya aşağıdaki simülatör butonlarıyla test edebilirsiniz.
                </div>
              )}
            </div>

            {/* Simülatör Butonları */}
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                Test Simülatörü:
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.keys(roster).slice(0, 6).map((sId) => (
                  <div key={sId} style={{ display: 'inline-flex', background: '#0e1017', padding: '4px 6px', borderRadius: '6px', gap: '4px' }}>
                    <span style={{ fontSize: '0.75rem', alignSelf: 'center', color: 'var(--text-muted)' }}>#{sId}:</span>
                    {['A', 'B', 'C', 'D'].map((ch) => (
                      <button
                        key={ch}
                        onClick={() => handleStudentResponse(parseInt(sId), ch)}
                        style={{
                          background: 'rgba(255,255,255,0.06)',
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

        {/* Sağ Kolon: PDF/Excel Yükleme & Soru Havuzu */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section className="panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '4px' }}>
              Soru İçe Aktar (PDF / Excel / CSV)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Sorularınızı içeren dosyayı seçin.
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

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => fileInputRef.current?.click()} className="btn btn-sm btn-primary" style={{ flex: 1 }}>
                Dosya Seç (.pdf / .xlsx / .csv)
              </button>
              <button
                onClick={() => { setQuestions(DEFAULT_QUESTIONS); setCurrentIndex(0); setImportStatus('Demo sorular yüklendi.'); }}
                className="btn btn-sm"
              >
                Örnek Sorular
              </button>
            </div>

            {importStatus && (
              <div style={{ marginTop: '10px', fontSize: '0.8rem', color: importStatus.includes('✓') ? 'var(--success)' : 'var(--warning)' }}>
                {importStatus}
              </div>
            )}
          </section>

          {/* Soru Listesi */}
          <section className="panel" style={{ padding: '20px', flex: 1 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px' }}>
              Soru Havuzu ({questions.length})
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {questions.map((q, idx) => {
                const isSelected = idx === currentIndex;
                return (
                  <div
                    key={q.id || idx}
                    onClick={() => setCurrentIndex(idx)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--primary-subtle)' : '#0e1017',
                      border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-subtle)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '0.82rem' }}>
                      <strong>#{idx + 1}</strong>
                      <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>Cevap: {q.correctAnswer}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {q.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Sınıf & Öğrenci Listesi Modalı */}
      {isRosterModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="panel" style={{ maxWidth: '640px', width: '100%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Sınıflar & Öğrenci Eşleme</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Plickers mantığı: Kartlar sabit, her sınıf için sadece isimleri eşleyin.
                </p>
              </div>
              <button onClick={() => setIsRosterModalOpen(false)} className="btn btn-sm">✕</button>
            </div>

            {/* Plickers Bilgilendirme Kutusu */}
            <div style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '18px',
              fontSize: '0.82rem',
              lineHeight: '1.45',
              color: '#c7d2fe'
            }}>
              <strong>💡 Nasıl Çalışır? (Plickers Mantığı):</strong>
              <div style={{ marginTop: '4px' }}>
                • <strong>Kartlar Kalıcıdır:</strong> 1-50 arası kartları bir kere yazdırın. Her tur veya soru için yeni kart gerekmez!
              </div>
              <div>
                • <strong>Çoklu Sınıf:</strong> 9-A, 10-B gibi farklı sınıflara girerken kartlar değişmez. Sadece buradan sınıfı seçin. 1 numaralı kart o sınıftaki 1. öğrenciye verilir.
              </div>
              <div>
                • <strong>Cevap Verme:</strong> Öğrenci seçtiği şıkkı (A, B, C veya D) en üste gelecek şekilde kartı çevirip kameraya gösterir.
              </div>
            </div>

            {/* Sınıf Seçimi ve Yeni Sınıf Ekleme */}
            <div style={{ background: '#0e1017', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Aktif Sınıf:</span>
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
                  {Object.keys(classes).length > 1 && (
                    <button
                      onClick={() => handleDeleteClass(currentClass)}
                      className="btn btn-sm"
                      style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '4px 8px' }}
                      title="Bu sınıfı sil"
                    >
                      Sil
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="Yeni Sınıf (örn: 10-B)"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    className="input"
                    style={{ width: '130px', padding: '6px 8px', fontSize: '0.82rem' }}
                  />
                  <button onClick={handleAddClass} className="btn btn-sm btn-primary">
                    + Sınıf Aç
                  </button>
                </div>
              </div>
            </div>

            {/* Tekli Öğrenci Ekleme */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                type="number"
                placeholder="Kart No (1-50)"
                min={1}
                max={50}
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                className="input"
                style={{ width: '120px' }}
              />
              <input
                type="text"
                placeholder="Öğrenci Adı Soyadı"
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                className="input"
                style={{ flex: 1 }}
              />
              <button onClick={addStudent} className="btn btn-success">
                + Ekle
              </button>
            </div>

            {/* Öğrenci Listesi Grid */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                {currentClass} Sınıfı Öğrencileri ({Object.keys(roster).length})
              </span>
            </div>

            <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {Object.entries(roster).sort(([a],[b]) => parseInt(a)-parseInt(b)).map(([sId, sName]) => (
                <div key={sId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#0e1017', borderRadius: '6px', fontSize: '0.82rem', border: '1px solid var(--border-subtle)' }}>
                  <span><strong style={{ color: 'var(--primary)' }}>Kart #{sId}:</strong> {sName}</span>
                  <button onClick={() => removeStudent(sId)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '2px 6px' }}>✕</button>
                </div>
              ))}
              {Object.keys(roster).length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '16px', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                  Bu sınıfta henüz kayıtlı öğrenci yok. Yukarıdan ekleyin veya aşağıya toplu yapıştırın.
                </div>
              )}
            </div>

            {/* Toplu Liste Yapıştırma */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                Toplu İsim Yapıştır (Her satır sırasıyla 1, 2, 3... numaralı karta atanır):
              </div>
              <textarea
                rows={3}
                value={bulkNames}
                onChange={(e) => setBulkNames(e.target.value)}
                placeholder="Ali Yılmaz&#10;Ayşe Kaya&#10;Mehmet Demir"
                className="input"
                style={{ marginBottom: '8px', fontSize: '0.82rem', width: '100%' }}
              />
              <button onClick={handleBulkImport} className="btn btn-sm btn-primary" style={{ width: '100%' }}>
                {currentClass} Sınıfına Toplu Listeyi Aktar
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintableCardsModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        roster={roster}
      />
    </div>
  );
}
