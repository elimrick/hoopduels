const fs = require('fs');
const path = require('path');

const START_SEASON_END_YEAR = 2000;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'players-2000-present.json');
const CHECKPOINT_PATH = path.join(__dirname, '..', 'data', 'players-build-checkpoint.json');

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nba.com',
  Referer: 'https://www.nba.com/',
  'Accept-Language': 'en-US,en;q=0.9',
  Connection: 'keep-alive'
};

function normalizeName(name) {
  return String(name || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.’]/g, "'");
}

function currentSeasonEndYear() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 10 ? year + 1 : year;
}

function seasonLabel(seasonEndYear) {
  const start = seasonEndYear - 1;
  const end2 = String(seasonEndYear).slice(-2);
  return `${start}-${end2}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    return typeof raw.lastCompletedSeason === 'number' ? raw.lastCompletedSeason : null;
  } catch (_) {
    return null;
  }
}

function writeCheckpoint(seasonEnd) {
  fs.writeFileSync(
    CHECKPOINT_PATH,
    JSON.stringify({ lastCompletedSeason: seasonEnd, at: new Date().toISOString() }, null, 2)
  );
}

function ensurePlayer(store, name) {
  const clean = normalizeName(name);
  if (!clean) return null;
  if (!store.has(clean)) {
    store.set(clean, {
      allStar: false,
      teammates: new Set()
    });
  }
  return clean;
}

function loadExistingPlayers() {
  if (!fs.existsSync(OUTPUT_PATH)) return new Map();

  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    const map = new Map();

    for (const [name, data] of Object.entries(raw)) {
      const key = ensurePlayer(map, name);
      if (!key) continue;
      map.get(key).allStar = Boolean(data && data.allStar);
      for (const teammate of (data && data.teammates) || []) {
        const teammateKey = ensurePlayer(map, teammate);
        if (!teammateKey) continue;
        map.get(key).teammates.add(teammateKey);
      }
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function parseStatsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { headers: [], rows: [] };
  }

  const resultSet = Array.isArray(payload.resultSets)
    ? payload.resultSets[0]
    : payload.resultSet || null;

  if (!resultSet) {
    return { headers: [], rows: [] };
  }

  const headers = Array.isArray(resultSet.headers)
    ? resultSet.headers
    : Array.isArray(resultSet.rowSet && resultSet.rowSet.headers)
      ? resultSet.rowSet.headers
      : [];

  const rows = Array.isArray(resultSet.rowSet)
    ? resultSet.rowSet
    : Array.isArray(resultSet.rows)
      ? resultSet.rows
      : [];

  return { headers, rows };
}

function toRowObjects(headers, rows) {
  if (!headers.length || !rows.length) return [];
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

async function fetchJson(url) {
  const maxRetries = 12;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const response = await fetch(url, { headers: NBA_HEADERS });

    if (response.ok) {
      return response.json();
    }

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const shouldRetry = response.status === 429 || response.status >= 500 || response.status === 403;

    if (!shouldRetry || attempt === maxRetries) {
      const body = await response.text().catch(() => '');
      throw new Error(`Failed to fetch ${url}: ${response.status}${body ? ` ${body.slice(0, 180)}` : ''}`);
    }

    const backoffMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(1000, Math.min(10 * 60 * 1000, retryAfterSeconds * 1000))
      : Math.min(60_000, 2000 * Math.pow(2, attempt));

    const jitterMs = Math.floor(Math.random() * 700);
    const waitMs = backoffMs + jitterMs;
    console.log(`  retry ${attempt + 1}/${maxRetries} for ${url} in ${waitMs}ms (status ${response.status})`);
    await sleep(waitMs);
    attempt += 1;
  }

  throw new Error(`Failed to fetch ${url}`);
}

function linkTeammatesForSeasonRows(playerRows, store) {
  const teamToPlayers = new Map();

  for (const row of playerRows) {
    const name = normalizeName(row.PLAYER_NAME || row.PLAYER || row.PLAYER_FULL_NAME);
    const teamId = String(row.TEAM_ID == null ? '' : row.TEAM_ID).trim();

    if (!name || !teamId || teamId === '0') continue;

    const key = ensurePlayer(store, name);
    if (!key) continue;

    if (!teamToPlayers.has(teamId)) {
      teamToPlayers.set(teamId, new Set());
    }
    teamToPlayers.get(teamId).add(key);
  }

  for (const players of teamToPlayers.values()) {
    const arr = [...players];
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = arr[i];
        const b = arr[j];
        store.get(a).teammates.add(b);
        store.get(b).teammates.add(a);
      }
    }
  }
}

function markAllStars(allStarRows, store) {
  for (const row of allStarRows) {
    const name = normalizeName(row.PLAYER_NAME || row.PLAYER || row.PLAYER_FULL_NAME);
    if (!name) continue;
    const key = ensurePlayer(store, name);
    if (!key) continue;
    store.get(key).allStar = true;
  }
}

function buildLeagueDashUrl({ season, seasonType }) {
  const params = new URLSearchParams({
    College: '',
    Conference: '',
    Country: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    DraftPick: '',
    DraftYear: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: '0',
    LeagueID: '00',
    Location: '',
    MeasureType: 'Base',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'Totals',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: season,
    SeasonSegment: '',
    SeasonType: seasonType,
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
    Weight: ''
  });

  return `https://stats.nba.com/stats/leaguedashplayerstats?${params.toString()}`;
}

function writeOutput(players) {
  const output = {};
  const names = [...players.keys()].sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const data = players.get(name);
    output[name] = {
      allStar: Boolean(data.allStar),
      teammates: [...data.teammates].sort((a, b) => a.localeCompare(b))
    };
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  return names.length;
}

async function build() {
  const endYear = currentSeasonEndYear();
  const checkpoint = readCheckpoint();
  const startYear = checkpoint ? Math.max(START_SEASON_END_YEAR, checkpoint + 1) : START_SEASON_END_YEAR;
  const players = loadExistingPlayers();

  console.log(`Building player graph from ${startYear} to ${endYear} via stats.nba.com...`);
  if (players.size) {
    console.log(`Loaded ${players.size} existing players from ${OUTPUT_PATH}`);
  }

  for (let seasonEnd = startYear; seasonEnd <= endYear; seasonEnd += 1) {
    const season = seasonLabel(seasonEnd);
    const totalsUrl = buildLeagueDashUrl({ season, seasonType: 'Regular Season' });
    const allStarUrl = buildLeagueDashUrl({ season, seasonType: 'All Star' });

    process.stdout.write(`- Season ${seasonEnd} (${season}): regular season... `);
    const regularPayload = await fetchJson(totalsUrl);
    const regular = parseStatsPayload(regularPayload);
    const regularRows = toRowObjects(regular.headers, regular.rows);
    linkTeammatesForSeasonRows(regularRows, players);
    process.stdout.write('ok, all-star... ');

    try {
      const allStarPayload = await fetchJson(allStarUrl);
      const allStar = parseStatsPayload(allStarPayload);
      const allStarRows = toRowObjects(allStar.headers, allStar.rows);
      markAllStars(allStarRows, players);
      process.stdout.write('ok\n');
    } catch (_) {
      process.stdout.write('missing\n');
    }

    writeCheckpoint(seasonEnd);
    const totalPlayers = writeOutput(players);
    process.stdout.write(`  saved (${totalPlayers} players)\n`);
    await sleep(700);
  }

  const finalCount = writeOutput(players);
  console.log(`Wrote ${finalCount} players to ${OUTPUT_PATH}`);
  if (fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
