/* script.js */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CELL_SIZE = 50;
const BOARD_SIZE = 8;
const HAND_START_Y = 415; 
const DRAG_OFFSET_Y = 80; 

const THEMES = {
    dark: { boardBg:'#2c3e50', gridLine:'#34495e', handBg:'#2c3e50', separator:'#7f8c8d', blockColor:'#3498db', blockGloss:'rgba(255,255,255,0.2)', inactiveHand:'#7f8c8d', ghostColor: 'rgba(52, 152, 219, 0.3)', highlightColor: 'rgba(46, 204, 113, 0.5)' },
    light: { boardBg:'#ffffff', gridLine:'#dfe6e9', handBg:'#f0f2f5', separator:'#b2bec3', blockColor:'#0984e3', blockGloss:'rgba(255,255,255,0.4)', inactiveHand:'#b2bec3', ghostColor: 'rgba(9, 132, 227, 0.3)', highlightColor: 'rgba(0, 184, 148, 0.5)' }
};
let currentTheme = 'dark';
function toggleTheme(checkbox) {
    if (checkbox.checked) { currentTheme = 'light'; document.body.classList.add('light-mode'); document.getElementById('mode-label').innerText = "Light Mode"; }
    else { currentTheme = 'dark'; document.body.classList.remove('light-mode'); document.getElementById('mode-label').innerText = "Dark Mode"; }
    draw();
}

// ★音を元に戻す（シンプルな電子音）
class SoundManager {
    constructor() { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    playPick() { this._tone(600, 800, 0.1); }
    playReturn() { this._tone(300, 100, 0.2); }
    playPlace() { this._tone(200, 50, 0.1); }
    playClear(combo) {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const bufferSize = this.ctx.sampleRate * 0.5;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
        const noiseFilter = this.ctx.createBiquadFilter(); noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 1000 + (combo * 500);
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
        noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.ctx.destination);
        noise.start();
        const baseFreq = 440; const freq = baseFreq * Math.pow(1.05946, combo * 2);
        this._tone(freq, freq * 2, 0.3, 'triangle');
    }
    playButton() { this._tone(800, 800, 0.05, 'sine', 0.05); }
    _tone(f1, f2, dur, type='sine', vol=0.1) {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f1, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(f2, this.ctx.currentTime + dur);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + dur);
    }
}
const sound = new SoundManager();

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
let isClearing = false;
let playerNames = {};
let ws = null;
let particles = [];
let turnStartTime = 0;
let currentSkipVotes = [];
let currentResetVotes = [];
let totalPlayers = 0;
let timerInterval = null;
let voteNotificationTimer = null;
let prevSkipVotesLen = 0;
let comboCount = 0;
let lastClearTurnId = -1;
let lastSentTime = 0;

function showModal(title, message, onConfirm, isConfirm = false) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    const okBtn = document.getElementById('modal-ok-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    cancelBtn.style.display = isConfirm ? 'inline-block' : 'none';
    const newOk = okBtn.cloneNode(true); okBtn.parentNode.replaceChild(newOk, okBtn);
    const newCancel = cancelBtn.cloneNode(true); cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newOk.addEventListener('click', () => { sound.playButton(); modal.style.display = 'none'; if (onConfirm) onConfirm(); });
    newCancel.addEventListener('click', () => { sound.playButton(); modal.style.display = 'none'; });
    modal.style.display = 'flex';
}
function openRankingModal() { sound.playButton(); document.getElementById('ranking-modal').style.display = 'flex'; }
function closeRankingModal(e) { if(e === null || e.target.id === 'ranking-modal') { sound.playButton(); document.getElementById('ranking-modal').style.display = 'none'; } }

function getBlockSize(shape) { return shape.flat().filter(x => x === 1).length; }

