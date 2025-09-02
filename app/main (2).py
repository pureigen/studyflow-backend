from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .database import SessionLocal, engine, Base
from . import models, schemas, crud
from .logic import KST, today_kst_str, parse_time_str, combine_today_time, tardiness_category, seconds_late, get_or_create_today_attendance, evaluate_all, issue_notice, notify
from .websockets import ws_manager
from datetime import datetime, timedelta
from typing import Optional

API_KEY = "studyflow-secret"  # replace in production

Base.metadata.create_all(bind=engine)

app = FastAPI(title="StudyFlow Integration API", version="1.0.0")

# CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

@app.post("/students", dependencies=[Depends(verify_api_key)])
def create_or_update_student(payload: schemas.StudentCreate, db: Session = Depends(get_db)):
    student = crud.upsert_student(db, payload)
    # broadcast to both UIs
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(student.id, {"type": "student_updated", "data": {
        "id": student.id, "name": student.name, "grade": student.grade, "classroom": student.classroom,
        "expected_check_in": student.expected_check_in, "expected_check_out": student.expected_check_out
    }}))
    return {"ok": True, "student": {"id": student.id, "name": student.name, "grade": student.grade, "classroom": student.classroom,
                                     "expected_check_in": student.expected_check_in, "expected_check_out": student.expected_check_out}}

@app.get("/students/{student_id}", response_model=schemas.StudentOut)
def get_student(student_id: str, db: Session = Depends(get_db)):
    s = crud.get_student(db, student_id)
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    return schemas.StudentOut(id=s.id, name=s.name, grade=s.grade, classroom=s.classroom,
                              expected_check_in=s.expected_check_in, expected_check_out=s.expected_check_out)

@app.post("/events/dashboard/start", dependencies=[Depends(verify_api_key)])
async def dashboard_start(ev: schemas.DashboardStart, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    student = crud.get_student(db, ev.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    crud.record_event(db, ev.student_id, "dashboard_start", now)

    # attendance record (check-in)
    rec = get_or_create_today_attendance(db, ev.student_id, now)
    if not rec.check_in_time:
        rec.check_in_time = now.astimezone(None)
        db.commit()

    # evaluate tardiness and issue notice (주의장) on *button press*
    expected = combine_today_time(parse_time_str(student.expected_check_in), now)
    diff = seconds_late(now, expected)
    sev = tardiness_category(diff)
    if sev:
        await issue_notice(db, ev.student_id, severity=sev, reason="등원 지각", source="dashboard_start", date_str=today_kst_str(now))

    return {"ok": True, "attendance": {"date": rec.date, "check_in_time": rec.check_in_time}}

@app.post("/events/logout", dependencies=[Depends(verify_api_key)])
async def dashboard_logout(ev: schemas.Logout, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    student = crud.get_student(db, ev.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    crud.record_event(db, ev.student_id, "logout", now)
    # attendance check-out
    rec = get_or_create_today_attendance(db, ev.student_id, now)
    rec.check_out_time = now.astimezone(None)
    db.commit()
    # broadcast
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "logout", "data": {"student_id": ev.student_id, "time": now.isoformat()}}))
    return {"ok": True}

@app.post("/events/outing/request", dependencies=[Depends(verify_api_key)])
async def outing_request(ev: schemas.OutingRequestIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    crud.record_event(db, ev.student_id, "outing_request", now, payload={"expected_return_time": ev.expected_return_time.isoformat()})
    req = models.OutingRequest(
        student_id=ev.student_id, start_time=now.astimezone(None), expected_return_time=ev.expected_return_time.astimezone(None), status="ongoing"
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    # broadcast
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "outing_request", "data": {
        "id": req.id, "expected_return_time": ev.expected_return_time.isoformat(), "start_time": now.isoformat()
    }}))
    return {"ok": True, "outing_id": req.id}

@app.post("/events/outing/return", dependencies=[Depends(verify_api_key)])
async def outing_return(ev: schemas.OutingReturnIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    outing = db.query(models.OutingRequest).filter_by(student_id=ev.student_id, status="ongoing").order_by(models.OutingRequest.id.desc()).first()
    if not outing:
        raise HTTPException(status_code=404, detail="No ongoing outing request")
    outing.actual_return_time = now.astimezone(None)
    outing.status = "completed"
    db.commit()
    # evaluate tardiness: *issue notice* on return button
    diff = int((now - outing.expected_return_time.replace(tzinfo=KST)).total_seconds())
    if diff > 0:
        sev = 2 if diff >= 1800 else 1
        await issue_notice(db, ev.student_id, severity=sev, reason="외출 복귀 지각", source="outing_return", date_str=today_kst_str(now))
    # broadcast
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "outing_return", "data": {
        "id": outing.id, "actual_return_time": now.isoformat()
    }}))
    return {"ok": True}

@app.post("/events/sleep/request", dependencies=[Depends(verify_api_key)])
async def sleep_request(ev: schemas.SleepRequestIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    crud.record_event(db, ev.student_id, "sleep_request", now, payload={"expected_wake_time": ev.expected_wake_time.isoformat()})
    req = models.SleepRequest(
        student_id=ev.student_id, start_time=now.astimezone(None), expected_wake_time=ev.expected_wake_time.astimezone(None), status="ongoing"
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "sleep_request", "data": {
        "id": req.id, "expected_wake_time": ev.expected_wake_time.isoformat(), "start_time": now.isoformat()
    }}))
    return {"ok": True, "sleep_id": req.id}

