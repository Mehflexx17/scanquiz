import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDACOS82FFYoqALbixY8Uj0dRyqMkN86og",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "scanquiz-1f5e3.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "scanquiz-1f5e3",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "scanquiz-1f5e3.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "673569603648",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:673569603648:web:8e7464d8297e709a7a9fa5",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-H80RWR7LL8"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = typeof window !== 'undefined' ? getAuth(app) : null;
export const googleProvider = new GoogleAuthProvider();
export const db = typeof window !== 'undefined' ? getFirestore(app) : null;

export { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
export { doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
export default app;