function refillHand() {
    const placeable = SHAPES.filter(shape => isShapePlaceable(shape));
    placeable.sort((a, b) => getBlockSize(b) - getBlockSize(a));
    const newHand = [];
    const source = placeable.length > 0 ? placeable : SHAPES;
    for(let i=0; i<3; i++) {
        const range = Math.max(1, Math.ceil(source.length * 0.5));
        const pickIdx = Math.floor(Math.random() * range);
        newHand.push(source[pickIdx]);
    }
    currentHand = newHand;
}

function isShapePlaceable(shape) {
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (canFit(shape, row, col)) return true;
        }
    }
    return false;
}

function checkCanPlace() {
    let hasBlocks = false;
    for (let i = 0; i < currentHand.length; i++) {
        const shape = currentHand[i];
        if (shape === null) continue;
        hasBlocks = true;
        if (isShapePlaceable(shape)) return true; 
        if (canPlaceAfterClear(shape)) return true;
    }
    if (!hasBlocks) return true; 
    return false;
}
function canFit(shape, startRow, startCol, targetBoard = board) {
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c] === 1) {
                const targetR = startRow + r; const targetC = startCol + c;
                if (targetR < 0 || targetR >= BOARD_SIZE || targetC < 0 || targetC >= BOARD_SIZE) return false;
                if (targetBoard[targetR][targetC] === 1) return false;
            }
        }
    }
    return true;
}
function canPlaceAfterClear(shapeToCheck) {
    let simBoard = board.map(row => [...row]);
    let rowsToClear = []; let colsToClear = [];
    for (let r = 0; r < BOARD_SIZE; r++) { if (simBoard[r].every(cell => cell === 1)) rowsToClear.push(r); }
    for (let c = 0; c < BOARD_SIZE; c++) { let full = true; for (let r = 0; r < BOARD_SIZE; r++) { if (simBoard[r][c] === 0) full = false; } if (full) colsToClear.push(c); }
    if (rowsToClear.length === 0 && colsToClear.length === 0) return false;
    rowsToClear.forEach(r => { for(let c=0; c<BOARD_SIZE; c++) simBoard[r][c] = 0; });
    colsToClear.forEach(c => { for(let r=0; r<BOARD_SIZE; r++) simBoard[r][c] = 0; });
    for (let r = 0; r < BOARD_SIZE; r++) { for (let c = 0; c < BOARD_SIZE; c++) { if (canFit(shapeToCheck, r, c, simBoard)) return true; } }
    return false;
}
// ★復活: これがないとdrawでエラーになる
function checkPotentialClears(shape, startRow, startCol) {
    let tempBoard = board.map(row => [...row]);
    for(let r=0; r<shape.length; r++) {
        for(let c=0; c<shape[r].length; c++) {
            if(shape[r][c] === 1) {
                tempBoard[startRow + r][startCol + c] = 1;
            }
        }
    }
    let rows = []; let cols = [];
    for (let r = 0; r < BOARD_SIZE; r++) { if (tempBoard[r].every(cell => cell === 1)) rows.push(r); }
    for (let c = 0; c < BOARD_SIZE; c++) { let full = true; for (let r = 0; r < BOARD_SIZE; r++) { if (tempBoard[r][c] === 0) full = false; } if (full) cols.push(c); }
    return { rows, cols };
}

async function triggerAutoPass() {
    const overlay = document.getElementById('pass-overlay');
    overlay.classList.add('active');
    document.getElementById('gameCanvas').classList.add('inactive-canvas');
    currentHand = [null, null, null];
    await new Promise(r => setTimeout(r, 2000));
    ws.send(JSON.stringify({type: 'pass_turn'}));
    overlay.classList.remove('active');
}

