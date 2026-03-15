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
const guessDisplayEl = document.getElementById('guess-display');
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
const DEFAULT_GUESS_PLACEHOLDER = 'Name a teammate...';

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
let transientGuessPlaceholder = '';
let transientGuessDisplay = '';
let lastStrikeSignature = '';
let lastRenderedStrikes = {};

function getLocalProfileName() {
  if (!window.HoopState) return '';
  const profile = window.HoopState.getProfile();
  return profile && profile.username ? profile.username : '';
}

function setMessage(text, kind = '') {
  messageEl.className = kind ? `message ${kind}` : 'message';
  messageEl.textContent = text || '';
}

function getGuessFieldRoot() {
  return guessInput ? (guessInput.closest('.player-autocomplete') || guessInput) : null;
}

function getGuessValue() {
  return guessInput ? String('value' in guessInput ? guessInput.value : (guessInput.textContent || '')) : '';
}

function setGuessValue(value = '') {
  if (!guessInput) return;
  if ('value' in guessInput) {
    guessInput.value = value;
  } else {
    guessInput.textContent = value;
  }
}

function setGuessPlaceholder(value = '') {
  if (!guessInput) return;
  guessInput.placeholder = value;
}

function setGuessEditable(editable) {
  if (!guessInput) return;
  if ('readOnly' in guessInput) {
    guessInput.readOnly = !editable;
    guessInput.disabled = false;
  }
  guessInput.setAttribute('aria-disabled', editable ? 'false' : 'true');
}

function isGuessLocked() {
  return !guessInput || Boolean(guessInput.readOnly || guessInput.disabled);
}

function showGuessInput() {
  const guessFieldRoot = getGuessFieldRoot();
  if (guessFieldRoot) {
    guessFieldRoot.hidden = false;
    guessFieldRoot.style.display = '';
  }
  guessInput.hidden = false;
  guessInput.style.display = '';
  if (guessDisplayEl) {
    guessDisplayEl.hidden = true;
    guessDisplayEl.textContent = '';
    guessDisplayEl.style.display = 'none';
  }
}

function lockGuessInput(value = '') {
  showGuessInput();
  setGuessPlaceholder('');
  setGuessValue(value);
  guessInput.dataset.lockedValue = value;
}
function showGuessDisplay(text = '') {
  const guessFieldRoot = getGuessFieldRoot();
  if (guessFieldRoot) {
    guessFieldRoot.hidden = true;
    guessFieldRoot.style.display = 'none';
  }
  guessInput.hidden = true;
  guessInput.style.display = 'none';
  if (guessDisplayEl) {
    guessDisplayEl.hidden = false;
    guessDisplayEl.textContent = text || '';
    guessDisplayEl.style.display = 'flex';
  }
}

function clearInputError() {
  setMessage('');
}

function syncGuessPlaceholder(isMyTurn) {
  if (transientGuessDisplay) {
    setGuessValue(transientGuessDisplay);
    setGuessPlaceholder('');
    return;
  }
  if (transientGuessPlaceholder) {
    setGuessPlaceholder(transientGuessPlaceholder);
    return;
  }
  if (!guessInput.matches(':focus')) {
    setGuessValue('');
  }
  setGuessPlaceholder(isMyTurn && currentState && currentState.status === 'active'
    ? DEFAULT_GUESS_PLACEHOLDER
    : "Opponent's turn");
}

function clearTransientGuessPlaceholder() {
  transientGuessPlaceholder = '';
  if (transientGuessDisplay && getGuessValue() === transientGuessDisplay) {
    setGuessValue('');
  }
  transientGuessDisplay = '';
}

function setOpponentGuessPlaceholder(name) {
  transientGuessDisplay = name ? `Opponent guessed ${name}` : 'Opponent guessed a player';
  transientGuessPlaceholder = '';
}

function getStrikeOutOutcome(players) {
  if (!Array.isArray(players) || !players.length) return null;
  const loser = players.find((p) => Number(p && p.strikes) >= 3);
  if (!loser || !loser.playerId) return null;
  const winner = players.find((p) => p && p.playerId && p.playerId !== loser.playerId) || null;
  return {
    reason: '3 strikes',
    loserPlayerId: loser.playerId,
    winnerPlayerId: winner ? winner.playerId : null
  };
}

function enforceInputPrivacy(input) {
  if (!input) return;
  input.removeAttribute('name');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('data-form-type', 'other');
  input.setAttribute('data-lpignore', 'true');
  input.setAttribute('data-1p-ignore', 'true');
}

