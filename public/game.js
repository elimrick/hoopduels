const GAME_END_REDIRECT_KEY = 'hoopduels_game_end_redirect_v1';
if (sessionStorage.getItem(GAME_END_REDIRECT_KEY) === '1') {
  sessionStorage.removeItem(GAME_END_REDIRECT_KEY);
  const nav = performance.getEntriesByType('navigation');
  const type = nav && nav[0] ? nav[0].type : '';
  if (type === 'reload') {
    window.location.replace('/');
  }
}

const playerId = window.HoopState ? window.HoopState.getClientId() : '';
const token = window.HoopState && typeof window.HoopState.getToken === 'function'
  ? (window.HoopState.getToken() || '')
  : '';
const socket = io({ auth: { playerId, token } });

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
const matchmakingOverlay = document.getElementById('matchmaking-overlay');
const matchmakingStatusEl = document.getElementById('matchmaking-status');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');
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
let isRequeueing = false;
let pregamePlayerElos = {};
let currentGameId = null;
let guessAutocomplete = null;

function getLocalProfileName() {
  if (!window.HoopState) return '';
  const profile = window.HoopState.getProfile();
  return profile && profile.username ? profile.username : '';
}

function setMessage(text, kind = '') {
  messageEl.className = kind ? `message ${kind}` : 'message';
  messageEl.textContent = text || '';
}

function isGuestLikeName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized === 'guest' || normalized.startsWith('player-');
}

function formatEloChange(delta) {
  const num = Number(delta);
  if (!Number.isFinite(num) || num === 0) return '(0)';
  return num > 0 ? `(+${Math.round(num)})` : `(${Math.round(num)})`;
}

function getAccountEloByName(username) {
  if (!window.HoopState || !username || isGuestLikeName(username)) return null;
  const me = window.HoopState.getProfile ? window.HoopState.getProfile() : null;
  if (me && me.signedIn && me.username && String(me.username).trim().toLowerCase() === String(username).trim().toLowerCase()) {
    const myElo = Number(me.elo);
    return Number.isFinite(myElo) ? Math.round(myElo) : null;
  }
  const key = String(username).trim().toLowerCase();
  const row = window.HoopState.getLeaderboardRows().find((item) => {
    return String(item.username || '').trim().toLowerCase() === key;
  });
  if (!row) return null;
  const elo = Number(row.elo);
  return Number.isFinite(elo) ? Math.round(elo) : null;
}

function calculateRankedEloOutcome(myElo, oppElo, won) {
  if (!Number.isFinite(myElo) || !Number.isFinite(oppElo)) return { after: myElo, delta: 0 };
  const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  const actual = won ? 1 : 0;
  const after = Math.round(myElo + 32 * (actual - expected));
  return { after, delta: after - myElo };
}

function extractGuessedName(message) {
  if (typeof message !== 'string') return '';
  const match = message.match(/guessed "([^"]+)"/i);
  return match && match[1] ? match[1].trim() : '';
}

function parseStrikeMessage(message) {
  if (typeof message !== 'string') return null;
  const match = message.match(/^(.+?) guessed "([^"]+)" and got(?: a)? strike(?: 3\/3)? \((.+)\)\.$/i);
  if (!match) return null;
  return {
    guesser: match[1].trim(),
    guess: match[2].trim(),
    reason: match[3].trim()
  };
}

function capitalizeFirstChar(value) {
  if (typeof value !== 'string' || !value.length) return value || '';
  return value[0].toUpperCase() + value.slice(1);
}