function startGame() {
    sound.playButton();
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
        document.getElementById('game-container').style.display = 'flex';
        document.getElementById('room-info').innerText = `Room: ${roomInput.toUpperCase()}`;
        if(currentHand.length === 0 || currentHand.every(s=>s===null)) refillHand();
        draw();
        if(timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(checkTurnTimer, 1000);
    };
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === "error") showModal("ERROR", data.message, () => location.reload());
        else if (data.type === "welcome") {
            myPlayerId = data.your_id;
            document.getElementById('player-badge').innerText = `${data.your_name} (YOU)`;
            if(data.restored) showModal("WELCOME BACK", "スコアを復元しました！");
            updateBoard(data.board);
            if(currentHand.length === 0 || currentHand.every(s=>s===null)) refillHand();
        }
        else if (data.type === "game_state") {
            document.getElementById('online-count').innerText = `ONLINE: ${data.count}/10`;
            totalPlayers = data.count;
            currentTurnId = data.current_turn;
            turnStartTime = data.turn_start_time;
            currentSkipVotes = data.skip_votes;
            currentResetVotes = data.reset_votes;
            hostId = data.host_id;
            isClearing = data.is_clearing;
            document.getElementById('turn-count-info').innerText = `Round: ${data.round_info}`;
            updateTurnDisplay(data.ranking);
            updateRanking(data.ranking);
            updateButtons();
            updateVotePopup();
            
            if (currentHand.length === 0 || currentHand.every(s => s === null)) {
                refillHand();
            }
            
            if (currentTurnId === myPlayerId && !isClearing) {
                if (!checkCanPlace()) triggerAutoPass();
            }
        }
        else if (data.type === "batch_update") {
            let cleared = false;
            data.updates.forEach(item => {
                if (item.value === 0 && board[item.row][item.col] === 1) {
                    createExplosion(item.col, item.row); // ★これがなくてエラーになっていた
                    cleared = true;
                }
                board[item.row][item.col] = item.value;
            });
            if (cleared) {
                if (lastClearTurnId === -1 || (Date.now() - lastClearTurnId) < 4000) comboCount++;
                else comboCount = 0;
                lastClearTurnId = Date.now();
                sound.playClear(comboCount);
            } else {
                sound.playPlace();
                comboCount = 0; 
            }
        }
        else if (data.type === "init") updateBoard(data.board);
        else if (data.type === "game_over") showModal("GAME OVER", "100 Rounds Completed!", () => location.reload());
    };
    ws.onclose = function() { if(timerInterval) clearInterval(timerInterval); };
}

