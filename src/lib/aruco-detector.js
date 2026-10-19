/**
 * ScanQuiz Yüksek Performanslı ArUco DICT_4X4_50 Kart Algılayıcı (Dual Engine)
 * 
 * 1. Motor: OpenCV.js Kontur & Perspektif Düzeltme (Hızlı, açılı/eğik kartları mükemmel yakalar)
 * 2. Motor: Pure JS Canvas 2D Adaptif Izgara Tarayıcısı (OpenCV yüklenmese bile çalışır)
 */

import { getArucoBits, DICT_SIZE } from './aruco-dictionary';
import { calculateRotationAngle, angleToChoice } from './angle-math';

// 50 marker'ın her biri için 4 dönüşün (A, B, C, D) 16-bit değerlerini önceden hash'le
const ROTATION_LOOKUP = new Map();

function rotateMatrix90(mat) {
  const N = mat.length;
  const res = Array.from({ length: N }, () => Array(N).fill(0));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      res[c][N - 1 - r] = mat[r][c];
    }
  }
  return res;
}

function bitsToNumber(mat) {
  let val = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      val = (val << 1) | (mat[r][c] & 1);
    }
  }
  return val;
}

// 50 kart için A (0°), B (90°), C (180°), D (270°) eşleştirmeleri
for (let id = 0; id < DICT_SIZE; id++) {
  let currentMat = getArucoBits(id);
  const choices = ['A', 'B', 'C', 'D'];
  for (let rot = 0; rot < 4; rot++) {
    const num = bitsToNumber(currentMat);
    // rot=0 -> 'A' üstte, rot=1 -> 'B' üstte, rot=2 -> 'C' üstte, rot=3 -> 'D' üstte
    ROTATION_LOOKUP.set(num, {
      studentId: id + 1,
      choice: choices[rot],
      rotationIndex: rot,
      originalId: id
    });
    currentMat = rotateMatrix90(currentMat);
  }
}

/**
 * 16-bit taranan sayı ile sözlükteki en yakın eşleşmeyi bulur (1 bit tolerans ile)
 */
export function findBestMatch(scannedBits) {
  const exact = ROTATION_LOOKUP.get(scannedBits);
  if (exact) return exact;

  // 1-bit hata düzeltme (parlama / kamera gürültüsü)
  for (let b = 0; b < 16; b++) {
    const flipped = scannedBits ^ (1 << b);
    const candidate = ROTATION_LOOKUP.get(flipped);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * 4 köşeyi saat yönünde sırala (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
 */
function orderCorners(corners) {
  // corners: [{x, y}, {x, y}, {x, y}, {x, y}]
  const pts = [...corners];
  pts.sort((a, b) => a.y - b.y);
  
  // Üst iki ve alt iki
  const top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = pts.slice(2, 4).sort((a, b) => b.x - a.x); // saat yönü: sağ-alt sonra sol-alt
  
  return [top[0], top[1], bottom[0], bottom[1]];
}

/**
 * OpenCV.js Kontur & Warp Perspektif Algılayıcı
 */
function detectMarkersWithOpenCV(canvas, cv) {
  const results = [];
  let src = null;
  let gray = null;
  let thresh = null;
  let contours = null;
  let hierarchy = null;

  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    thresh = new cv.Mat();
    // Adaptif eşikleme ile ışık ve gölgelerden etkilenmez
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 11, 4);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const numContours = contours.size();
    const WARP_SIZE = 60; // 6x6 ızgara için her hücre 10x10 px

    for (let i = 0; i < numContours; i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 600 || area > (canvas.width * canvas.height * 0.7)) {
        cnt.delete();
        continue;
      }

      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, peri * 0.04, true);

      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        // 4 köşeli konveks poligon (kart adayı)
        const rawCorners = [];
        for (let j = 0; j < 4; j++) {
          rawCorners.push({
            x: approx.data32S[j * 2],
            y: approx.data32S[j * 2 + 1]
          });
        }

        const ordered = orderCorners(rawCorners);
        
        // Perspektif düzeltme matrisi
        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
          ordered[0].x, ordered[0].y,
          ordered[1].x, ordered[1].y,
          ordered[2].x, ordered[2].y,
          ordered[3].x, ordered[3].y
        ]);

        const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          WARP_SIZE, 0,
          WARP_SIZE, WARP_SIZE,
          0, WARP_SIZE
        ]);

        const transform = cv.getPerspectiveTransform(srcPts, dstPts);
        const warped = new cv.Mat();
        const dsize = new cv.Size(WARP_SIZE, WARP_SIZE);
        cv.warpPerspective(gray, warped, transform, dsize);

        // 6x6 ızgarayı analiz et (hücre boyutu 10px)
        const cellSize = 10;
        let borderBlackCount = 0;
        let totalBorderCells = 0;

        // Dış 6x6 kenar hücrelerini kontrol et
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 6; c++) {
            if (r === 0 || r === 5 || c === 0 || c === 5) {
              const sampleVal = sampleCell(warped, c * cellSize, r * cellSize, cellSize);
              if (sampleVal < 120) borderBlackCount++;
              totalBorderCells++;
            }
          }
        }

        // Dış çerçevenin en az %75'i siyah olmalı
        if (borderBlackCount / totalBorderCells >= 0.75) {
          // 4x4 iç veriyi oku
          let bitsVal = 0;
          for (let r = 1; r <= 4; r++) {
            for (let c = 1; c <= 4; c++) {
              const sampleVal = sampleCell(warped, c * cellSize, r * cellSize, cellSize);
              const bit = sampleVal > 128 ? 1 : 0;
              bitsVal = (bitsVal << 1) | bit;
            }
          }

          const match = findBestMatch(bitsVal);
          if (match && !results.some(r => r.studentId === match.studentId)) {
            const angle = calculateRotationAngle(ordered[0], ordered[1], ordered[2], ordered[3]);
            results.push({
              studentId: match.studentId,
              choice: match.choice,
              angle: Math.round(angle),
              corners: ordered
            });
          }
        }

        srcPts.delete();
        dstPts.delete();
        transform.delete();
        warped.delete();
      }

      approx.delete();
      cnt.delete();
    }
  } catch (err) {
    // OpenCV işlem hatası olursa devam et
  } finally {
    if (src) src.delete();
    if (gray) gray.delete();
    if (thresh) thresh.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
  }

  return results;
}