function getEndDisplay(reason, winnerPlayerId, loserPlayerId) {
  const lost = playerId === loserPlayerId;
  const won = playerId === winnerPlayerId;
  const title = lost ? 'You Lost' : (won ? 'You Won' : 'Game Over');
  const normalized = typeof reason === 'string' ? reason.trim().toLowerCase() : '';

  if (normalized === 'left game') {
    return { title, detail: lost ? 'Left Game' : 'Opponent Left Game' };
  }
  if (normalized === 'time expired') {
    return { title, detail: lost ? 'Poor Clock Management' : "Opponent's Time Expired" };
  }
  if (normalized === '3 strikes') {
    return { title, detail: lost ? 'You Fouled Out' : 'Opponent Fouled Out' };
  }
  if (normalized === 'disconnect') {
    return { title, detail: lost ? 'Disconnected' : 'Opponent Disconnected' };
  }
  if (!normalized) {
    return { title, detail: 'Finished' };
  }
  const detail = normalized.split(' ').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  return { title, detail };
}

function renderHistory(chainPlayers, historyEntries, players) {
  historyListEl.innerHTML = '';

  if (Array.isArray(historyEntries) && historyEntries.length) {
    const recent = historyEntries.slice(-24).reverse();
    recent.forEach((entry) => {
      const li = document.createElement('li');

      if (entry.type === 'start') {
        li.className = 'history-item start-player';
        const startLabel = document.createElement('strong');
        startLabel.textContent = 'Start:';
        li.appendChild(startLabel);
        li.append(` ${entry.player || 'Unknown'}`);
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
      const startLabel = document.createElement('strong');
      startLabel.textContent = 'Start:';
      li.appendChild(startLabel);
      li.append(` ${slice[i]}`);
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
    const leftMetaEl = document.getElementById('player-left-elo');
    const rightMetaEl = document.getElementById('player-right-elo');
    if (leftMetaEl) leftMetaEl.textContent = '';
    if (rightMetaEl) rightMetaEl.textContent = '';
    return;
  }

  const left = players[0];
  const right = players[1] || { username: 'Waiting...', strikes: 0, playerId: null };

  playerLeftNameEl.textContent = `${left.username}`;
  playerRightNameEl.textContent = `${right.username}`;
  playerLeftStrikesEl.textContent = String(left.strikes);
  playerRightStrikesEl.textContent = String(right.strikes);

  const leftMetaEl = document.getElementById('player-left-elo');
  const rightMetaEl = document.getElementById('player-right-elo');

  const leftInitialElo = pregamePlayerElos[left.playerId]
    ?? (Number.isFinite(Number(left.elo)) ? Number(left.elo) : null)
    ?? getAccountEloByName(left.username);
  const rightInitialElo = pregamePlayerElos[right.playerId]
    ?? (Number.isFinite(Number(right.elo)) ? Number(right.elo) : null)
    ?? getAccountEloByName(right.username);
  if (left.playerId && Number.isFinite(leftInitialElo)) {
    pregamePlayerElos[left.playerId] = leftInitialElo;
  }
  if (right.playerId && Number.isFinite(rightInitialElo)) {
    pregamePlayerElos[right.playerId] = rightInitialElo;
  }

  const bothRanked = Number.isFinite(leftInitialElo) && Number.isFinite(rightInitialElo);
  let leftAfter = leftInitialElo;
  let rightAfter = rightInitialElo;
  let leftDelta = 0;
  let rightDelta = 0;
  if (bothRanked && outcome && outcome.winnerPlayerId && outcome.loserPlayerId) {
    const leftWon = left.playerId === outcome.winnerPlayerId;
    const rightWon = right.playerId === outcome.winnerPlayerId;
    const leftCalc = calculateRankedEloOutcome(leftInitialElo, rightInitialElo, leftWon);
    const rightCalc = calculateRankedEloOutcome(rightInitialElo, leftInitialElo, rightWon);
    leftAfter = leftCalc.after;
    rightAfter = rightCalc.after;
    leftDelta = leftCalc.delta;
    rightDelta = rightCalc.delta;
  }

  if (leftMetaEl) {
    if (Number.isFinite(leftInitialElo)) {
      leftMetaEl.textContent = (outcome && bothRanked)
        ? `ELO: ${Math.round(leftAfter)} ${formatEloChange(leftDelta)}`
        : `ELO: ${Math.round(leftInitialElo)}`;
    } else if (isGuestLikeName(left.username)) {
      leftMetaEl.textContent = 'ELO: -';
    } else {
      leftMetaEl.textContent = '';
    }
  }
  if (rightMetaEl) {
    if (Number.isFinite(rightInitialElo)) {
      rightMetaEl.textContent = (outcome && bothRanked)
        ? `ELO: ${Math.round(rightAfter)} ${formatEloChange(rightDelta)}`
        : `ELO: ${Math.round(rightInitialElo)}`;
    } else if (isGuestLikeName(right.username)) {
      rightMetaEl.textContent = 'ELO: -';
    } else {
      rightMetaEl.textContent = '';
    }
  }

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
  if (state && state.gameId && state.gameId !== currentGameId) {
    currentGameId = state.gameId;
    hasRecordedCurrentGame = false;
    finalWinnerPlayerId = null;
    finalLoserPlayerId = null;
  }
  currentState = {
    ...state,
    turnDeadline: Date.now() + state.timeRemainingMs
  };
  gameFinished = false;
  isRequeueing = false;
  pregamePlayerElos = {};
  sessionStorage.removeItem(GAME_END_REDIRECT_KEY);

  const isMyTurn = state.activePlayerId === playerId;

  if (leaveGameBtn) leaveGameBtn.textContent = 'Leave Game';

  if (currentLabelEl) currentLabelEl.textContent = '';
  if (currentLabelEl) currentLabelEl.style.display = 'none';
  currentPlayerEl.textContent = state.currentPlayer;

  guessInput.disabled = !isMyTurn || state.status !== 'active';
  submitBtn.disabled = !isMyTurn || state.status !== 'active';
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.toggle('turn-active', isMyTurn && state.status === 'active');
    guessRowEl.classList.toggle('turn-inactive', !isMyTurn || state.status !== 'active');
  }
  guessInput.placeholder = isMyTurn && state.status === 'active' ? 'Name a teammate...' : "Opponent's turn";
  if (isMyTurn && state.status === 'active') {
    setTimeout(() => {
      guessInput.focus();
    }, 0);
  }

  renderScoreboard(state.players, state.activePlayerId);
  renderHistory(state.usedPlayers, state.history, state.players);
  const strikeInfo = parseStrikeMessage(state.message);
  if (strikeInfo) {
    const me = state.players.find((p) => p.playerId === playerId);
    const myName = me ? me.username : '';
    if (myName && strikeInfo.guesser === myName) {
      setMessage(`Incorrect guess: ${capitalizeFirstChar(strikeInfo.reason)}`, 'error');
    } else {
      const guessedName = strikeInfo.guess || extractGuessedName(state.message) || 'blank guess';
      setMessage(`Opponent guessed "${guessedName}"`, 'error');
    }
  } else {
    setMessage('');
  }

  if (guessAutocomplete && typeof guessAutocomplete.refresh === 'function') {
    guessAutocomplete.refresh();
  }

  startTimer();
}

async function wireGuessAutocomplete() {
  if (!window.HoopAutocomplete || !guessInput) return;
  guessAutocomplete = await window.HoopAutocomplete.attach(guessInput, {
    getExcludedNames: () => {
      if (!currentState || !Array.isArray(currentState.usedPlayers)) return [];
      return currentState.usedPlayers;
    }
  });
}

submitBtn.addEventListener('click', () => {
  const guess = guessInput.value.trim();
  if (!guess) return;
  socket.emit('game:guess', guess);
  guessInput.value = '';
  if (window.innerWidth <= 1100) {
    guessInput.blur();
    if (typeof window.HoopSetViewportHeight === 'function') {
      window.HoopSetViewportHeight();
      setTimeout(() => {
        window.HoopSetViewportHeight();
      }, 120);
      setTimeout(() => {
        window.HoopSetViewportHeight();
      }, 260);
    }
  }
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

function closeMatchmakingOverlay() {
  if (matchmakingOverlay) {
    matchmakingOverlay.hidden = true;
  }
}

function queueForAnotherGame() {
  isRequeueing = true;
  const displayName = getLocalProfileName();
  if (displayName) {
    socket.emit('user:set-name', displayName);
  }
  if (matchmakingOverlay) matchmakingOverlay.hidden = false;
  if (matchmakingStatusEl) matchmakingStatusEl.textContent = 'Connecting to matchmaking...';
  socket.emit('matchmaking:join');
  setMessage('');
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
    // Record a local loss immediately so it shows in history even if we navigate away fast.
    try {
      if (window.HoopState && currentState && currentState.status === 'active') {
        const players = Array.isArray(currentState.players) ? currentState.players : [];
        const myRow = players.find((p) => p.playerId === playerId);
        const oppRow = players.find((p) => p.playerId !== playerId);
        const chainLength = Array.isArray(currentState.history)
          ? currentState.history.filter((item) => item.type === 'guess').length
          : 0;
        window.HoopState.recordGame({
          won: false,
          reason: 'left game',
          opponent: oppRow ? oppRow.username : 'Opponent',
          chainLength,
          myStrikes: myRow ? myRow.strikes : 0,
          oppStrikes: oppRow ? oppRow.strikes : 0
        });
      }
    } catch (_) {
    }
    socket.emit('matchmaking:leave');
    closeLeaveGameOverlay();
    window.location.href = '/';
  });
}

if (cancelMatchmakingBtn) {
  cancelMatchmakingBtn.addEventListener('click', () => {
    socket.emit('matchmaking:leave');
    isRequeueing = false;
    closeMatchmakingOverlay();
    if (leaveGameBtn && gameFinished) leaveGameBtn.textContent = 'Find Another Game';
  });
}

socket.on('connect', () => {
  hasRecordedCurrentGame = false;
  if (window.HoopState && typeof window.HoopState.refreshLeaderboard === 'function') {
    window.HoopState.refreshLeaderboard().catch(() => {});
  }
  const fallbackName = getLocalProfileName();
  if (fallbackName) {
    socket.emit('user:set-name', fallbackName);
  }
});

socket.on('matchmaking:queued', () => {
  if (!gameFinished) {
    hasRecordedCurrentGame = false;
    finalWinnerPlayerId = null;
    finalLoserPlayerId = null;
  }
  setMessage('');
  if (guessRowEl && !gameFinished) {
    guessRowEl.hidden = true;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  if (!gameFinished) {
    guessInput.placeholder = "Opponent's turn";
    if (currentLabelEl) currentLabelEl.textContent = '';
    if (currentLabelEl) currentLabelEl.style.display = 'none';
    currentPlayerEl.textContent = '-';
  }
  if (matchmakingStatusEl) matchmakingStatusEl.textContent = 'Searching for opponent...';
});

socket.on('matchmaking:left', () => {
  isRequeueing = false;
  closeMatchmakingOverlay();
  setMessage('');
});

socket.on('matchmaking:error', (msg) => {
  isRequeueing = false;
  if (matchmakingStatusEl) matchmakingStatusEl.textContent = msg || 'Matchmaking error.';
  setMessage(msg, 'error');
});

socket.on('game:error', (msg) => {
  setMessage(msg, 'error');
});

socket.on('game:state', (state) => {
  if (gameFinished && !isRequeueing) return;
  closeMatchmakingOverlay();
  renderGameState(state);
});

socket.on('game:ended', ({ winnerPlayerId, winnerUsername, loserPlayerId, reason, eloUpdate, gameState }) => {
  gameFinished = true;
  stopTimer();
  closeMatchmakingOverlay();
  const endDisplay = getEndDisplay(reason, winnerPlayerId, loserPlayerId);
  timerEl.textContent = endDisplay.title;
  if (currentLabelEl) currentLabelEl.textContent = '';
  if (currentLabelEl) currentLabelEl.style.display = 'none';
  currentPlayerEl.textContent = endDisplay.detail;
  if (leaveGameBtn) leaveGameBtn.textContent = 'Find Another Game';
  finalWinnerPlayerId = winnerPlayerId;
  finalLoserPlayerId = loserPlayerId;
  isRequeueing = false;
  sessionStorage.setItem(GAME_END_REDIRECT_KEY, '1');
  const youWon = playerId === winnerPlayerId;

  if (gameState) {
    if (Array.isArray(gameState.players)) {
      renderScoreboard(gameState.players, gameState.activePlayerId, {
        winnerPlayerId,
        loserPlayerId
      });
    }
    renderHistory(gameState.usedPlayers, gameState.history, gameState.players);
  }

  const finalStrikeInfo = gameState ? parseStrikeMessage(gameState.message) : null;
  if (finalStrikeInfo) {
    const me = gameState && Array.isArray(gameState.players)
      ? gameState.players.find((p) => p.playerId === playerId)
      : null;
    const myName = me ? me.username : '';
    if (myName && finalStrikeInfo.guesser === myName) {
      setMessage(`Incorrect guess: ${capitalizeFirstChar(finalStrikeInfo.reason)}`, 'error');
    } else {
      const guessedName = finalStrikeInfo.guess || extractGuessedName(gameState.message) || 'blank guess';
      setMessage(`Opponent guessed "${guessedName}"`, 'error');
    }
  } else {
    setMessage('');
  }

  guessInput.disabled = true;
  submitBtn.disabled = true;
  if (guessRowEl) {
    guessRowEl.hidden = true;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  guessInput.value = '';
  guessInput.placeholder = '';

  if (window.HoopState && !hasRecordedCurrentGame && gameState && Array.isArray(gameState.players)) {
    const myRow = gameState.players.find((p) => p.playerId === playerId);
    const oppRow = gameState.players.find((p) => p.playerId !== playerId);
    const chainLength = Array.isArray(gameState.history)
      ? gameState.history.filter((item) => item.type === 'guess').length
      : 0;

    const myElo = eloUpdate && eloUpdate[playerId] ? eloUpdate[playerId] : null;
    const oppElo = oppRow && eloUpdate && eloUpdate[oppRow.playerId] ? eloUpdate[oppRow.playerId] : null;
    const ranked = Boolean(eloUpdate && eloUpdate.ranked && myElo && oppElo);

    window.HoopState.recordGame({
      won: youWon,
      reason,
      opponent: oppRow ? oppRow.username : winnerUsername || 'Opponent',
      opponentElo: oppElo && Number.isFinite(Number(oppElo.before)) ? Number(oppElo.before) : null,
      chainLength,
      myStrikes: myRow ? myRow.strikes : 0,
      oppStrikes: oppRow ? oppRow.strikes : 0,
      ranked,
      eloBefore: myElo && Number.isFinite(Number(myElo.before)) ? Number(myElo.before) : null,
      eloAfter: myElo && Number.isFinite(Number(myElo.after)) ? Number(myElo.after) : null,
      eloDelta: myElo && Number.isFinite(Number(myElo.delta)) ? Number(myElo.delta) : null
    });
    if (typeof window.HoopState.refreshLeaderboard === 'function') {
      window.HoopState.refreshLeaderboard().catch(() => {});
    }
    if (Array.isArray(gameState.players)) {
      renderScoreboard(gameState.players, gameState.activePlayerId, {
        winnerPlayerId,
        loserPlayerId
      });
    }
    hasRecordedCurrentGame = true;
  }
});

socket.on('disconnect', () => {
  stopTimer();
  closeMatchmakingOverlay();
  setMessage('Connection lost.', 'error');
});

wireGuessAutocomplete().catch(() => {});