function manualPass() {
    showModal("SKIP TURN", "本当にスキップしますか？", () => {
        currentHand = [null, null, null];
        ws.send(JSON.stringify({type: 'pass_turn'}));
    }, true);
}
function checkTurnTimer() {
    if (!turnStartTime) return;
    const now = Date.now() / 1000; const diff = now - turnStartTime;
    const skipBtn = document.getElementById('vote-skip-btn');
    if (skipBtn) {
        if (currentTurnId !== myPlayerId && diff > 60 && totalPlayers > 1) { 
            skipBtn.style.display = 'flex'; 
        } else { 
            skipBtn.style.display = 'none'; 
        }
    }
}
function updateButtons() {
    const resetBtn = document.getElementById('reset-btn');
    if (currentResetVotes.includes(myPlayerId)) resetBtn.classList.add('voted'); else resetBtn.classList.remove('voted');
    const skipBtn = document.getElementById('action-skip-btn');
    const skipIcon = document.getElementById('skip-icon');
    if (currentTurnId === myPlayerId) {
        skipBtn.className = 'icon-btn self-skip'; skipIcon.innerText = 'skip_next'; skipBtn.disabled = false;
    } else {
        const now = Date.now() / 1000; const diff = now - turnStartTime;
        if (diff > 60 && totalPlayers > 1) {
            skipBtn.disabled = false; skipIcon.innerText = 'gavel';
            if (currentSkipVotes.includes(myPlayerId)) skipBtn.className = 'icon-btn voted'; else skipBtn.className = 'icon-btn vote-active';
        } else {
            skipBtn.className = 'icon-btn vote-wait'; skipIcon.innerText = 'gavel'; skipBtn.disabled = true;
        }
    }
}
function updateVotePopup() {
    const popup = document.getElementById('vote-status-popup');
    const countDisplay = document.getElementById('vote-count-display');
    const vetoBtn = document.getElementById('veto-btn');
    const required = Math.max(1, totalPlayers - 1);
    if (currentSkipVotes.length > 0) {
        if (currentSkipVotes.length !== prevSkipVotesLen) {
            popup.classList.add('active');
            countDisplay.innerText = `${currentSkipVotes.length} / ${required}`;
            if (currentTurnId === myPlayerId) vetoBtn.style.display = 'block'; else vetoBtn.style.display = 'none';
            if (voteNotificationTimer) clearTimeout(voteNotificationTimer);
            voteNotificationTimer = setTimeout(() => { popup.classList.remove('active'); }, 1000);
        }
    } else {
        popup.classList.remove('active');
    }
    prevSkipVotesLen = currentSkipVotes.length;
}
window.voteReset = function() { sound.playButton(); ws.send(JSON.stringify({type: 'vote_reset'})); };
window.voteSkip = function() { sound.playButton(); ws.send(JSON.stringify({type: 'vote_skip'})); };
window.vetoSkip = function() { sound.playButton(); ws.send(JSON.stringify({type: 'veto_skip'})); };
window.handleExit = function() { showModal("EXIT", "退出しますか？", () => { if (ws) { ws.close(); ws = null; } location.reload(); }, true); };
function kickPlayer(targetId) { if(confirm("Kick this player?")) ws.send(JSON.stringify({type: 'kick_player', target_id: targetId})); }
function openRankingModal() { sound.playButton(); document.getElementById('ranking-modal').style.display = 'flex'; }
function closeRankingModal(e) { if(e === null || e.target.id === 'ranking-modal') { sound.playButton(); document.getElementById('ranking-modal').style.display = 'none'; } }
function updateBoard(newBoard) { for(let r=0; r<BOARD_SIZE; r++) for(let c=0; c<BOARD_SIZE; c++) board[r][c] = newBoard[r][c]; }
function updateTurnDisplay(ranking) { ranking.forEach(p => playerNames[p.id] = p.name); const indicator = document.getElementById('turn-indicator'); const canvasEl = document.getElementById('gameCanvas'); if (currentTurnId === myPlayerId) { indicator.innerText = "YOUR TURN"; indicator.classList.add('my-turn'); canvasEl.classList.remove('inactive-canvas'); } else { const name = playerNames[currentTurnId] || `PLAYER ${currentTurnId}`; indicator.innerText = `TURN: ${name}`; indicator.classList.remove('my-turn'); canvasEl.classList.add('inactive-canvas'); } }
function updateRanking(rankingData) { 
    const list = document.getElementById('score-list'); list.innerHTML = ""; 
    const fullList = document.getElementById('full-score-list'); fullList.innerHTML = "";
    rankingData.forEach(player => { 
        const isMe = (player.id === myPlayerId); const isTurn = (player.id === currentTurnId); 
        let text = player.name.toUpperCase(); if(player.id === hostId) text = "👑 " + text;
        const li = document.createElement('li'); 
        let className = ""; if (isMe) className += "highlight-me "; if (isTurn) className += "turn-active "; 
        li.className = className; li.innerHTML = `<span>${text}</span> <span>${player.score}</span>`; list.appendChild(li); 
        const fullLi = li.cloneNode(true); if (myPlayerId === hostId && player.id !== myPlayerId) { const kickBtn = document.createElement('button'); kickBtn.className = 'kick-btn'; kickBtn.innerText = 'KICK'; kickBtn.onclick = (e) => { e.stopPropagation(); kickPlayer(player.id); }; fullLi.appendChild(kickBtn); } fullList.appendChild(fullLi); 
    }); 
}

