import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  console.log('SUPABASE_URL:', supabaseUrl ? 'Found' : 'Missing');
  console.log('SUPABASE_SERVICE_KEY:', supabaseKey ? 'Found' : 'Missing');
  throw new Error('Supabase configuration is incomplete');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
