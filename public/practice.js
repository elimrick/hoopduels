const TURN_MS = 60_000;
const CPU_DELAY_MS = 2000;

const timerEl = document.getElementById('practice-timer');
const currentEl = document.getElementById('practice-current-player');
const playerNameEl = document.getElementById('practice-player-name');
const yourFoulsEl = document.getElementById('practice-you-fouls');
const inputEl = document.getElementById('practice-guess-input');
const submitEl = document.getElementById('practice-submit-btn');
const messageEl = document.getElementById('practice-message');
const historyEl = document.getElementById('practice-history-list');
const leaveBtn = document.getElementById('leave-practice-btn');
const guessRowEl = document.getElementById('practice-guess-row');
const playerLeftEl = document.getElementById('practice-player-left');
const playerRightEl = document.getElementById('practice-player-right');
const DEFAULT_PRACTICE_PLACEHOLDER = 'Name a teammate...';
let practiceAutocomplete = null;

const state = {
  currentPlayer: '',
  usedPlayers: [],
  yourFouls: 0,
  turnDeadline: 0,
  timer: null,
  active: true,
  phase: 'player',
  timeoutHandled: false,
  pending: false
};

function refreshPlayerName() {
  playerNameEl.textContent = getDisplayName();
}

function getDisplayName() {
  if (!window.HoopState || typeof window.HoopState.getProfile !== 'function') return 'Guest';
  const profile = window.HoopState.getProfile();
  const name = profile && profile.username ? String(profile.username).trim() : '';
  return name || 'Guest';
}

function setMessage(text, kind = '') {
  messageEl.className = kind ? `message ${kind}` : 'message';
  messageEl.textContent = text || '';
}

function clearInputError() {
  setMessage('');
}

function syncInputPlaceholder() {
  if (!state.active) {
    inputEl.placeholder = '';
  } else if (state.phase === 'player') {
    inputEl.placeholder = DEFAULT_PRACTICE_PLACEHOLDER;
  } else {
    inputEl.placeholder = "Computer's turn";
  }
}

function showInputError(text) {
  inputEl.value = '';
  setMessage(text, 'error');
}

function flashPracticeFoul() {
  playerLeftEl.classList.remove('foul-flash');
  void playerLeftEl.offsetWidth;
  playerLeftEl.classList.add('foul-flash');
  setTimeout(() => {
    playerLeftEl.classList.remove('foul-flash');
  }, 650);
}

function capitalizeFirstChar(value) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function renderHistory() {
  historyEl.innerHTML = '';
  if (!state.usedPlayers.length) return;
  for (let i = state.usedPlayers.length - 1; i >= 0; i -= 1) {
    const li = document.createElement('li');
    li.className = i === 0 ? 'history-item start-player' : 'history-item';
    if (i === 0) {
      const s = document.createElement('strong');
      s.textContent = 'Start:';
      li.appendChild(s);
      li.append(` ${state.usedPlayers[i]}`);
    } else {
      li.textContent = state.usedPlayers[i];
    }
    historyEl.appendChild(li);
  }
}

function refreshAutocomplete() {
  if (practiceAutocomplete && typeof practiceAutocomplete.refresh === 'function') {
    practiceAutocomplete.refresh();
  }
}

function stopTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function setTurnUi() {
  const playerTurn = state.active && state.phase === 'player';
  const cpuTurn = state.active && state.phase === 'cpu';
  playerLeftEl.classList.toggle('active', playerTurn);
  playerRightEl.classList.toggle('active', cpuTurn);
  if (playerTurn) {
    playerLeftEl.style.borderColor = '#3a7bff';
    playerLeftEl.style.background = 'rgba(58, 123, 255, 0.14)';
    playerLeftEl.style.boxShadow = 'inset 0 0 0 1px rgba(58, 123, 255, 0.5)';
  } else {
    playerLeftEl.style.borderColor = '';
    playerLeftEl.style.background = '';
    playerLeftEl.style.boxShadow = '';
  }
  if (cpuTurn) {
    playerRightEl.style.borderColor = '#3a7bff';
    playerRightEl.style.background = 'rgba(58, 123, 255, 0.14)';
    playerRightEl.style.boxShadow = 'inset 0 0 0 1px rgba(58, 123, 255, 0.5)';
  } else {
    playerRightEl.style.borderColor = '';
    playerRightEl.style.background = '';
    playerRightEl.style.boxShadow = '';
  }

  inputEl.disabled = !state.active;
  inputEl.readOnly = !playerTurn || state.pending;
  if (submitEl) submitEl.disabled = !playerTurn || state.pending;
  if (guessRowEl) {
    guessRowEl.classList.toggle('turn-active', playerTurn);
    guessRowEl.classList.toggle('turn-inactive', !playerTurn);
  }
  syncInputPlaceholder();
}

function savePracticeProgress() {
  const chainLength = Math.max(0, state.usedPlayers.length - 1);
  if (window.HoopState && typeof window.HoopState.savePracticeChain === 'function') {
    window.HoopState.savePracticeChain(chainLength);
  }
}

function endPractice(reason, detailMessage = '') {
  state.active = false;
  state.phase = 'ended';
  stopTimer();
  timerEl.textContent = 'Game Over';
  currentEl.textContent = reason || 'Finished';
  setMessage(detailMessage, detailMessage ? 'error' : '');
  if (guessRowEl) {
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
  }
  setTurnUi();
  if (leaveBtn) {
    leaveBtn.textContent = 'Play Again';
  }
  savePracticeProgress();
  refreshAutocomplete();
}

