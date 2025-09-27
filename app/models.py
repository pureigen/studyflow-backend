from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Time, JSON, UniqueConstraint, Text
from sqlalchemy.orm import relationship
from .database import Base
from datetime import datetime

class Student(Base):
    __tablename__ = "students"
    id = Column(String, primary_key=True, index=True)  # student_id (login id)
    name = Column(String, nullable=False)
    grade = Column(String, nullable=True)
    classroom = Column(String, nullable=True)
    # Default expected times (HH:MM:SS as string)
    expected_check_in = Column(String, default="09:00:00")
    expected_check_out = Column(String, default="18:00:00")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    attendance_records = relationship("AttendanceRecord", back_populates="student")

class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, ForeignKey("students.id"), nullable=False, index=True)
    date = Column(String, index=True)  # YYYY-MM-DD (KST)
    check_in_time = Column(DateTime, nullable=True)
    check_out_time = Column(DateTime, nullable=True)
    status = Column(String, default="present")  # present / absent / unknown

    student = relationship("Student", back_populates="attendance_records")

    __table_args__ = (UniqueConstraint('student_id', 'date', name='_student_date_uc'),)

class OutingRequest(Base):
    __tablename__ = "outing_requests"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    start_time = Column(DateTime, nullable=False)
    expected_return_time = Column(DateTime, nullable=False)
    actual_return_time = Column(DateTime, nullable=True)
    status = Column(String, default="ongoing")  # ongoing/completed/cancelled

class SleepRequest(Base):
    __tablename__ = "sleep_requests"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    start_time = Column(DateTime, nullable=False)
    expected_wake_time = Column(DateTime, nullable=False)
    actual_wake_time = Column(DateTime, nullable=True)
    status = Column(String, default="ongoing")  # ongoing/completed/cancelled

class FocusSession(Base):
    __tablename__ = "focus_sessions"
    session_metadata = Column(JSON)
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    meta_data = Column(JSON, nullable=True)

class Notice(Base):
    __tablename__ = "notices"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    type = Column(String, default="주의장")  # 주의장 / 경고장
    severity = Column(Integer, default=1)    # 1, 2, 5
    reason = Column(String, nullable=False)  # e.g., '등원 지각', '외출 복귀 지각', '무단결석'
    source = Column(String, nullable=True)   # dashboard_start / outing_return / system
    date = Column(String, index=True)        # YYYY-MM-DD (KST)
    created_at = Column(DateTime, default=datetime.utcnow)

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    category = Column(String, nullable=False)  # late-arrival / late-outing-return / late-sleep-wake / info
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    acknowledged = Column(Boolean, default=False)
    # for dedupe
    dedupe_key = Column(String, index=True, nullable=True)
    __table_args__ = (UniqueConstraint('dedupe_key', name='_notif_dedupe_uc'),)

class EventLog(Base):
    __tablename__ = "event_logs"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    type = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    payload = Column(JSON, nullable=True)
