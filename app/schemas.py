from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime, time

class StudentCreate(BaseModel):
    id: str
    name: str
    grade: Optional[str] = None
    classroom: Optional[str] = None
    expected_check_in: Optional[str] = "09:00:00"  # HH:MM:SS
    expected_check_out: Optional[str] = "18:00:00" # HH:MM:SS

class StudentOut(BaseModel):
    id: str
    name: str
    grade: Optional[str]
    classroom: Optional[str]
    expected_check_in: str
    expected_check_out: str

class AttendanceOut(BaseModel):
    date: str
    check_in_time: Optional[datetime]
    check_out_time: Optional[datetime]
    status: str

class NoticeOut(BaseModel):
    id: int
    student_id: str
    type: str
    severity: int
    reason: str
    source: Optional[str]
    date: str
    created_at: datetime

class NotificationOut(BaseModel):
    id: int
    student_id: str
    category: str
    message: str
    created_at: datetime
    acknowledged: bool

class EventBase(BaseModel):
    student_id: str
    timestamp: Optional[datetime] = None

class DashboardStart(EventBase):
    pass

class Logout(EventBase):
    pass

class OutingRequestIn(EventBase):
    expected_return_time: datetime

class OutingReturnIn(EventBase):
    pass

class SleepRequestIn(EventBase):
    expected_wake_time: datetime

class SleepReturnIn(EventBase):
    pass

class FocusStartIn(EventBase):
    meta: Optional[dict] = None

class FocusStopIn(EventBase):
    pass

class EvaluateIn(BaseModel):
    student_id: str
