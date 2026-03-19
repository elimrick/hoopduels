const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’]/g, "'");
}

function normalizeInitialsForDisplay(name) {
  return String(name || '')
    .replace(/(?<=\b[A-Za-z])'(?=[A-Za-z]\b)/g, '.')
    .replace(/\b([A-Za-z]{1,4})'(?=[^A-Za-z]|$)/g, '$1.');
}

function canonicalizeSourceName(name) {
  return normalizeInitialsForDisplay(
    String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[’]/g, "'")
  );
}

function normalizeLooseName(name) {
  return normalizeName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function currentSeasonStartYear() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 10 ? year : year - 1;
}

function formatYearRange(startYear, endYear) {
  if (!Number.isFinite(startYear)) return '';
  if (!Number.isFinite(endYear) || endYear >= currentSeasonStartYear()) {
    return `${startYear}-present`;
  }
  return `${startYear}-${endYear}`;
}

class PlayerStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'players.db');
    this.seedJsonPath = options.seedJsonPath || path.join(process.cwd(), 'data', 'players-2000-present.json');
    this.db = null;
    this.playersByKey = new Map();
    this.teammatesByKey = new Map();
    this.looseKeyIndex = new Map();
    this.loosePreferredKey = new Map();
    this.allStarKeys = [];
  }

  init() {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        all_star INTEGER NOT NULL DEFAULT 0,
        start_year INTEGER,
        end_year INTEGER
      );

      CREATE TABLE IF NOT EXISTS teammate_links (
        player_id INTEGER NOT NULL,
        teammate_id INTEGER NOT NULL,
        PRIMARY KEY(player_id, teammate_id),
        FOREIGN KEY(player_id) REFERENCES players(id),
        FOREIGN KEY(teammate_id) REFERENCES players(id)
      );

      CREATE INDEX IF NOT EXISTS idx_players_normalized_name ON players(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_players_all_star ON players(all_star);
    `);
    try {
      this.db.exec('ALTER TABLE players ADD COLUMN start_year INTEGER;');
    } catch (_) {
    }
    try {
      this.db.exec('ALTER TABLE players ADD COLUMN end_year INTEGER;');
    } catch (_) {
    }

    this.reloadFromJson(this.seedJsonPath);

    this.loadIntoMemory();
  }

  loadIntoMemory() {
    this.playersByKey.clear();
    this.teammatesByKey.clear();
    this.looseKeyIndex.clear();
    this.loosePreferredKey.clear();

    const players = this.db.prepare('SELECT id, name, normalized_name, all_star, start_year, end_year FROM players').all();
    const nameGroups = new Map();
    for (const p of players) {
      const baseName = normalizeInitialsForDisplay(p.name);
      if (!nameGroups.has(baseName)) {
        nameGroups.set(baseName, []);
      }
      nameGroups.get(baseName).push(p);

      this.playersByKey.set(p.normalized_name, {
        id: p.id,
        name: baseName,
        startYear: Number.isFinite(Number(p.start_year)) ? Number(p.start_year) : null,
        endYear: Number.isFinite(Number(p.end_year)) ? Number(p.end_year) : null,
        allStar: Boolean(p.all_star)
      });
      this.teammatesByKey.set(p.normalized_name, new Set());
      this.indexLooseKey(p.normalized_name, p.normalized_name);
      this.indexLooseKey(p.name, p.normalized_name);
    }

    for (const [baseName, group] of nameGroups.entries()) {
      if (group.length < 2) continue;
      for (const player of group) {
        const entry = this.playersByKey.get(player.normalized_name);
        if (!entry) continue;
        const yearRange = formatYearRange(entry.startYear, entry.endYear);
        if (yearRange) {
          entry.name = `${baseName} (${yearRange})`;
          this.indexLooseKey(entry.name, player.normalized_name);
        }
      }
    }

    const links = this.db.prepare(`
      SELECT p1.normalized_name AS player_key, p2.normalized_name AS teammate_key
      FROM teammate_links tl
      JOIN players p1 ON p1.id = tl.player_id
      JOIN players p2 ON p2.id = tl.teammate_id
    `).all();

    for (const link of links) {
      const set = this.teammatesByKey.get(link.player_key);
      if (set) {
        set.add(link.teammate_key);
      }
    }

    for (const [looseKey, keySet] of this.looseKeyIndex.entries()) {
      const candidates = [...keySet];
      if (!candidates.length) continue;

      const preferred = candidates.sort((a, b) => {
        const aDegree = this.teammatesByKey.get(a)?.size || 0;
        const bDegree = this.teammatesByKey.get(b)?.size || 0;
        if (bDegree !== aDegree) return bDegree - aDegree;
        const aName = this.playersByKey.get(a)?.name || a;
        const bName = this.playersByKey.get(b)?.name || b;
        return aName.localeCompare(bName);
      })[0];
      this.loosePreferredKey.set(looseKey, preferred);
    }

    this.allStarKeys = [...this.playersByKey.entries()]
      .filter(([key, player]) => {
        if (!player.allStar) return false;
        const teammates = this.teammatesByKey.get(key);
        return Boolean(teammates && teammates.size > 0);
      })
      .map(([key]) => key);
  }

  indexLooseKey(input, strictKey) {
    const looseKey = normalizeLooseName(input);
    if (!looseKey) return;
    if (!this.looseKeyIndex.has(looseKey)) {
      this.looseKeyIndex.set(looseKey, new Set());
    }
    this.looseKeyIndex.get(looseKey).add(strictKey);
  }

  resolveKey(keyOrName) {
    const strictKey = normalizeName(keyOrName);
    const looseKey = normalizeLooseName(keyOrName);
    if (!looseKey) {
      return strictKey;
    }

    const preferred = this.loosePreferredKey.get(looseKey);
    if (preferred) {
      return preferred;
    }

    if (this.playersByKey.has(strictKey)) {
      return strictKey;
    }

    const candidates = this.looseKeyIndex.get(looseKey);
    if (!candidates || !candidates.size) {
      return strictKey;
    }

    if (candidates.size === 1) {
      return [...candidates][0];
    }

    return [...candidates].sort((a, b) => {
      const aName = this.playersByKey.get(a)?.name || a;
      const bName = this.playersByKey.get(b)?.name || b;
      return aName.localeCompare(bName);
    })[0];
  }

  seedFromJson(seedPath) {
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed file not found: ${seedPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const mergedPlayers = new Map();

    for (const [rawName, data] of Object.entries(raw)) {
      const canonicalName = canonicalizeSourceName(rawName);
      if (!canonicalName) continue;

      if (!mergedPlayers.has(canonicalName)) {
        mergedPlayers.set(canonicalName, {
          allStar: false,
          teammates: new Set(),
          startYear: null,
          endYear: null
        });
      }

      const merged = mergedPlayers.get(canonicalName);
      if (data && data.allStar) {
        merged.allStar = true;
      }
      if (Number.isFinite(Number(data && data.startYear))) {
        merged.startYear = merged.startYear == null
          ? Number(data.startYear)
          : Math.min(merged.startYear, Number(data.startYear));
      }
      if (Number.isFinite(Number(data && data.endYear))) {
        merged.endYear = merged.endYear == null
          ? Number(data.endYear)
          : Math.max(merged.endYear, Number(data.endYear));
      }
    }

    for (const [rawName, data] of Object.entries(raw)) {
      const canonicalName = canonicalizeSourceName(rawName);
      const merged = mergedPlayers.get(canonicalName);
      if (!merged) continue;

      for (const teammateName of data.teammates || []) {
        const canonicalTeammate = canonicalizeSourceName(teammateName);
        if (!canonicalTeammate || canonicalTeammate === canonicalName) continue;
        merged.teammates.add(canonicalTeammate);
      }
    }

    const insertPlayer = this.db.prepare(`
      INSERT INTO players (name, normalized_name, all_star, start_year, end_year)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        name = excluded.name,
        all_star = excluded.all_star,
        start_year = excluded.start_year,
        end_year = excluded.end_year
    `);

    const findPlayerId = this.db.prepare('SELECT id FROM players WHERE normalized_name = ?');
    const insertEdge = this.db.prepare(`
      INSERT OR IGNORE INTO teammate_links (player_id, teammate_id)
      VALUES (?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      for (const [name, data] of mergedPlayers.entries()) {
        insertPlayer.run(
          name,
          normalizeName(name),
          data.allStar ? 1 : 0,
          Number.isFinite(data.startYear) ? data.startYear : null,
          Number.isFinite(data.endYear) ? data.endYear : null
        );
      }

      for (const [name, data] of mergedPlayers.entries()) {
        const aKey = normalizeName(name);
        const aRow = findPlayerId.get(aKey);
        if (!aRow) continue;

        for (const teammateName of data.teammates) {
          const bKey = normalizeName(teammateName);
          const bRow = findPlayerId.get(bKey);
          if (!bRow) continue;

          insertEdge.run(aRow.id, bRow.id);
          insertEdge.run(bRow.id, aRow.id);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  reloadFromJson(seedPath = this.seedJsonPath) {
    this.db.exec('DELETE FROM teammate_links;');
    this.db.exec('DELETE FROM players;');
    this.seedFromJson(seedPath);
    this.loadIntoMemory();
  }

  getRandomAllStarKey() {
    if (!this.allStarKeys.length) {
      throw new Error('No all-star players available in database.');
    }
    return this.allStarKeys[Math.floor(Math.random() * this.allStarKeys.length)];
  }

  hasPlayer(keyOrName) {
    const key = this.resolveKey(keyOrName);
    return this.playersByKey.has(key);
  }

  getPlayerByKey(keyOrName) {
    const key = this.resolveKey(keyOrName);
    return this.playersByKey.get(key) || null;
  }

  getName(keyOrName) {
    const player = this.getPlayerByKey(keyOrName);
    return player ? player.name : null;
  }

  areTeammates(aKeyOrName, bKeyOrName) {
    const aKey = this.resolveKey(aKeyOrName);
    const bKey = this.resolveKey(bKeyOrName);
    const set = this.teammatesByKey.get(aKey);
    return Boolean(set && set.has(bKey));
  }

  getTeammateKeys(keyOrName) {
    const key = this.resolveKey(keyOrName);
    const set = this.teammatesByKey.get(key);
    return set ? [...set] : [];
  }

  getTeammateNames(keyOrName) {
    return this.getTeammateKeys(keyOrName)
      .map((k) => this.getName(k))
      .filter(Boolean);
  }

  getAllPlayerNames() {
    return [...this.playersByKey.values()]
      .map((player) => player.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  toKey(name) {
    return this.resolveKey(name);
  }

  getCounts() {
    return {
      players: this.playersByKey.size,
      allStars: this.allStarKeys.length
    };
  }
}

module.exports = {
  PlayerStore,
  normalizeName
};