function pulseCardRed(targetEl) {
  if (!targetEl) return;
  if (targetEl._foulFlashTimer) {
    clearTimeout(targetEl._foulFlashTimer);
  }
  targetEl.classList.remove('foul-flash');
  void targetEl.offsetWidth;
  targetEl.classList.add('foul-flash');

  targetEl._foulFlashTimer = setTimeout(() => {
    targetEl.classList.remove('foul-flash');
    targetEl._foulFlashTimer = null;
  }, 1000);
}

function flashFoulCard(targetPlayerId) {
  if (!targetPlayerId) return;
  const targetEl = currentState && Array.isArray(currentState.players) && currentState.players[0] && currentState.players[0].playerId === targetPlayerId
    ? playerLeftEl
    : currentState && Array.isArray(currentState.players) && currentState.players[1] && currentState.players[1].playerId === targetPlayerId
      ? playerRightEl
      : null;
  pulseCardRed(targetEl);
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

function getLastStrikeGuess(history) {
  if (!Array.isArray(history)) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.type === 'strike' && entry.guess) {
      return String(entry.guess).trim();
    }
  }
  return '';
}

function getLastStrikeEntry(history) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.type === 'strike') {
      return entry;
    }
  }
  return null;
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
    lastRenderedStrikes = {};
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
  const strikeOutOutcome = getStrikeOutOutcome(state.players);
  const lockedForTerminalStrike = Boolean(strikeOutOutcome);
  const canGuess = isMyTurn && state.status === 'active' && !lockedForTerminalStrike;

  if (leaveGameBtn) leaveGameBtn.textContent = 'Leave Game';

  if (currentLabelEl) currentLabelEl.textContent = '';
  if (currentLabelEl) currentLabelEl.style.display = 'none';
  currentPlayerEl.textContent = state.currentPlayer;

  setGuessEditable(canGuess);
  delete guessInput.dataset.lockedValue;
  guessInput.tabIndex = canGuess ? 0 : -1;
  if (submitBtn) submitBtn.disabled = !canGuess;
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.remove('game-ended');
    guessRowEl.classList.toggle('turn-active', canGuess);
    guessRowEl.classList.toggle('turn-inactive', !canGuess);
  }
  showGuessInput();
  syncGuessPlaceholder(canGuess);
  if (canGuess) {
    setTimeout(() => {
      guessInput.focus();
    }, 0);
  } else {
    guessInput.blur();
  }

  const strikeInfo = parseStrikeMessage(state.message);
  const nextRenderedStrikes = {};
  if (Array.isArray(state.players)) {
    state.players.forEach((p) => {
      const strikeCount = Number(p && p.strikes);
      const safeCount = Number.isFinite(strikeCount) ? strikeCount : 0;
      if (p && p.playerId && Number.isFinite(lastRenderedStrikes[p.playerId]) && safeCount > lastRenderedStrikes[p.playerId]) {
        flashFoulCard(p.playerId);
      }
      if (p && p.playerId) {
        nextRenderedStrikes[p.playerId] = safeCount;
      }
    });
  }
  lastRenderedStrikes = nextRenderedStrikes;

  renderScoreboard(state.players, state.activePlayerId, strikeOutOutcome);
  renderHistory(state.usedPlayers, state.history, state.players);
  if (strikeInfo) {
    const me = state.players.find((p) => p.playerId === playerId);
    const myName = me ? me.username : '';
    clearInputError();
    if (myName && strikeInfo.guesser === myName) {
      clearTransientGuessPlaceholder();
      syncGuessPlaceholder(canGuess);
    } else {
      const guessedName = strikeInfo.guess || extractGuessedName(state.message) || 'player';
      setOpponentGuessPlaceholder(guessedName);
      syncGuessPlaceholder(canGuess);
    }
  } else {
    lastStrikeSignature = '';
    clearInputError();
    clearTransientGuessPlaceholder();
    syncGuessPlaceholder(canGuess);
  }

  if (lockedForTerminalStrike) {
    stopTimer();
    if (guessRowEl) {
      guessRowEl.classList.remove('turn-active');
      guessRowEl.classList.add('turn-inactive');
      guessRowEl.classList.add('game-ended');
    }
    if (guessAutocomplete && typeof guessAutocomplete.close === 'function') {
      guessAutocomplete.close();
    }
    lockGuessInput(strikeOutOutcome.loserPlayerId === playerId ? '' : (getGuessValue() || ''));
    return;
  }

  if (guessAutocomplete && typeof guessAutocomplete.refresh === 'function') {
    guessAutocomplete.refresh();
  }

  startTimer();
}

