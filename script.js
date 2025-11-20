/* script.js */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CELL_SIZE = 50;
const HAND_CELL_SIZE = 30;
const BOARD_SIZE = 8;

const THEMES = {
    dark: { boardBg:'#2c3e50', gridLine:'#34495e', handBg:'#2c3e50', separator:'#7f8c8d', blockColor:'#3498db', blockGloss:'rgba(255,255,255,0.2)', inactiveHand:'#7f8c8d' },
    light: { boardBg:'#ffffff', gridLine:'#dfe6e9', handBg:'#f0f2f5', separator:'#b2bec3', blockColor:'#0984e3', blockGloss:'rgba(255,255,255,0.4)', inactiveHand:'#b2bec3' }
};
let currentTheme = 'dark';
function toggleTheme(checkbox) {
    if (checkbox.checked) { currentTheme = 'light'; document.body.classList.add('light-mode'); document.getElementById('mode-label').innerText = "Light Mode"; }
    else { currentTheme = 'dark'; document.body.classList.remove('light-mode'); document.getElementById('mode-label').innerText = "Dark Mode"; }
    draw();
}

const SHAPES = [
    [[1]], [[1, 1]], [[1], [1]], [[1, 1, 1]], [[1], [1], [1]],
    [[1, 1, 1, 1]], [[1], [1], [1], [1]], [[1, 1, 1, 1, 1]], [[1], [1], [1], [1], [1]],
    [[1, 1], [1, 1]], [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
    [[1, 0], [1, 1]], [[0, 1], [1, 1]], [[1, 1], [1, 0]], [[1, 1], [0, 1]],
    [[1, 0], [1, 0], [1, 1]], [[0, 1], [0, 1], [1, 1]], 
    [[1, 1, 1], [1, 0, 0]], [[1, 0, 0], [1, 1, 1]],
    [[1, 1], [1, 0], [1, 0]], [[1, 1], [0, 1], [0, 1]],
    [[0, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 0, 1]],
    [[1, 1, 1], [0, 1, 0]], [[0, 1, 0], [1, 1, 1]], 
    [[1, 0], [1, 1], [1, 0]], [[0, 1], [1, 1], [0, 1]],
    [[1, 1, 0], [0, 1, 1]], [[0, 1, 1], [1, 1, 0]],
    [[0, 1], [1, 1], [1, 0]], [[1, 0], [1, 1], [0, 1]],
    [[1, 0], [0, 1]], [[0, 1], [1, 0]]
];

let board = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
let currentHand = [];
let draggingIdx = -1;
let dragX = 0, dragY = 0;

let myPlayerId = null;
let hostId = 0;
let currentTurnId = 0;
let isPlaying = false;
let playerNames = {};
let ws = null;
let particles = [];
let turnStartTime = 0;
let currentSkipVotes = [];
let currentResetVotes = [];
let totalPlayers = 0;
let timerInterval = null;

function refillHand() {
    currentHand = [
        SHAPES[Math.floor(Math.random() * SHAPES.length)],
        SHAPES[Math.floor(Math.random() * SHAPES.length)],
        SHAPES[Math.floor(Math.random() * SHAPES.length)]
    ];
}
refillHand();

// --- 詰み判定 ---
function checkCanPlace() {
    for (let i = 0; i < currentHand.length; i++) {
        const shape = currentHand[i];
        if (shape === null) continue;
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                if (canFit(shape, row, col)) return true;
            }
        }
    }
    return false;
}

function canFit(shape, startRow, startCol) {
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c] === 1) {
                const targetR = startRow + r; const targetC = startCol + c;
                if (targetR < 0 || targetR >= BOARD_SIZE || targetC < 0 || targetC >= BOARD_SIZE) return false;
                if (board[targetR][targetC] === 1) return false;
            }
        }
    }
    return true;
}

async function triggerAutoPass() {
    const overlay = document.getElementById('pass-overlay');
    overlay.classList.add('active');
    document.getElementById('gameCanvas').classList.add('inactive-canvas');
    await new Promise(r => setTimeout(r, 2000));
    ws.send(JSON.stringify({type: 'pass_turn'}));
    overlay.classList.remove('active');
}

