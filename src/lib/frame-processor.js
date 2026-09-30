/**
 * Adaptif Frame İşleme Motoru
 *
 * Düşük donanımlı telefonlarda UI thread'ini bloklamadan
 * görüntü işleme yapmak için adaptif FPS throttling sistemi.
 */

export class AdaptiveFrameProcessor {
  constructor(targetFps = 30) {
    this.targetInterval = 1000 / targetFps;
    this.lastProcessTime = 0;
    this.fpsHistory = [];
    this.frameCount = 0;
  }

  /**
   * Bu frame işlenmeli mi?
   * Hedef FPS'i korumak için bazı frame'leri atlar.
   */
  shouldProcessFrame(timestamp) {
    const elapsed = timestamp - this.lastProcessTime;

    if (elapsed < this.targetInterval) {
      return false;
    }

    const currentFps = elapsed > 0 ? 1000 / elapsed : 0;
    this.fpsHistory.push(currentFps);
    if (this.fpsHistory.length > 60) this.fpsHistory.shift();

    this.lastProcessTime = timestamp;
    this.frameCount++;
    return true;
  }

  /**
   * Ortalama FPS değerini döndürür.
   */
  getAverageFps() {
    if (this.fpsHistory.length === 0) return 0;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return parseFloat((sum / this.fpsHistory.length).toFixed(1));
  }

  /**
   * Performansa göre dinamik işleme çözünürlüğü belirler.
   */
  getOptimalResolution() {
    const avgFps = this.getAverageFps();

    if (avgFps > 0 && avgFps < 15) {
      return { width: 640, height: 480 };
    } else if (avgFps < 25) {
      return { width: 960, height: 540 };
    } else {
      return { width: 1280, height: 720 };
    }
  }

  reset() {
    this.lastProcessTime = 0;
    this.fpsHistory = [];
    this.frameCount = 0;
  }
}
