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

export default router;