function sampleCell(mat, startX, startY, size) {
  let sum = 0;
  let count = 0;
  const data = mat.data;
  const cols = mat.cols;
  // Merkezdeki %50'lik çekirdek alanı örnekle (kenar parazitlerini önler)
  const margin = Math.floor(size * 0.25);
  for (let y = startY + margin; y < startY + size - margin; y++) {
    for (let x = startX + margin; x < startX + size - margin; x++) {
      sum += data[y * cols + x];
      count++;
    }
  }
  return count > 0 ? sum / count : 255;
}

/**
 * Pure JS Canvas 2D Tarayıcı (OpenCV olmadan da çalışır)
 */
function detectMarkersPureJS(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const results = [];
  const step = 10;

  for (let y = 30; y < height - 60; y += step * 2) {
    for (let x = 30; x < width - 60; x += step * 2) {
      const idx = (y * width + x) * 4;
      const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;

      if (lum < 55) {
        for (let size of [60, 90, 120, 150]) {
          if (x + size >= width || y + size >= height) continue;

          const match = sampleGridPure(data, width, x, y, size);
          if (match && !results.some(r => r.studentId === match.studentId)) {
            results.push(match);
            break;
          }
        }
      }
    }
  }

  return results;
}

function sampleGridPure(data, imgWidth, startX, startY, size) {
  const cellSize = size / 6;
  const threshold = 110;

  let borderBlack = 0;
  let totalBorder = 0;

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      if (r === 0 || r === 5 || c === 0 || c === 5) {
        const px = Math.floor(startX + c * cellSize + cellSize / 2);
        const py = Math.floor(startY + r * cellSize + cellSize / 2);
        const idx = (py * imgWidth + px) * 4;
        const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
        if (lum < threshold) borderBlack++;
        totalBorder++;
      }
    }
  }

  if (borderBlack / totalBorder < 0.75) return null;

  let bitsVal = 0;
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 4; c++) {
      const px = Math.floor(startX + c * cellSize + cellSize / 2);
      const py = Math.floor(startY + r * cellSize + cellSize / 2);
      const idx = (py * imgWidth + px) * 4;
      const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
      const bit = lum > threshold ? 1 : 0;
      bitsVal = (bitsVal << 1) | bit;
    }
  }

  const match = findBestMatch(bitsVal);
  if (match) {
    const angleMap = [0, 90, 180, 270];
    const angle = angleMap[match.rotationIndex] || 0;
    return {
      studentId: match.studentId,
      choice: match.choice,
      angle,
      corners: [
        { x: startX, y: startY },
        { x: startX + size, y: startY },
        { x: startX + size, y: startY + size },
        { x: startX, y: startY + size }
      ]
    };
  }

  return null;
}

/**
 * Ana Algılama Fonksiyonu
 */
export function detectArucoMarkers(canvas, cv = null) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return [];

  // 1. OpenCV Hazırsa Kontur + Warp Perspektif ile tara (en hassas)
  if (cv && cv.Mat && cv.findContours) {
    const openCvResults = detectMarkersWithOpenCV(canvas, cv);
    if (openCvResults && openCvResults.length > 0) {
      return openCvResults;
    }
  }

  // 2. Pure JS Yedek Motoru
  return detectMarkersPureJS(canvas);
}
