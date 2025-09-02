import { Router } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import dayjs from 'dayjs';

const router = Router();

// 출석 체크인 (대시보드 시작하기)
router.post('/checkin', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user.id;
  const now = new Date();
  const today = dayjs().format('YYYY-MM-DD');
  
  try {
    // 학생 정보 가져오기
    const { data: studentInfo } = await supabase
      .from('student_info')
      .select('scheduled_in_time')
      .eq('user_id', userId)
      .single();
    
    // 지각 계산
    let lateMinutes = 0;
    let status = 'PRESENT';
    
    if (studentInfo?.scheduled_in_time) {
      const scheduledTime = dayjs(`${today} ${studentInfo.scheduled_in_time}`);
      const checkInTime = dayjs(now);
      
      if (checkInTime.isAfter(scheduledTime)) {
        lateMinutes = checkInTime.diff(scheduledTime, 'minute');
        status = lateMinutes > 0 ? 'LATE' : 'PRESENT';
      }
    }
    
    // 출석 기록
    const { data: attendance, error } = await supabase
      .from('attendances')
      .upsert({
        user_id: userId,
        date: today,
        check_in_time: now,
        status,
        late_minutes: lateMinutes
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // 활동 로그
    await supabase.from('activities').insert({
      user_id: userId,
      type: 'CHECK_IN',
      description: `Checked in at ${dayjs(now).format('HH:mm')}`,
      metadata: { lateMinutes, status }
    });
    
    // 지각 시 주의장 발급
    if (lateMinutes > 0) {
      let warningCount = 1;
      let reason = `${lateMinutes}분 지각`;
      
      if (lateMinutes >= 30) {
        warningCount = 2;
        reason = `${lateMinutes}분 지각 (30분 이상)`;
      }
      
      await supabase.from('warnings').insert({
        user_id: userId,
        type: 'CAUTION',
        reason,
        count: warningCount
      });
      
      // 알림 생성
      await supabase.from('notifications').insert({
        user_id: userId,
        title: '지각 주의장 발급',
        message: `${reason}으로 주의장 ${warningCount}장이 발급되었습니다.`,
        type: 'LATE_WARNING'
      });
    }
    
    res.json({ 
      message: 'Check-in successful', 
      attendance,
      lateMinutes,
      status 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// 출석 체크아웃 (로그아웃)
router.post('/checkout', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user.id;
  const now = new Date();
  const today = dayjs().format('YYYY-MM-DD');
  
  try {
    // 출석 업데이트
    const { data, error } = await supabase
      .from('attendances')
      .update({ check_out_time: now })
      .eq('user_id', userId)
      .eq('date', today)
      .select()
      .single();
    
    if (error) throw error;
    
    // 활동 로그
    await supabase.from('activities').insert({
      user_id: userId,
      type: 'CHECK_OUT',
      description: `Checked out at ${dayjs(now).format('HH:mm')}`
    });
    
    res.json({ message: 'Check-out successful', data });
  } catch (error) {
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// 출석 현황 조회
router.get('/status/:userId', authenticate, async (req: AuthRequest, res) => {
  const { userId } = req.params;
  const today = dayjs().format('YYYY-MM-DD');
  
  try {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json(data || { status: 'NOT_CHECKED_IN' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance status' });
  }
});

// 월별 출석 조회
router.get('/monthly/:userId', authenticate, async (req: AuthRequest, res) => {
  const { userId } = req.params;
  const { year, month } = req.query;
  
  const startDate = dayjs(`${year}-${month}-01`).format('YYYY-MM-DD');
  const endDate = dayjs(startDate).endOf('month').format('YYYY-MM-DD');
  
  try {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch monthly attendance' });
  }
});

export default router;
