/**
 * iOS Safari WebRTC Uyumluluk Katmanı
 *
 * iOS Safari'nin WebRTC/getUserMedia/video kısıtlamalarını çözer:
 * - autoplay engeli: playsinline + muted gereklidir
 * - getUserMedia: Sadece kullanıcı gesture içinden çağrılabilir
 * - OffscreenCanvas: iOS 16.4+ gerektirir, fallback sağlanır
 */

/**
 * iOS Safari mi kontrol eder.
 */
export function isIOSSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  return isIOS;
}

/**
 * Video elementini iOS Safari'ye uygun şekilde yapılandırır.
 * Bu attribute'lar OLMADAN video ÇALMAZ.
 */
export function configureVideoForIOS(videoElement) {
  videoElement.setAttribute('playsinline', '');
  videoElement.setAttribute('autoplay', '');
  videoElement.setAttribute('muted', '');
  videoElement.setAttribute('webkit-playsinline', '');
  videoElement.playsInline = true;
  videoElement.muted = true;
  return videoElement;
}

/**
 * Kullanıcı gesture gerektiren kamera başlatma wrapper'ı.
 * MUTLAKA bir onClick/onTouchEnd handler'ı içinden çağrılmalıdır.
 *
 * @param {'environment' | 'user'} facing - Kamera yönü
 * @returns {Promise<MediaStream>}
 */
export async function requestCameraWithGesture(facing = 'environment') {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing === 'environment'
          ? { ideal: 'environment' }
          : 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    return stream;
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error(
        'Kamera izni reddedildi. Lütfen tarayıcı ayarlarından kamera iznini etkinleştirin.'
      );
    }
    if (err.name === 'OverconstrainedError' && facing === 'environment') {
      // Arka kamera bulunamadı, ön kamerayı dene
      console.warn('Arka kamera bulunamadı, ön kamera deneniyor...');
      return requestCameraWithGesture('user');
    }
    throw err;
  }
}

/**
 * OffscreenCanvas fallback: iOS 16.3 ve altında desteklenmez.
 */
export function createProcessingCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  // Fallback: Gizli DOM canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = 'none';
  document.body.appendChild(canvas);
  return canvas;
}

/**
 * Gizli fallback canvas'ı temizler.
 */
export function destroyProcessingCanvas(canvas) {
  if (canvas && canvas.parentNode) {
    canvas.parentNode.removeChild(canvas);
  }
}
