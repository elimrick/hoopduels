(async function markActiveNav() {
  const page = document.body.dataset.page;
  const MOBILE_MENU_BREAKPOINT = 1100;
  let onlinePollTimer = null;
  let presenceTimer = null;
  let profileChartRange = 'all';
  let lastProfileForChart = null;
  let profileChartCompactLayout = false;

  function applyActiveNav() {
    if (!page) return;
    const navPage = page === 'practice' ? 'play' : page;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.remove('active');
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      if (el.dataset.nav === navPage) {
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

  function wireMobileTopbar() {
    const layout = document.querySelector('.layout');
    const sidebar = document.querySelector('.sidebar');
    if (!layout || !sidebar) return;
    if (document.querySelector('.mobile-topbar')) return;

    const topbar = document.createElement('div');
    topbar.className = 'mobile-topbar';
    topbar.innerHTML = '<div class="mobile-brand" role="link" tabindex="0" aria-label="Go to home">HoopDuels</div><button class="mobile-menu-btn" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>';
    document.body.insertBefore(topbar, layout);

    const toggleBtn = topbar.querySelector('.mobile-menu-btn');
    const mobileBrand = topbar.querySelector('.mobile-brand');
    if (!toggleBtn) return;

    const closeMenu = () => {
      document.body.classList.remove('mobile-nav-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    };

    toggleBtn.addEventListener('click', () => {
      const willOpen = !document.body.classList.contains('mobile-nav-open');
      document.body.classList.toggle('mobile-nav-open', willOpen);
      toggleBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    if (mobileBrand) {
      mobileBrand.addEventListener('click', () => {
        window.location.href = '/';
      });
      mobileBrand.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = '/';
        }
      });
    }

    sidebar.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        closeMenu();
      });
    });

    document.addEventListener('click', (event) => {
      if (window.innerWidth > MOBILE_MENU_BREAKPOINT) return;
      if (!document.body.classList.contains('mobile-nav-open')) return;
      if (sidebar.contains(event.target) || topbar.contains(event.target)) return;
      closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > MOBILE_MENU_BREAKPOINT) {
        closeMenu();
      }
    });
  }

  function wireBrandHome() {
    const brand = document.querySelector('.sidebar .brand');
    if (!brand) return;
    brand.setAttribute('role', 'link');
    brand.setAttribute('tabindex', '0');
    brand.setAttribute('aria-label', 'Go to home');
    brand.addEventListener('click', () => {
      window.location.href = '/';
    });
    brand.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.href = '/';
      }
    });
  }

  wireMobileTopbar();
  wireBrandHome();
  wireViewportHeight();
  wirePresencePing();

  if (!page) return;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function formatElo(elo) {
    const value = Number(elo);
    return Number.isFinite(value) ? String(Math.round(value)) : '-';
  }

  function formatStreak(streak) {
    if (streak > 0) return `W${streak}`;
    if (streak < 0) return `L${Math.abs(streak)}`;
    return '0';
  }

  function formatBestWin(bestWinRank) {
    return bestWinRank == null ? '-' : String(Math.round(bestWinRank));
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
    setText('practice-longest-chain', String(Number(activeProfile.practiceLongestChain) || 0));

    const guestNote = document.getElementById('home-guest-stats-note');
    if (guestNote) {
      guestNote.hidden = !isGuest;
    }

    if (isGuest) {
      setText('stat-rating', '-');
      setText('stat-wl', '-');
      setText('stat-streak', '-');
      setText('stat-peak', '-');
      setText('stat-best-win', '-');
      setText('stat-longest-chain', '-');
    } else {
      setText('stat-rating', formatElo(activeProfile.elo));
      setText('stat-wl', `${activeProfile.wins}-${activeProfile.losses}`);
      setText('stat-streak', formatStreak(activeProfile.streak));
      setText('stat-peak', formatElo(activeProfile.peakElo));
      setText('stat-best-win', formatBestWin(activeProfile.bestWin));
      setText('stat-longest-chain', activeProfile.longestChain);
    }

    const historyPreview = document.getElementById('history-preview');
    if (historyPreview) {
      historyPreview.innerHTML = '';
      if (isGuest) {
        historyPreview.textContent = 'Create an account to track games played.';
        historyPreview.className = 'list-empty';
      } else {
        const recent = activeProfile.games.slice(0, 10);
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
          ['Result', 'Opponent', 'Rating', 'Chain'].forEach((label) => {
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
            opp.textContent = g.opponent;
            opp.className = 'history-opponent';

            const elo = document.createElement('td');
            elo.textContent = g.opponentRank == null ? '-' : String(Math.round(g.opponentRank));

            const chain = document.createElement('td');
            chain.textContent = String(g.chainLength || 0);

            tr.appendChild(wl);
            tr.appendChild(opp);
            tr.appendChild(elo);
            tr.appendChild(chain);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          wrap.appendChild(table);
          historyPreview.appendChild(wrap);
        }
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
        ['Rank', 'Name', 'Rating', 'Record'].forEach((label) => {
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

          const rating = document.createElement('td');
          rating.textContent = formatElo(row.elo);

          const record = document.createElement('td');
          record.textContent = `${row.wins}-${row.losses}`;

          tr.appendChild(rank);
          tr.appendChild(name);
          tr.appendChild(rating);
          tr.appendChild(record);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        leaderboardPreview.appendChild(wrap);
      }
    }

    const onlineEl = document.getElementById('online-count');
    if (onlineEl) {
      const updateOnline = () => {
        fetch('/api/online')
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            const online = payload ? Number(payload.online) : NaN;
            onlineEl.textContent = Number.isFinite(online) && online >= 0 ? `${online} Online` : '0 Online';
          })
          .catch(() => {
            onlineEl.textContent = '0 Online';
          });
      };

      if (onlinePollTimer) {
        clearInterval(onlinePollTimer);
        onlinePollTimer = null;
      }
      updateOnline();
      onlinePollTimer = setInterval(updateOnline, 5000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateOnline();
      });
    }
  }

  function renderProfileChart(activeProfile) {
    const chartEl = document.getElementById('profile-elo-chart');
    if (!chartEl) return;

    const games = Array.isArray(activeProfile.games) ? activeProfile.games : [];
    lastProfileForChart = activeProfile;
    const now = Date.now();
    const rangeCutoff = profileChartRange === 'month'
      ? now - (30 * 24 * 60 * 60 * 1000)
      : profileChartRange === 'year'
        ? now - (365 * 24 * 60 * 60 * 1000)
        : null;
    const rankedGames = games
      .filter((g) => Number.isFinite(Number(g.eloAfter)) && Number(g.eloAfter) > 0)
      .filter((g) => !rangeCutoff || !Number.isFinite(Number(g.at)) || Number(g.at) >= rangeCutoff)
      .slice()
      .sort((a, b) => {
        const aAt = Number.isFinite(Number(a.at)) ? Number(a.at) : 0;
        const bAt = Number.isFinite(Number(b.at)) ? Number(b.at) : 0;
        return aAt - bAt;
      });

    chartEl.innerHTML = '';
    if (!rankedGames.length) {
      chartEl.innerHTML = `
        <div class="profile-elo-chart-meta">
          <strong>Rating Progression</strong>
          <div class="profile-elo-range-tabs${profileChartCompactLayout ? ' is-compact' : ''}" role="tablist" aria-label="Rating progression range">
            <button class="btn btn-compact${profileChartRange === 'month' ? ' is-selected' : ''}" data-profile-range="month" type="button">Month</button>
            <button class="btn btn-compact${profileChartRange === 'year' ? ' is-selected' : ''}" data-profile-range="year" type="button">Year</button>
            <button class="btn btn-compact${profileChartRange === 'all' ? ' is-selected' : ''}" data-profile-range="all" type="button">All Time</button>
          </div>
        </div>
        <p class="list-empty">Play ranked account-vs-account games in this range to see your Rating progression.</p>
      `;
      wireProfileChartRangeButtons();
      updateProfileChartLayout();
      return;
    }

    const startValue = Number.isFinite(Number(rankedGames[0].eloBefore)) && Number(rankedGames[0].eloBefore) > 0
      ? Number(rankedGames[0].eloBefore)
      : Number(rankedGames[0].eloAfter);
    const values = [startValue, ...rankedGames.map((g) => Number(g.eloAfter))];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const shellWidth = Math.max(320, Math.round(chartEl.clientWidth || 720));
    const width = Math.max(360, shellWidth - 12);
    const height = 200;
    const padX = 16;
    const padY = 16;
    const innerW = width - (padX * 2);
    const innerH = height - (padY * 2);

    const yFor = (v) => padY + innerH - (((v - min) / span) * innerH);
    const points = values.map((v, i) => {
      const x = padX + ((innerW * i) / Math.max(1, values.length - 1));
      const y = yFor(v);
      return `${x},${y}`;
    }).join(' ');

    const mid = Math.round((min + max) / 2);
    const ticks = [Math.round(max), mid, Math.round(min)];
    const gridLines = ticks.map((value) => {
      const y = yFor(value);
      return `
        <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(255,255,255,0.14)" stroke-width="1"></line>
      `;
    }).join('');

    chartEl.innerHTML = `
      <div class="profile-elo-chart-meta">
        <strong>Rating Progression</strong>
        <div class="profile-elo-range-tabs${profileChartCompactLayout ? ' is-compact' : ''}" role="tablist" aria-label="Rating progression range">
          <button class="btn btn-compact${profileChartRange === 'month' ? ' is-selected' : ''}" data-profile-range="month" type="button">Month</button>
          <button class="btn btn-compact${profileChartRange === 'year' ? ' is-selected' : ''}" data-profile-range="year" type="button">Year</button>
          <button class="btn btn-compact${profileChartRange === 'all' ? ' is-selected' : ''}" data-profile-range="all" type="button">All Time</button>
        </div>
      </div>
      <div class="profile-elo-chart-shell">
        <div class="profile-elo-axis" aria-hidden="true">
          <span>${Math.round(max)}</span>
          <span>${Math.round(mid)}</span>
          <span>${Math.round(min)}</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" class="profile-elo-svg" role="img" aria-label="Rating progression chart">
          ${gridLines}
          <polyline points="${points}" fill="none" stroke="rgba(58, 123, 255, 0.95)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
        </svg>
      </div>
    `;
    wireProfileChartRangeButtons();
    updateProfileChartLayout();
  }

  function updateProfileChartLayout() {
    const chartEl = document.getElementById('profile-elo-chart');
    if (!chartEl) return;
    const meta = chartEl.querySelector('.profile-elo-chart-meta');
    const title = meta ? meta.querySelector('strong') : null;
    const tabs = meta ? meta.querySelector('.profile-elo-range-tabs') : null;
    if (!meta || !title || !tabs) return;

    meta.classList.remove('is-compact');
    tabs.classList.remove('is-compact');
    const tabsNaturalWidth = Math.min(360, Math.max(tabs.scrollWidth, tabs.offsetWidth));
    const compact = meta.clientWidth < (title.scrollWidth + tabsNaturalWidth + 28);
    profileChartCompactLayout = compact;
    meta.classList.toggle('is-compact', compact);
    tabs.classList.toggle('is-compact', compact);
  }

  function wireProfileChartRangeButtons() {
    document.querySelectorAll('[data-profile-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextRange = btn.dataset.profileRange;
        if (!nextRange || nextRange === profileChartRange) return;
        profileChartRange = nextRange;
        if (lastProfileForChart) renderProfileChart(lastProfileForChart);
      });
    });
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

    const wrap = document.createElement('div');
    wrap.className = 'page-table-wrap';
    const table = document.createElement('table');
    table.className = 'leaderboard-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Rank', 'Name', 'Rating', 'Record'].forEach((label) => {
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

      const eloCell = document.createElement('td');
      eloCell.textContent = formatElo(row.elo);

      const recordCell = document.createElement('td');
      recordCell.textContent = `${row.wins}-${row.losses}`;

      tr.appendChild(rankCell);
      tr.appendChild(nameCell);
      tr.appendChild(eloCell);
      tr.appendChild(recordCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function renderHistory() {
    const activeProfile = window.HoopState ? window.HoopState.getProfile() : null;
    if (!activeProfile) return;
    const container = document.getElementById('history-list-page');
    if (!container) return;

    container.innerHTML = '';
    if (!activeProfile.signedIn) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'Create an account to track games played.';
      container.appendChild(empty);
      return;
    }

    if (!activeProfile.games.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No saved games yet.';
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'page-table-wrap';
    const table = document.createElement('table');
    table.className = 'leaderboard-table history-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Result', 'Opponent', 'Rating', 'Chain'].forEach((label) => {
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
      opp.textContent = g.opponent;
      opp.className = 'history-opponent';

      const elo = document.createElement('td');
      elo.textContent = g.opponentRank == null ? '-' : String(Math.round(g.opponentRank));

      const chain = document.createElement('td');
      chain.textContent = String(g.chainLength || 0);

      tr.appendChild(wl);
      tr.appendChild(opp);
      tr.appendChild(elo);
      tr.appendChild(chain);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function renderProfile() {
    const activeProfile = window.HoopState ? window.HoopState.getProfile() : null;
    if (!activeProfile) return;
    setText('profile-page-title', activeProfile.signedIn ? activeProfile.username : 'Guest');
    setText('profile-joined', formatJoinedDate(activeProfile.joinedAt));
    if (!activeProfile.signedIn) {
      setText('profile-rank', '-');
      setText('profile-peak-rank', '-');
      setText('profile-wl', '-');
      setText('profile-streak', '-');
      setText('profile-best-win', '-');
      setText('profile-longest-chain', '-');
    } else {
      setText('profile-rank', formatElo(activeProfile.elo));
      setText('profile-peak-rank', formatElo(activeProfile.peakElo));
      setText('profile-wl', `${activeProfile.wins}-${activeProfile.losses}`);
      setText('profile-streak', formatStreak(activeProfile.streak));
      setText('profile-best-win', formatBestWin(activeProfile.bestWin));
      setText('profile-longest-chain', activeProfile.longestChain);
    }
    renderProfileChart(activeProfile);
  }

  window.addEventListener('resize', () => {
    if (page === 'profile' && lastProfileForChart) {
      renderProfileChart(lastProfileForChart);
    }
  });

  function wirePresencePing() {
    if (!window.HoopState || typeof window.HoopState.getClientId !== 'function') return;
    const clientId = window.HoopState.getClientId();
    if (!clientId) return;

    const ping = () => {
      fetch('/api/online/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
      }).catch(() => {});
    };

    const bye = () => {
      try {
        if (navigator && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([JSON.stringify({ clientId })], { type: 'application/json' });
          navigator.sendBeacon('/api/online/bye', blob);
          return;
        }
      } catch (_) {
      }
      fetch('/api/online/bye', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
        keepalive: true
      }).catch(() => {});
    };

    if (presenceTimer) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
    ping();
    presenceTimer = setInterval(ping, 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) ping();
    });
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
  }

  function wireViewportHeight() {
    let stableHeight = window.innerHeight;
    const setVh = () => {
      const inner = Math.max(0, Math.round(window.innerHeight || 0));
      const vv = window.visualViewport
        ? Math.max(0, Math.round((window.visualViewport.height || 0) + (window.visualViewport.offsetTop || 0)))
        : inner;
      const active = document.activeElement;
      const isTyping = Boolean(
        active
        && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      );
      const keyboardLikelyOpen = isTyping && inner - vv > 120;

      if (!keyboardLikelyOpen && inner > 0) {
        stableHeight = inner;
      }
      const h = keyboardLikelyOpen ? stableHeight : Math.max(inner, vv);
      document.documentElement.style.setProperty('--app-vh', `${h}px`);
    };
    window.HoopSetViewportHeight = setVh;
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('pageshow', setVh);
    window.addEventListener('orientationchange', () => setTimeout(setVh, 150));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVh);
      window.visualViewport.addEventListener('scroll', setVh);
    }
    document.addEventListener('focusin', () => {
      setTimeout(setVh, 60);
    });
    document.addEventListener('focusout', () => {
      setTimeout(setVh, 80);
      setTimeout(setVh, 260);
    });
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
      const token = window.HoopState.getToken ? (window.HoopState.getToken() || '') : '';

      matchmakingSocket = io({ auth: { playerId, token } });

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

  function wirePracticeEntry() {
    const btn = document.getElementById('enter-practice-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      window.location.href = 'practice.html';
    });
  }

  function wireLegalFooter() {
    const main = document.querySelector('.main');
    if (!main || main.querySelector('.site-legal-footer')) return;

    const footer = document.createElement('footer');
    footer.className = 'site-legal-footer';
    footer.innerHTML = [
      '<a href="privacy.html">Privacy Policy</a>',
      '<span aria-hidden="true">|</span>',
      '<a href="terms.html">Terms of Service</a>',
      '<span aria-hidden="true">|</span>',
      '<a href="contact.html">Contact</a>',
    ].join('');
    main.appendChild(footer);
  }

  if (page === 'play') renderHome();
  if (page === 'leaderboard') renderLeaderboard();
  if (page === 'history') renderHistory();
  if (page === 'profile') renderProfile();
  if (page === 'signin' || page === 'createaccount') wireSignIn();
  if (page === 'play') wireHomeFindGame();
  if (page === 'play') wirePracticeEntry();
  if (page === 'play' && !document.getElementById('find-game-home-btn')) {
  }
  wireLegalFooter();
  wireSignOut();
})();
