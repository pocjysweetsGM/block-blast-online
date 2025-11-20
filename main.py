from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
import json
import asyncio
import time
import os

app = FastAPI()

# ★重要: サーバー上のファイルの場所を正確に取得する
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/")
async def get():
    return FileResponse(os.path.join(BASE_DIR, 'index.html'))

@app.get("/style.css")
async def get_css():
    return FileResponse(os.path.join(BASE_DIR, 'style.css'))

@app.get("/script.js")
async def get_js():
    return FileResponse(os.path.join(BASE_DIR, 'script.js'))

# --- ゲームロジック ---

class GameRoom:
    def __init__(self):
        self.active_connections: dict[WebSocket, int] = {}
        self.board = [[0] * 8 for _ in range(8)]
        self.scores: dict[int, int] = {}
        self.names: dict[int, str] = {}
        
        self.current_turn: int = 0
        self.host_id: int = 0
        self.is_playing: bool = False
        self.max_turns: int = 0
        self.current_turn_count: int = 0

        self.turn_start_time: float = 0
        self.skip_votes: set[int] = set()
        self.reset_votes: set[int] = set()

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections.keys()):
            try:
                await connection.send_json(message)
            except:
                pass

    def rotate_turn(self):
        self.skip_votes.clear()
        self.turn_start_time = time.time()
        self.current_turn_count += 1
        
        if not self.active_connections:
            self.current_turn = 0
            return

        ids = sorted(list(self.active_connections.values()))
        if self.current_turn == 0:
            self.current_turn = ids[0]
            return

        try:
            current_index = ids.index(self.current_turn)
            next_index = (current_index + 1) % len(ids)
            self.current_turn = ids[next_index]
        except ValueError:
            self.current_turn = ids[0]

