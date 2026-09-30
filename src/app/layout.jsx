import './globals.css';

export const metadata = {
  title: 'ScanQuiz — Gerçek Zamanlı Optik Sınıf Yanıt Sistemi',
  description: 'ArUco DICT_4X4_50 optik kartlarıyla sıfır maliyetli, anlık ve eğlenceli sınıf içi quiz ve yoklama platformu.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