async function wireGuessAutocomplete() {
  if (!window.HoopAutocomplete || !guessInput) return;
  enforceInputPrivacy(guessInput);
  guessAutocomplete = await window.HoopAutocomplete.attach(guessInput, {
    getExcludedNames: () => {
      if (!currentState || !Array.isArray(currentState.usedPlayers)) return [];
      return currentState.usedPlayers;
    },
    onSelect: () => {
      submitGuess();
    }
  });
}

enforceInputPrivacy(guessInput);

function submitGuess() {
  const guess = getGuessValue().trim();
  if (!guess) return;
  clearInputError();
  clearTransientGuessPlaceholder();
  syncGuessPlaceholder(Boolean(currentState && currentState.activePlayerId === playerId));
  socket.emit('game:guess', guess);
  setGuessValue('');
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
}

if (submitBtn) {
  submitBtn.addEventListener('click', submitGuess);
}

  guessInput.addEventListener('keydown', (e) => {
  if (gameFinished || isGuessLocked()) {
    e.preventDefault();
    return;
  }
  if (e.key !== 'Enter' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Escape' && e.key !== 'Tab') {
    clearInputError();
    clearTransientGuessPlaceholder();
    syncGuessPlaceholder(Boolean(currentState && currentState.activePlayerId === playerId));
  }
  if (e.key === 'Enter') {
    e.preventDefault();
  }
});

guessInput.addEventListener('beforeinput', (e) => {
  if (gameFinished || isGuessLocked()) {
    e.preventDefault();
  }
});

guessInput.addEventListener('input', () => {
  if (gameFinished || isGuessLocked()) {
    setGuessValue(guessInput.dataset.lockedValue || '');
    return;
  }
});

guessInput.addEventListener('focus', () => {
  if (gameFinished || isGuessLocked()) {
    guessInput.blur();
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
    if (leaveGameBtn && gameFinished) leaveGameBtn.textContent = 'New Game';
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
    lastStrikeSignature = '';
  }
  setMessage('');
  clearTransientGuessPlaceholder();
  if (guessRowEl && !gameFinished) {
    guessRowEl.hidden = true;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  if (!gameFinished) {
    syncGuessPlaceholder(false);
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
  clearTransientGuessPlaceholder();
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
  if (leaveGameBtn) leaveGameBtn.textContent = 'New Game';
  finalWinnerPlayerId = winnerPlayerId;
  finalLoserPlayerId = loserPlayerId;
  isRequeueing = false;
  sessionStorage.setItem(GAME_END_REDIRECT_KEY, '1');
  const youWon = playerId === winnerPlayerId;
  const normalizedReason = typeof reason === 'string' ? reason.trim().toLowerCase() : '';
  let finalInputText = '';

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
    const striker = gameState && Array.isArray(gameState.players)
      ? gameState.players.find((p) => String(p.username || '').trim().toLowerCase() === String(finalStrikeInfo.guesser || '').trim().toLowerCase())
      : null;
    const me = gameState && Array.isArray(gameState.players)
      ? gameState.players.find((p) => p.playerId === playerId)
      : null;
    const myName = me ? me.username : '';
    flashFoulCard(striker ? striker.playerId : null);
    if (myName && finalStrikeInfo.guesser === myName) {
      clearTransientGuessPlaceholder();
      finalInputText = '';
    } else {
      const guessedName = finalStrikeInfo.guess || finalHistoryGuess || extractGuessedName(gameState.message) || 'player';
      finalInputText = `Opponent guessed ${guessedName}`;
    }
  } else if (normalizedReason === '3 strikes' && finalHistoryGuess) {
    finalInputText = `Opponent guessed ${finalHistoryGuess}`;
  } else {
    setMessage('');
    clearTransientGuessPlaceholder();
    finalInputText = '';
  }

  setGuessEditable(false);
  guessInput.tabIndex = -1;
  guessInput.blur();
  if (submitBtn) submitBtn.disabled = true;
  if (guessRowEl) {
    guessRowEl.hidden = false;
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
    guessRowEl.classList.add('game-ended');
  }
  if (guessAutocomplete && typeof guessAutocomplete.close === 'function') {
    guessAutocomplete.close();
  }
  clearTransientGuessPlaceholder();
  const lockedValue = normalizedReason === 'time expired' ? '' : (finalInputText || '');
  if (lockedValue) {
    setGuessPlaceholder('');
    setGuessValue(lockedValue);
    guessInput.dataset.lockedValue = lockedValue;
    showGuessDisplay(lockedValue);
  } else {
    lockGuessInput('');
  }

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
