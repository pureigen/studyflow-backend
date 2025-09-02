import { Router } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import dayjs from 'dayjs';

const router = Router();

// 외출/수면 요청
router.post('/request', authenticate, async (req: AuthRequest, res) => {
  const { type, reason, expectedReturnTime } = req.body;
  const userId = req.user.id;
  
  try {
    const { data, error } = await supabase
      .from('break_requests')
      .insert({
        user_id: userId,
        type,
        reason,
        start_time: new Date(),
        expected_return: expectedReturnTime,
        status: 'REQUESTED'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // 활동 로그
    await supabase.from('activities').insert({
      user_id: userId,
      type: `${type}_REQUEST`,
      description: `${type} requested until ${dayjs(expectedReturnTime).format('HH:mm')}`,
      metadata: { reason }
    });
    
    res.json({ message: 'Request submitted', data });
  } catch (error) {
    res.status(500).json({ error: 'Request failed' });
  }
});

// 복귀 처리
router.post('/return/:requestId', authenticate, async (req: AuthRequest, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;
  const now = new Date();
  
  try {
    // 요청 정보 가져오기
    const { data: request } = await supabase
      .from('break_requests')
      .select('*')
      .eq('id', requestId)
      .eq('user_id', userId)
      .single();
    
    if (!request) throw new Error('Request not found');
    
    // 지각 계산
    let lateMinutes = 0;
    const expectedReturn = dayjs(request.expected_return);
    const actualReturn = dayjs(now);
    
    if (actualReturn.isAfter(expectedReturn)) {
      lateMinutes = actualReturn.diff(expectedReturn, 'minute');
    }
    
    // 상태 업데이트
    const status = lateMinutes > 0 ? 'LATE_RETURN' : 'RETURNED';
    
    const { data, error } = await supabase
      .from('break_requests')
      .update({
        actual_return: now,
        status,
        late_minutes: lateMinutes
      })
      .eq('id', requestId)
      .select()
      .single();
    
    if (error) throw error;
    
    // 외출 복귀 지각 시 주의장 (수면은 제외)
    if (request.type === 'OUTING' && lateMinutes > 0) {
      let warningCount = 1;
      let reason = `외출 복귀 ${lateMinutes}분 지각`;
      
      if (lateMinutes >= 30) {
        warningCount = 2;
        reason = `외출 복귀 ${lateMinutes}분 지각 (30분 이상)`;
      }
      
      await supabase.from('warnings').insert({
        user_id: userId,
        type: 'CAUTION',
        reason,
        count: warningCount
      });
      
      // 알림
      await supabase.from('notifications').insert({
        user_id: userId,
        title: '외출 복귀 지각',
        message: `${reason}으로 주의장 ${warningCount}장이 발급되었습니다.`,
        type: 'LATE_WARNING'
      });
    }
    
    // 수면 복귀 지각은 알림만
    if (request.type === 'SLEEP' && lateMinutes > 0) {
      await supabase.from('notifications').insert({
        user_id: userId,
        title: '수면 복귀 지각',
        message: `수면 복귀가 ${lateMinutes}분 늦었습니다.`,
        type: 'LATE_REMINDER'
      });
    }
    
    res.json({ message: 'Return recorded', data, lateMinutes });
  } catch (error) {
    res.status(500).json({ error: 'Return failed' });
  }
});

export default router;