@app.post("/events/sleep/return", dependencies=[Depends(verify_api_key)])
async def sleep_return(ev: schemas.SleepReturnIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    sleep = db.query(models.SleepRequest).filter_by(student_id=ev.student_id, status="ongoing").order_by(models.SleepRequest.id.desc()).first()
    if not sleep:
        raise HTTPException(status_code=404, detail="No ongoing sleep request")
    sleep.actual_wake_time = now.astimezone(None)
    sleep.status = "completed"
    db.commit()
    # Only notification, no notice
    diff = int((now - sleep.expected_wake_time.replace(tzinfo=KST)).total_seconds())
    if diff > 0:
        msg = f"[수면 복귀 지연] {diff}초 지연되었습니다."
        await notify(db, ev.student_id, "late-sleep-wake", msg, dedupe_key=f"sleep-return:{sleep.id}")
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "sleep_return", "data": {
        "id": sleep.id, "actual_wake_time": now.isoformat()
    }}))
    return {"ok": True}

@app.post("/events/focus/start", dependencies=[Depends(verify_api_key)])
async def focus_start(ev: schemas.FocusStartIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    sess = models.FocusSession(student_id=ev.student_id, start_time=now.astimezone(None), metadata=ev.meta or {})
    db.add(sess)
    db.commit()
    db.refresh(sess)
    crud.record_event(db, ev.student_id, "focus_start", now, payload={"focus_session_id": sess.id})
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "focus_start", "data": {"id": sess.id, "start_time": now.isoformat()}}))
    return {"ok": True, "focus_session_id": sess.id}

@app.post("/events/focus/stop", dependencies=[Depends(verify_api_key)])
async def focus_stop(ev: schemas.FocusStopIn, db: Session = Depends(get_db)):
    now = ev.timestamp or datetime.now(KST)
    sess = db.query(models.FocusSession).filter_by(student_id=ev.student_id).order_by(models.FocusSession.id.desc()).first()
    if not sess or sess.end_time:
        raise HTTPException(status_code=404, detail="No active focus session")
    sess.end_time = now.astimezone(None)
    sess.duration_seconds = int((sess.end_time - sess.start_time).total_seconds())
    db.commit()
    crud.record_event(db, ev.student_id, "focus_stop", now, payload={"focus_session_id": sess.id, "duration": sess.duration_seconds})
    import asyncio
    asyncio.create_task(ws_manager.send_to_all(ev.student_id, {"type": "focus_stop", "data": {
        "id": sess.id, "end_time": now.isoformat(), "duration_seconds": sess.duration_seconds
    }}))
    return {"ok": True, "duration_seconds": sess.duration_seconds}

@app.post("/evaluate", dependencies=[Depends(verify_api_key)])
async def evaluate(payload: schemas.EvaluateIn, db: Session = Depends(get_db)):
    await evaluate_all(db, payload.student_id)
    return {"ok": True}

@app.get("/notices/{student_id}", response_model=list[schemas.NoticeOut])
def list_notices(student_id: str, db: Session = Depends(get_db)):
    items = crud.list_notices(db, student_id)
    return [
        schemas.NoticeOut(
            id=i.id, student_id=i.student_id, type=i.type, severity=i.severity, reason=i.reason,
            source=i.source, date=i.date, created_at=i.created_at
        ) for i in items
    ]

@app.get("/notifications/{student_id}", response_model=list[schemas.NotificationOut])
def list_notifications(student_id: str, db: Session = Depends(get_db)):
    items = crud.list_notifications(db, student_id)
    return [
        schemas.NotificationOut(
            id=i.id, student_id=i.student_id, category=i.category, message=i.message,
            created_at=i.created_at, acknowledged=i.acknowledged
        ) for i in items
    ]

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, student_id: Optional[str] = None, role: Optional[str] = None):
    try:
        if role == "admin":
            await ws_manager.connect_admin(websocket)
        elif student_id:
            await ws_manager.connect_student(student_id, websocket)
        else:
            await websocket.accept()
            await websocket.close(code=4000)
            return

        while True:
            # keep alive; echo pings if desired
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.post("/events/attendance/mark_absent", dependencies=[Depends(verify_api_key)])
async def mark_absent(student_id: str, date_str: Optional[str] = None, db: Session = Depends(get_db)):
    now = datetime.now(KST)
    date_str = date_str or now.date().isoformat()
    # ensure record exists
    rec = db.query(models.AttendanceRecord).filter_by(student_id=student_id, date=date_str).first()
    if not rec:
        rec = models.AttendanceRecord(student_id=student_id, date=date_str, status="absent")
        db.add(rec)
    else:
        rec.status = "absent"
    db.commit()
    # issue notice 5장
    await issue_notice(db, student_id, severity=5, reason="무단결석", source="admin_mark_absent", date_str=date_str)
    return {"ok": True, "date": date_str}