// ★復活: パーティクル関数
class Particle { constructor(x, y, color) { this.x = x; this.y = y; this.vx = (Math.random() - 0.5) * 10; this.vy = (Math.random() - 0.5) * 10; this.life = 1.0; this.color = color; this.size = Math.random() * 10 + 5; this.gravity = 0.5; } update() { this.x += this.vx; this.y += this.vy; this.vy += this.gravity; this.life -= 0.02; this.size *= 0.95; } draw(ctx) { ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, this.size, this.size); ctx.globalAlpha = 1.0; } }
function createExplosion(col, row) { const centerX = col * CELL_SIZE + CELL_SIZE / 2; const centerY = row * CELL_SIZE + CELL_SIZE / 2; for(let i=0; i<10; i++) { const colors = ['#3498db', '#2980b9', '#ecf0f1', '#00d2d3']; const color = colors[Math.floor(Math.random() * colors.length)]; particles.push(new Particle(centerX, centerY, color)); } }

function draw() {
    if(document.getElementById('game-container').style.display === 'none') return;
    const theme = THEMES[currentTheme];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = theme.boardBg; ctx.fillRect(0, 0, canvas.width, 400);
    ctx.fillStyle = theme.handBg; ctx.fillRect(0, 400, canvas.width, 200);

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const x = col * CELL_SIZE; const y = row * CELL_SIZE;
            ctx.strokeStyle = theme.gridLine; ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
            if (board[row][col] === 1) {
                ctx.fillStyle = theme.blockColor; ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                ctx.fillStyle = theme.blockGloss; ctx.fillRect(x + 5, y + 5, CELL_SIZE - 10, 12);
            }
        }
    }
    ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(400, 400); ctx.strokeStyle = theme.separator; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;

    if (draggingIdx !== -1 && currentTurnId === myPlayerId && !isClearing) {
        const shape = currentHand[draggingIdx];
        const placeCol = Math.round(dragX / CELL_SIZE); const placeRow = Math.round(dragY / CELL_SIZE);
        if (canFit(shape, placeRow, placeCol)) {
            const lines = checkPotentialClears(shape, placeRow, placeCol);
            if (lines.rows.length > 0 || lines.cols.length > 0) {
                ctx.fillStyle = theme.highlightColor;
                lines.rows.forEach(r => ctx.fillRect(0, r * CELL_SIZE, canvas.width, CELL_SIZE));
                lines.cols.forEach(c => ctx.fillRect(c * CELL_SIZE, 0, CELL_SIZE, 400));
            }
            ctx.fillStyle = theme.ghostColor;
            for(let r = 0; r < shape.length; r++) { for(let c = 0; c < shape[r].length; c++) { if(shape[r][c] === 1) { ctx.fillRect((placeCol + c) * CELL_SIZE, (placeRow + r) * CELL_SIZE, CELL_SIZE, CELL_SIZE); } } }
        }
    }
    drawHand(theme);
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.update(); p.draw(ctx); if (p.life <= 0) particles.splice(i, 1); }
    requestAnimationFrame(draw);
}

function drawHand(theme) {
    const slotWidth = 400 / 3;
    const slotCenterY = HAND_START_Y + (190 / 2);

    currentHand.forEach((shape, index) => {
        if (shape === null) return;
        const slotCenterX = (index * slotWidth) + (slotWidth / 2);
        const originalW = shape[0].length * 30;
        const originalH = shape.length * 30;
        const maxSlotSize = slotWidth * 0.8;
        let scale = 1.0;
        if (originalW > maxSlotSize || originalH > maxSlotSize) {
            scale = maxSlotSize / Math.max(originalW, originalH);
        }
        const drawW = originalW * scale;
        const drawH = originalH * scale;
        const blockSize = 30 * scale;

        if (index === draggingIdx) {
            drawShape(shape, dragX, dragY, CELL_SIZE, 'rgba(52, 152, 219, 0.7)', theme);
        } else {
            const color = (currentTurnId === myPlayerId && !isClearing) ? theme.blockColor : theme.inactiveHand;
            drawShape(shape, slotCenterX - drawW/2, slotCenterY - drawH/2, blockSize, color, theme);
        }
    });
}

