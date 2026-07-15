import { createClient } from '@supabase/supabase-js';

const buildEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const supabaseUrl = buildEnv.VITE_SUPABASE_URL;
const supabaseKey =
  buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  buildEnv.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null;
