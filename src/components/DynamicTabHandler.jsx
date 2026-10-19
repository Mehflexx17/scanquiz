'use client';

import { useEffect } from 'react';

/**
 * DynamicTabHandler:
 * Kullanıcı başka bir sekmeye geçtiğinde başlığı "👋 Ben buradayım :) | ScanQuiz"
 * yapar ve el sallayan logo koyar. Geri geldiğinde orijinal haline döndürür.
 */
export default function DynamicTabHandler() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    let originalTitle = document.title || 'ScanQuiz — Akıllı Tahta & Canlı Sınav';
    const originalFavicon = '/favicon.svg';
    const awayFavicon = '/wave.svg';

    const getFaviconLink = () => {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      return link;
    };

    // İlk faviconu ayarla
    const favicon = getFaviconLink();
    favicon.type = 'image/svg+xml';
    favicon.href = originalFavicon;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        originalTitle = document.title;
        document.title = '👋 Ben buradayım :) | ScanQuiz';
        favicon.href = awayFavicon;
      } else {
        document.title = originalTitle;
        favicon.href = originalFavicon;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
