const TURN_MS = 60_000;
const CPU_DELAY_MS = 5000;

const timerEl = document.getElementById('practice-timer');
const currentEl = document.getElementById('practice-current-player');
const yourFoulsEl = document.getElementById('practice-you-fouls');
const cpuFoulsEl = document.getElementById('practice-cpu-fouls');
const inputEl = document.getElementById('practice-guess-input');
const submitEl = document.getElementById('practice-submit-btn');
const messageEl = document.getElementById('practice-message');
const historyEl = document.getElementById('practice-history-list');
const leaveBtn = document.getElementById('leave-practice-btn');

const state = {
  currentPlayer: '',
  usedPlayers: [],
  yourFouls: 0,
  cpuFouls: 0,
  turnDeadline: 0,
  timer: null,
  active: true
};

function setMessage(text, kind = '') {
  messageEl.className = kind ? `message ${kind}` : 'message';
  messageEl.textContent = text || '';
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

function stopTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function startTurnTimer() {
  stopTimer();
  state.turnDeadline = Date.now() + TURN_MS;
  const tick = () => {
    const left = Math.max(0, Math.floor((state.turnDeadline - Date.now()) / 1000));
    timerEl.textContent = String(left);
    if (left <= 0) {
      state.yourFouls += 1;
      yourFoulsEl.textContent = String(state.yourFouls);
      if (state.yourFouls >= 3) {
        endPractice('Poor Clock Management');
      } else {
        setMessage('Incorrect guess: Time expired.', 'error');
        startTurnTimer();
      }
    }
  };
  tick();
  state.timer = setInterval(tick, 250);
}

function endPractice(reason) {
  state.active = false;
  stopTimer();
  timerEl.textContent = 'Practice Over';
  currentEl.textContent = reason;
  inputEl.disabled = true;
  submitEl.disabled = true;
  const chainLength = Math.max(0, state.usedPlayers.length - 1);
  if (window.HoopState && typeof window.HoopState.savePracticeChain === 'function') {
    window.HoopState.savePracticeChain(chainLength);
  }
}

async function startPractice() {
  const res = await fetch('/api/practice/start');
  const payload = await res.json();
  if (!res.ok || !payload || !payload.startPlayer) {
    throw new Error(payload && payload.error ? payload.error : 'Practice unavailable.');
  }
  state.currentPlayer = payload.startPlayer;
  state.usedPlayers = [payload.startPlayer];
  currentEl.textContent = payload.startPlayer;
  renderHistory();
  startTurnTimer();
  inputEl.focus();
}

async function submitGuess() {
  if (!state.active) return;
  const guess = inputEl.value.trim();
  if (!guess) return;
  inputEl.value = '';
  inputEl.disabled = true;
  submitEl.disabled = true;

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
      state.yourFouls += 1;
      yourFoulsEl.textContent = String(state.yourFouls);
      setMessage(`Incorrect guess: ${payload.reason}`, 'error');
      if (state.yourFouls >= 3) {
        endPractice('You Fouled Out');
        return;
      }
      inputEl.disabled = false;
      submitEl.disabled = false;
      inputEl.focus();
      startTurnTimer();
      return;
    }

    setMessage('');
    if (payload.userGuess) {
      state.usedPlayers.push(payload.userGuess);
    }
    renderHistory();

    if (!payload.computerGuess) {
      state.currentPlayer = payload.nextCurrentPlayer || payload.userGuess || state.currentPlayer;
      currentEl.textContent = state.currentPlayer;
      inputEl.disabled = false;
      submitEl.disabled = false;
      inputEl.focus();
      startTurnTimer();
      return;
    }

    currentEl.textContent = 'Computer thinking...';
    timerEl.textContent = '...';
    await new Promise((resolve) => setTimeout(resolve, CPU_DELAY_MS));
    if (!state.active) return;

    state.usedPlayers.push(payload.computerGuess);
    state.currentPlayer = payload.nextCurrentPlayer || payload.computerGuess;
    currentEl.textContent = state.currentPlayer;
    renderHistory();
    inputEl.disabled = false;
    submitEl.disabled = false;
    inputEl.focus();
    startTurnTimer();
  } catch (error) {
    setMessage(error.message || 'Practice error.', 'error');
    inputEl.disabled = false;
    submitEl.disabled = false;
  }
}

submitEl.addEventListener('click', submitGuess);
inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitGuess();
});
leaveBtn.addEventListener('click', () => {
  window.location.href = '/';
});

startPractice().catch((error) => {
  setMessage(error.message || 'Practice unavailable.', 'error');
  endPractice('Unavailable');
});
