from typing import Dict, List, Set
from fastapi import WebSocket
from collections import defaultdict

class WSManager:
    def __init__(self):
        # Map student_id to set of websockets
        self.student_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        # Admin channel for all-students broadcasts
        self.admin_connections: Set[WebSocket] = set()

    async def connect_student(self, student_id: str, websocket: WebSocket):
        await websocket.accept()
        self.student_connections[student_id].add(websocket)

    async def connect_admin(self, websocket: WebSocket):
        await websocket.accept()
        self.admin_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        for s, conns in list(self.student_connections.items()):
            if websocket in conns:
                conns.remove(websocket)
        if websocket in self.admin_connections:
            self.admin_connections.remove(websocket)

    async def send_to_student(self, student_id: str, message: dict):
        dead = []
        for ws in list(self.student_connections.get(student_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_admins(self, message: dict):
        dead = []
        for ws in list(self.admin_connections):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_all(self, student_id: str, message: dict):
        await self.send_to_student(student_id, message)
        await self.send_to_admins(message)

ws_manager = WSManager()
