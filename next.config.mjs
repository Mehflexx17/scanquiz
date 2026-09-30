/** @type {import('next').NextConfig} */
const nextConfig = {
  // OpenCV.js WASM dosyası için gerekli header'lar
  async headers() {
    return [
      {
        source: '/opencv.js',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
