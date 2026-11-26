const TURN_MS = 60_000;
const CPU_DELAY_MS = 900;

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
const DEFAULT_PRACTICE_PLACEHOLDER = 'Search...';
let practiceAutocomplete = null;

const state = {
  currentPlayer: '',
  usedPlayers: [],
  yourFouls: 0,
  turnDeadline: 0,
  timer: null,
  active: false,
  roundId: 0,
  phase: 'player',
  timeoutHandled: false,
  pending: false
};

function getInputValue() {
  return String('value' in inputEl ? inputEl.value : (inputEl.textContent || ''));
}

function setInputValue(value = '') {
  if ('value' in inputEl) {
    inputEl.value = value;
  } else {
    inputEl.textContent = value;
  }
  resizeInput();
}

function setInputPlaceholder(value = '') {
  inputEl.placeholder = value;
}

function resizeInput() {
  if (!inputEl || !('scrollHeight' in inputEl)) return;
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.max(52, inputEl.scrollHeight)}px`;
}

function setInputEditable(editable) {
  if ('readOnly' in inputEl) {
    inputEl.readOnly = !editable;
    inputEl.disabled = false;
  }
  inputEl.setAttribute('aria-disabled', editable ? 'false' : 'true');
}

function refreshPlayerName() {
  playerNameEl.textContent = getDisplayName();
  const profile = window.HoopState?.getProfile();
  const rating = document.getElementById('practice-player-elo');
  if (rating) rating.textContent = profile?.signedIn ? `(${Math.round(Number(profile.elo) || 1200)})` : '';
}

function getDisplayName() {
  if (!window.HoopState || typeof window.HoopState.getProfile !== 'function') return 'Guest';
  const profile = window.HoopState.getProfile();
  const name = profile && profile.username ? String(profile.username).trim() : '';
  return name || 'Guest';
}

function setMessage(text, kind = '', allowHtml = false) {
  messageEl.className = kind ? `message ${kind}` : 'message';
  if (allowHtml) {
    messageEl.innerHTML = text || '';
  } else {
    messageEl.textContent = text || '';
  }
  if (text && kind === 'error') window.HoopFeedback.animateError(messageEl);
}

function clearInputError() {
  setMessage('');
}

function syncInputPlaceholder() {
  if (!state.active) {
    setInputPlaceholder('');
  } else if (state.phase === 'player') {
    setInputPlaceholder(DEFAULT_PRACTICE_PLACEHOLDER);
  } else {
    setInputPlaceholder("Computer's turn");
  }
}

function showInputError(text) {
  setInputValue('');
  setMessage(text, 'error');
}

function flashPracticeFoul() {
  if (playerLeftEl._foulFlashTimer) {
    clearTimeout(playerLeftEl._foulFlashTimer);
  }
  playerLeftEl.classList.remove('foul-flash');
  void playerLeftEl.offsetWidth;
  playerLeftEl.classList.add('foul-flash');

  playerLeftEl._foulFlashTimer = setTimeout(() => {
    playerLeftEl.classList.remove('foul-flash');
    playerLeftEl._foulFlashTimer = null;
  }, 1000);
}

function setPracticeEndState(result) {
  playerLeftEl.classList.remove('winner', 'loser');
  playerRightEl.classList.remove('winner', 'loser');
  if (result === 'loss') {
    playerLeftEl.classList.add('loser');
  }
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
  setInputEditable(state.active && playerTurn && !state.pending);
  inputEl.tabIndex = state.active && playerTurn && !state.pending ? 0 : -1;
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
  currentEl.classList.add('practice-final-count');
  document.querySelector('.duel-current-label').textContent = 'FINAL CHAIN';
  const chainLength = Math.max(0, state.usedPlayers.length - 1);
  currentEl.textContent = String(chainLength);
  setInputValue('');
  setMessage(detailMessage, detailMessage ? 'error' : '');
  if (guessRowEl) {
    guessRowEl.classList.remove('turn-active');
    guessRowEl.classList.add('turn-inactive');
    guessRowEl.classList.add('game-ended');
  }
  setTurnUi();
  inputEl.blur();
  if (leaveBtn) {
    leaveBtn.textContent = 'Play Again';
  }
  if (reason === 'You Fouled Out' || reason === 'Time expired') {
    setPracticeEndState('loss');
  }
  savePracticeProgress();
  refreshAutocomplete();
}

function applyFoul(reason, preserveTurn = false) {
  state.yourFouls += 1;
  window.HoopFeedback.setFouls(yourFoulsEl, state.yourFouls);
  flashPracticeFoul();
  if (state.yourFouls >= 3) {
    endPractice('You Fouled Out', reason);
    return;
  }
  showInputError(reason);
  if (!preserveTurn) state.phase = 'player';
  setTurnUi();
  inputEl.focus();
  resizeInput();
  refreshAutocomplete();
}

function startPlayerTurnTimer() {
  state.phase = 'player';
  state.timeoutHandled = false;
  setTurnUi();
  stopTimer();
  state.turnDeadline = Date.now() + TURN_MS;
  timerEl.textContent = '1:00';

  const tick = () => {
    if (!state.active || state.phase !== 'player') return;
    const ms = Math.max(0, state.turnDeadline - Date.now());
    if (ms <= 0 && !state.timeoutHandled) {
      state.timeoutHandled = true;
      stopTimer();
      timerEl.textContent = '0:00';
      endPractice('Time expired');
      return;
    }
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    timerEl.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
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
  timerEl.textContent = '1:00';
  currentEl.textContent = nextCurrentPlayer || state.currentPlayer;
}

window.HoopFeedback.watchVisibility((hidden) => {
  if (hidden && state.active) applyFoul('Left the game tab.', true);
});

async function startPractice() {
  state.roundId += 1;
  state.active = false;
  state.pending = false;
  stopTimer();
  currentEl.classList.remove('practice-final-count');
  document.querySelector('.duel-current-label').textContent = 'CURRENT PLAYER';
  const res = await fetch('/api/practice/start');
  const payload = await res.json();
  if (!res.ok || !payload || !payload.startPlayer) {
    throw new Error(payload && payload.error ? payload.error : 'Solo Challenge is unavailable.');
  }
  state.currentPlayer = payload.startPlayer;
  state.usedPlayers = [payload.startPlayer];
  state.active = true;
  state.phase = 'player';
  state.yourFouls = 0;
  refreshPlayerName();
  window.HoopFeedback.setFouls(yourFoulsEl, 0);
  currentEl.textContent = state.currentPlayer;
  setMessage('');
  playerLeftEl.classList.remove('winner', 'loser', 'foul-flash');
  playerRightEl.classList.remove('winner', 'loser', 'foul-flash');
  if (playerLeftEl._foulFlashTimer) {
    clearTimeout(playerLeftEl._foulFlashTimer);
    playerLeftEl._foulFlashTimer = null;
  }
  if (leaveBtn) {
    leaveBtn.textContent = 'Leave Game';
  }
  renderHistory();
  if (guessRowEl) {
    guessRowEl.classList.remove('game-ended');
  }
  startPlayerTurnTimer();
  inputEl.focus();
  resizeInput();
  refreshAutocomplete();
}

async function submitGuess() {
  if (!state.active || state.phase !== 'player' || state.pending) return;
  const roundId = state.roundId;
  const guess = getInputValue().trim();
  if (!guess) return;
  clearInputError();
  syncInputPlaceholder();
  state.pending = true;
  setInputValue('');
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
    if (!state.active || state.roundId !== roundId) return;
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
      resizeInput();
      return;
    }

    queueComputerTurn(payload.userGuess || state.currentPlayer);
    await new Promise((resolve) => setTimeout(resolve, CPU_DELAY_MS));
    if (!state.active || state.roundId !== roundId) return;

    state.usedPlayers.push(payload.computerGuess);
    state.currentPlayer = payload.nextCurrentPlayer || payload.computerGuess;
    currentEl.textContent = state.currentPlayer;
    renderHistory();
    refreshAutocomplete();
    startPlayerTurnTimer();
    inputEl.focus();
    resizeInput();
  } catch (error) {
    if (state.active && state.roundId === roundId) setMessage(error.message || 'Could not complete your turn.', 'error');
  } finally {
    if (state.roundId !== roundId) return;
    state.pending = false;
    if (state.active) {
      setTurnUi();
      if (state.phase === 'player') inputEl.focus();
      resizeInput();
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
  if (event.key === 'Enter') event.preventDefault();
});
inputEl.addEventListener('input', () => {
  resizeInput();
});
leaveBtn.addEventListener('click', () => {
  if (!state.active) {
    startPractice().catch((error) => {
      setMessage(error.message || 'Solo Challenge is unavailable.', 'error');
      endPractice('Unavailable');
    });
    return;
  }
  savePracticeProgress();
  window.location.href = '/';
});

window.addEventListener('hoopstate:updated', refreshPlayerName);

startPractice().catch((error) => {
  setMessage(error.message || 'Solo Challenge is unavailable.', 'error');
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
