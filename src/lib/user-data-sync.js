/**
 * ScanQuiz Kullanıcı Veri Senkronizasyonu (User Data Sync)
 * 
 * Öğretmenin Google hesabına bağlı olarak:
 * - Sınıflar (8/A, 8/B vb. ve Hoca İsimleri)
 * - Sınırsız Test Setleri & Soru Havuzları
 * - Geçmiş Test Raporları (Podium, en çok doğru/yanlış yapılanlar)
 * Firestore & Supabase & LocalStorage üçlüsünde saklar.
 */

import { db, doc, setDoc, getDoc } from './firebase';

export async function saveUserDataToCloud(userId, data) {
  if (!userId) return;

  const storageKey = `scanquiz_data_${userId}`;
  
  // 1. Yerel Hafızaya anında yaz (hızlı erişim için)
  if (typeof window !== 'undefined') {
    try {
      const existing = localStorage.getItem(storageKey);
      const merged = existing ? { ...JSON.parse(existing), ...data, updatedAt: Date.now() } : { ...data, updatedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(merged));
      // Genel fallback
      if (data.classes) localStorage.setItem('scanquiz_classes', JSON.stringify(data.classes));
      if (data.tests) localStorage.setItem('scanquiz_tests', JSON.stringify(data.tests));
    } catch (e) {}
  }

  // 2. Firebase Firestore Bulut Senkronizasyonu (kullanıcı Google ile giriş yaptıysa)
  if (db && userId !== 'teacher_guest') {
    try {
      const userRef = doc(db, 'users', userId);
      await setDoc(userRef, {
        ...data,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.warn('Buluta kaydetme uyarısı:', err.message);
    }
  }
}

export async function loadUserDataFromCloud(userId) {
  let result = {
    classes: null,
    tests: null,
    activeTestId: null,
    teacherName: '',
    history: []
  };

  const storageKey = `scanquiz_data_${userId || 'guest'}`;

  // 1. Önce Firestore'dan çek (varsa)
  if (db && userId && userId !== 'teacher_guest') {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const cloudData = snap.data();
        if (cloudData.classes) result.classes = cloudData.classes;
        if (cloudData.tests) result.tests = cloudData.tests;
        if (cloudData.activeTestId) result.activeTestId = cloudData.activeTestId;
        if (cloudData.teacherName) result.teacherName = cloudData.teacherName;
        if (cloudData.history) result.history = cloudData.history;
      }
    } catch (err) {
      console.warn('Buluttan okuma uyarısı:', err.message);
    }
  }

  // 2. LocalStorage ile harmanla
  if (typeof window !== 'undefined') {
    try {
      const localRaw = localStorage.getItem(storageKey);
      if (localRaw) {
        const local = JSON.parse(localRaw);
        if (!result.classes && local.classes) result.classes = local.classes;
        if (!result.tests && local.tests) result.tests = local.tests;
        if (!result.activeTestId && local.activeTestId) result.activeTestId = local.activeTestId;
        if (!result.teacherName && local.teacherName) result.teacherName = local.teacherName;
        if ((!result.history || result.history.length === 0) && local.history) result.history = local.history;
      }

      // Eski format fallback
      if (!result.classes) {
        const legacyClasses = localStorage.getItem('scanquiz_classes');
        if (legacyClasses) result.classes = JSON.parse(legacyClasses);
      }
      if (!result.tests) {
        const legacyQ = localStorage.getItem('scanquiz_questions');
        if (legacyQ) {
          result.tests = [
            { id: 'default_1', name: 'Genel Değerlendirme Testi', questions: JSON.parse(legacyQ) }
          ];
        }
      }
    } catch (e) {}
  }

  return result;
}
