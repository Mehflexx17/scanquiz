import SmartBoardView from '@/components/SmartBoardView';

export const metadata = {
  title: 'ScanQuiz — Akıllı Tahta & Canlı Sınav',
  description: 'ArUco DICT_4X4_50 optik kartlarıyla sıfır maliyetli, anlık ve eğlenceli sınıf içi quiz ve yoklama platformu.',
};

export default function HomePage() {
  return <SmartBoardView />;
}
