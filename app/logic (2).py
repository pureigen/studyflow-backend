from datetime import datetime, timedelta, date, time
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from typing import Optional
from . import models
from .websockets import ws_manager

KST = ZoneInfo("Asia/Seoul")

def today_kst_str(now: Optional[datetime] = None) -> str:
    if not now:
        now = datetime.now(KST)
    return now.date().isoformat()

def parse_time_str(t: str) -> time:
    hh, mm, ss = [int(x) for x in t.split(":")]
    return time(hour=hh, minute=mm, second=ss, tzinfo=None)

def combine_today_time(t: time, now: Optional[datetime] = None) -> datetime:
    if not now:
        now = datetime.now(KST)
    # combine with today's date in KST
    return datetime(year=now.year, month=now.month, day=now.day, hour=t.hour, minute=t.minute, second=t.second, tzinfo=KST)

def tardiness_category(diff_seconds: int) -> Optional[int]:
    if diff_seconds >= 30*60:
        return 2
    if diff_seconds >= 1:
        return 1
    return None

async def notify(db: Session, student_id: str, category: str, message: str, dedupe_key: Optional[str] = None):
    # de-duplicate by dedupe_key if provided
    if dedupe_key:
        existing = db.query(models.Notification).filter(models.Notification.dedupe_key == dedupe_key).first()
        if existing:
            return existing
    notif = models.Notification(
        student_id=student_id,
        category=category,
        message=message,
        created_at=datetime.now(tz=KST).astimezone(None),
        acknowledged=False,
        dedupe_key=dedupe_key
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)
    await ws_manager.send_to_all(student_id, {"type": "notification", "data": {
        "id": notif.id, "student_id": student_id, "category": category, "message": message, "created_at": notif.created_at.isoformat()
    }})
    return notif

async def issue_notice(db: Session, student_id: str, severity: int, reason: str, source: str, date_str: Optional[str] = None):
    date_str = date_str or today_kst_str()
    # Avoid duplicate notices with same severity & reason & date
    existing = db.query(models.Notice).filter(
        models.Notice.student_id == student_id,
        models.Notice.date == date_str,
        models.Notice.reason == reason,
        models.Notice.severity == severity
    ).first()
    if existing:
        return existing
    notice = models.Notice(
        student_id=student_id, type="주의장", severity=severity, reason=reason, source=source,
        date=date_str
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    await ws_manager.send_to_all(student_id, {"type": "notice", "data": {
        "id": notice.id, "student_id": student_id, "type": notice.type, "severity": severity,
        "reason": reason, "source": source, "date": date_str, "created_at": notice.created_at.isoformat()
    }})
    return notice

def get_or_create_today_attendance(db: Session, student_id: str, now: Optional[datetime] = None) -> models.AttendanceRecord:
    date_str = today_kst_str(now)
    rec = db.query(models.AttendanceRecord).filter(
        models.AttendanceRecord.student_id == student_id,
        models.AttendanceRecord.date == date_str
    ).first()
    if not rec:
        rec = models.AttendanceRecord(student_id=student_id, date=date_str, status="present")
        db.add(rec)
        db.commit()
        db.refresh(rec)
    return rec

async def evaluate_checkin_notifications(db: Session, student: models.Student, now: Optional[datetime] = None):
    now = now or datetime.now(KST)
    expected = combine_today_time(parse_time_str(student.expected_check_in), now)
    if now <= expected:
        return  # not late yet
    # if student has already checked in today, do nothing
    ar = db.query(models.AttendanceRecord).filter_by(student_id=student.id, date=today_kst_str(now)).first()
    if ar and ar.check_in_time:
        return
    diff = int((now - expected).total_seconds())
    sev = tardiness_category(diff)
    if sev is None:
        return
    dedupe_key = f"late-arrival:{student.id}:{today_kst_str(now)}:{1 if diff>=1 and diff<1800 else 2}"
    msg = f"[등원 지각 알림] 현재 {diff}초 지각 중입니다. 기준시간 {expected.astimezone(KST).time()}"
    await notify(db, student.id, "late-arrival", msg, dedupe_key=dedupe_key)

async def evaluate_outing_notifications(db: Session, student_id: str, now: Optional[datetime] = None):
    now = now or datetime.now(KST)
    # find ongoing outing
    outing = db.query(models.OutingRequest).filter_by(student_id=student_id, status="ongoing").order_by(models.OutingRequest.id.desc()).first()
    if not outing:
        return
    if now <= outing.expected_return_time.replace(tzinfo=KST):
        return
    diff = int((now - outing.expected_return_time.replace(tzinfo=KST)).total_seconds())
    sev = tardiness_category(diff)
    if sev is None:
        return
    tier = 1 if diff < 1800 else 2
    dedupe_key = f"late-outing-return:{student_id}:{outing.id}:{tier}"
    msg = f"[외출 복귀 지각 알림] 현재 {diff}초 지각 중입니다. 복귀예정 {outing.expected_return_time.astimezone(KST).strftime('%H:%M:%S')}"
    await notify(db, student_id, "late-outing-return", msg, dedupe_key=dedupe_key)

async def evaluate_sleep_notifications(db: Session, student_id: str, now: Optional[datetime] = None):
    now = now or datetime.now(KST)
    sleep = db.query(models.SleepRequest).filter_by(student_id=student_id, status="ongoing").order_by(models.SleepRequest.id.desc()).first()
    if not sleep:
        return
    if now <= sleep.expected_wake_time.replace(tzinfo=KST):
        return
    diff = int((now - sleep.expected_wake_time.replace(tzinfo=KST)).total_seconds())
    if diff >= 1:
        dedupe_key = f"late-sleep-wake:{student_id}:{sleep.id}"
        msg = f"[수면 복귀 지연 알림] 현재 {diff}초 지연 중입니다. 기상예정 {sleep.expected_wake_time.astimezone(KST).strftime('%H:%M:%S')}"
        await notify(db, student_id, "late-sleep-wake", msg, dedupe_key=dedupe_key)

async def evaluate_all(db: Session, student_id: str):
    student = db.query(models.Student).filter_by(id=student_id).first()
    if not student:
        return
    await evaluate_checkin_notifications(db, student)
    await evaluate_outing_notifications(db, student_id)
    await evaluate_sleep_notifications(db, student_id)

def ensure_kst(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=KST)
    return dt.astimezone(KST)

def seconds_late(actual: datetime, expected: datetime) -> int:
    actual = ensure_kst(actual)
    expected = ensure_kst(expected)
    return int((actual - expected).total_seconds())
