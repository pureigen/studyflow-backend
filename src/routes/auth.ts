import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/database';

const router = Router();

// SMS 인증번호 저장소 (실제로는 Redis 사용 권장)
const verificationCodes = new Map<string, { code: string; expires: Date }>();

// 인증번호 생성
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// SMS 발송 함수 (알리고 연동)
async function sendSMS(phoneNumber: string, message: string): Promise<boolean> {
  try {
    const axios = require('axios');
    const FormData = require('form-data');
    
    const form = new FormData();
    form.append('key', process.env.ALIGO_API_KEY);
    form.append('user_id', process.env.ALIGO_USER_ID);
    form.append('sender', process.env.ALIGO_SENDER);
    form.append('receiver', phoneNumber.replace(/-/g, '')); // 하이픈 제거
    form.append('msg', message);
    form.append('testmode_yn', 'N'); // 테스트 시 'Y'로 변경
    
    const response = await axios.post('https://apis.aligo.in/send/', form, {
      headers: form.getHeaders()
    });
    
    console.log('SMS 발송 결과:', response.data);
    
    if (response.data.result_code === '1') {
      return true;
    } else {
      console.error('SMS 발송 실패:', response.data.message);
      return false;
    }
  } catch (error) {
    console.error('SMS 발송 오류:', error);
    return false;
  }
}

// 회원가입 - Step 1: 정보 입력 및 인증번호 발송
router.post('/register', async (req, res) => {
  const { userId, password, name, phoneNumber, userType } = req.body;

  try {
    // 학생은 SMS 인증 불필요 (관리자가 직접 등록)
    if (userType === 'student') {
      return res.status(400).json({ 
        error: '학생은 관리자를 통해 등록되어야 합니다.' 
      });
    }

    // 관리자와 학부모만 SMS 인증
    if (userType !== 'admin' && userType !== 'parent') {
      return res.status(400).json({ 
        error: '잘못된 사용자 유형입니다.' 
      });
    }

    // 이메일(userId) 중복 확인
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', userId)
      .single();

    if (existingUser) {
      return res.status(400).json({ 
        error: '이미 사용중인 아이디입니다.' 
      });
    }

    // 인증번호 생성 및 저장
    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료
    
    verificationCodes.set(phoneNumber, { code, expires });

    // SMS 발송
    const message = `[StudyFlow] 인증번호: ${code}`;
    await sendSMS(phoneNumber, message);

    // 임시로 사용자 정보 저장 (세션 또는 Redis 사용 권장)
    verificationCodes.set(`temp_${phoneNumber}`, {
      code: JSON.stringify({ userId, password, name, phoneNumber, userType }),
      expires
    });

    res.json({ 
      success: true,
      message: '인증번호가 발송되었습니다.'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 회원가입 - Step 2: 인증번호 확인 및 계정 생성
router.post('/verify', async (req, res) => {
  const { phoneNumber, verificationCode } = req.body;

  try {
    // 인증번호 확인
    const stored = verificationCodes.get(phoneNumber);
    
    if (!stored || stored.expires < new Date()) {
      return res.status(400).json({ 
        error: '인증번호가 만료되었거나 잘못되었습니다.' 
      });
    }

    if (stored.code !== verificationCode) {
      return res.status(400).json({ 
        error: '인증번호가 일치하지 않습니다.' 
      });
    }

    // 임시 저장된 사용자 정보 가져오기
    const tempData = verificationCodes.get(`temp_${phoneNumber}`);
    if (!tempData) {
      return res.status(400).json({ 
        error: '회원가입 정보를 찾을 수 없습니다.' 
      });
    }

    const userData = JSON.parse(tempData.code);
    
    // 비밀번호 해시화
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // 사용자 생성
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: userData.userId,
        password: hashedPassword,
        name: userData.name,
        role: userData.userType,
        phone: userData.phoneNumber
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // 임시 데이터 삭제
    verificationCodes.delete(phoneNumber);
    verificationCodes.delete(`temp_${phoneNumber}`);

    // 활동 기록
    await supabase.from('activities').insert({
      user_id: newUser.id,
      type: 'SIGNUP',
      description: `${newUser.name} (${userData.userType}) registered`
    });

    res.json({ 
      success: true,
      message: '회원가입이 완료되었습니다.'
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 로그인 (기존 코드)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    await supabase.from('activities').insert({
      user_id: user.id,
      type: 'LOGIN',
      description: `${user.name} logged in`
    });

    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 로그아웃 (기존 코드)
router.post('/logout', async (req, res) => {
  const { userId } = req.body;

  try {
    await supabase.from('activities').insert({
      user_id: userId,
      type: 'LOGOUT',
      description: 'User logged out'
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 학생 등록 (관리자 전용)
router.post('/admin/register-student', async (req, res) => {
  const { studentId, password, name, grade, class: className } = req.body;
  
  // TODO: 관리자 권한 확인 미들웨어 추가
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data: newStudent, error } = await supabase
      .from('users')
      .insert({
        email: studentId, // 학생은 학번을 ID로 사용
        password: hashedPassword,
        name: name,
        role: 'student',
        studentId: studentId,
        grade: grade,
        class: className
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ 
      success: true,
      message: '학생이 등록되었습니다.',
      student: newStudent
    });
  } catch (error) {
    console.error('Student registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;