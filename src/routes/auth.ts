import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase, supabaseAdmin } from '../config/database';
import { 
  sendAligoSMS, 
  generateVerificationCode, 
  normalizePhoneNumber,
  validatePhoneNumber 
} from '../services/sms.service';
import { createStudentEmail, koreanKeyboardToEnglish } from '../utils/korean-converter';

const router = Router();

// 메모리 저장소 (실제로는 Redis 권장)
const verificationCodes = new Map<string, { 
  code: string; 
  expires: Date;
  userData?: any;
}>();

// ================== API 엔드포인트 ==================

// 1. 아이디 중복 확인
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        ok: false,
        available: false,
        message: '아이디를 입력해주세요.'
      });
    }

    const trimmedUsername = username.trim();
    
    if (trimmedUsername.length < 3) {
      return res.status(400).json({
        ok: false,
        available: false,
        message: '아이디는 3자 이상이어야 합니다.'
      });
    }

    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(trimmedUsername)) {
      return res.status(400).json({
        ok: false,
        available: false,
        message: '아이디는 영문, 숫자, 언더스코어(_)만 사용 가능합니다.'
      });
    }
    
    // 모든 테이블에서 중복 확인
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('username', trimmedUsername)
      .maybeSingle();
    
    const { data: existingStudent } = await supabase
      .from('students')
      .select('id')
      .eq('username', trimmedUsername)
      .maybeSingle();
      
    const { data: existingParent } = await supabase
      .from('parents')
      .select('user_id')
      .eq('username', trimmedUsername)
      .maybeSingle();
    
    const available = !existingUser && !existingStudent && !existingParent;
    
    res.json({
      ok: true,
      available,
      message: available ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.'
    });
    
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({
      ok: false,
      available: false,
      message: '중복 확인 중 오류가 발생했습니다.'
    });
  }
});

// 2. SMS 인증번호 발송
router.post('/send-sms', async (req, res) => {
  try {
    const { phone, userType = 'parent' } = req.body;
    
    console.log('🔔 SMS 인증 요청:', { userType, phone });
    
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        ok: false,
        message: '전화번호를 입력해주세요.'
      });
    }
    
    const normalizedPhone = normalizePhoneNumber(phone);
    
    if (!validatePhoneNumber(normalizedPhone)) {
      return res.status(400).json({
        ok: false,
        message: '올바른 휴대폰 번호 형식이 아닙니다.'
      });
    }
    
    // 이미 등록된 번호인지 확인
    if (userType === 'admin') {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      
      if (existingUser) {
        return res.status(409).json({
          ok: false,
          message: '이미 등록된 관리자 전화번호입니다.'
        });
      }
    } else {
      const { data: existingParent } = await supabase
        .from('parents')
        .select('user_id')
        .eq('parent_phone', normalizedPhone)
        .maybeSingle();
      
      if (existingParent) {
        return res.status(409).json({
          ok: false,
          message: '이미 등록된 학부모 전화번호입니다.'
        });
      }
    }
    
    // 인증 코드 생성
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    
    // 기존 코드 삭제
    await supabase
      .from('phone_verifications')
      .delete()
      .eq('phone', normalizedPhone);
    
    // 새 코드 저장
    await supabase
      .from('phone_verifications')
      .insert({
        phone: normalizedPhone,
        code: verificationCode,
        user_type: userType,
        expires_at: expiresAt.toISOString(),
        verified: false
      });
    
    // 메모리에도 저장
    verificationCodes.set(normalizedPhone, {
      code: verificationCode,
      expires: expiresAt
    });
    
    // SMS 발송
    const smsMessage = `[StudyFlow] 인증번호: ${verificationCode}\n5분 내에 입력해주세요.`;
    const smsSent = await sendAligoSMS(normalizedPhone, smsMessage);
    
    // 개발 환경 로그
    if (process.env.NODE_ENV === 'development') {
      console.log('📱 인증 코드:', verificationCode);
    }
    
    res.json({
      ok: true,
      message: smsSent 
        ? '인증번호가 발송되었습니다.' 
        : '개발 모드: 콘솔에서 인증번호를 확인하세요.',
      ...(process.env.NODE_ENV === 'development' && {
        debug: { code: verificationCode }
      })
    });
    
  } catch (error) {
    console.error('SMS 발송 오류:', error);
    res.status(500).json({
      ok: false,
      message: '인증번호 발송 중 오류가 발생했습니다.'
    });
  }
});

