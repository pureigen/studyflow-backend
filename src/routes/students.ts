import { Router } from 'express';
import { supabase } from '../config/database';
import bcrypt from 'bcryptjs';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// 학생 정보 등록 (Admin만)
router.post('/register', authenticate, async (req: AuthRequest, res) => {
  const { email, password, name, studentId, grade, className, phoneNumber, parentPhone, address, scheduledInTime, scheduledOutTime } = req.body;
  
  // Admin 권한 체크
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 사용자 생성
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        email,
        password: hashedPassword,
        name,
        role: 'STUDENT',
        student_id: studentId
      })
      .select()
      .single();
    
    if (userError) throw userError;
    
    // 학생 상세 정보 생성
    const { data: studentInfo, error: infoError } = await supabase
      .from('student_info')
      .insert({
        user_id: user.id,
        student_id: studentId,
        grade,
        class: className,
        phone_number: phoneNumber,
        parent_phone: parentPhone,
        address,
        scheduled_in_time: scheduledInTime,
        scheduled_out_time: scheduledOutTime
      })
      .select()
      .single();
    
    if (infoError) throw infoError;
    
    res.json({ message: 'Student registered successfully', user, studentInfo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to register student' });
  }
});

// 학생 정보 조회
router.get('/:studentId', authenticate, async (req: AuthRequest, res) => {
  const { studentId } = req.params;
  
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        student_info (*),
        attendances (*),
        warnings (*),
        study_sessions (*)
      `)
      .eq('student_id', studentId)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(404).json({ error: 'Student not found' });
  }
});

// 모든 학생 목록 (Admin)
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        student_info (*)
      `)
      .eq('role', 'STUDENT')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});


// 학부모 자녀 확인 엔드포인트
router.post('/verify', async (req, res) => {
  try {
    const { name, phone } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({
        ok: false,
        message: '자녀 이름과 핸드폰번호를 모두 입력해주세요.'
      });
    }
    
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({
        ok: false,
        message: '올바른 이름을 입력해주세요.'
      });
    }
    
    // 전화번호 정규화 (숫자만 추출)
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    
    // students 테이블에서 검색
    const { data: student } = await supabase
      .from('students')
      .select('id, name, phone, username, school, grade, category, gender, ended')
      .eq('name', trimmedName)
      .or(`phone.eq.${normalizedPhone},phone.eq.${phone.trim()}`)
      .maybeSingle();
    
    if (!student) {
      return res.status(404).json({
        ok: false,
        message: '자녀분이 존재하지 않습니다.\n학생 회원가입 후 다시 시도해주세요.'
      });
    }
     res.json({
      ok: true,
      studentId: student.id,
      message: '자녀 확인이 완료되었습니다.',
      student: {
        name: student.name,
        school: student.school || '미등록',
        grade: student.grade || '미등록'
      }
    });
    
  } catch (error) {
    console.error('Student verification error:', error);
    res.status(500).json({
      ok: false,
      message: '자녀 확인 중 오류가 발생했습니다.'
    });
  }
  
});

export default router;
    
