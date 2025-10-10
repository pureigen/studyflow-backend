import axios from 'axios';
import FormData from 'form-data';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = process.env.FIXIE_URL || process.env.HTTPS_PROXY;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

// 전화번호 정규화
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// 전화번호 유효성 검사
export function validatePhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return /^01[0-9]{8,9}$/.test(normalized);
}

// 6자리 인증코드 생성
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 알리고 SMS 발송
export async function sendAligoSMS(phoneNumber: string, message: string): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  
  if (!process.env.ALIGO_API_KEY || !process.env.ALIGO_USER_ID || !process.env.SMS_SENDER_PHONE) {
    console.error('❌ 알리고 SMS 설정이 누락되었습니다.');
    return false;
  }
  
  const isTestMode = process.env.NODE_ENV === 'development';
  
  try {
    const form = new FormData();
    form.append('key', process.env.ALIGO_API_KEY);
    form.append('user_id', process.env.ALIGO_USER_ID);
    form.append('sender', process.env.SMS_SENDER_PHONE);
    form.append('receiver', normalizedPhone);
    form.append('msg', message);
    form.append('testmode_yn', isTestMode ? 'Y' : 'N');
    
    console.log('📤 알리고 SMS 요청:', {
      수신번호: normalizedPhone,
      테스트모드: isTestMode ? 'Y' : 'N'
    });
    
    const axiosConfig: any = {
      headers: form.getHeaders()
    };
    
    if (agent) {
      axiosConfig.httpAgent = agent;
      axiosConfig.httpsAgent = agent;
      axiosConfig.proxy = false;
    }
    
    const { data: result } = await axios.post(
      'https://apis.aligo.in/send/',
      form,
      axiosConfig
    );
    
    console.log('📥 알리고 응답:', result);
    
    if (result.result_code === '1' || result.result_code === 1) {
      console.log('✅ SMS 발송 성공');
      return true;
    } else {
      console.error('❌ SMS 발송 실패:', result.message);
      return false;
    }
  } catch (error) {
    console.error('❌ SMS API 오류:', error);
    return process.env.NODE_ENV === 'development';
  }
}