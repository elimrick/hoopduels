const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_PROFILE = {
  wins: 0,
  losses: 0,
  streak: 0,
  bestWin: null,
  peakRank: null,
  longestChain: 0,
  games: []
};

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function toUserKey(username) {
  return normalizeUsername(username).toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 4 && password.length <= 72;
}

function sanitizeProfileInput(input, joinedAt) {
  const src = input && typeof input === 'object' ? input : {};
  const games = Array.isArray(src.games) ? src.games.slice(0, 100) : [];
  return {
    joinedAt: Number(joinedAt) || Date.now(),
    wins: Number(src.wins) || 0,
    losses: Number(src.losses) || 0,
    streak: Number(src.streak) || 0,
    bestWin: src.bestWin == null ? null : Number(src.bestWin) || null,
    peakRank: src.peakRank == null ? null : Number(src.peakRank) || null,
    longestChain: Number(src.longestChain) || 0,
    games: games.map((g) => ({
      at: Number(g && g.at) || Date.now(),
      won: Boolean(g && g.won),
      reason: String((g && g.reason) || 'finished').slice(0, 80),
      opponent: String((g && g.opponent) || 'Unknown').slice(0, 24),
      opponentRank: g && g.opponentRank == null ? null : Number(g && g.opponentRank) || null,
      chainLength: Number(g && g.chainLength) || 0,
      myStrikes: Number(g && g.myStrikes) || 0,
      oppStrikes: Number(g && g.oppStrikes) || 0
    }))
  };
}

class AccountStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'accounts.db');
    this.db = null;
  }

  init() {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        profile_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);
  }

  createUser(username, password) {
    const cleanName = normalizeUsername(username);
    const key = toUserKey(cleanName);
    if (cleanName.length < 2) {
      const error = new Error('Username must be at least 2 characters.');
      error.code = 'USERNAME_INVALID';
      throw error;
    }
    if (!isStrongEnoughPassword(password)) {
      const error = new Error('Password must be 4-72 characters.');
      error.code = 'PASSWORD_INVALID';
      throw error;
    }

    const existing = this.db.prepare(
      'SELECT id FROM users WHERE normalized_username = ?'
    ).get(key);
    if (existing) {
      const error = new Error('Username is already taken.');
      error.code = 'USERNAME_TAKEN';
      throw error;
    }

    const now = Date.now();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const profile = sanitizeProfileInput(DEFAULT_PROFILE, now);

    const result = this.db.prepare(`
      INSERT INTO users (username, normalized_username, password_salt, password_hash, created_at, profile_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      cleanName,
      key,
      salt,
      passwordHash,
      now,
      JSON.stringify(profile)
    );

    return Number(result.lastInsertRowid);
  }

  verifyUser(username, password) {
    const cleanName = normalizeUsername(username);
    const key = toUserKey(cleanName);
    const row = this.db.prepare(`
      SELECT id, password_salt, password_hash
      FROM users
      WHERE normalized_username = ?
    `).get(key);
    if (!row) return null;

    const actual = hashPassword(password, row.password_salt);
    const match = crypto.timingSafeEqual(
      Buffer.from(actual, 'hex'),
      Buffer.from(row.password_hash, 'hex')
    );
    return match ? row.id : null;
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (token, user_id, created_at, last_seen_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, now, now);
    return token;
  }

  clearSession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  getUserByToken(token) {
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT u.id, u.username, u.normalized_username, u.created_at, u.profile_json
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token);
    if (!row) return null;
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(Date.now(), token);
    return row;
  }

  getLeaderboardRows(currentUserId = null) {
    const users = this.db.prepare(`
      SELECT id, username, normalized_username, profile_json
      FROM users
    `).all();

    const rows = users
      .map((u) => {
        let parsed = {};
        try {
          parsed = JSON.parse(u.profile_json || '{}');
        } catch (_) {
          parsed = {};
        }
        const wins = Number(parsed.wins) || 0;
        const losses = Number(parsed.losses) || 0;
        return {
          userId: u.id,
          username: u.username,
          key: u.normalized_username,
          wins,
          losses,
          longestChain: Number(parsed.longestChain) || 0,
          peakRank: parsed.peakRank == null ? null : Number(parsed.peakRank) || null,
          gamesPlayed: wins + losses
        };
      })
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        if (b.longestChain !== a.longestChain) return b.longestChain - a.longestChain;
        return a.username.localeCompare(b.username);
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        isYou: currentUserId != null && row.userId === currentUserId
      }));

    return rows;
  }

  getProfileByToken(token) {
    const user = this.getUserByToken(token);
    if (!user) return null;

    let parsed = {};
    try {
      parsed = JSON.parse(user.profile_json || '{}');
    } catch (_) {
      parsed = {};
    }
    const profile = sanitizeProfileInput(parsed, user.created_at);

    const rows = this.getLeaderboardRows(user.id);
    const row = rows.find((r) => r.userId === user.id) || null;
    const rank = row ? row.rank : null;

    return {
      signedIn: true,
      username: user.username,
      joinedAt: profile.joinedAt || user.created_at,
      wins: profile.wins,
      losses: profile.losses,
      streak: profile.streak,
      bestWin: profile.bestWin,
      peakRank: profile.peakRank,
      longestChain: profile.longestChain,
      games: profile.games,
      rank
    };
  }

  saveProfileByToken(token, incomingProfile) {
    const user = this.getUserByToken(token);
    if (!user) return null;
    const profile = sanitizeProfileInput(incomingProfile, user.created_at);
    this.db.prepare(`
      UPDATE users
      SET profile_json = ?
      WHERE id = ?
    `).run(JSON.stringify(profile), user.id);
    return this.getProfileByToken(token);
  }

}

module.exports = {
  AccountStore,
  normalizeUsername
};
