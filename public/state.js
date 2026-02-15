(function initHoopState() {
  const TOKEN_KEY = 'hoopduels_auth_token_v1';
  const CLIENT_ID_KEY = 'hoopduels_client_id_v1';
  const GUEST_PROFILE_KEY = 'hoopduels_guest_profile_v1';
  const LEADERBOARD_CACHE_KEY = 'hoopduels_leaderboard_cache_v1';
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
      bestWin: null,
      peakRank: null,
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

  const runtime = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    profile: (() => {
      const guest = readJson(GUEST_PROFILE_KEY, null);
      if (guest) {
        return {
          ...defaultProfile(GUEST_USERNAME, false),
          ...guest,
          signedIn: false,
          username: GUEST_USERNAME,
          joinedAt: null,
          games: Array.isArray(guest.games) ? guest.games : []
        };
      }
      return defaultProfile(GUEST_USERNAME, false);
    })(),
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
        : undefined
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

    if (!signedIn) {
      writeJson(GUEST_PROFILE_KEY, runtime.profile);
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
  }

  async function init() {
    if (runtime.token) {
      try {
        const payload = await api('/api/account/profile');
        applyProfile(payload.profile, true);
      } catch (_) {
        runtime.token = null;
        localStorage.removeItem(TOKEN_KEY);
        applyProfile(readJson(GUEST_PROFILE_KEY, defaultProfile(GUEST_USERNAME, false)), false);
      }
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
    applyProfile(readJson(GUEST_PROFILE_KEY, defaultProfile(GUEST_USERNAME, false)), false);
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

  function getOpponentRankFromLeaderboard(opponentName) {
    const key = toNameKey(opponentName);
    const row = (runtime.leaderboard || []).find((r) => toNameKey(r.username) === key);
    return row ? row.rank : null;
  }

  async function syncSignedInProfile() {
    if (!runtime.profile.signedIn || !runtime.token) return;
    try {
      const payload = await api('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: { profile: runtime.profile }
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
    const opponentRank = getOpponentRankFromLeaderboard(opponent);

    applyStreak(profile, won);

    if (won && opponentRank != null) {
      profile.bestWin = profile.bestWin == null
        ? opponentRank
        : Math.max(profile.bestWin, opponentRank);
    }

    profile.longestChain = Math.max(profile.longestChain, chainLength);

    profile.games.unshift({
      at: Date.now(),
      won,
      reason: result && result.reason ? String(result.reason) : 'finished',
      opponent,
      opponentRank,
      chainLength,
      myStrikes: Number(result && result.myStrikes) || 0,
      oppStrikes: Number(result && result.oppStrikes) || 0
    });

    if (profile.games.length > 100) {
      profile.games = profile.games.slice(0, 100);
    }

    const myRow = (runtime.leaderboard || []).find((r) => toNameKey(r.username) === toNameKey(profile.username));
    if (myRow && Number(myRow.rank)) {
      const rankNow = Number(myRow.rank);
      profile.rank = rankNow;
      profile.peakRank = profile.peakRank == null ? rankNow : Math.min(profile.peakRank, rankNow);
    }

    if (!profile.signedIn) {
      writeJson(GUEST_PROFILE_KEY, profile);
    }

    emitUpdated();
    syncSignedInProfile();
    return getProfile();
  }

  function saveProfile(profilePatch) {
    Object.assign(runtime.profile, profilePatch || {});
    if (!runtime.profile.signedIn) {
      writeJson(GUEST_PROFILE_KEY, runtime.profile);
    } else {
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
    getLeaderboardRows
  };
})();
