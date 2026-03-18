const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_PROFILE = {
  profileUpdatedAt: 0,
  wins: 0,
  losses: 0,
  streak: 0,
  elo: 1200,
  bestWin: null,
  peakElo: 1200,
  longestChain: 0,
  practiceLongestChain: 0,
  games: []
};

const USERNAME_BLOCKLIST = [
  'admin',
  'anal',
  'balls',
  'anus',
  'arse',
  'ass',
  'asshole',
  'bastard',
  'bitch',
  'boob',
  'boobs',
  'blowjob',
  'boner',
  'booty',
  'bullshit',
  'buttplug',
  'clit',
  'cock',
  'coon',
  'cum',
  'cunt',
  'dick',
  'dildo',
  'ejaculate',
  'dyke',
  'fag',
  'faggot',
  'fellatio',
  'fuck',
  'fck',
  'fuk',
  'fucc',
  'fuq',
  'goddamn',
  'hitler',
  'hell',
  'hentai',
  'jackoff',
  'jizz',
  'kike',
  'kkk',
  'milf',
  'mod',
  'moderator',
  'motherfucker',
  'nazi',
  'nigga',
  'nigger',
  'penis',
  'prick',
  'piss',
  'porn',
  'pussy',
  'rape',
  'rapist',
  'retard',
  'sex',
  'sexy',
  'semen',
  'sex',
  'shitass',
  'shit',
  'shyt',
  'shit',
  'slut',
  'spic',
  'staff',
  'support',
  'suicide',
  'sysop',
  'system',
  'tit',
  'tits',
  'twat',
  'vagina',
  'whore',
  'owner'
];

const USERNAME_ALLOWED_RE = /^[A-Za-z0-9]+$/;
const PASSWORD_ALLOWED_RE = /^[\x20-\x7E]+$/;
const LEETSPEAK_MAP = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '+': 't',
  '|': 'i',
  '€': 'e'
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

function isUsernameFormatAllowed(username) {
  return USERNAME_ALLOWED_RE.test(String(username || ''));
}

function isPasswordFormatAllowed(password) {
  return typeof password === 'string' && PASSWORD_ALLOWED_RE.test(password);
}

function normalizeForModeration(username) {
  return normalizeUsername(username)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('')
    .map((char) => LEETSPEAK_MAP[char] || char)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

function toModerationKey(username) {
  return normalizeForModeration(username);
}

function collapseRepeatedCharacters(text) {
  return String(text || '').replace(/(.)\1+/g, '$1');
}

function isUsernameAllowed(username) {
  const moderationKey = toModerationKey(username);
  if (!moderationKey) return true;
  const collapsedKey = collapseRepeatedCharacters(moderationKey);
  return !USERNAME_BLOCKLIST.some((term) => (
    moderationKey.includes(term) ||
    collapsedKey.includes(term)
  ));
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
  const profileUpdatedAt = Number(src.profileUpdatedAt) || 0;
  return {
    joinedAt: Number(joinedAt) || Date.now(),
    profileUpdatedAt,
    wins: Number(src.wins) || 0,
    losses: Number(src.losses) || 0,
    streak: Number(src.streak) || 0,
    elo: Number(src.elo) || 1200,
    bestWin: src.bestWin == null ? null : Number(src.bestWin) || null,
    peakElo: src.peakElo == null ? (Number(src.elo) || 1200) : Number(src.peakElo) || (Number(src.elo) || 1200),
    longestChain: Number(src.longestChain) || 0,
    practiceLongestChain: Number(src.practiceLongestChain) || 0,
    games: games.map((g) => ({
      at: Number(g && g.at) || Date.now(),
      won: Boolean(g && g.won),
      reason: String((g && g.reason) || 'finished').slice(0, 80),
      opponent: String((g && g.opponent) || 'Unknown').slice(0, 24),
      opponentRank: g && g.opponentRank == null ? null : Number(g && g.opponentRank) || null,
      chainLength: Number(g && g.chainLength) || 0,
      myStrikes: Number(g && g.myStrikes) || 0,
      oppStrikes: Number(g && g.oppStrikes) || 0,
      ranked: Boolean(g && g.ranked),
      eloBefore: Number(g && g.eloBefore),
      eloAfter: Number(g && g.eloAfter),
      eloDelta: Number(g && g.eloDelta)
    }))
  };
}

class AccountStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'accounts.db');
    this.db = null;
    this.tokenSecret = String(
      options.tokenSecret ||
      process.env.HOOPDUELS_TOKEN_SECRET ||
      process.env.AUTH_TOKEN_SECRET ||
      'hoopduels-dev-secret-change-me'
    );
    this.tokenTtlMs = Number(options.tokenTtlMs) > 0 ? Number(options.tokenTtlMs) : 1000 * 60 * 60 * 24 * 365;
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
    if (!isUsernameFormatAllowed(cleanName)) {
      const error = new Error('Username can only use letters and numbers.');
      error.code = 'USERNAME_INVALID';
      throw error;
    }
    if (!isUsernameAllowed(cleanName)) {
      const error = new Error('Username is not allowed.');
      error.code = 'USERNAME_INVALID';
      throw error;
    }
    if (!isPasswordFormatAllowed(password)) {
      const error = new Error('Password can only use standard keyboard characters.');
      error.code = 'PASSWORD_INVALID';
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
    const now = Date.now();
    const payload = `${Number(userId)}.${now + this.tokenTtlMs}`;
    const sig = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  clearSession(_token) {
    // Stateless auth: client-side token removal is sufficient for sign-out.
  }

  getUserByToken(token) {
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

    const row = this.db.prepare(`
      SELECT id, username, normalized_username, created_at, profile_json
      FROM users
      WHERE id = ?
    `).get(userId);
    if (!row) return null;
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
        const elo = Number(parsed.elo) || 1200;
        return {
          userId: u.id,
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
      profileUpdatedAt: profile.profileUpdatedAt,
      wins: profile.wins,
      losses: profile.losses,
      streak: profile.streak,
      elo: profile.elo,
      bestWin: profile.bestWin,
      peakElo: profile.peakElo,
      longestChain: profile.longestChain,
      practiceLongestChain: profile.practiceLongestChain,
      games: profile.games,
      rank
    };
  }

  saveProfileByToken(token, incomingProfile) {
    const user = this.getUserByToken(token);
    if (!user) return null;
    let existingParsed = {};
    try {
      existingParsed = JSON.parse(user.profile_json || '{}');
    } catch (_) {
      existingParsed = {};
    }
    const existingProfile = sanitizeProfileInput(existingParsed, user.created_at);
    const profile = sanitizeProfileInput(incomingProfile, user.created_at);
    const existingUpdatedAt = Number(existingProfile.profileUpdatedAt) || 0;
    const incomingUpdatedAt = Number(profile.profileUpdatedAt) || 0;
    if (incomingUpdatedAt < existingUpdatedAt) {
      return this.getProfileByToken(token);
    }
    this.db.prepare(`
      UPDATE users
      SET profile_json = ?
      WHERE id = ?
    `).run(JSON.stringify(profile), user.id);
    return this.getProfileByToken(token);
  }

  getUserCount() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get();
    return Number((row && row.count) || 0);
  }

}

module.exports = {
  AccountStore,
  isUsernameAllowed,
  isUsernameFormatAllowed,
  isPasswordFormatAllowed,
  normalizeUsername
};
