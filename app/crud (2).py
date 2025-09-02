from sqlalchemy.orm import Session
from . import models, schemas
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, Tuple

KST = ZoneInfo("Asia/Seoul")

def upsert_student(db: Session, data: schemas.StudentCreate) -> models.Student:
    student = db.query(models.Student).filter(models.Student.id == data.id).first()
    if student:
        student.name = data.name
        student.grade = data.grade
        student.classroom = data.classroom
        student.expected_check_in = data.expected_check_in or student.expected_check_in
        student.expected_check_out = data.expected_check_out or student.expected_check_out
        student.updated_at = datetime.now(tz=KST).astimezone(None)
    else:
        student = models.Student(
            id=data.id, name=data.name, grade=data.grade, classroom=data.classroom,
            expected_check_in=data.expected_check_in or "09:00:00",
            expected_check_out=data.expected_check_out or "18:00:00"
        )
        db.add(student)
    db.commit()
    db.refresh(student)
    return student

def record_event(db: Session, student_id: str, type: str, timestamp: Optional[datetime] = None, payload: Optional[dict] = None) -> models.EventLog:
    ts = timestamp or datetime.now(tz=KST)
    ev = models.EventLog(student_id=student_id, type=type, timestamp=ts.astimezone(None), payload=payload or {})
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev

def get_student(db: Session, student_id: str) -> Optional[models.Student]:
    return db.query(models.Student).filter(models.Student.id == student_id).first()

def get_today_attendance(db: Session, student_id: str, date_str: str) -> Optional[models.AttendanceRecord]:
    return db.query(models.AttendanceRecord).filter(
        models.AttendanceRecord.student_id == student_id,
        models.AttendanceRecord.date == date_str
    ).first()

def list_notices(db: Session, student_id: str):
    return db.query(models.Notice).filter(models.Notice.student_id == student_id).order_by(models.Notice.id.desc()).all()

def list_notifications(db: Session, student_id: str):
    return db.query(models.Notification).filter(models.Notification.student_id == student_id).order_by(models.Notification.id.desc()).all()
