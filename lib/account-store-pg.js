const crypto = require('crypto');
const { Pool } = require('pg');
const { normalizeUsername } = require('./account-store');

const DEFAULT_PROFILE = {
  wins: 0,
  losses: 0,
  streak: 0,
  elo: 1200,
  bestWin: null,
  peakElo: 1200,
  longestChain: 0,
  games: []
};

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
    elo: Number(src.elo) || 1200,
    bestWin: src.bestWin == null ? null : Number(src.bestWin) || null,
    peakElo: src.peakElo == null ? (Number(src.elo) || 1200) : Number(src.peakElo) || (Number(src.elo) || 1200),
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

class AccountStorePg {
  constructor(options = {}) {
    this.pool = new Pool({
      connectionString: options.connectionString || process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
    this.tokenSecret = String(
      options.tokenSecret ||
      process.env.HOOPDUELS_TOKEN_SECRET ||
      process.env.AUTH_TOKEN_SECRET ||
      'hoopduels-dev-secret-change-me'
    );
    this.tokenTtlMs = Number(options.tokenTtlMs) > 0 ? Number(options.tokenTtlMs) : 1000 * 60 * 60 * 24 * 365;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        profile_json JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username);
    `);
  }

  async createUser(username, password) {
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

    const existing = await this.pool.query(
      'SELECT id FROM users WHERE normalized_username = $1 LIMIT 1',
      [key]
    );
    if (existing.rowCount) {
      const error = new Error('Username is already taken.');
      error.code = 'USERNAME_TAKEN';
      throw error;
    }

    const now = Date.now();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const profile = sanitizeProfileInput(DEFAULT_PROFILE, now);

    const inserted = await this.pool.query(
      `INSERT INTO users (username, normalized_username, password_salt, password_hash, created_at, profile_json)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [cleanName, key, salt, passwordHash, now, profile]
    );
    return Number(inserted.rows[0].id);
  }

  async verifyUser(username, password) {
    const cleanName = normalizeUsername(username);
    const key = toUserKey(cleanName);
    const result = await this.pool.query(
      `SELECT id, password_salt, password_hash
       FROM users
       WHERE normalized_username = $1
       LIMIT 1`,
      [key]
    );
    if (!result.rowCount) return null;

    const row = result.rows[0];
    const actual = hashPassword(password, row.password_salt);
    const match = crypto.timingSafeEqual(
      Buffer.from(actual, 'hex'),
      Buffer.from(row.password_hash, 'hex')
    );
    return match ? Number(row.id) : null;
  }

  createSession(userId) {
    const now = Date.now();
    const payload = `${Number(userId)}.${now + this.tokenTtlMs}`;
    const sig = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  clearSession(_token) {
  }

  async getUserByToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [userIdRaw, expRaw, sig] = parts;
    const userId = Number(userIdRaw);
    const exp = Number(expRaw);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!Number.isFinite(exp) || exp < Date.now()) return null;

    const payload = `${userIdRaw}.${expRaw}`;
    const expected = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    if (sig !== expected) return null;

    const result = await this.pool.query(
      `SELECT id, username, normalized_username, created_at, profile_json
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    if (!result.rowCount) return null;
    return result.rows[0];
  }

  async getLeaderboardRows(currentUserId = null) {
    const result = await this.pool.query(
      `SELECT id, username, normalized_username, profile_json
       FROM users`
    );

    const rows = result.rows
      .map((u) => {
        const parsed = typeof u.profile_json === 'string'
          ? JSON.parse(u.profile_json || '{}')
          : (u.profile_json || {});
        const wins = Number(parsed.wins) || 0;
        const losses = Number(parsed.losses) || 0;
        const elo = Number(parsed.elo) || 1200;
        return {
          userId: Number(u.id),
          username: u.username,
          key: u.normalized_username,
          wins,
          losses,
          elo,
          longestChain: Number(parsed.longestChain) || 0,
          peakElo: parsed.peakElo == null ? elo : Number(parsed.peakElo) || elo,
          gamesPlayed: wins + losses
        };
      })
      .sort((a, b) => {
        if (b.elo !== a.elo) return b.elo - a.elo;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        if (b.longestChain !== a.longestChain) return b.longestChain - a.longestChain;
        return a.username.localeCompare(b.username);
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        isYou: currentUserId != null && row.userId === Number(currentUserId)
      }));

    return rows;
  }

  async getProfileByToken(token) {
    const user = await this.getUserByToken(token);
    if (!user) return null;

    const parsed = typeof user.profile_json === 'string'
      ? JSON.parse(user.profile_json || '{}')
      : (user.profile_json || {});
    const profile = sanitizeProfileInput(parsed, user.created_at);
    const rows = await this.getLeaderboardRows(Number(user.id));
    const row = rows.find((r) => r.userId === Number(user.id)) || null;
    const rank = row ? row.rank : null;

    return {
      signedIn: true,
      username: user.username,
      joinedAt: profile.joinedAt || Number(user.created_at),
      wins: profile.wins,
      losses: profile.losses,
      streak: profile.streak,
      elo: profile.elo,
      bestWin: profile.bestWin,
      peakElo: profile.peakElo,
      longestChain: profile.longestChain,
      games: profile.games,
      rank
    };
  }

  async saveProfileByToken(token, incomingProfile) {
    const user = await this.getUserByToken(token);
    if (!user) return null;
    const profile = sanitizeProfileInput(incomingProfile, user.created_at);
    await this.pool.query(
      `UPDATE users SET profile_json = $1 WHERE id = $2`,
      [profile, Number(user.id)]
    );
    return this.getProfileByToken(token);
  }

  async getUserCount() {
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM users');
    return Number((result.rows[0] && result.rows[0].count) || 0);
  }
}

module.exports = {
  AccountStorePg
};