// 3. SMS 인증번호 확인
router.post('/verify-sms', async (req, res) => {
  try {
    const { phone, code } = req.body;
    
    if (!phone || !code) {
      return res.status(400).json({
        ok: false,
        message: '전화번호와 인증번호를 입력해주세요.'
      });
    }
    
    const normalizedPhone = normalizePhoneNumber(phone);
    const trimmedCode = code.toString().trim();
    
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      return res.status(400).json({
        ok: false,
        message: '인증번호는 6자리 숫자여야 합니다.'
      });
    }
    
    // DB에서 확인
    const { data: verification } = await supabase
      .from('phone_verifications')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('code', trimmedCode)
      .eq('verified', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (!verification) {
      // 메모리에서 확인 (fallback)
      const stored = verificationCodes.get(normalizedPhone);
      if (!stored || stored.code !== trimmedCode || stored.expires < new Date()) {
        return res.status(400).json({
          ok: false,
          message: '잘못되었거나 만료된 인증번호입니다.'
        });
      }
    }
    
    // 인증 상태 업데이트
    if (verification) {
      await supabase
        .from('phone_verifications')
        .update({ verified: true })
        .eq('id', verification.id);
    }
    
    res.json({
      ok: true,
      message: '인증이 완료되었습니다.',
      data: {
        phone: normalizedPhone,
        userType: verification?.user_type || 'parent',
        verified: true
      }
    });
    
  } catch (error) {
    console.error('SMS 인증 확인 오류:', error);
    res.status(500).json({
      ok: false,
      message: '인증 확인 중 오류가 발생했습니다.'
    });
  }
});

// 4. 로그인 (userType별 처리)
router.post('/login', async (req, res) => {
  try {
    const { username, password, userType } = req.body;
    
    if (!username || !password || !userType) {
      return res.status(400).json({
        ok: false,
        message: '모든 필드를 입력해주세요.'
      });
    }
    
    const trimmedUsername = username.trim();
    
    // 관리자 로그인
    if (userType === 'admin') {
      const { data: userData } = await supabase
        .from('users')
        .select('id, username, email, role, name, phone')
        .eq('username', trimmedUsername)
        .maybeSingle();
      
      if (!userData) {
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
      
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: userData.email,
          password: password
        });
        
        if (authError) {
          return res.status(401).json({
            ok: false,
            message: '아이디 또는 비밀번호가 일치하지 않습니다.'
          });
        }
        
        const token = jwt.sign(
          { id: userData.id, username: userData.username, role: 'admin' },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '24h' }
        );
        
        return res.json({
          ok: true,
          user: userData,
          role: 'admin',
          token,
          session: authData.session
        });
      } catch (error) {
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
    }
    
    // 학부모 로그인
    else if (userType === 'parent') {
      const { data: parentData } = await supabase
        .from('parents')
        .select('user_id, username, name, parent_phone')
        .eq('username', trimmedUsername)
        .maybeSingle();
      
      if (!parentData) {
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
      
      const parentEmail = `${trimmedUsername}@parents.local`;
      
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: parentEmail,
          password: password
        });
        
        if (authError) {
          return res.status(401).json({
            ok: false,
            message: '아이디 또는 비밀번호가 일치하지 않습니다.'
          });
        }
        
        const token = jwt.sign(
          { id: parentData.user_id, username: parentData.username, role: 'parent' },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '24h' }
        );
        
        return res.json({
          ok: true,
          user: {
            id: parentData.user_id,
            username: parentData.username,
            name: parentData.name,
            phone: parentData.parent_phone
          },
          role: 'parent',
          token,
          session: authData.session
        });
      } catch (error) {
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
    }
    
    // 학생 로그인
    else if (userType === 'student') {
      const { data: studentData } = await supabase
        .from('students')
        .select('id, username, user_id, name, phone, school, grade')
        .eq('username', trimmedUsername)
        .maybeSingle();
      
      if (!studentData) {
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
      
      if (!studentData.user_id) {
        return res.status(401).json({
          ok: false,
          message: '학생 계정이 활성화되지 않았습니다. 관리자에게 문의하세요.'
        });
      }
      
      const studentEmail = createStudentEmail(trimmedUsername);
      console.log(`Login attempt for ${trimmedUsername} with email: ${studentEmail}`);
      
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: studentEmail,
          password: password
        });
        
        if (authError) {
          console.error('Student auth error:', authError);
          return res.status(401).json({
            ok: false,
            message: '아이디 또는 비밀번호가 일치하지 않습니다.',
            ...(process.env.NODE_ENV === 'development' && {
              debug: `Email tried: ${studentEmail}`
            })
          });
        }
        
        const token = jwt.sign(
          { id: studentData.id, username: studentData.username, role: 'student' },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '24h' }
        );
        
        return res.json({
          ok: true,
          user: {
            id: studentData.id,
            username: studentData.username,
            name: studentData.name,
            phone: studentData.phone,
            school: studentData.school,
            grade: studentData.grade
          },
          role: 'student',
          token,
          session: authData.session
        });
      } catch (error) {
        console.error('Student login error:', error);
        return res.status(401).json({
          ok: false,
          message: '아이디 또는 비밀번호가 일치하지 않습니다.'
        });
      }
    }
    
    else {
      return res.status(400).json({
        ok: false,
        message: '올바른 사용자 유형을 선택해주세요.'
      });
    }
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      ok: false,
      message: '로그인 처리 중 오류가 발생했습니다.'
    });
  }
});

