(async function markActiveNav() {
  const page = document.body.dataset.page;

  function applyActiveNav() {
    if (!page) return;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.remove('active');
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      if (el.dataset.nav === page) {
        el.classList.add('active');
      }
    });
  }

  function renderAuthNav(isSignedIn) {
    const root = document.documentElement;
    root.classList.remove('auth-signed-in', 'auth-signed-out');
    root.classList.add(isSignedIn ? 'auth-signed-in' : 'auth-signed-out');

    const authNavLink = document.getElementById('auth-nav-link');
    const existingCreate = document.getElementById('auth-nav-create');
    const profileNavLink = document.getElementById('auth-nav-profile');
    if (!authNavLink || !existingCreate || !profileNavLink) return;

    if (isSignedIn) {
      authNavLink.classList.add('is-hidden');
      existingCreate.classList.add('is-hidden');
      profileNavLink.classList.remove('is-hidden');
    } else {
      authNavLink.classList.remove('is-hidden');
      existingCreate.classList.remove('is-hidden');
      profileNavLink.classList.add('is-hidden');
    }
  }

  // Render auth nav immediately to avoid signed-in/signed-out flicker during async init.
  renderAuthNav(Boolean(localStorage.getItem('hoopduels_auth_token_v1')));
  applyActiveNav();

  if (window.HoopState && typeof window.HoopState.init === 'function') {
    try {
      await window.HoopState.init();
    } catch (_) {
    }
  }

  const profile = window.HoopState ? window.HoopState.getProfile() : null;
  const signedIn = profile ? profile.signedIn : false;
  renderAuthNav(signedIn);
  applyActiveNav();

  if (!page) return;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function formatRank(rank) {
    return rank == null ? '-' : `#${rank}`;
  }

  function formatStreak(streak) {
    if (streak > 0) return `W${streak}`;
    if (streak < 0) return `L${Math.abs(streak)}`;
    return '0';
  }

  function formatBestWin(bestWinRank) {
    return bestWinRank == null ? '-' : `#${bestWinRank}`;
  }

  function formatJoinedDate(ts) {
    if (!ts) return '-';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
  }

  function renderHome() {
    const activeProfile = window.HoopState ? window.HoopState.getProfile() : null;
    if (!activeProfile) return;
    const isGuest = !activeProfile.signedIn;

    const homeTitle = document.getElementById('home-title');
    if (homeTitle) {
      homeTitle.textContent = activeProfile.signedIn ? `Welcome back, ${activeProfile.username}!` : 'Welcome!';
    }

    const shown = isGuest
      ? {
        rank: null,
        wins: 0,
        losses: 0,
        streak: 0,
        peakRank: null,
        bestWin: null,
        longestChain: 0,
        games: []
      }
      : activeProfile;

    setText('stat-rating', formatRank(shown.rank));
    setText('stat-wl', `${shown.wins}-${shown.losses}`);
    setText('stat-streak', formatStreak(shown.streak));
    setText('stat-peak', formatRank(shown.peakRank));
    setText('stat-best-win', formatBestWin(shown.bestWin));
    setText('stat-longest-chain', shown.longestChain);

    const historyPreview = document.getElementById('history-preview');
    if (historyPreview) {
      historyPreview.innerHTML = '';
      const recent = shown.games.slice(0, 10);
      if (!recent.length) {
        historyPreview.textContent = 'No games played yet.';
        historyPreview.className = 'list-empty';
      } else {
        historyPreview.className = '';
        const wrap = document.createElement('div');
        wrap.className = 'home-table-wrap';

        const table = document.createElement('table');
        table.className = 'history-table home-history-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Result', 'Opponent'].forEach((label) => {
          const th = document.createElement('th');
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        recent.forEach((g) => {
          const tr = document.createElement('tr');

          const wl = document.createElement('td');
          wl.textContent = g.won ? 'W' : 'L';
          wl.className = g.won ? 'history-wl win' : 'history-wl loss';

          const opp = document.createElement('td');
          const oppPrefix = g.opponentRank == null ? '' : `#${g.opponentRank} `;
          opp.textContent = `${oppPrefix}${g.opponent}`;
          opp.className = 'history-opponent';

          tr.appendChild(wl);
          tr.appendChild(opp);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        historyPreview.appendChild(wrap);
      }
    }

    const leaderboardPreview = document.getElementById('leaderboard-preview');
    if (leaderboardPreview && window.HoopState) {
      leaderboardPreview.innerHTML = '';
      const top = window.HoopState.getLeaderboardRows().slice(0, 10);
      if (!top.length) {
        leaderboardPreview.textContent = 'No players yet.';
        leaderboardPreview.className = 'list-empty';
      } else {
        leaderboardPreview.className = '';
        const wrap = document.createElement('div');
        wrap.className = 'home-table-wrap';

        const table = document.createElement('table');
        table.className = 'leaderboard-table home-leaderboard-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Rank', 'Name', 'Record'].forEach((label) => {
          const th = document.createElement('th');
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        top.forEach((row) => {
          const tr = document.createElement('tr');
          if (row.isYou) {
            tr.classList.add('leaderboard-row-you');
          }

          const rank = document.createElement('td');
          rank.textContent = String(row.rank);

          const name = document.createElement('td');
          name.textContent = row.username;
          name.className = `leaderboard-name ${row.isYou ? 'leaderboard-name-you' : ''}`.trim();

          const record = document.createElement('td');
          record.textContent = `${row.wins}-${row.losses}`;

          tr.appendChild(rank);
          tr.appendChild(name);
          tr.appendChild(record);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        leaderboardPreview.appendChild(wrap);
      }
    }
  }

  function renderLeaderboard() {
    if (!window.HoopState) return;
    const container = document.getElementById('leaderboard-list');
    if (!container) return;

    const rows = window.HoopState.getLeaderboardRows();
    container.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No players yet.';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'leaderboard-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Rank', 'Name', 'Record', 'Longest Chain'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.isYou) {
        tr.classList.add('leaderboard-row-you');
      }

      const rankCell = document.createElement('td');
      rankCell.textContent = String(row.rank);

      const nameCell = document.createElement('td');
      nameCell.textContent = row.username;
      nameCell.className = `leaderboard-name ${row.isYou ? 'leaderboard-name-you' : ''}`.trim();

      const recordCell = document.createElement('td');
      recordCell.textContent = `${row.wins}-${row.losses}`;

      const chainCell = document.createElement('td');
      chainCell.textContent = String(row.longestChain);

      tr.appendChild(rankCell);
      tr.appendChild(nameCell);
      tr.appendChild(recordCell);
      tr.appendChild(chainCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderHistory() {
    const activeProfile = window.HoopState ? window.HoopState.getProfile() : null;
    if (!activeProfile) return;
    const container = document.getElementById('history-list-page');
    if (!container) return;

    container.innerHTML = '';
    if (!activeProfile.games.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No saved games yet.';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'history-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Result', 'Opponent', 'Chain', 'Date'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    activeProfile.games.forEach((g) => {
      const tr = document.createElement('tr');

      const wl = document.createElement('td');
      wl.textContent = g.won ? 'W' : 'L';
      wl.className = g.won ? 'history-wl win' : 'history-wl loss';

      const opp = document.createElement('td');
      const oppPrefix = g.opponentRank == null ? '' : `#${g.opponentRank} `;
      opp.textContent = `${oppPrefix}${g.opponent}`;
      opp.className = 'history-opponent';

      const chain = document.createElement('td');
      chain.textContent = String(g.chainLength || 0);

      const date = document.createElement('td');
      date.textContent = new Date(g.at).toLocaleDateString();

      tr.appendChild(wl);
      tr.appendChild(opp);
      tr.appendChild(chain);
      tr.appendChild(date);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderProfile() {
    const activeProfile = window.HoopState ? window.HoopState.getProfile() : null;
    if (!activeProfile) return;
    setText('profile-page-title', activeProfile.signedIn ? activeProfile.username : 'Guest');
    setText('profile-joined', formatJoinedDate(activeProfile.joinedAt));
    setText('profile-rank', formatRank(activeProfile.rank));
    setText('profile-peak-rank', formatRank(activeProfile.peakRank));
    setText('profile-wl', `${activeProfile.wins}-${activeProfile.losses}`);
    setText('profile-streak', formatStreak(activeProfile.streak));
    setText('profile-best-win', formatBestWin(activeProfile.bestWin));
    setText('profile-longest-chain', activeProfile.longestChain);
  }

  function wireSignIn() {
    if (!window.HoopState) return;
    const signInButton = document.getElementById('signin-btn');
    const signUpButton = document.getElementById('signup-btn');
    const pageMode = signUpButton ? 'signup' : 'signin';
    const usernameInput = document.getElementById('signin-username');
    const passwordInput = document.getElementById('signin-password');
    const usernameError = document.getElementById('signin-username-error');
    const passwordError = document.getElementById('signin-password-error');
    const message = document.getElementById('signin-message');
    if (!usernameInput || !passwordInput) return;

    const activeProfile = window.HoopState.getProfile();
    if (activeProfile && activeProfile.signedIn && activeProfile.username && activeProfile.username !== 'Guest') {
      usernameInput.value = activeProfile.username;
    }

    const setMessage = (text) => {
      if (!message) return;
      message.textContent = text || '';
    };

    const setUsernameError = (text) => {
      if (!usernameError) return;
      usernameError.textContent = text || '';
    };

    const setPasswordError = (text) => {
      if (!passwordError) return;
      passwordError.textContent = text || '';
    };

    const clearFieldErrors = () => {
      setUsernameError('');
      setPasswordError('');
    };

    const setLoading = (loading) => {
      if (signInButton) signInButton.disabled = loading;
      if (signUpButton) signUpButton.disabled = loading;
    };

    const submitAuth = async (mode) => {
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      clearFieldErrors();
      setMessage('');
      if (mode === 'signup') {
        if (username.length < 2) {
          setUsernameError('Username must be at least 2 characters.');
          return;
        }
        if (!password || password.length < 4 || password.length > 72) {
          setPasswordError('Password must be 4-72 characters.');
          return;
        }
      } else {
        if (username.length < 2) {
          setUsernameError('Enter a valid username.');
          return;
        }
        if (!password) {
          setPasswordError('Enter your password.');
          return;
        }
      }

      try {
        setLoading(true);
        setMessage(mode === 'signup' ? 'Creating account...' : 'Signing in...');
        if (mode === 'signup') {
          await window.HoopState.signUp(username, password);
        } else {
          await window.HoopState.signIn(username, password);
        }
        window.location.href = 'profile.html';
      } catch (error) {
        const raw = error && error.message ? error.message : '';
        if (mode === 'signup') {
          if (/already taken/i.test(raw)) {
            setUsernameError('Username is already taken.');
            setMessage('');
          } else if (/username must be at least 2/i.test(raw)) {
            setUsernameError('Username must be at least 2 characters.');
            setMessage('');
          } else if (/password must be 4-72/i.test(raw) || /password/i.test(raw)) {
            setPasswordError('Password must be 4-72 characters.');
            setMessage('');
          } else if (raw) {
            setMessage(raw);
          } else {
            setMessage('Could not create account.');
          }
        } else if (/invalid username or password/i.test(raw)) {
          setPasswordError('Invalid username or password.');
          setMessage('');
        } else if (raw) {
          setMessage(raw);
        } else {
          setMessage('Authentication failed.');
        }
      } finally {
        setLoading(false);
      }
    };

    if (signInButton) {
      signInButton.addEventListener('click', () => submitAuth('signin'));
    }
    if (signUpButton) {
      signUpButton.addEventListener('click', () => submitAuth('signup'));
    }
    usernameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submitAuth(pageMode);
      }
    });
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submitAuth(pageMode);
      }
    });
  }

  function wireSignOut() {
    if (!window.HoopState) return;
    const signOutButton = document.getElementById('signout-btn');
    if (!signOutButton) return;
    signOutButton.addEventListener('click', async () => {
      await window.HoopState.signOut();
      window.location.href = 'signin.html';
    });
  }

  function wireHomeFindGame() {
    const findBtn = document.getElementById('find-game-home-btn');
    const overlay = document.getElementById('matchmaking-overlay');
    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    const status = document.getElementById('matchmaking-status');
    if (!findBtn || !overlay || !cancelBtn || !status) return;

    let matchmakingSocket = null;
    let isSearching = false;
    let ignoreNextDisconnect = false;
    let matched = false;
    let disconnectNoticeTimer = null;

    const clearDisconnectNotice = () => {
      if (disconnectNoticeTimer) {
        clearTimeout(disconnectNoticeTimer);
        disconnectNoticeTimer = null;
      }
    };

    const closeOverlay = () => {
      overlay.hidden = true;
      isSearching = false;
      matched = false;
      clearDisconnectNotice();
      ignoreNextDisconnect = true;
      if (matchmakingSocket) {
        matchmakingSocket.emit('matchmaking:leave');
        matchmakingSocket.disconnect();
        matchmakingSocket = null;
      }
    };

    findBtn.addEventListener('click', () => {
      if (isSearching) return;
      if (typeof io !== 'function' || !window.HoopState) {
        status.textContent = 'Matchmaking unavailable.';
        overlay.hidden = false;
        return;
      }

      isSearching = true;
      matched = false;
      clearDisconnectNotice();
      overlay.hidden = false;
      status.textContent = 'Connecting to matchmaking...';

      const profile = window.HoopState.getProfile();
      const playerId = window.HoopState.getClientId();
      const displayName = profile && profile.username ? profile.username : '';

      matchmakingSocket = io({ auth: { playerId } });

      matchmakingSocket.on('connect', () => {
        clearDisconnectNotice();
        if (displayName) {
          matchmakingSocket.emit('user:set-name', displayName);
        }
        matchmakingSocket.emit('matchmaking:join');
      });

      matchmakingSocket.on('matchmaking:queued', () => {
        status.textContent = 'Searching for opponent...';
      });

      matchmakingSocket.on('game:state', () => {
        matched = true;
        clearDisconnectNotice();
        status.textContent = 'Opponent found. Entering duel...';
        setTimeout(() => {
          if (matchmakingSocket) {
            ignoreNextDisconnect = true;
            matchmakingSocket.disconnect();
            matchmakingSocket = null;
          }
          window.location.href = 'game.html';
        }, 300);
      });

      matchmakingSocket.on('matchmaking:error', (msg) => {
        clearDisconnectNotice();
        status.textContent = msg || 'Matchmaking error.';
      });

      matchmakingSocket.on('disconnect', () => {
        if (ignoreNextDisconnect) {
          ignoreNextDisconnect = false;
        }
        clearDisconnectNotice();
      });

      matchmakingSocket.on('connect_error', () => {
        clearDisconnectNotice();
        if (isSearching && !matched) {
          status.textContent = 'Disconnected. Try again.';
          isSearching = false;
        }
      });
    });

    cancelBtn.addEventListener('click', closeOverlay);
  }

  if (page === 'play') renderHome();
  if (page === 'leaderboard') renderLeaderboard();
  if (page === 'history') renderHistory();
  if (page === 'profile') renderProfile();
  if (page === 'signin' || page === 'createaccount') wireSignIn();
  if (page === 'play') wireHomeFindGame();
  if (page === 'play' && !document.getElementById('find-game-home-btn')) {
  }
  wireSignOut();
})();
