'use client';

import { useState, useEffect } from 'react';
import { getArucoMarkerFull, DICT_SIZE } from '@/lib/aruco-dictionary';

/**
 * ArUco Öğrenci Kartları Yazdırma Aracı
 * A4 kağıda 2'li grid halinde, 1'den 50'ye kadar öğrenci kartı üretir.
 * Her kartta gerçek DICT_4X4_50 ArUco marker + şık yönleri bulunur.
 */
export default function PrintableCardsModal({ isOpen, onClose, roster = {} }) {
  const [cardCount, setCardCount] = useState(50);
  const [showNames, setShowNames] = useState(true);
  const [currentRoster, setCurrentRoster] = useState(roster);

  // Roster'ı localStorage'dan yükle
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('scanquiz_roster');
        if (saved) {
          const parsed = JSON.parse(saved);
          setCurrentRoster(prev => ({ ...parsed, ...roster }));
        }
      } catch (e) {}
    }
  }, [roster]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  /**
   * ArUco marker'ı Canvas'a çizer
   */
  const renderMarkerSVG = (id) => {
    const full = getArucoMarkerFull(id);
    const cellSize = 18;
    const size = 6 * cellSize;
    
    const cells = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={c * cellSize}
            y={r * cellSize}
            width={cellSize}
            height={cellSize}
            fill={full[r][c] === 1 ? '#ffffff' : '#000000'}
          />
        );
      }
    }

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
        <rect width={size} height={size} fill="#000000" />
        {cells}
      </svg>
    );
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      backdropFilter: 'blur(12px)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px',
      overflowY: 'auto'
    }}>
      {/* Yazdırma Kontrol Barı */}
      <div className="no-print" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#12151f',
        padding: '16px 24px',
        borderRadius: '16px',
        marginBottom: '20px',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f0f0f5', marginBottom: '4px' }}>
            🖨️ ArUco DICT_4X4_50 Öğrenci Kartları
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#8888a0' }}>
            A4 kağıda yazdırıp, makasla kesin ve öğrencilere dağıtın. Kartı doğru şık yukarı gelecek şekilde havaya kaldırmaları yeterli!
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
          <label style={{ fontSize: '0.85rem', color: '#8888a0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Kart Sayısı:
            <input
              type="number"
              min="1"
              max="50"
              value={cardCount}
              onChange={(e) => setCardCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{
                width: '60px',
                padding: '6px 10px',
                background: '#0a0d14',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: '#fff',
                textAlign: 'center',
                fontSize: '0.9rem'
              }}
            />
          </label>

          <label style={{ fontSize: '0.82rem', color: '#8888a0', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showNames}
              onChange={(e) => setShowNames(e.target.checked)}
              style={{ accentColor: '#3b82f6' }}
            />
            İsim Göster
          </label>

          <button
            onClick={handlePrint}
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#fff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            🖨️ Yazdır (A4)
          </button>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#9ca3af',
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ✕ Kapat
          </button>
        </div>
      </div>

      {/* Yazdırılabilir Kartlar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '16px',
        background: '#fff',
        padding: '20px',
        borderRadius: '16px',
        color: '#000'
      }} className="printable-area">
        {Array.from({ length: Math.min(cardCount, DICT_SIZE) }).map((_, idx) => {
          // Marker ID'ler 0 tabanlı, öğrenci numaraları 1 tabanlı
          const studentId = idx + 1;
          const markerId = idx; // DICT_4X4_50 ID: 0-49
          const studentName = currentRoster[studentId] || '';

          return (
            <div key={studentId} style={{
              border: '2px dashed #888',
              borderRadius: '14px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              height: '320px',
              background: '#fff',
              pageBreakInside: 'avoid'
            }}>
              {/* Üst Şık: A */}
              <div style={{
                position: 'absolute',
                top: '6px',
                fontWeight: 900,
                fontSize: '1.2rem',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                letterSpacing: '0.05em'
              }}>
                ▲ A
              </div>

              {/* Sol Şık: D */}
              <div style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%) rotate(-90deg)',
                fontWeight: 900,
                fontSize: '1.2rem',
                color: '#16a34a',
                letterSpacing: '0.05em'
              }}>
                ▲ D
              </div>

              {/* Sağ Şık: B */}
              <div style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%) rotate(90deg)',
                fontWeight: 900,
                fontSize: '1.2rem',
                color: '#2563eb',
                letterSpacing: '0.05em'
              }}>
                ▲ B
              </div>

              {/* Alt Şık: C */}
              <div style={{
                position: 'absolute',
                bottom: '6px',
                fontWeight: 900,
                fontSize: '1.2rem',
                color: '#d97706',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                letterSpacing: '0.05em'
              }}>
                ▼ C
              </div>

              {/* ArUco Marker (Gerçek DICT_4X4_50) */}
              <div style={{
                border: '6px solid #000',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '8px'
              }}>
                {renderMarkerSVG(markerId)}
              </div>

              {/* Öğrenci Bilgileri */}
              <div style={{
                fontWeight: 800,
                fontSize: '0.95rem',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#111',
                textAlign: 'center',
                lineHeight: 1.4
              }}>
                <div>#{studentId}</div>
                {showNames && studentName && (
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#444', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {studentName}
                  </div>
                )}
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
            visibility: visible !important;
          }
          .printable-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 10mm;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4;
            margin: 8mm;
          }
        }
      `}</style>
    </div>
  );
}