function applyFoul(reason) {
  state.yourFouls += 1;
  yourFoulsEl.textContent = String(state.yourFouls);
  flashPracticeFoul();
  if (state.yourFouls >= 3) {
    endPractice('You Fouled Out', '');
    return;
  }
  clearInputError();
  state.phase = 'player';
  setTurnUi();
  inputEl.focus();
  refreshAutocomplete();
}

function startPlayerTurnTimer() {
  state.phase = 'player';
  state.timeoutHandled = false;
  setTurnUi();
  stopTimer();
  state.turnDeadline = Date.now() + TURN_MS;
  timerEl.textContent = '60';

  const tick = () => {
    if (!state.active || state.phase !== 'player') return;
    const ms = Math.max(0, state.turnDeadline - Date.now());
    const left = Math.max(0, Math.floor(ms / 1000));
    timerEl.textContent = String(left);
    if (left <= 0 && !state.timeoutHandled) {
      state.timeoutHandled = true;
      stopTimer();
      endPractice('Poor Clock Management');
    }
  };

  tick();
  state.timer = setInterval(tick, 250);
}

function hydrateSignedInName() {
  if (!window.HoopState || typeof window.HoopState.getToken !== 'function') return;
  if (!window.HoopState.getToken()) return;
  let attempts = 0;
  const maxAttempts = 12;
  const tick = () => {
    attempts += 1;
    refreshPlayerName();
    if (getDisplayName() !== 'Guest' || attempts >= maxAttempts) return;
    setTimeout(tick, 250);
  };
  tick();
}

function queueComputerTurn(nextCurrentPlayer) {
  state.phase = 'cpu';
  setTurnUi();
  stopTimer();
  timerEl.textContent = '60';
  currentEl.textContent = nextCurrentPlayer || state.currentPlayer;
}

async function startPractice() {
  const res = await fetch('/api/practice/start');
  const payload = await res.json();
  if (!res.ok || !payload || !payload.startPlayer) {
    throw new Error(payload && payload.error ? payload.error : 'Practice unavailable.');
  }
  state.currentPlayer = payload.startPlayer;
  state.usedPlayers = [payload.startPlayer];
  state.active = true;
  state.phase = 'player';
  state.yourFouls = 0;
  refreshPlayerName();
  yourFoulsEl.textContent = '0';
  currentEl.textContent = state.currentPlayer;
  setMessage('');
  if (leaveBtn) {
    leaveBtn.textContent = 'Leave Game';
  }
  renderHistory();
  startPlayerTurnTimer();
  inputEl.focus();
  refreshAutocomplete();
}

async function submitGuess() {
  if (!state.active || state.phase !== 'player') return;
  const guess = inputEl.value.trim();
  if (!guess) return;
  clearInputError();
  syncInputPlaceholder();
  state.pending = true;
  inputEl.value = '';
  setTurnUi();

  try {
    const res = await fetch('/api/practice/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPlayer: state.currentPlayer,
        usedPlayers: state.usedPlayers,
        guess
      })
    });
    const payload = await res.json();
    if (!res.ok || !payload) {
      throw new Error(payload && payload.error ? payload.error : 'Could not process guess.');
    }

    if (!payload.ok) {
      applyFoul(payload.reason || 'Unknown player');
      return;
    }

    setMessage('');
    if (payload.userGuess) {
      state.usedPlayers.push(payload.userGuess);
    }
    renderHistory();
    refreshAutocomplete();

    if (!payload.computerGuess) {
      state.currentPlayer = payload.nextCurrentPlayer || payload.userGuess || state.currentPlayer;
      currentEl.textContent = state.currentPlayer;
      startPlayerTurnTimer();
      inputEl.focus();
      return;
    }

    queueComputerTurn(payload.userGuess || state.currentPlayer);
    await new Promise((resolve) => setTimeout(resolve, CPU_DELAY_MS));
    if (!state.active) return;

    state.usedPlayers.push(payload.computerGuess);
    state.currentPlayer = payload.nextCurrentPlayer || payload.computerGuess;
    currentEl.textContent = state.currentPlayer;
    renderHistory();
    refreshAutocomplete();
    startPlayerTurnTimer();
    inputEl.focus();
  } catch (error) {
    setMessage(error.message || 'Practice error.', 'error');
  } finally {
    state.pending = false;
    if (state.active) {
      setTurnUi();
      if (state.phase === 'player') inputEl.focus();
    }
  }
}

if (submitEl) {
  submitEl.addEventListener('click', submitGuess);
}
inputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Escape' && event.key !== 'Tab') {
    clearInputError();
    syncInputPlaceholder();
  }
  if (event.key === 'Enter') submitGuess();
});
leaveBtn.addEventListener('click', () => {
  if (!state.active) {
    startPractice().catch((error) => {
      setMessage(error.message || 'Practice unavailable.', 'error');
      endPractice('Unavailable');
    });
    return;
  }
  savePracticeProgress();
  window.location.href = '/';
});

window.addEventListener('hoopstate:updated', refreshPlayerName);

startPractice().catch((error) => {
  setMessage(error.message || 'Practice unavailable.', 'error');
  endPractice('Unavailable');
});

hydrateSignedInName();

if (window.HoopAutocomplete) {
  window.HoopAutocomplete.attach(inputEl, {
    getExcludedNames: () => state.usedPlayers,
    onSelect: () => {
      submitGuess();
    }
  }).then((instance) => {
    practiceAutocomplete = instance;
    refreshAutocomplete();
  }).catch(() => {});
}
