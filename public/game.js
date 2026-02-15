const playerId = window.HoopState ? window.HoopState.getClientId() : '';
const socket = io({ auth: { playerId } });

const statusLabel = document.getElementById('status-label');
const staleLiveBadge = document.getElementById('live-badge');
if (staleLiveBadge) {
  staleLiveBadge.remove();
}
const currentPlayerEl = document.getElementById('current-player');
const currentLabelEl = document.getElementById('current-label');
const timerEl = document.getElementById('timer');
const guessInput = document.getElementById('guess-input');
const submitBtn = document.getElementById('submit-btn');
const guessRowEl = document.getElementById('guess-row');
const messageEl = document.getElementById('message');
const historyListEl = document.getElementById('history-list');
const leaveGameBtn = document.getElementById('leave-game-btn');
const leaveGameOverlay = document.getElementById('leave-game-overlay');
const leaveGameConfirmBtn = document.getElementById('leave-game-confirm-btn');
const leaveGameCancelBtn = document.getElementById('leave-game-cancel-btn');
const playerLeftEl = document.getElementById('player-left');
const playerRightEl = document.getElementById('player-right');
const playerLeftNameEl = document.getElementById('player-left-name');
const playerRightNameEl = document.getElementById('player-right-name');
const playerLeftStrikesEl = document.getElementById('player-left-strikes');
const playerRightStrikesEl = document.getElementById('player-right-strikes');

let currentState = null;
let timerInterval = null;
let hasRecordedCurrentGame = false;
let finalWinnerPlayerId = null;
let finalLoserPlayerId = null;
let gameFinished = false;

function getLocalProfileName() {
  if (!window.HoopState) return '';
  const profile = window.HoopState.getProfile();
  return profile && profile.username ? profile.username : '';
}

function setMessage(text, kind = '') {
  messageEl.className = kind ? `message ${kind}` : 'message';
  messageEl.textContent = text || '';
}

function renderHistory(chainPlayers, historyEntries, players) {
  historyListEl.innerHTML = '';

  if (Array.isArray(historyEntries) && historyEntries.length) {
    const recent = historyEntries.slice(-24).reverse();
    recent.forEach((entry) => {
      const li = document.createElement('li');

      if (entry.type === 'start') {
        li.className = 'history-item start-player';
        li.textContent = `Start: ${entry.player || 'Unknown'}`;
      } else if (entry.type === 'guess') {
        li.className = 'history-item';
        li.textContent = entry.player || 'Unknown';
      } else {
        return;
      }

      historyListEl.appendChild(li);
    });
    return;
  }

  if (!chainPlayers || !chainPlayers.length) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.textContent = 'Chain will appear here once the game starts.';
    historyListEl.appendChild(li);
    return;
  }

  const slice = chainPlayers.length > 18
    ? [chainPlayers[0], ...chainPlayers.slice(-17)]
    : chainPlayers;

  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const li = document.createElement('li');
    if (i === 0) {
      li.className = 'history-item start-player';
      li.textContent = `Start: ${slice[i]}`;
    } else {
      li.className = 'history-item';
      li.textContent = slice[i];
    }
    historyListEl.appendChild(li);
  }
}

