import { createClient } from '@supabase/supabase-js';

// Vercel ve üretim ortamı için doğrulanmış varsayılan kimlik bilgileri
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wffwykpxargofmttarjl.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_mUQPPmoQp8SHQSFxRBUICQ_BbZ2ZkoI';

let supabaseInstance = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 40,
        }
      }
    });
  } catch (err) {
    console.warn('Supabase createClient error:', err.message);
  }
}

if (!supabaseInstance) {
  // Acil durum yerel fallback
  supabaseInstance = {
    channel: () => ({
      on: function() { return this; },
      subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return { unsubscribe: () => {} }; },
      send: () => {},
    }),
    removeChannel: () => {},
  };
}

export const supabase = supabaseInstance;

export function getSupabase() {
  return supabase;
}
