import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase ortam değişkenleri bulunamadı. ' +
    '.env.local dosyasını kontrol edin.'
  );
}

/**
 * Browser tarafı Supabase client (anon key ile).
 * RLS policies tarafından korunur.
 */
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
);

/**
 * Supabase client'ı döndüren helper.
 */
export function getSupabase() {
  return supabase;
}
