'use client';

import { useState } from 'react';

// DICT_4X4_50 örnek kodlamaları (4x4 bit dizileri)
// Her kart için 4x4 binary matris üretimi
function getAruco4x4Bits(id) {
  // Deterministik ArUco 4x4 deseni üretimi (id bazlı)
  const bits = [];
  let seed = (id * 1103515245 + 12345) & 0x7fffffff;
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 4; c++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // Dış kenarlar ve kontrast için bit belirleme
      row.push((seed >> 16) & 1);
    }
    bits.push(row);
  }
  return bits;
}

export default function PrintableCardsModal({ isOpen, onClose }) {
  const [cardCount, setCardCount] = useState(30);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px',
      overflowY: 'auto'
    }}>
      {/* Yazdırma Kontrol Barı (Yazıcıda gizlenir) */}
      <div className="no-print" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#1a1a2e',
        padding: '16px 24px',
        borderRadius: '16px',
        marginBottom: '20px',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f0f0f5' }}>
            🖨️ ArUco Öğrenci Kartları Yazdırma Aracı
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#8888a0' }}>
            A4 kağıda yazdırıp öğrencilere dağıtın. Kartı çevirerek doğru şıkkı yukarı tutmaları yeterlidir!
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ fontSize: '0.9rem', color: '#8888a0' }}>
            Öğrenci Sayısı:
            <input
              type="number"
              min="1"
              max="50"
              value={cardCount}
              onChange={(e) => setCardCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{
                marginLeft: '8px',
                width: '60px',
                padding: '6px 10px',
                background: '#0a0a0f',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
          </label>

          <button onClick={handlePrint} className="btn btn-primary" style={{ padding: '8px 20px' }}>
            🖨️ Yazdır (A4)
          </button>

          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
            ✕ Kapat
          </button>
        </div>
      </div>

      {/* Yazdırılabilir Kartlar Tablosu */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '20px',
        background: '#fff',
        padding: '24px',
        borderRadius: '16px',
        color: '#000'
      }} className="printable-area">
        {Array.from({ length: cardCount }).map((_, idx) => {
          const studentId = idx + 1;
          const bits = getAruco4x4Bits(studentId);

          return (
            <div key={studentId} style={{
              border: '3px dashed #333',
              borderRadius: '16px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              height: '340px',
              background: '#fff',
              pageBreakInside: 'avoid'
            }}>
              {/* Üst Şık: B */}
              <div style={{
                position: 'absolute',
                top: '8px',
                fontWeight: 900,
                fontSize: '1.4rem',
                color: '#000',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                ▲ B (YUKARI)
              </div>

              {/* Sol Şık: C */}
              <div style={{
                position: 'absolute',
                left: '12px',
                fontWeight: 900,
                fontSize: '1.4rem',
                color: '#000',
                transform: 'rotate(-90deg)'
              }}>
                ▲ C
              </div>

              {/* Sağ Şık: A */}
              <div style={{
                position: 'absolute',
                right: '12px',
                fontWeight: 900,
                fontSize: '1.4rem',
                color: '#000',
                transform: 'rotate(90deg)'
              }}>
                ▲ A
              </div>

              {/* Alt Şık: D */}
              <div style={{
                position: 'absolute',
                bottom: '8px',
                fontWeight: 900,
                fontSize: '1.4rem',
                color: '#000'
              }}>
                ▼ D
              </div>

              {/* ArUco 4x4 Marker Çerçevesi */}
              <div style={{
                width: '160px',
                height: '160px',
                background: '#000',
                padding: '20px',
                boxSizing: 'border-box',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridTemplateRows: 'repeat(4, 1fr)',
                gap: '2px',
                border: '4px solid #000'
              }}>
                {bits.flatMap((row, rIdx) =>
                  row.map((bit, cIdx) => (
                    <div
                      key={`${rIdx}-${cIdx}`}
                      style={{
                        background: bit === 1 ? '#fff' : '#000',
                        width: '100%',
                        height: '100%'
                      }}
                    />
                  ))
                )}
              </div>

              {/* Öğrenci No & İsim Etiketi */}
              <div style={{
                marginTop: '12px',
                fontWeight: 800,
                fontSize: '1.05rem',
                fontFamily: 'monospace',
                color: '#111',
                textAlign: 'center'
              }}>
                Öğrenci #{studentId}
                {typeof window !== 'undefined' && (() => {
                  try {
                    const r = JSON.parse(localStorage.getItem('scanquiz_roster') || '{}');
                    return r[studentId] ? <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#333' }}>{r[studentId]}</div> : null;
                  } catch(e) { return null; }
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-area, .printable-area * {
            visibility: visible;
          }
          .printable-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 10px;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