function renderScoreboard(players, activePlayerId, outcome = null) {
  const applyActiveStyles = (el, isActive) => {
    if (!el) return;
    if (isActive) {
      el.style.borderColor = '#3a7bff';
      el.style.background = 'rgba(58, 123, 255, 0.14)';
      el.style.boxShadow = 'inset 0 0 0 1px rgba(58, 123, 255, 0.5)';
    } else {
      el.style.borderColor = '';
      el.style.background = '';
      el.style.boxShadow = '';
    }
  };

  if (!players || !players.length) {
    playerLeftNameEl.textContent = 'Player 1';
    playerRightNameEl.textContent = 'Player 2';
    playerLeftStrikesEl.textContent = '0';
    playerRightStrikesEl.textContent = '0';
    playerLeftEl.classList.remove('active');
    playerRightEl.classList.remove('active');
    playerLeftEl.classList.remove('winner', 'loser');
    playerRightEl.classList.remove('winner', 'loser');
    applyActiveStyles(playerLeftEl, false);
    applyActiveStyles(playerRightEl, false);
    return;
  }

  const left = players[0];
  const right = players[1] || { username: 'Waiting...', strikes: 0, playerId: null };

  playerLeftNameEl.textContent = `${left.username}`;
  playerRightNameEl.textContent = `${right.username}`;
  playerLeftStrikesEl.textContent = String(left.strikes);
  playerRightStrikesEl.textContent = String(right.strikes);

  const leftActive = !outcome && left.playerId === activePlayerId;
  const rightActive = !outcome && right.playerId === activePlayerId;
  const winnerId = outcome && outcome.winnerPlayerId ? outcome.winnerPlayerId : null;
  const loserId = outcome && outcome.loserPlayerId ? outcome.loserPlayerId : null;
  playerLeftEl.classList.toggle('active', leftActive);
  playerRightEl.classList.toggle('active', rightActive);
  playerLeftEl.classList.toggle('winner', left.playerId === winnerId);
  playerRightEl.classList.toggle('winner', right.playerId === winnerId);
  playerLeftEl.classList.toggle('loser', left.playerId === loserId);
  playerRightEl.classList.toggle('loser', right.playerId === loserId);
  applyActiveStyles(playerLeftEl, leftActive);
  applyActiveStyles(playerRightEl, rightActive);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  stopTimer();
  const updateTimer = () => {
    if (!currentState || currentState.status !== 'active') {
      timerEl.textContent = '0';
      return;
    }

    const ms = Math.max(0, currentState.turnDeadline - Date.now());
    if (ms <= 0) {
      timerEl.textContent = 'Game Over';
      return;
    }
    timerEl.textContent = String(Math.max(0, Math.floor(ms / 1000)));
  };

  updateTimer();
  timerInterval = setInterval(() => {
    updateTimer();
  }, 250);
}

function renderGameState(state) {
  currentState = {
    ...state,
    turnDeadline: Date.now() + state.timeRemainingMs
  };
  gameFinished = false;

  const isMyTurn = state.activePlayerId === playerId;

  statusLabel.textContent = 'In Match';
  const opponent = Array.isArray(state.players)
    ? state.players.find((p) => p.playerId !== playerId)
    : null;
  const opponentConnected = Boolean(opponent && opponent.connected);
  if (!opponentConnected) {
    statusLabel.textContent = 'Opponent disconnected';
  }
  if (leaveGameBtn) leaveGameBtn.textContent = 'Leave Game';

  if (currentLabelEl) currentLabelEl.textContent = 'Current:';
  currentPlayerEl.textContent = state.currentPlayer;

  guessInput.disabled = !isMyTurn || state.status !== 'active';
  submitBtn.disabled = !isMyTurn || state.status !== 'active';
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.toggle('turn-active', isMyTurn && state.status === 'active');
    guessRowEl.classList.toggle('turn-inactive', !isMyTurn || state.status !== 'active');
  }
  guessInput.placeholder = isMyTurn && state.status === 'active' ? 'Name a teammate...' : "Opponent's turn";

  renderScoreboard(state.players, state.activePlayerId);
  renderHistory(state.usedPlayers, state.history, state.players);
  if (state.message) {
    const kind = state.message.includes('got a strike') ? 'error' : 'success';
    setMessage(state.message, kind);
  }

  startTimer();
}

submitBtn.addEventListener('click', () => {
  const guess = guessInput.value.trim();
  if (!guess) return;
  socket.emit('game:guess', guess);
  guessInput.value = '';
});

guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitBtn.click();
  }
});

function closeLeaveGameOverlay() {
  if (leaveGameOverlay) {
    leaveGameOverlay.hidden = true;
  }
}

function queueForAnotherGame() {
  gameFinished = false;
  finalWinnerPlayerId = null;
  finalLoserPlayerId = null;
  const displayName = getLocalProfileName();
  if (displayName) {
    socket.emit('user:set-name', displayName);
  }
  socket.emit('matchmaking:join');
  statusLabel.textContent = 'Searching for opponent...';
  setMessage('Finding another game...');
  if (currentLabelEl) currentLabelEl.textContent = 'Current:';
  currentPlayerEl.textContent = '-';
  if (leaveGameBtn) leaveGameBtn.textContent = 'Leave Game';
}

