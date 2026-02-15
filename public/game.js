const playerId = window.HoopState ? window.HoopState.getClientId() : '';
const socket = io({ auth: { playerId } });

const statusLabel = document.getElementById('status-label');
const liveBadge = document.getElementById('live-badge');
const currentPlayerEl = document.getElementById('current-player');
const timerEl = document.getElementById('timer');
const turnLabel = document.getElementById('turn-label');
const guessInput = document.getElementById('guess-input');
const submitBtn = document.getElementById('submit-btn');
const guessRowEl = document.getElementById('guess-row');
const messageEl = document.getElementById('message');
const findAnotherBtn = document.getElementById('find-another-btn');
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

function renderScoreboard(players, activePlayerId) {
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
    applyActiveStyles(playerLeftEl, false);
    applyActiveStyles(playerRightEl, false);
    return;
  }

  const left = players[0];
  const right = players[1] || { username: 'Waiting...', strikes: 0, playerId: null };
  const leftYou = left.playerId === playerId ? ' (You)' : '';
  const rightYou = right.playerId === playerId ? ' (You)' : '';

  playerLeftNameEl.textContent = `${left.username}${leftYou}`;
  playerRightNameEl.textContent = `${right.username}${rightYou}`;
  playerLeftStrikesEl.textContent = String(left.strikes);
  playerRightStrikesEl.textContent = String(right.strikes);

  const leftActive = left.playerId === activePlayerId;
  const rightActive = right.playerId === activePlayerId;
  playerLeftEl.classList.toggle('active', leftActive);
  playerRightEl.classList.toggle('active', rightActive);
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
  timerInterval = setInterval(() => {
    if (!currentState || currentState.status !== 'active') {
      timerEl.textContent = '0';
      return;
    }

    const ms = Math.max(0, currentState.turnDeadline - Date.now());
    timerEl.textContent = String(Math.ceil(ms / 1000));
  }, 250);
}

function renderGameState(state) {
  currentState = {
    ...state,
    turnDeadline: Date.now() + state.timeRemainingMs
  };

  const isMyTurn = state.activePlayerId === playerId;

  statusLabel.textContent = 'In Match';
  const opponent = Array.isArray(state.players)
    ? state.players.find((p) => p.playerId !== playerId)
    : null;
  const opponentConnected = Boolean(opponent && opponent.connected);
  liveBadge.textContent = opponentConnected ? 'Connected' : 'Disconnected';
  liveBadge.classList.toggle('live', opponentConnected);
  if (findAnotherBtn) {
    findAnotherBtn.classList.add('is-hidden');
  }

  currentPlayerEl.textContent = state.currentPlayer;
  turnLabel.textContent = isMyTurn ? 'Your turn. Name a teammate.' : `${state.activeUsername}'s turn.`;

  guessInput.disabled = !isMyTurn || state.status !== 'active';
  submitBtn.disabled = !isMyTurn || state.status !== 'active';
  if (guessRowEl) {
    guessRowEl.hidden = !isMyTurn || state.status !== 'active';
  }

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

if (leaveGameBtn && leaveGameOverlay && leaveGameConfirmBtn && leaveGameCancelBtn) {
  leaveGameBtn.addEventListener('click', () => {
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

if (findAnotherBtn) {
  findAnotherBtn.addEventListener('click', () => {
    const displayName = getLocalProfileName();
    if (displayName) {
      socket.emit('user:set-name', displayName);
    }
    socket.emit('matchmaking:join');
    findAnotherBtn.classList.add('is-hidden');
    statusLabel.textContent = 'Searching for opponent...';
    setMessage('Finding another game...');
    turnLabel.textContent = 'Waiting for matchup...';
  });
}

socket.on('connect', () => {
  hasRecordedCurrentGame = false;
  const fallbackName = getLocalProfileName();
  if (fallbackName) {
    socket.emit('user:set-name', fallbackName);
  }
  liveBadge.textContent = 'Connected';
  liveBadge.classList.add('live');
});

socket.on('matchmaking:queued', () => {
  hasRecordedCurrentGame = false;
  statusLabel.textContent = 'Searching for opponent...';
  setMessage('Queued for matchmaking. Waiting for an opponent...');
  if (guessRowEl) {
    guessRowEl.hidden = true;
  }
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
  stopTimer();
  const youWon = playerId === winnerPlayerId;
  const endedBy = reason === '3 strikes' ? 'opponent reached 3 strikes' : reason;

  if (gameState) {
    if (Array.isArray(gameState.players)) {
      renderScoreboard(gameState.players, gameState.activePlayerId);
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
  turnLabel.textContent = 'Find another game to play again.';
  guessInput.disabled = true;
  submitBtn.disabled = true;
  if (guessRowEl) {
    guessRowEl.hidden = true;
  }
  if (findAnotherBtn) {
    findAnotherBtn.classList.remove('is-hidden');
  }

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
  liveBadge.textContent = 'Disconnected';
  liveBadge.classList.remove('live');
  statusLabel.textContent = 'Disconnected';
  setMessage('Connection lost.', 'error');
});
