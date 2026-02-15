(function initHoopState() {
  const TOKEN_KEY = 'hoopduels_auth_token_v1';
  const CLIENT_ID_KEY = 'hoopduels_client_id_v1';
  const LEGACY_GUEST_PROFILE_KEY = 'hoopduels_guest_profile_v1';
  const LEADERBOARD_CACHE_KEY = 'hoopduels_leaderboard_cache_v1';
  const PROFILE_CACHE_KEY = 'hoopduels_profile_cache_v1';
  const GUEST_USERNAME = 'Guest';

  function normalizeName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 24);
  }

  function toNameKey(name) {
    return normalizeName(name).toLowerCase();
  }

  function defaultProfile(username = GUEST_USERNAME, signedIn = false) {
    return {
      signedIn,
      username,
      joinedAt: signedIn ? Date.now() : null,
      rank: null,
      wins: 0,
      losses: 0,
      streak: 0,
      elo: 1200,
      bestWin: null,
      peakElo: 1200,
      longestChain: 0,
      games: []
    };
  }

  function readJson(storageKey, fallback) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(storageKey, value) {
    localStorage.setItem(storageKey, JSON.stringify(value));
  }

  function cacheProfileIfSignedIn() {
    if (runtime.profile && runtime.profile.signedIn) {
      writeJson(PROFILE_CACHE_KEY, runtime.profile);
    }
  }

  const runtime = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    profile: defaultProfile(GUEST_USERNAME, false),
    leaderboard: (() => {
      const cached = readJson(LEADERBOARD_CACHE_KEY, []);
      return Array.isArray(cached) ? cached : [];
    })()
  };

  function emitUpdated() {
    window.dispatchEvent(new CustomEvent('hoopstate:updated'));
  }

  function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    if (runtime.token) {
      headers.Authorization = `Bearer ${runtime.token}`;
    }
    return headers;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: getAuthHeaders(options.headers || {}),
      body: options.body
        ? JSON.stringify(options.body)
        : undefined,
      keepalive: Boolean(options.keepalive)
    });

    if (!response.ok) {
      let message = 'Request failed.';
      try {
        const payload = await response.json();
        message = payload && payload.error ? payload.error : message;
      } catch (_) {
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  function applyProfile(profile, signedIn) {
    runtime.profile = {
      ...defaultProfile(signedIn ? profile.username : GUEST_USERNAME, signedIn),
      ...(profile || {}),
      signedIn,
      username: signedIn ? normalizeName(profile.username) : GUEST_USERNAME,
      games: Array.isArray(profile && profile.games) ? profile.games : []
    };

    if (signedIn) {
      // Cache last-known profile so transient network issues don't "log out" the user.
      writeJson(PROFILE_CACHE_KEY, runtime.profile);
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  }

  function getProfile() {
    return { ...runtime.profile, games: [...runtime.profile.games] };
  }

  function getLeaderboardRows() {
    const meKey = toNameKey(runtime.profile.username);
    return (runtime.leaderboard || []).map((row) => ({
      ...row,
      isYou: toNameKey(row.username) === meKey && runtime.profile.signedIn
    }));
  }

  function getClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  async function refreshLeaderboard() {
    try {
      const payload = await api('/api/leaderboard');
      runtime.leaderboard = Array.isArray(payload && payload.leaderboard) ? payload.leaderboard : [];
      writeJson(LEADERBOARD_CACHE_KEY, runtime.leaderboard);
    } catch (_) {
      // Keep last known leaderboard if fetch fails (e.g. cold start/network hiccup).
      const cached = readJson(LEADERBOARD_CACHE_KEY, runtime.leaderboard);
      runtime.leaderboard = Array.isArray(cached) ? cached : runtime.leaderboard;
    }
    emitUpdated();
  }

  async function init() {
    // Ensure guest sessions always start from a blank/default profile.
    localStorage.removeItem(LEGACY_GUEST_PROFILE_KEY);

    if (runtime.token) {
      try {
        const payload = await api('/api/account/profile');
        const cached = readJson(PROFILE_CACHE_KEY, null);
        const serverProfile = payload.profile;

        const latestAt = (p) => {
          const g = p && Array.isArray(p.games) ? p.games[0] : null;
          return g && Number.isFinite(Number(g.at)) ? Number(g.at) : 0;
        };

        // If server is behind (common right after a game ends), keep the newer local cached profile.
        if (cached && typeof cached === 'object' && cached.username) {
          const cachedAt = latestAt(cached);
          const serverAt = latestAt(serverProfile);
          if (cachedAt > serverAt) {
            applyProfile(cached, true);
          } else {
            applyProfile(serverProfile, true);
          }
        } else {
          applyProfile(serverProfile, true);
        }
      } catch (error) {
        // Only clear token on explicit auth failure.
        const status = error && error.status ? Number(error.status) : 0;
        if (status === 401) {
          runtime.token = null;
          localStorage.removeItem(TOKEN_KEY);
          applyProfile(defaultProfile(GUEST_USERNAME, false), false);
        } else {
          const cached = readJson(PROFILE_CACHE_KEY, null);
          if (cached && typeof cached === 'object' && cached.username) {
            applyProfile(cached, true);
          }
          // Keep token; user stays signed in.
        }
      }
    } else {
      applyProfile(defaultProfile(GUEST_USERNAME, false), false);
    }

    await refreshLeaderboard();
    emitUpdated();
    return getProfile();
  }

  function applyAuthResult(payload) {
    runtime.token = payload.token;
    localStorage.setItem(TOKEN_KEY, runtime.token);
    applyProfile(payload.profile, true);
    runtime.leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : runtime.leaderboard;
    emitUpdated();
    return getProfile();
  }

  async function signUp(username, password) {
    const cleanName = normalizeName(username);
    const payload = await api('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: cleanName, password: String(password || '') }
    });
    return applyAuthResult(payload);
  }

  async function signIn(username, password) {
    const cleanName = normalizeName(username);
    const payload = await api('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: cleanName, password: String(password || '') }
    });
    return applyAuthResult(payload);
  }

  async function signOut() {
    try {
      if (runtime.token) {
        await api('/api/auth/signout', { method: 'POST' });
      }
    } catch (_) {
    }

    runtime.token = null;
    localStorage.removeItem(TOKEN_KEY);
    applyProfile(defaultProfile(GUEST_USERNAME, false), false);
    await refreshLeaderboard();
    emitUpdated();
    return getProfile();
  }

  function applyStreak(profile, won) {
    if (won) {
      profile.streak = profile.streak >= 0 ? profile.streak + 1 : 1;
      profile.wins += 1;
    } else {
      profile.streak = profile.streak <= 0 ? profile.streak - 1 : -1;
      profile.losses += 1;
    }
  }

  function getOpponentEloFromLeaderboard(opponentName) {
    const key = toNameKey(opponentName);
    const row = (runtime.leaderboard || []).find((r) => toNameKey(r.username) === key);
    return row ? (Number(row.elo) || null) : null;
  }

  function isGuestLikeName(name) {
    const normalized = toNameKey(name);
    return normalized === 'guest' || normalized.startsWith('player-');
  }

  async function syncSignedInProfile() {
    if (!runtime.profile.signedIn || !runtime.token) return;
    try {
      const payload = await api('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: { profile: runtime.profile },
        keepalive: true
      });
      if (payload && payload.profile) {
        applyProfile(payload.profile, true);
      }
      if (payload && Array.isArray(payload.leaderboard)) {
        runtime.leaderboard = payload.leaderboard;
      } else {
        await refreshLeaderboard();
      }
      emitUpdated();
    } catch (_) {
    }
  }

  function recordGame(result) {
    const profile = runtime.profile;
    const won = Boolean(result && result.won);
    const chainLength = Number(result && result.chainLength) || 0;
    const opponent = normalizeName(result && result.opponent ? String(result.opponent) : 'Unknown') || 'Unknown';
    const opponentElo = getOpponentEloFromLeaderboard(opponent);
    const rankedGame = Boolean(
      profile.signedIn
      && !isGuestLikeName(opponent)
      && opponentElo != null
      && Number.isFinite(opponentElo)
    );

    applyStreak(profile, won);

    if (won && rankedGame) {
      profile.bestWin = profile.bestWin == null
        ? opponentElo
        : Math.max(profile.bestWin, opponentElo);
    }

    profile.longestChain = Math.max(profile.longestChain, chainLength);
    const myEloBefore = Number(profile.elo) || 1200;
    let myEloAfter = myEloBefore;
    if (rankedGame) {
      const oppElo = opponentElo;
      const expected = 1 / (1 + Math.pow(10, (oppElo - myEloBefore) / 400));
      const actual = won ? 1 : 0;
      myEloAfter = Math.round(myEloBefore + 32 * (actual - expected));
    }
    profile.elo = myEloAfter;
    profile.peakElo = Math.max(Number(profile.peakElo) || myEloAfter, myEloAfter);
    const eloDelta = myEloAfter - myEloBefore;

    profile.games.unshift({
      at: Date.now(),
      won,
      reason: result && result.reason ? String(result.reason) : 'finished',
      opponent,
      opponentRank: opponentElo,
      chainLength,
      myStrikes: Number(result && result.myStrikes) || 0,
      oppStrikes: Number(result && result.oppStrikes) || 0,
      ranked: rankedGame,
      eloBefore: myEloBefore,
      eloAfter: myEloAfter,
      eloDelta
    });

    if (profile.games.length > 100) {
      profile.games = profile.games.slice(0, 100);
    }

    const myRow = (runtime.leaderboard || []).find((r) => toNameKey(r.username) === toNameKey(profile.username));
    if (myRow && Number(myRow.rank)) {
      profile.rank = Number(myRow.rank);
    }

    cacheProfileIfSignedIn();
    emitUpdated();
    syncSignedInProfile();
    return getProfile();
  }

  function saveProfile(profilePatch) {
    Object.assign(runtime.profile, profilePatch || {});
    cacheProfileIfSignedIn();
    if (runtime.profile.signedIn) {
      syncSignedInProfile();
    }
    emitUpdated();
    return getProfile();
  }

  window.HoopState = {
    init,
    getProfile,
    saveProfile,
    getClientId,
    signUp,
    signIn,
    signOut,
    recordGame,
    getLeaderboardRows,
    refreshLeaderboard
  };
})();
