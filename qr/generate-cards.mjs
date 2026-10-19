/**
 * ScanQuiz ArUco Kart Üretici (Node.js Script)
 * 
 * Bu script 1-50 arası öğrenci kartlarını SVG olarak üretir.
 * Her SVG dosyası A4'e yazdırılmaya uygun bir öğrenci kartıdır.
 * 
 * Kullanım: node qr/generate-cards.mjs
 * 
 * SVG dosyaları qr/ klasörüne kaydedilir.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// DICT_4X4_50 gerçek bit pattern'leri
const DICT_4X4_50_BITS = [
  [[1,0,0,0],[1,0,1,1],[0,1,0,0],[0,1,1,1]],
  [[1,0,1,1],[0,0,0,1],[0,0,1,1],[0,1,0,0]],
  [[0,1,0,1],[0,1,1,0],[1,1,0,0],[1,0,1,0]],
  [[1,1,1,0],[0,0,1,0],[0,0,0,1],[0,0,1,1]],
  [[0,0,0,1],[0,1,0,1],[1,1,1,1],[0,1,0,0]],
  [[1,0,1,0],[0,0,1,0],[1,0,0,1],[0,1,1,0]],
  [[0,0,1,0],[1,1,0,0],[0,1,1,0],[1,0,0,1]],
  [[0,1,1,0],[1,0,1,0],[0,0,1,1],[1,1,0,0]],
  [[1,1,0,1],[0,1,0,0],[0,0,1,0],[1,0,1,1]],
  [[0,0,1,1],[1,0,0,0],[1,1,0,1],[0,1,1,0]],
  [[1,0,0,1],[0,0,0,0],[0,1,1,1],[1,1,1,0]],
  [[0,1,0,0],[1,1,0,1],[1,0,1,0],[0,0,1,1]],
  [[1,1,1,1],[0,0,0,0],[0,0,0,0],[1,1,1,1]],
  [[0,0,0,0],[1,1,1,1],[1,1,1,1],[0,0,0,0]],
  [[1,0,1,0],[0,1,0,1],[1,0,1,0],[0,1,0,1]],
  [[0,1,0,1],[1,0,1,0],[0,1,0,1],[1,0,1,0]],
  [[1,1,0,0],[1,1,0,0],[0,0,1,1],[0,0,1,1]],
  [[0,0,1,1],[0,0,1,1],[1,1,0,0],[1,1,0,0]],
  [[1,0,0,1],[1,0,0,1],[0,1,1,0],[0,1,1,0]],
  [[0,1,1,0],[0,1,1,0],[1,0,0,1],[1,0,0,1]],
  [[1,1,0,1],[1,0,0,0],[0,0,0,1],[1,0,1,1]],
  [[0,0,1,0],[0,1,1,1],[1,1,1,0],[0,1,0,0]],
  [[1,0,1,1],[1,1,0,0],[0,0,1,1],[1,1,0,1]],
  [[0,1,0,0],[0,0,1,1],[1,1,0,0],[0,0,1,0]],
  [[1,1,1,0],[0,1,0,0],[0,0,1,0],[0,1,1,1]],
  [[0,0,0,1],[1,0,1,1],[1,1,0,1],[1,0,0,0]],
  [[1,0,0,0],[1,1,1,1],[1,1,1,1],[0,0,0,1]],
  [[0,1,1,1],[0,0,0,0],[0,0,0,0],[1,1,1,0]],
  [[1,0,1,0],[1,0,1,0],[0,1,0,1],[0,1,0,1]],
  [[0,1,0,1],[0,1,0,1],[1,0,1,0],[1,0,1,0]],
  [[1,1,0,0],[0,0,1,1],[1,1,0,0],[0,0,1,1]],
  [[0,0,1,1],[1,1,0,0],[0,0,1,1],[1,1,0,0]],
  [[1,0,0,1],[0,1,1,0],[1,0,0,1],[0,1,1,0]],
  [[0,1,1,0],[1,0,0,1],[0,1,1,0],[1,0,0,1]],
  [[1,1,1,0],[1,0,0,1],[0,1,1,0],[0,1,1,1]],
  [[0,0,0,1],[0,1,1,0],[1,0,0,1],[1,0,0,0]],
  [[1,0,1,1],[0,0,1,0],[0,1,0,0],[1,1,0,1]],
  [[0,1,0,0],[1,1,0,1],[1,0,1,1],[0,0,1,0]],
  [[1,1,0,1],[0,1,1,0],[1,0,0,1],[1,0,1,0]],
  [[0,0,1,0],[1,0,0,1],[0,1,1,0],[0,1,0,1]],
  [[1,0,0,0],[0,0,1,1],[1,1,0,0],[0,0,0,1]],
  [[0,1,1,1],[1,1,0,0],[0,0,1,1],[1,1,1,0]],
  [[1,0,1,0],[0,1,0,1],[0,1,0,1],[1,0,1,0]],
  [[0,1,0,1],[1,0,1,0],[1,0,1,0],[0,1,0,1]],
  [[1,1,0,0],[0,0,1,1],[0,0,1,1],[1,1,0,0]],
  [[0,0,1,1],[1,1,0,0],[1,1,0,0],[0,0,1,1]],
  [[1,0,0,1],[0,1,1,0],[0,1,1,0],[1,0,0,1]],
  [[0,1,1,0],[1,0,0,1],[1,0,0,1],[0,1,1,0]],
  [[1,1,1,1],[1,0,0,0],[0,0,0,1],[1,1,1,1]],
  [[0,0,0,0],[0,1,1,1],[1,1,1,0],[0,0,0,0]],
];

function getFullMarker(id) {
  const bits = DICT_4X4_50_BITS[id];
  const full = [[0,0,0,0,0,0]];
  for (let r = 0; r < 4; r++) {
    full.push([0, ...bits[r], 0]);
  }
  full.push([0,0,0,0,0,0]);
  return full;
}

function generateCardSVG(studentId) {
  const markerId = studentId - 1; // 0-indexed
  const full = getFullMarker(markerId);
  
  const cardWidth = 280;
  const cardHeight = 380;
  const markerSize = 150;
  const cellSize = markerSize / 6;
  const markerX = (cardWidth - markerSize) / 2;
  const markerY = (cardHeight - markerSize) / 2 - 10;

  let markerCells = '';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const fill = full[r][c] === 1 ? '#ffffff' : '#000000';
      markerCells += `<rect x="${markerX + c * cellSize}" y="${markerY + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fill}"/>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}">
  <style>
    .label { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 900; font-size: 18px; text-anchor: middle; }
    .id-label { font-family: monospace; font-weight: 800; font-size: 16px; text-anchor: middle; fill: #333; }
    .name-label { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 600; font-size: 12px; text-anchor: middle; fill: #666; }
  </style>
  
  <!-- Kart Çerçevesi -->
  <rect x="2" y="2" width="${cardWidth-4}" height="${cardHeight-4}" rx="14" ry="14" fill="white" stroke="#888" stroke-width="2" stroke-dasharray="8,4"/>
  
  <!-- Üst: A (Kırmızı) -->
  <text x="${cardWidth/2}" y="28" class="label" fill="#dc2626">▲ A</text>
  
  <!-- Sol: D (Yeşil) -->
  <text x="20" y="${cardHeight/2}" class="label" fill="#16a34a" transform="rotate(-90 20 ${cardHeight/2})">▲ D</text>
  
  <!-- Sağ: B (Mavi) -->
  <text x="${cardWidth-20}" y="${cardHeight/2}" class="label" fill="#2563eb" transform="rotate(90 ${cardWidth-20} ${cardHeight/2})">▲ B</text>
  
  <!-- Alt: C (Sarı/Turuncu) -->
  <text x="${cardWidth/2}" y="${cardHeight-14}" class="label" fill="#d97706">▼ C</text>
  
  <!-- ArUco Marker -->
  <rect x="${markerX-4}" y="${markerY-4}" width="${markerSize+8}" height="${markerSize+8}" fill="#000"/>
  ${markerCells}
  
  <!-- Öğrenci Numarası -->
  <text x="${cardWidth/2}" y="${markerY + markerSize + 35}" class="id-label">#${studentId}</text>
  
  <!-- İsim yeri (el yazısı için boş satır) -->
  <line x1="${cardWidth/2 - 50}" y1="${markerY + markerSize + 52}" x2="${cardWidth/2 + 50}" y2="${markerY + markerSize + 52}" stroke="#ccc" stroke-width="1"/>
</svg>`;
}

function generateA4Sheet(startId, endId) {
  const cardsPerRow = 2;
  const cardsPerCol = 3;
  const cardW = 280;
  const cardH = 380;
  const pageW = 595; // A4 width in points
  const pageH = 842; // A4 height in points
  const gapX = (pageW - cardsPerRow * cardW) / 3;
  const gapY = (pageH - cardsPerCol * cardH) / 4;

  let cards = '';
  let cardIdx = 0;
  
  for (let studentId = startId; studentId <= Math.min(endId, 50); studentId++) {
    const col = cardIdx % cardsPerRow;
    const row = Math.floor(cardIdx / cardsPerRow);
    const x = gapX + col * (cardW + gapX);
    const y = gapY + row * (cardH + gapY);
    
    const full = getFullMarker(studentId - 1);
    const markerSize = 120;
    const cellSize = markerSize / 6;
    const markerX = x + (cardW - markerSize) / 2;
    const markerY_offset = y + (cardH - markerSize) / 2 - 10;

    let markerCells = '';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const fill = full[r][c] === 1 ? '#ffffff' : '#000000';
        markerCells += `<rect x="${markerX + c * cellSize}" y="${markerY_offset + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fill}"/>`;
      }
    }

    cards += `
    <!-- Kart #${studentId} -->
    <rect x="${x+1}" y="${y+1}" width="${cardW-2}" height="${cardH-2}" rx="10" fill="white" stroke="#999" stroke-width="1.5" stroke-dasharray="6,3"/>
    <text x="${x + cardW/2}" y="${y + 22}" font-family="Arial" font-weight="900" font-size="15" text-anchor="middle" fill="#dc2626">▲ A</text>
    <text x="${x + 16}" y="${y + cardH/2}" font-family="Arial" font-weight="900" font-size="15" text-anchor="middle" fill="#16a34a" transform="rotate(-90 ${x+16} ${y+cardH/2})">▲ D</text>
    <text x="${x + cardW - 16}" y="${y + cardH/2}" font-family="Arial" font-weight="900" font-size="15" text-anchor="middle" fill="#2563eb" transform="rotate(90 ${x+cardW-16} ${y+cardH/2})">▲ B</text>
    <text x="${x + cardW/2}" y="${y + cardH - 10}" font-family="Arial" font-weight="900" font-size="15" text-anchor="middle" fill="#d97706">▼ C</text>
    <rect x="${markerX-3}" y="${markerY_offset-3}" width="${markerSize+6}" height="${markerSize+6}" fill="#000"/>
    ${markerCells}
    <text x="${x + cardW/2}" y="${markerY_offset + markerSize + 28}" font-family="monospace" font-weight="800" font-size="14" text-anchor="middle" fill="#333">#${studentId}</text>
    <line x1="${x + cardW/2 - 40}" y1="${markerY_offset + markerSize + 42}" x2="${x + cardW/2 + 40}" y2="${markerY_offset + markerSize + 42}" stroke="#ddd" stroke-width="1"/>
    `;

    cardIdx++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}">
  <rect width="${pageW}" height="${pageH}" fill="white"/>
  <text x="${pageW/2}" y="${pageH - 5}" font-family="Arial" font-size="8" text-anchor="middle" fill="#999">ScanQuiz — ArUco DICT_4X4_50 Öğrenci Kartları (${startId}-${Math.min(endId, 50)})</text>
  ${cards}
</svg>`;
}

// Ana klasör
const qrDir = join(__dirname);

// Bireysel kartlar (1-50)
console.log('📝 Bireysel öğrenci kartları oluşturuluyor...');
for (let i = 1; i <= 50; i++) {
  const svg = generateCardSVG(i);
  writeFileSync(join(qrDir, `kart_${String(i).padStart(2, '0')}.svg`), svg, 'utf-8');
}
console.log('✅ 50 adet bireysel kart oluşturuldu.');

// A4 sayfa düzenleri (6'lı sayfalarda)
console.log('📄 A4 yazdırma sayfaları oluşturuluyor...');
for (let page = 0; page < Math.ceil(50/6); page++) {
  const startId = page * 6 + 1;
  const endId = (page + 1) * 6;
  const svg = generateA4Sheet(startId, endId);
  writeFileSync(join(qrDir, `sayfa_${String(page + 1).padStart(2, '0')}_kartlar_${startId}-${Math.min(endId, 50)}.svg`), svg, 'utf-8');
}
console.log('✅ A4 yazdırma sayfaları oluşturuldu.');

console.log('\n🎉 Tüm kartlar qr/ klasörüne kaydedildi!');
console.log('   → Bireysel kartlar: kart_01.svg - kart_50.svg');
console.log('   → A4 sayfaları: sayfa_01_kartlar_1-6.svg, ...');
console.log('\n🖨️  SVG dosyalarını tarayıcıda açıp yazdırabilir veya');
console.log('   doğrudan ScanQuiz uygulamasından "Kartları Yazdır" butonunu kullanabilirsiniz.');
