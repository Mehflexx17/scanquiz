/**
 * ArUco marker'ın ilk iki köşesinden rotasyon açısını hesaplar.
 *
 * Formül: θ = atan2(y₁ - y₀, x₁ - x₀) × (180/π)
 *
 * @param {number} x0 - İlk köşenin x koordinatı
 * @param {number} y0 - İlk köşenin y koordinatı
 * @param {number} x1 - İkinci köşenin x koordinatı
 * @param {number} y1 - İkinci köşenin y koordinatı
 * @returns {number} 0-360 arası normalize edilmiş açı (derece)
 */
export function calculateRotationAngle(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;

  let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  // Negatif açıları 0-360 aralığına normalize et
  if (angleDeg < 0) {
    angleDeg += 360;
  }

  return angleDeg;
}

/**
 * Açıyı cevap seçeneğine eşler.
 *
 * Açı Haritası (her seçenek ±45° tolerans bandına sahip):
 *
 *              90° (B)
 *               ↑
 *         135°  |  45°
 *           ╲   |   ╱
 *  180° (C) ←———●———→ 0° / 360° (A)
 *           ╱   |   ╲
 *         225°  |  315°
 *               ↓
 *             270° (D)
 *
 * @param {number} angle - 0-360 arası açı
 * @returns {string} 'A', 'B', 'C', veya 'D'
 */
export function angleToChoice(angle) {
  const normalized = ((angle % 360) + 360) % 360;

  if (normalized >= 315 || normalized < 45) {
    return 'A';
  } else if (normalized >= 45 && normalized < 135) {
    return 'B';
  } else if (normalized >= 135 && normalized < 225) {
    return 'C';
  } else {
    return 'D';
  }
}

/**
 * Açı değerinin hangi seçeneğe ne kadar yakın olduğunun
 * güven skorunu hesaplar (0.0 - 1.0).
 *
 * Merkez açıya tam denk gelen: 1.0
 * Tolerans sınırında olan: ~0.0
 *
 * @param {number} angle - 0-360 arası açı
 * @returns {{ choice: string, confidence: number }}
 */
export function angleToChoiceWithConfidence(angle) {
  const normalized = ((angle % 360) + 360) % 360;
  const choice = angleToChoice(normalized);

  const centers = { A: 0, B: 90, C: 180, D: 270 };
  const center = centers[choice];

  // Merkeze olan mesafe (dairesel)
  let diff = Math.abs(normalized - center);
  if (diff > 180) diff = 360 - diff;

  // 0-45 arası mesafeyi 1.0-0.0 güvene dönüştür
  const confidence = Math.max(0, 1 - diff / 45);

  return { choice, confidence: parseFloat(confidence.toFixed(3)) };
}