// 5. 관리자 회원가입
router.post('/register/admin', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;
    
    if (!email || !password || !name || !phone) {
      return res.status(400).json({
        ok: false,
        message: '모든 필드를 입력해주세요.'
      });
    }
    
    // 이메일 중복 확인
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim())
      .maybeSingle();
    
    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: '이미 등록된 이메일입니다.'
      });
    }
    
    // Auth 사용자 생성
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
          role: 'admin'
        }
      }
    });
    
    if (authError) {
      console.error('Auth creation error:', authError);
      return res.status(500).json({
        ok: false,
        message: '회원가입 처리 중 오류가 발생했습니다.'
      });
    }
    
    const authUserId = authData.user?.id;
    
    if (!authUserId) {
      return res.status(500).json({
        ok: false,
        message: '사용자 생성에 실패했습니다.'
      });
    }
    
    // users 테이블에 저장
    const username = email.split('@')[0];
    
    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: authUserId,
        username: username,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        role: 'admin'
      });
    
    if (userError) {
      console.error('User table insert error:', userError);
      return res.status(500).json({
        ok: false,
        message: '회원정보 저장 중 오류가 발생했습니다.'
      });
    }
    
    res.json({
      ok: true,
      message: '관리자 회원가입이 완료되었습니다.',
      user: {
        id: authUserId,
        email: email.trim(),
        name: name.trim(),
        role: 'admin'
      }
    });
    
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({
      ok: false,
      message: '회원가입 처리 중 오류가 발생했습니다.'
    });
  }
});

// 6. 학부모 회원가입
router.post('/register/parent', async (req, res) => {
  try {
    const { username, password, name, phone, childId } = req.body;
    
    if (!username || !password || !name || !phone || !childId) {
      return res.status(400).json({
        ok: false,
        message: '모든 필드를 입력해주세요.'
      });
    }
    
    // 자녀 정보 재확인
    const { data: childData } = await supabase
      .from('students')
      .select('id, name')
      .eq('id', childId)
      .maybeSingle();
    
    if (!childData) {
      return res.status(404).json({
        ok: false,
        message: '자녀 정보를 찾을 수 없습니다.'
      });
    }
    
    // 아이디 중복 확인
    const { data: existingParent } = await supabase
      .from('parents')
      .select('user_id')
      .eq('username', username.trim())
      .maybeSingle();
    
    if (existingParent) {
      return res.status(409).json({
        ok: false,
        message: '이미 사용 중인 아이디입니다.'
      });
    }
    
    // Auth 사용자 생성
    const email = `${username.trim()}@parents.local`;
    
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.trim(),
          name: name.trim(),
          role: 'parent',
          childId: childId
        }
      }
    });
    
    if (authError) {
      console.error('Auth creation error:', authError);
      return res.status(500).json({
        ok: false,
        message: '회원가입 처리 중 오류가 발생했습니다.'
      });
    }
    
    const authUserId = authData.user?.id;
    
    if (!authUserId) {
      return res.status(500).json({
        ok: false,
        message: '사용자 생성에 실패했습니다.'
      });
    }
    
    // parents 테이블에 저장
    const { error: parentError } = await supabase
      .from('parents')
      .insert({
        user_id: authUserId,
        username: username.trim(),
        parent_phone: phone.trim(),
        name: name.trim(),
        relationship_to_student: '부모'
      });
    
    if (parentError) {
      console.error('Parents table insert error:', parentError);
      return res.status(500).json({
        ok: false,
        message: '회원정보 저장 중 오류가 발생했습니다.'
      });
    }
    
    // 부모-자녀 관계 저장 (테이블이 있는 경우)
    try {
      await supabase
        .from('parent_student_relations')
        .insert({
          parent_id: authUserId,
          student_id: childId
        });
    } catch (relationError) {
      console.log('Parent-student relation save skipped');
    }
    
    res.json({
      ok: true,
      message: '학부모 회원가입이 완료되었습니다.',
      user: {
        id: authUserId,
        username: username.trim(),
        name: name.trim(),
        role: 'parent',
        childName: childData.name
      }
    });
    
  } catch (error) {
    console.error('Parent registration error:', error);
    res.status(500).json({
      ok: false,
      message: '회원가입 처리 중 오류가 발생했습니다.'
    });
  }
});

// 7. 로그아웃
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

// 8. 학생 등록 (관리자 전용)
router.post('/admin/register-student', async (req, res) => {
  const { studentId, password, name, grade, class: className } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data: newStudent, error } = await supabase
      .from('users')
      .insert({
        email: studentId,
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