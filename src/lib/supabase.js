import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let supabaseInstance = null;

if (supabaseUrl && supabaseAnonKey) {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: {
        eventsPerSecond: 40, // Yüksek frekanslı kart tarama için
      }
    }
  });
} else {
  console.warn(
    '⚠️ Supabase ortam değişkenleri bulunamadı. ' +
    '.env.local dosyasını kontrol edin. Yerel mod aktif.'
  );
  // Dummy client oluştur (channel metodu çağrılabilsin diye)
  supabaseInstance = {
    channel: () => ({
      on: function() { return this; },
      subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return { unsubscribe: () => {} }; },
      send: () => {},
    }),
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: async () => ({ error: new Error('Supabase yapılandırılmamış') }),
      signOut: async () => {},
    }
  };
}

/**
 * Browser tarafı Supabase client (anon key ile).
 * RLS policies tarafından korunur.
 */
export const supabase = supabaseInstance;

/**
 * Supabase client'ı döndüren helper.
 */
export function getSupabase() {
  return supabase;
}
