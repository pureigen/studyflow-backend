import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

// 환경변수 검증
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  console.log('SUPABASE_URL:', supabaseUrl ? 'Found' : 'Missing');
  console.log('SUPABASE_SERVICE_KEY:', supabaseKey ? 'Found' : 'Missing');
  throw new Error('Supabase configuration is incomplete');
}

// 개발/프로덕션 환경 구분
const isDevelopment = process.env.NODE_ENV === 'development';
if (isDevelopment) {
  console.log('🔧 Running in development mode');
}

// 일반 클라이언트 (Service Role Key 사용)
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,  // 서버 환경이므로 자동 갱신 불필요
    persistSession: false      // 세션 유지 불필요
  }
});

// Admin 작업용 클라이언트 (명시적 구분)
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase clients initialized');