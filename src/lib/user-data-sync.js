/**
 * ScanQuiz Kullanıcı Veri Senkronizasyonu (User Data Sync)
 * 
 * Öğretmenin evde bilgisayarından hazırladığı veya telefondan eklediği
 * soruları ve sınıfları buluta (Firestore & LocalStorage) kaydeder.
 * Başka bir cihazdan Google ile oturum açtığında tüm soruları anında geri yükler!
 */

import { db, doc, setDoc, getDoc } from './firebase';

export async function saveUserDataToCloud(userId, data) {
  if (!userId || userId === 'teacher_guest') {
    // Misafir ise sadece localStorage
    if (typeof window !== 'undefined') {
      if (data.questions) localStorage.setItem('scanquiz_guest_questions', JSON.stringify(data.questions));
      if (data.classes) localStorage.setItem('scanquiz_guest_classes', JSON.stringify(data.classes));
    }
    return;
  }

  // 1. LocalStorage yedeği
  if (typeof window !== 'undefined') {
    try {
      if (data.questions) localStorage.setItem(`scanquiz_questions_${userId}`, JSON.stringify(data.questions));
      if (data.classes) localStorage.setItem(`scanquiz_classes_${userId}`, JSON.stringify(data.classes));
    } catch (e) {}
  }

  // 2. Firebase Firestore Bulut Kaydı
  if (db) {
    try {
      const userRef = doc(db, 'users', userId);
      await setDoc(userRef, {
        ...data,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.warn('Buluta kaydetme uyarısı (Firestore kapalı olabilir):', err.message);
    }
  }
}

export async function loadUserDataFromCloud(userId) {
  if (!userId || userId === 'teacher_guest') {
    if (typeof window !== 'undefined') {
      try {
        const q = localStorage.getItem('scanquiz_guest_questions');
        const c = localStorage.getItem('scanquiz_guest_classes');
        return {
          questions: q ? JSON.parse(q) : null,
          classes: c ? JSON.parse(c) : null
        };
      } catch (e) {}
    }
    return { questions: null, classes: null };
  }

  let cloudQuestions = null;
  let cloudClasses = null;

  // 1. Önce Firestore'dan oku
  if (db) {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.questions) cloudQuestions = data.questions;
        if (data.classes) cloudClasses = data.classes;
      }
    } catch (err) {
      console.warn('Buluttan okuma uyarısı:', err.message);
    }
  }

  // 2. LocalStorage yedeğiyle harmanla
  if (typeof window !== 'undefined') {
    try {
      if (!cloudQuestions) {
        const localQ = localStorage.getItem(`scanquiz_questions_${userId}`) || localStorage.getItem('scanquiz_guest_questions');
        if (localQ) cloudQuestions = JSON.parse(localQ);
      }
      if (!cloudClasses) {
        const localC = localStorage.getItem(`scanquiz_classes_${userId}`) || localStorage.getItem('scanquiz_classes');
        if (localC) cloudClasses = JSON.parse(localC);
      }
    } catch (e) {}
  }

  return {
    questions: cloudQuestions,
    classes: cloudClasses
  };
}