// --- 通信関連 ---
function joinLobby() {
    const roomInput = document.getElementById('roomInput').value.trim();
    const nameInput = document.getElementById('nameInput').value.trim();
    if (!roomInput) { document.getElementById('error-msg').innerText = "合言葉を入力してください"; return; }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/${encodeURIComponent(roomInput)}?nickname=${encodeURIComponent(nameInput)}`;
    
    if (ws) ws.close();
    ws = new WebSocket(url);

    ws.onopen = function() {
        document.getElementById('title-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'flex';
        document.getElementById('lobby-room-name').innerText = `Room: ${roomInput.toUpperCase()}`;
        if(timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(checkTurnTimer, 1000);
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.type === "error") { alert(data.message); location.reload(); }
        else if (data.type === "welcome") {
            myPlayerId = data.your_id;
            hostId = data.host_id;
            isPlaying = data.is_playing;
            if(isPlaying) {
                document.getElementById('lobby-screen').style.display = 'none';
                document.getElementById('game-container').style.display = 'flex';
            }
            updateBoard(data.board);
        }
        else if (data.type === "game_state") {
            document.getElementById('online-count').innerText = `ONLINE: ${data.count}/10`;
            totalPlayers = data.count;
            currentTurnId = data.current_turn;
            turnStartTime = data.turn_start_time;
            currentSkipVotes = data.skip_votes;
            currentResetVotes = data.reset_votes;
            hostId = data.host_id;
            isPlaying = data.is_playing;
            document.getElementById('turn-count-info').innerText = `Turns: ${data.turns_info}`;

            updateLobby(data.ranking);
            
            if (isPlaying) {
                if(document.getElementById('game-container').style.display === 'none') {
                    document.getElementById('lobby-screen').style.display = 'none';
                    document.getElementById('game-container').style.display = 'flex';
                }
                updateTurnDisplay(data.ranking);
                updateRanking(data.ranking);
                updateButtons();
                if (currentTurnId === myPlayerId) {
                    if (!checkCanPlace()) triggerAutoPass();
                }
            }
        }
        else if (data.type === "batch_update") {
            data.updates.forEach(item => {
                if (item.value === 0 && board[item.row][item.col] === 1) createExplosion(item.col, item.row);
                board[item.row][item.col] = item.value;
            });
        }
        else if (data.type === "init") updateBoard(data.board);
        else if (data.type === "game_over") {
            alert("GAME OVER!");
            location.reload();
        }
    };
    ws.onclose = function() { if(timerInterval) clearInterval(timerInterval); };
}

function updateLobby(ranking) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = "";
    if (myPlayerId === hostId) {
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('lobby-status').innerText = "You are the Host. Configure and Start.";
    } else {
        document.getElementById('host-controls').style.display = 'none';
        document.getElementById('lobby-status').innerText = "Waiting for host to start...";
    }
    ranking.forEach(p => {
        const li = document.createElement('li');
        let text = p.name;
        if (p.id === hostId) text += " 👑";
        if (p.id === myPlayerId) text += " (YOU)";
        li.innerText = text;
        if (myPlayerId === hostId && p.id !== myPlayerId) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'kick-btn'; kickBtn.innerText = '×'; kickBtn.onclick = () => kickPlayer(p.id);
            li.appendChild(kickBtn);
        }
        list.appendChild(li);
    });
}

function requestStartGame() {
    const maxTurns = document.getElementById('maxTurnsInput').value;
    ws.send(JSON.stringify({type: 'start_game', max_turns: maxTurns}));
}

function kickPlayer(targetId) {
    if(confirm("Kick this player?")) ws.send(JSON.stringify({type: 'kick_player', target_id: targetId}));
}

function manualPass() {
    if(confirm("Skip your turn?")) ws.send(JSON.stringify({type: 'pass_turn'}));
}

function checkTurnTimer() {
    if (!turnStartTime || !isPlaying) return;
    const now = Date.now() / 1000;
    const diff = now - turnStartTime;
    const skipBtn = document.getElementById('vote-skip-btn');
    if (currentTurnId !== myPlayerId && diff > 60 && totalPlayers > 1) skipBtn.style.display = 'block';
    else skipBtn.style.display = 'none';
}

function updateButtons() {
    const resetBtn = document.getElementById('reset-btn');
    const resetCount = currentResetVotes.length;
    if (currentResetVotes.includes(myPlayerId)) { resetBtn.innerText = `CANCEL RESET (${resetCount}/${totalPlayers})`; resetBtn.classList.add('voted'); }
    else { resetBtn.innerText = `VOTE RESET (${resetCount}/${totalPlayers})`; resetBtn.classList.remove('voted'); }

    const skipBtn = document.getElementById('vote-skip-btn');
    const skipCount = currentSkipVotes.length;
    const required = Math.max(1, totalPlayers - 1);
    if (currentSkipVotes.includes(myPlayerId)) { skipBtn.innerText = `CANCEL SKIP (${skipCount}/${required})`; skipBtn.classList.add('voted'); }
    else { skipBtn.innerText = `FORCE SKIP (${skipCount}/${required})`; skipBtn.classList.remove('voted'); }
    
    const selfSkipBtn = document.getElementById('self-skip-btn');
    if(currentTurnId === myPlayerId) selfSkipBtn.style.display = 'block';
    else selfSkipBtn.style.display = 'none';
}

window.voteReset = function() { ws.send(JSON.stringify({type: 'vote_reset'})); };
window.voteSkip = function() { ws.send(JSON.stringify({type: 'vote_skip'})); };
window.exitGame = function() { if(confirm("退出しますか？")) { if (ws) { ws.close(); ws = null; } location.reload(); } };

class Particle { constructor(x, y, color) { this.x = x; this.y = y; this.vx = (Math.random() - 0.5) * 10; this.vy = (Math.random() - 0.5) * 10; this.life = 1.0; this.color = color; this.size = Math.random() * 10 + 5; this.gravity = 0.5; } update() { this.x += this.vx; this.y += this.vy; this.vy += this.gravity; this.life -= 0.02; this.size *= 0.95; } draw(ctx) { ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, this.size, this.size); ctx.globalAlpha = 1.0; } }
function createExplosion(col, row) { const centerX = col * CELL_SIZE + CELL_SIZE / 2; const centerY = row * CELL_SIZE + CELL_SIZE / 2; for(let i=0; i<10; i++) { const colors = ['#3498db', '#2980b9', '#ecf0f1', '#00d2d3']; const color = colors[Math.floor(Math.random() * colors.length)]; particles.push(new Particle(centerX, centerY, color)); } }
function updateBoard(newBoard) { for(let r=0; r<BOARD_SIZE; r++) for(let c=0; c<BOARD_SIZE; c++) board[r][c] = newBoard[r][c]; }
function updateTurnDisplay(ranking) { ranking.forEach(p => playerNames[p.id] = p.name); const indicator = document.getElementById('turn-indicator'); const canvasEl = document.getElementById('gameCanvas'); if (currentTurnId === myPlayerId) { indicator.innerText = "YOUR TURN"; indicator.classList.add('my-turn'); canvasEl.classList.remove('inactive-canvas'); } else { const name = playerNames[currentTurnId] || `PLAYER ${currentTurnId}`; indicator.innerText = `TURN: ${name}`; indicator.classList.remove('my-turn'); canvasEl.classList.add('inactive-canvas'); } }
function updateRanking(rankingData) { const list = document.getElementById('score-list'); list.innerHTML = ""; rankingData.forEach(player => { const li = document.createElement('li'); const isMe = (player.id === myPlayerId); const isTurn = (player.id === currentTurnId); let className = ""; if (isMe) className += "highlight-me "; if (isTurn) className += "turn-active "; li.className = className; li.innerHTML = `<span>${player.name.toUpperCase()}</span> <span>${player.score}</span>`; list.appendChild(li); }); }
function draw() { if(document.getElementById('game-container').style.display === 'none') return; const theme = THEMES[currentTheme]; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = theme.boardBg; ctx.fillRect(0, 0, canvas.width, 400); ctx.fillStyle = theme.handBg; ctx.fillRect(0, 400, canvas.width, 200); for (let row = 0; row < BOARD_SIZE; row++) { for (let col = 0; col < BOARD_SIZE; col++) { const x = col * CELL_SIZE; const y = row * CELL_SIZE; ctx.strokeStyle = theme.gridLine; ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE); if (board[row][col] === 1) { ctx.fillStyle = theme.blockColor; ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4); ctx.fillStyle = theme.blockGloss; ctx.fillRect(x + 5, y + 5, CELL_SIZE - 10, 12); } } } ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(400, 400); ctx.strokeStyle = theme.separator; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; drawHand(theme); for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.update(); p.draw(ctx); if (p.life <= 0) particles.splice(i, 1); } requestAnimationFrame(draw); }
function drawHand(theme) { const handStartY = 450; const handHeight = 150; const slotWidth = 400 / 3; currentHand.forEach((shape, index) => { if (shape === null) return; if (index === draggingIdx) drawShape(shape, dragX, dragY, CELL_SIZE, theme.blockColor, theme); else { const shapeW = shape[0].length * HAND_CELL_SIZE; const shapeH = shape.length * HAND_CELL_SIZE; const slotCX = (index * slotWidth) + (slotWidth / 2); const slotCY = handStartY + (handHeight / 2); const color = (currentTurnId === myPlayerId) ? theme.blockColor : theme.inactiveHand; drawShape(shape, slotCX - shapeW/2, slotCY - shapeH/2, HAND_CELL_SIZE, color, theme); } }); }
function drawShape(shape, startX, startY, size, color, theme) { ctx.fillStyle = color; for(let r = 0; r < shape.length; r++) { for(let c = 0; c < shape[r].length; c++) { if(shape[r][c] === 1) { ctx.fillRect(startX + c * size, startY + r * size, size - 2, size - 2); ctx.fillStyle = theme.blockGloss; ctx.fillRect(startX + c * size + 2, startY + r * size + 2, size - 6, 4); ctx.fillStyle = color; } } } }
function getCanvasCoordinates(event) { const rect = canvas.getBoundingClientRect(); let clientX, clientY; if (event.touches && event.touches.length > 0) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; } else { clientX = event.clientX; clientY = event.clientY; } const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height; return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }; }
function handleStart(e) { if (currentTurnId !== myPlayerId) return; if(e.type === 'touchstart') e.preventDefault(); const pos = getCanvasCoordinates(e); if (pos.y > 400) { const slotWidth = 400 / 3; const clickedSlotIndex = Math.floor(pos.x / slotWidth); if (clickedSlotIndex >= 0 && clickedSlotIndex < 3) { const shape = currentHand[clickedSlotIndex]; if (shape !== null) { draggingIdx = clickedSlotIndex; dragX = pos.x - (shape[0].length * CELL_SIZE) / 2; dragY = pos.y - (shape.length * CELL_SIZE) / 2; } } } }
function handleMove(e) { if (draggingIdx !== -1) { if(e.type === 'touchmove') e.preventDefault(); const pos = getCanvasCoordinates(e); const shape = currentHand[draggingIdx]; dragX = pos.x - (shape[0].length * CELL_SIZE) / 2; dragY = pos.y - (shape.length * CELL_SIZE) / 2; } }
function handleEnd(e) { if (draggingIdx !== -1) { if(e.type === 'touchend') e.preventDefault(); const shape = currentHand[draggingIdx]; const placeCol = Math.round(dragX / CELL_SIZE); const placeRow = Math.round(dragY / CELL_SIZE); let canPlace = true; for(let r=0; r<shape.length; r++) { for(let c=0; c<shape[r].length; c++) { if(shape[r][c] === 1) { if (placeRow + r < 0 || placeRow + r >= BOARD_SIZE || placeCol + c < 0 || placeCol + c >= BOARD_SIZE) canPlace = false; else if (board[placeRow + r][placeCol + c] === 1) canPlace = false; } if (placeRow + shape.length > BOARD_SIZE || placeCol + shape[0].length > BOARD_SIZE) canPlace = false; } } if (canPlace) { const updates = []; for(let r=0; r<shape.length; r++) { for(let c=0; c<shape[r].length; c++) { if(shape[r][c] === 1) { const tR = placeRow + r; const tC = placeCol + c; board[tR][tC] = 1; updates.push({row: tR, col: tC, value: 1}); } } } ws.send(JSON.stringify({type: 'batch_update', updates: updates})); currentHand[draggingIdx] = null; if (currentHand.every(s => s === null)) { refillHand(); ws.send(JSON.stringify({type: 'end_turn'})); } } draggingIdx = -1; } }
canvas.addEventListener('mousedown', handleStart); canvas.addEventListener('mousemove', handleMove); canvas.addEventListener('mouseup', handleEnd);
canvas.addEventListener('touchstart', handleStart, {passive: false}); canvas.addEventListener('touchmove', handleMove, {passive: false}); canvas.addEventListener('touchend', handleEnd, {passive: false});