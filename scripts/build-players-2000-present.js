const fs = require('fs');
const path = require('path');

const START_SEASON_END_YEAR = 1977;
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
    .replace(/[’]/g, "'");
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
    enforceGraphIntegrity(map);
    return map;
  } catch (_) {
    return new Map();
  }
}

function enforceGraphIntegrity(store) {
  for (const [name, data] of store.entries()) {
    if (!data || !data.teammates) continue;
    if (data.teammates.has(name)) {
      data.teammates.delete(name);
    }
    for (const teammate of [...data.teammates]) {
      if (!store.has(teammate)) {
        data.teammates.delete(teammate);
        continue;
      }
      const teammateSet = store.get(teammate).teammates;
      if (!teammateSet.has(name)) {
        teammateSet.add(name);
      }
    }
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

async function fetchJson(url, options = {}) {
  const maxRetries = Number.isFinite(Number(options.maxRetries)) ? Number(options.maxRetries) : 12;
  const maxBackoffMs = Number.isFinite(Number(options.maxBackoffMs)) ? Number(options.maxBackoffMs) : 60_000;
  let attempt = 0;
  const requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs)) ? Number(options.requestTimeoutMs) : 20_000;

  while (attempt <= maxRetries) {
    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        response = await fetch(url, {
          headers: NBA_HEADERS,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Failed to fetch ${url}: ${error && error.message ? error.message : 'network error'}`);
      }
      const backoffMs = Math.min(maxBackoffMs, 2000 * Math.pow(2, attempt));
      const jitterMs = Math.floor(Math.random() * 700);
      const waitMs = backoffMs + jitterMs;
      console.log(`  retry ${attempt + 1}/${maxRetries} for ${url} in ${waitMs}ms (network error)`);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

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
      : Math.min(maxBackoffMs, 2000 * Math.pow(2, attempt));

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
    const gp = Number(row.GP);
    if (!Number.isFinite(gp) || gp <= 0) continue;
    const name = normalizeName(row.PLAYER_NAME || row.PLAYER || row.PLAYER_FULL_NAME);
    if (!name) continue;
    const key = ensurePlayer(store, name);
    if (!key) continue;
    store.get(key).allStar = true;
  }
}

function buildTeamDashUrl({ season }) {
  const params = new URLSearchParams({
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
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
    PlusMinus: 'N',
    Rank: 'N',
    Season: season,
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: ''
  });

  return `https://stats.nba.com/stats/leaguedashteamstats?${params.toString()}`;
}

function buildTeamRosterUrl({ season, teamId }) {
  const params = new URLSearchParams({
    LeagueID: '00',
    Season: season,
    TeamID: String(teamId)
  });
  return `https://stats.nba.com/stats/commonteamroster?${params.toString()}`;
}

function parseTeamIdsFromDash(payload) {
  const parsed = parseStatsPayload(payload);
  const rows = toRowObjects(parsed.headers, parsed.rows);
  const ids = [];
  for (const row of rows) {
    const raw = row.TEAM_ID;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) {
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function parseRosterPlayers(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const sets = Array.isArray(payload.resultSets) ? payload.resultSets : [];
  if (!sets.length) return [];

  const rosterSet = sets.find((s) => {
    const name = String((s && s.name) || '').toLowerCase();
    return name.includes('commonteamroster') || name.includes('roster');
  }) || sets[0];

  const headers = Array.isArray(rosterSet.headers) ? rosterSet.headers : [];
  const rows = Array.isArray(rosterSet.rowSet) ? rosterSet.rowSet : [];
  return toRowObjects(headers, rows)
    .map((row) => normalizeName(row.PLAYER || row.PLAYER_NAME || row.PLAYER_FULL_NAME))
    .filter(Boolean);
}

function linkRosterTeammates(rosterNames, store) {
  const keys = rosterNames
    .map((name) => ensurePlayer(store, name))
    .filter(Boolean);
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      store.get(a).teammates.add(b);
      store.get(b).teammates.add(a);
    }
  }
}

function buildLeagueDashUrl({ season, seasonType, teamId = '0' }) {
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
    TeamID: String(teamId),
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
    Weight: ''
  });

  return `https://stats.nba.com/stats/leaguedashplayerstats?${params.toString()}`;
}

function writeOutput(players) {
  enforceGraphIntegrity(players);
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
  const autoEndYear = currentSeasonEndYear();
  const endYear = Number(process.env.BUILD_END_SEASON_END_YEAR || autoEndYear);
  const forcedStartYearRaw = process.env.BUILD_START_SEASON_END_YEAR;
  const forcedStartYear = Number.isFinite(Number(forcedStartYearRaw))
    ? Number(forcedStartYearRaw)
    : null;
  const checkpoint = readCheckpoint();
  const startYear = forcedStartYear != null
    ? Math.max(START_SEASON_END_YEAR, forcedStartYear)
    : checkpoint
      ? Math.max(START_SEASON_END_YEAR, checkpoint + 1)
      : START_SEASON_END_YEAR;
  const players = loadExistingPlayers();
  const rosterStartSeasonEnd = Number(process.env.ROSTER_START_SEASON_END || START_SEASON_END_YEAR);
  const rosterEndSeasonEnd = Number(process.env.ROSTER_END_SEASON_END || endYear);
  const rosterMaxRetries = Number(process.env.ROSTER_MAX_RETRIES || 3);
  const rosterTimeoutMs = Number(process.env.ROSTER_TIMEOUT_MS || 12_000);
  const rosterMaxBackoffMs = Number(process.env.ROSTER_MAX_BACKOFF_MS || 8_000);
  const rosterTeamPauseMs = Number(process.env.ROSTER_TEAM_PAUSE_MS || 120);
  const globalMaxRetries = Number(process.env.GLOBAL_MAX_RETRIES || 12);
  const globalTimeoutMs = Number(process.env.GLOBAL_TIMEOUT_MS || 20_000);
  const globalMaxBackoffMs = Number(process.env.GLOBAL_MAX_BACKOFF_MS || 60_000);

  console.log(`Building player graph from ${startYear} to ${endYear} via stats.nba.com...`);
  if (players.size) {
    console.log(`Loaded ${players.size} existing players from ${OUTPUT_PATH}`);
  }

  for (let seasonEnd = startYear; seasonEnd <= endYear; seasonEnd += 1) {
    const season = seasonLabel(seasonEnd);
    const totalsUrl = buildLeagueDashUrl({ season, seasonType: 'Regular Season' });
    const teamDashUrl = buildTeamDashUrl({ season });
    const allStarUrl = buildLeagueDashUrl({ season, seasonType: 'All Star' });

    process.stdout.write(`- Season ${seasonEnd} (${season}): regular season... `);
    let regularRows = null;
    let regularFailed = false;
    try {
      const regularPayload = await fetchJson(totalsUrl, {
        maxRetries: globalMaxRetries,
        maxBackoffMs: globalMaxBackoffMs,
        requestTimeoutMs: globalTimeoutMs
      });
      const regular = parseStatsPayload(regularPayload);
      regularRows = toRowObjects(regular.headers, regular.rows);
      linkTeammatesForSeasonRows(regularRows, players);
    } catch (error) {
      regularFailed = true;
      process.stdout.write(`failed (${error && error.message ? error.message : 'unknown error'})`);
    }
    if (seasonEnd < rosterStartSeasonEnd || seasonEnd > rosterEndSeasonEnd) {
      process.stdout.write(
        `${regularFailed ? ', ' : ''}skipped rosters (outside ${rosterStartSeasonEnd}-${rosterEndSeasonEnd}), all-star... `
      );
    } else {
      process.stdout.write(`${regularFailed ? ', team links fallback... ' : 'ok, team links... '}`);

      let rosterFailures = 0;
      let rosterAttempts = 0;
      try {
        const teamPayload = await fetchJson(teamDashUrl, {
          maxRetries: 4,
          maxBackoffMs: 10_000,
          requestTimeoutMs: 15_000
      });
      const teamIds = parseTeamIdsFromDash(teamPayload);
      rosterAttempts = teamIds.length;

      for (const teamId of teamIds) {
        let linkedByAnySource = false;

        // Source 1: season team player stats (captures traded/partial-season teammates).
        try {
          const teamPlayerPayload = await fetchJson(
            buildLeagueDashUrl({ season, seasonType: 'Regular Season', teamId }),
            {
              maxRetries: rosterMaxRetries,
              maxBackoffMs: rosterMaxBackoffMs,
              requestTimeoutMs: rosterTimeoutMs
            }
          );
          const teamPlayerParsed = parseStatsPayload(teamPlayerPayload);
          const teamPlayerRows = toRowObjects(teamPlayerParsed.headers, teamPlayerParsed.rows);
          const teamPlayerNames = teamPlayerRows
            .map((row) => normalizeName(row.PLAYER_NAME || row.PLAYER || row.PLAYER_FULL_NAME))
            .filter(Boolean);
          if (teamPlayerNames.length) {
            linkRosterTeammates(teamPlayerNames, players);
            linkedByAnySource = true;
          }
        } catch (error) {
          console.log(
            `\n  team-player fetch failed for season ${season} team ${teamId}: ${
              error && error.message ? error.message : 'unknown error'
            }`
          );
        }

        // Source 2: historical roster endpoint (helps capture zero-minute/inactive teammates).
        try {
          const rosterPayload = await fetchJson(buildTeamRosterUrl({ season, teamId }), {
            maxRetries: rosterMaxRetries,
            maxBackoffMs: rosterMaxBackoffMs,
            requestTimeoutMs: rosterTimeoutMs
          });
          const rosterPlayers = parseRosterPlayers(rosterPayload);
          if (rosterPlayers.length) {
            linkRosterTeammates(rosterPlayers, players);
            linkedByAnySource = true;
          }
        } catch (error) {
          console.log(
            `\n  roster fetch failed for season ${season} team ${teamId}: ${
              error && error.message ? error.message : 'unknown error'
            }`
          );
        }

        if (!linkedByAnySource) {
          rosterFailures += 1;
        }
        await sleep(rosterTeamPauseMs);
      }
      } catch (error) {
        rosterFailures = 1;
        console.log(
          `\n  roster step skipped for season ${season}: ${
            error && error.message ? error.message : 'unknown error'
          }`
        );
      }

      if (rosterAttempts > 0 && rosterFailures > 0) {
        process.stdout.write(`partial (${rosterAttempts - rosterFailures}/${rosterAttempts}), all-star... `);
      } else if (rosterFailures > 0) {
        process.stdout.write('skipped, all-star... ');
      } else {
        process.stdout.write('ok, all-star... ');
      }
    }

    try {
      const allStarPayload = await fetchJson(allStarUrl, {
        maxRetries: globalMaxRetries,
        maxBackoffMs: globalMaxBackoffMs,
        requestTimeoutMs: globalTimeoutMs
      });
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