if (leaveGameBtn && leaveGameOverlay && leaveGameConfirmBtn && leaveGameCancelBtn) {
  leaveGameBtn.addEventListener('click', () => {
    if (gameFinished) {
      queueForAnotherGame();
      return;
    }
    leaveGameOverlay.hidden = false;
  });

  leaveGameCancelBtn.addEventListener('click', () => {
    closeLeaveGameOverlay();
  });

  leaveGameConfirmBtn.addEventListener('click', () => {
    socket.emit('matchmaking:leave');
    closeLeaveGameOverlay();
    window.location.href = '/';
  });
}

socket.on('connect', () => {
  hasRecordedCurrentGame = false;
  const fallbackName = getLocalProfileName();
  if (fallbackName) {
    socket.emit('user:set-name', fallbackName);
  }
});

socket.on('matchmaking:queued', () => {
  gameFinished = false;
  hasRecordedCurrentGame = false;
  finalWinnerPlayerId = null;
  finalLoserPlayerId = null;
  statusLabel.textContent = 'Searching for opponent...';
  setMessage('Queued for matchmaking. Waiting for an opponent...');
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  guessInput.placeholder = "Opponent's turn";
  if (currentLabelEl) currentLabelEl.textContent = 'Current:';
  currentPlayerEl.textContent = '-';
  if (leaveGameBtn) leaveGameBtn.textContent = 'Leave Game';
});

socket.on('matchmaking:left', () => {
  statusLabel.textContent = 'Waiting for match...';
  setMessage('Left queue.');
});

socket.on('matchmaking:error', (msg) => {
  setMessage(msg, 'error');
});

socket.on('game:error', (msg) => {
  setMessage(msg, 'error');
});

socket.on('game:state', (state) => {
  renderGameState(state);
});

socket.on('game:ended', ({ winnerPlayerId, winnerUsername, loserPlayerId, reason, gameState }) => {
  gameFinished = true;
  stopTimer();
  timerEl.textContent = 'Game Over';
  if (currentLabelEl) currentLabelEl.textContent = '';
  currentPlayerEl.textContent = reason || 'finished';
  if (leaveGameBtn) leaveGameBtn.textContent = 'Find Another Game';
  finalWinnerPlayerId = winnerPlayerId;
  finalLoserPlayerId = loserPlayerId;
  const youWon = playerId === winnerPlayerId;
  const endedBy = reason === '3 strikes' ? 'opponent reached 3 strikes' : reason;

  if (gameState) {
    if (Array.isArray(gameState.players)) {
      renderScoreboard(gameState.players, gameState.activePlayerId, {
        winnerPlayerId,
        loserPlayerId
      });
    }
    renderHistory(gameState.usedPlayers, gameState.history, gameState.players);
  }

  if (youWon) {
    setMessage(`You won. ${winnerUsername} defeats opponent (${endedBy}).`, 'success');
  } else if (playerId === loserPlayerId) {
    setMessage(`You lost. Reason: ${endedBy}.`, 'error');
  } else {
    setMessage(`Game ended (${endedBy}).`, 'success');
  }

  statusLabel.textContent = 'Game finished';
  guessInput.disabled = true;
  submitBtn.disabled = true;
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  guessInput.placeholder = "Opponent's turn";

  if (window.HoopState && !hasRecordedCurrentGame && gameState && Array.isArray(gameState.players)) {
    const myRow = gameState.players.find((p) => p.playerId === playerId);
    const oppRow = gameState.players.find((p) => p.playerId !== playerId);
    const chainLength = Array.isArray(gameState.history)
      ? gameState.history.filter((item) => item.type === 'guess').length
      : 0;

    window.HoopState.recordGame({
      won: youWon,
      reason,
      opponent: oppRow ? oppRow.username : winnerUsername || 'Opponent',
      chainLength,
      myStrikes: myRow ? myRow.strikes : 0,
      oppStrikes: oppRow ? oppRow.strikes : 0
    });
    hasRecordedCurrentGame = true;
  }
});

socket.on('disconnect', () => {
  stopTimer();
  statusLabel.textContent = 'Disconnected';
  setMessage('Connection lost.', 'error');
});
