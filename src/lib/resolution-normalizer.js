/**
 * Çözünürlük Normalizasyonu
 *
 * Farklı telefon kameralarından gelen frame'leri standart boyuta
 * indirir ve koordinatları 0.0–1.0 aralığına normalize eder.
 */

/**
 * Köşe koordinatlarını normalize eder.
 * @param {number[][]} corners - [[x,y], [x,y], [x,y], [x,y]]
 * @param {number} w - Frame genişliği (piksel)
 * @param {number} h - Frame yüksekliği (piksel)
 * @returns {{ x: number, y: number }[]}
 */
export function normalizeCorners(corners, w, h) {
  return corners.map(([x, y]) => ({
    x: x / w,
    y: y / h,
  }));
}

/**
 * Aspect ratio düzeltmeli açı hesaplama.
 *
 * 16:9 ekranlarda y ekseni x'e göre sıkışıktır.
 * Düzeltme yapmazsak açı hesabı yanlış olur.
 *
 * @param {number[][]} corners - 4 köşe [[x,y], ...]
 * @param {number} w - Frame genişliği
 * @param {number} h - Frame yüksekliği
 * @returns {number} Düzeltilmiş açı (0-360)
 */
export function calculateNormalizedAngle(corners, w, h) {
  const aspectRatio = w / h;
  const norm = normalizeCorners(corners, w, h);

  const x0 = norm[0].x;
  const y0 = norm[0].y * aspectRatio;
  const x1 = norm[1].x;
  const y1 = norm[1].y * aspectRatio;

  const dx = x1 - x0;
  const dy = y1 - y0;
  let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angleDeg < 0) angleDeg += 360;

  return angleDeg;
}

/**
 * Frame'i standart işleme boyutuna ölçekler.
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @param {HTMLVideoElement} video
 * @param {number} targetW
 * @param {number} targetH
 */
export function drawStandardizedFrame(canvas, video, targetW = 640, targetH = 480) {
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}