rooms: dict[str, GameRoom] = {}
MAX_PLAYERS_PER_ROOM = 10

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, nickname: str = ""):
    if room_id not in rooms:
        rooms[room_id] = GameRoom()
    room = rooms[room_id]

    if len(room.active_connections) >= MAX_PLAYERS_PER_ROOM:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "満員です"})
        await websocket.close()
        return
    
    if room.is_playing:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "ゲーム進行中です"})
        await websocket.close()
        return

    await websocket.accept()

    used_ids = set(room.active_connections.values())
    current_player_id = 1
    while current_player_id in used_ids:
        current_player_id += 1
    
    if not nickname.strip():
        final_name = f"Player {current_player_id}"
    else:
        final_name = nickname.strip()
    
    existing_names = set(room.names.values())
    original_name = final_name
    count = 2
    while final_name in existing_names:
        final_name = f"{original_name} {count}"
        count += 1

    room.active_connections[websocket] = current_player_id
    room.scores[current_player_id] = 0
    room.names[current_player_id] = final_name

    if len(room.active_connections) == 1 or room.host_id == 0:
        room.host_id = current_player_id

    await websocket.send_json({
        "type": "welcome",
        "your_id": current_player_id,
        "your_name": final_name,
        "board": room.board,
        "room_id": room_id,
        "host_id": room.host_id,
        "is_playing": room.is_playing
    })

    async def broadcast_room_state():
        ranking = []
        for pid, score in room.scores.items():
            name = room.names.get(pid, f"Player {pid}")
            ranking.append({"id": pid, "name": name, "score": score})
        ranking.sort(key=lambda x: x["score"], reverse=True)

        message = {
            "type": "game_state",
            "count": len(room.active_connections),
            "ranking": ranking,
            "current_turn": room.current_turn,
            "turn_start_time": room.turn_start_time,
            "skip_votes": list(room.skip_votes),
            "reset_votes": list(room.reset_votes),
            "host_id": room.host_id,
            "is_playing": room.is_playing,
            "turns_info": f"{room.current_turn_count}/{room.max_turns}" if room.max_turns > 0 else "∞"
        }
        await room.broadcast(message)

    await broadcast_room_state()

    async def check_votes_and_execute():
        player_count = len(room.active_connections)
        if player_count == 0: return

        if len(room.reset_votes) >= player_count:
            room.board = [[0] * 8 for _ in range(8)]
            for pid in room.scores: room.scores[pid] = 0
            room.reset_votes.clear()
            room.skip_votes.clear()
            room.current_turn_count = 0
            await room.broadcast({"type": "init", "board": room.board})
            await broadcast_room_state()
            return

        required_skips = max(1, player_count - 1)
        if len(room.skip_votes) >= required_skips:
            room.rotate_turn()
            await broadcast_room_state()

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message["type"] == "start_game":
                if current_player_id == room.host_id:
                    # ★修正: 値が変でも 0 (無制限) にしてサーバーを落とさない
                    try:
                        room.max_turns = int(message.get("max_turns", 0))
                    except ValueError:
                        room.max_turns = 0
                    room.current_turn_count = 1
                    room.is_playing = True
                    room.current_turn = room.host_id
                    room.turn_start_time = time.time()
                    await broadcast_room_state()

            elif message["type"] == "kick_player":
                if current_player_id == room.host_id:
                    target_id = message.get("target_id")
                    target_ws = None
                    for ws, pid in room.active_connections.items():
                        if pid == target_id:
                            target_ws = ws
                            break
                    if target_ws:
                        await target_ws.send_json({"type": "error", "message": "ホストによりキックされました"})
                        await target_ws.close() 

            elif message["type"] == "batch_update":
                if room.current_turn != current_player_id: continue

                updates = message["updates"]
                for item in updates:
                    r, c, v = item["row"], item["col"], item["value"]
                    if 0 <= r < 8 and 0 <= c < 8:
                        room.board[r][c] = v
                
                await room.broadcast(message)

                rows_to_clear = []
                cols_to_clear = []
                for r in range(8):
                    if all(room.board[r][c] == 1 for c in range(8)): rows_to_clear.append(r)
                for c in range(8):
                    if all(room.board[r][c] == 1 for r in range(8)): cols_to_clear.append(c)

                if rows_to_clear or cols_to_clear:
                    lines_count = len(rows_to_clear) + len(cols_to_clear)
                    points = lines_count * 10
                    if current_player_id in room.scores:
                        room.scores[current_player_id] += points
                    
                    await asyncio.sleep(0.3)
                    cleared_updates = []
                    for r in rows_to_clear:
                        for c in range(8):
                            room.board[r][c] = 0
                            cleared_updates.append({"row": r, "col": c, "value": 0})
                    for c in cols_to_clear:
                        for r in range(8):
                            room.board[r][c] = 0
                            cleared_updates.append({"row": r, "col": c, "value": 0})
                    
                    await room.broadcast({"type": "batch_update", "updates": cleared_updates})
                    await broadcast_room_state()

            elif message["type"] == "end_turn" or message["type"] == "pass_turn":
                if room.current_turn == current_player_id:
                    if room.max_turns > 0 and room.current_turn_count >= room.max_turns:
                        room.is_playing = False
                        await room.broadcast({"type": "game_over", "ranking": []})
                        room.current_turn = 0
                    else:
                        room.rotate_turn()
                        await broadcast_room_state()

            elif message["type"] == "vote_reset":
                if current_player_id in room.reset_votes: room.reset_votes.remove(current_player_id)
                else: room.reset_votes.add(current_player_id)
                await broadcast_room_state()
                await check_votes_and_execute()

            elif message["type"] == "vote_skip":
                if room.current_turn != current_player_id:
                    if current_player_id in room.skip_votes: room.skip_votes.remove(current_player_id)
                    else: room.skip_votes.add(current_player_id)
                    await broadcast_room_state()
                    await check_votes_and_execute()

    except WebSocketDisconnect:
        if websocket in room.active_connections:
            del room.active_connections[websocket]
        if current_player_id in room.scores:
            del room.scores[current_player_id]
        if current_player_id in room.names:
            del room.names[current_player_id]
        
        if current_player_id in room.skip_votes: room.skip_votes.remove(current_player_id)
        if current_player_id in room.reset_votes: room.reset_votes.remove(current_player_id)

        if room.host_id == current_player_id:
            if room.active_connections:
                new_host = sorted(room.active_connections.values())[0]
                room.host_id = new_host
            else:
                room.host_id = 0

        if room.current_turn == current_player_id:
            room.rotate_turn()

        if len(room.active_connections) == 0:
            del rooms[room_id]
        else:
            await broadcast_room_state()
            await check_votes_and_execute()