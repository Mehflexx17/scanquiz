import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://wffwykpxargofmttarjl.supabase.co';
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_mUQPPmoQp8SHQSFxRBUICQ_BbZ2ZkoI';

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
