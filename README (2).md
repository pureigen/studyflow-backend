# StudyFlow Integration API (FastAPI)

세 개의 UI(`admin-ui`, `student dashboard-ui`, (추후) `parent-ui`)가 **동일한 시간/출결/활동 데이터**를 실시간으로 공유할 수 있도록 하는 중계 백엔드입니다.

## 빠른 시작

```bash
# 1) 가상환경 생성 & 라이브러리 설치
pip install -r requirements.txt

# 2) 서버 실행 (기본: http://127.0.0.1:8000)
uvicorn app.main:app --reload
```

> 기본 API 키: `studyflow-secret` (배포 시 반드시 교체하세요.)  
> 모든 서버-서버 호출은 `X-API-Key: studyflow-secret` 헤더를 사용합니다.

## 연동 요약

- `admin-ui`에서 학생 기본정보를 생성/수정하면 `POST /students` 로 업서트 → `student dashboard`는 로그인 시 `GET /students/{id}` 로 조회하여 동일 정보 표시
- `student dashboard`에서
  - "대시보드 시작하기" 버튼 → `POST /events/dashboard/start` (출석 체크인 + 지각 시 *주의장* 발급)
  - "로그아웃" → `POST /events/logout` (출석 체크아웃)
  - "외출 요청" → `POST /events/outing/request`
  - "복귀" → `POST /events/outing/return` (*지각 시 주의장 발급*)
  - "수면 시작" → `POST /events/sleep/request`
  - "수면 복귀" → `POST /events/sleep/return` (*알림만*, 주의장 발급 없음)
  - "순공 타이머 시작/종료" → `POST /events/focus/start`, `POST /events/focus/stop`
- 알림(Notifications)과 주의장/경고장(Notices)은 **양쪽 UI에 WebSocket으로 브로드캐스트** 됩니다.
  - WebSocket: `ws://<host>/ws?student_id=...` (학생 대시보드), `ws://<host>/ws?role=admin` (관리자 UI)
- 실시간 지각 알림(“알림 먼저”)은 각 UI에서 주기적으로 `POST /evaluate` 를 호출하여 현재 상태를 평가하고 발송합니다.
  - **주의장 발급 타이밍 규칙**
    - 등원 지각: *학생이 "대시보드 시작하기" 버튼을 눌렀을 때*
    - 외출 복귀 지각: *학생이 "복귀" 버튼을 눌렀을 때*
    - 수면 복귀 지연: *알림만*, 주의장 발급 없음

## 지각/결석 규칙

- 등원: `expected_check_in` 보다 **1초 이상 늦으면 주의장 1장**, **30분 이상** 늦으면 **주의장 2장**
- 무단결석(관리자가 별도로 처리하거나, 정책상 미체크인 종료 시점에 처리): **주의장 5장**
- 외출 복귀: 요청 시 지정한 `expected_return_time` 보다 **1초 이상** 늦으면 **주의장 1장**, **30분 이상** 늦으면 **주의장 2장**
- 수면 복귀: 지연 시 **알림만** 전송, 주의장 **미발급**

모든 시간 계산은 `Asia/Seoul`(KST) 기준, **초 단위**로 비교합니다.

## 엔드포인트

### 학생 정보
- `POST /students` — 학생 생성/수정(업서트) [admin-ui]
- `GET /students/{student_id}` — 학생 단건 조회 [dashboard-ui]

### 출석/대시보드
- `POST /events/dashboard/start` — 대시보드 시작=출석 체크인(+지각 시 주의장) [dashboard-ui]
- `POST /events/logout` — 로그아웃=출석 체크아웃 [dashboard-ui]

### 외출
- `POST /events/outing/request` — 외출 요청(복귀예정시간 포함) [dashboard-ui]
- `POST /events/outing/return` — 외출 복귀(+지각 시 주의장) [dashboard-ui]

### 수면
- `POST /events/sleep/request` — 수면 시작(기상예정시간 포함) [dashboard-ui]
- `POST /events/sleep/return` — 수면 복귀(지연 시 알림만) [dashboard-ui]

### 순공 타이머
- `POST /events/focus/start` — 순공 시작 [dashboard-ui]
- `POST /events/focus/stop` — 순공 종료(총 초 저장) [dashboard-ui]

### 상태 평가(알림 발송 트리거)
- `POST /evaluate` — 현재 시점 기준 등원/외출/수면 지각 여부 평가 → 알림 생성 [양쪽 UI 주기 호출]

### 조회
- `GET /notices/{student_id}` — 주의장/경고장 목록
- `GET /notifications/{student_id}` — 알림 목록

## WebSocket 사용

```text
학생 대시보드: ws://<host>/ws?student_id=STU123
관리자 UI:     ws://<host>/ws?role=admin
```
메시지 예)
```json
{"type":"notice","data":{"id":3,"student_id":"STU123","type":"주의장","severity":2,"reason":"외출 복귀 지각","source":"outing_return","date":"2025-08-19","created_at":"..."}}
{"type":"notification","data":{"id":7,"student_id":"STU123","category":"late-arrival","message":"[등원 지각 알림] ...","created_at":"..."}}
{"type":"focus_stop","data":{"id":10,"end_time":"...","duration_seconds":5400}}
```

## 통합 예시 (cURL)

```bash
# 1) admin-ui: 학생 정보 업서트
curl -X POST http://127.0.0.1:8000/students \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"id":"STU123","name":"홍길동","grade":"중2","classroom":"2-3","expected_check_in":"09:00:00","expected_check_out":"18:00:00"}'

# 2) student dashboard: 로그인 직후 학생 정보 조회
curl http://127.0.0.1:8000/students/STU123

# 3) 대시보드 시작하기 (출석 체크인 + 지각시 주의장)
curl -X POST http://127.0.0.1:8000/events/dashboard/start \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"student_id":"STU123"}'

# 4) 외출 요청
curl -X POST http://127.0.0.1:8000/events/outing/request \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"student_id":"STU123","expected_return_time":"2025-08-19T15:30:00+09:00"}'

# 5) 외출 복귀 (지각이면 주의장 발급)
curl -X POST http://127.0.0.1:8000/events/outing/return \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"student_id":"STU123"}'

# 6) 수면 복귀 (지연 알림만, 주의장 없음)
curl -X POST http://127.0.0.1:8000/events/sleep/return \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"student_id":"STU123"}'

# 7) 상태평가(알림 먼저) - 양쪽 UI가 분당 1회 호출 권장
curl -X POST http://127.0.0.1:8000/evaluate \
  -H "Content-Type: application/json" -H "X-API-Key: studyflow-secret" \
  -d '{"student_id":"STU123"}'
```

## 비고
- 모든 시간은 `Asia/Seoul` 기준으로 처리합니다.
- 이 백엔드는 중계 계층이며, 추후 `parent-ui`가 추가되면 동일 WebSocket 및 REST를 그대로 사용하면 됩니다.
- 무단결석 판단 로직(주의장 5장)은 운영정책에 맞춰 `관리자 배치` 혹은 `마감 시각 평가`로 확장 가능하도록 `EventLog`/`AttendanceRecord` 스키마를 포함했습니다.


### 출석 관리(무단결석)
- `POST /events/attendance/mark_absent` — 관리자가 특정 날짜 무단결석 처리(주의장 5장 즉시 발급)