function drawShape(shape, startX, startY, size, color, theme) {
    ctx.fillStyle = color;
    for(let r = 0; r < shape.length; r++) {
        for(let c = 0; c < shape[r].length; c++) {
            if(shape[r][c] === 1) {
                ctx.fillRect(startX + c * size, startY + r * size, size - 2, size - 2);
                if (theme && theme.blockGloss) {
                    ctx.fillStyle = theme.blockGloss;
                    ctx.fillRect(startX + c * size + 2, startY + r * size + 2, size - 6, 4);
                    ctx.fillStyle = color;
                }
            }
        }
    }
}

function getCanvasCoordinates(event) { const rect = canvas.getBoundingClientRect(); let clientX, clientY; if (event.touches && event.touches.length > 0) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; } else { clientX = event.clientX; clientY = event.clientY; } const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height; return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }; }

function handleStart(e) {
    if (currentTurnId !== myPlayerId || isClearing) return;
    if(e.type === 'touchstart') e.preventDefault();
    sound.playPick();
    const pos = getCanvasCoordinates(e);
    if (pos.y > 400) {
        const slotWidth = 400 / 3; const clickedSlotIndex = Math.floor(pos.x / slotWidth);
        if (clickedSlotIndex >= 0 && clickedSlotIndex < 3) {
            const shape = currentHand[clickedSlotIndex];
            if (shape !== null) { 
                draggingIdx = clickedSlotIndex;
                const blockW = shape[0].length * CELL_SIZE; const blockH = shape.length * CELL_SIZE;
                dragX = pos.x - (blockW / 2); dragY = pos.y - blockH - DRAG_OFFSET_Y; 
            }
        }
    }
}
function handleMove(e) { 
    if (draggingIdx !== -1) { 
        if(e.type === 'touchmove') e.preventDefault(); 
        const pos = getCanvasCoordinates(e); const shape = currentHand[draggingIdx]; 
        const blockW = shape[0].length * CELL_SIZE; const blockH = shape.length * CELL_SIZE; 
        dragX = pos.x - (blockW / 2); dragY = pos.y - blockH - DRAG_OFFSET_Y; 
    } 
}
function handleEnd(e) {
    if (draggingIdx !== -1) {
        if(e.type === 'touchend') e.preventDefault();
        const shape = currentHand[draggingIdx];
        const placeCol = Math.round(dragX / CELL_SIZE); const placeRow = Math.round(dragY / CELL_SIZE);
        let canPlace = true;
        for(let r=0; r<shape.length; r++) { for(let c=0; c<shape[r].length; c++) { if(shape[r][c] === 1) { if (placeRow + r < 0 || placeRow + r >= BOARD_SIZE || placeCol + c < 0 || placeCol + c >= BOARD_SIZE) canPlace = false; else if (board[placeRow + r][placeCol + c] === 1) canPlace = false; } } }

        if (canPlace) {
            sound.playPlace();
            const updates = [];
            for(let r=0; r<shape.length; r++) { for(let c=0; c<shape[r].length; c++) { if(shape[r][c] === 1) { const tR = placeRow + r; const tC = placeCol + c; board[tR][tC] = 1; updates.push({row: tR, col: tC, value: 1}); } } }
            ws.send(JSON.stringify({type: 'batch_update', updates: updates}));
            currentHand[draggingIdx] = null;
            if (currentHand.every(s => s === null)) { refillHand(); ws.send(JSON.stringify({type: 'end_turn'})); }
            else { if (!checkCanPlace()) { triggerAutoPass(); } }
        } else {
            sound.playReturn();
        }
        draggingIdx = -1;
    }
}
canvas.addEventListener('mousedown', handleStart); canvas.addEventListener('mousemove', handleMove); canvas.addEventListener('mouseup', handleEnd); canvas.addEventListener('touchstart', handleStart, {passive: false}); canvas.addEventListener('touchmove', handleMove, {passive: false}); canvas.addEventListener('touchend', handleEnd, {passive: false});

// ★初期化時にも手札を作る
if(currentHand.length === 0) refillHand();