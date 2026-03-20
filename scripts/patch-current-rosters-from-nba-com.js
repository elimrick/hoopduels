const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '..', 'data', 'players-2000-present.json');
const NBA_PLAYERS_URL = 'https://www.nba.com/players';

const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

function loadPlayers() {
  return JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
}

function savePlayers(players) {
  const output = {};
  const names = Object.keys(players).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const row = players[name] || {};
    const teammates = Array.isArray(row.teammates) ? row.teammates : [];
    output[name] = {
      allStar: Boolean(row.allStar),
      teammates: [...new Set(teammates.map(normalizeName).filter(Boolean))]
        .filter((teammate) => teammate !== name)
        .sort((a, b) => a.localeCompare(b))
    };
  }
  fs.writeFileSync(INPUT_PATH, JSON.stringify(output, null, 2));
}

async function fetchLeagueRosterHtml() {
  const response = await fetch(NBA_PLAYERS_URL, { headers: HTML_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${NBA_PLAYERS_URL}: ${response.status}`);
  }
  return response.text();
}

function parseLeagueRosterRows(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find __NEXT_DATA__ on nba.com/players.');
  }
  const data = JSON.parse(match[1]);
  const rows = data && data.props && data.props.pageProps && data.props.pageProps.players;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Could not find player rows in nba.com/players data.');
  }
  return rows;
}

function playerFullName(row) {
  return normalizeName(`${row.PLAYER_FIRST_NAME || ''} ${row.PLAYER_LAST_NAME || ''}`);
}

function buildActiveTeamGroups(rows) {
  const teams = new Map();
  for (const row of rows) {
    if (!row || Number(row.IS_DEFUNCT) === 1) continue;
    if (Number(row.ROSTER_STATUS) !== 1) continue;
    const teamId = String(row.TEAM_ID == null ? '' : row.TEAM_ID).trim();
    if (!teamId || teamId === '0') continue;
    const name = playerFullName(row);
    if (!name) continue;
    if (!teams.has(teamId)) {
      teams.set(teamId, new Set());
    }
    teams.get(teamId).add(name);
  }
  return teams;
}

function ensurePlayer(players, name) {
  if (!players[name]) {
    players[name] = {
      allStar: false,
      teammates: []
    };
  } else if (!Array.isArray(players[name].teammates)) {
    players[name].teammates = [];
  }
}

function linkCurrentTeammates(players, teamGroups) {
  let linksAdded = 0;
  for (const namesSet of teamGroups.values()) {
    const names = [...namesSet];
    for (const name of names) {
      ensurePlayer(players, name);
    }
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = names[i];
        const b = names[j];
        const aSet = new Set(players[a].teammates.map(normalizeName));
        const bSet = new Set(players[b].teammates.map(normalizeName));
        if (!aSet.has(b)) {
          aSet.add(b);
          players[a].teammates = [...aSet];
          linksAdded += 1;
        }
        if (!bSet.has(a)) {
          bSet.add(a);
          players[b].teammates = [...bSet];
          linksAdded += 1;
        }
      }
    }
  }
  return linksAdded;
}

async function main() {
  const players = loadPlayers();
  const html = await fetchLeagueRosterHtml();
  const rows = parseLeagueRosterRows(html);
  const teams = buildActiveTeamGroups(rows);
  const linksAdded = linkCurrentTeammates(players, teams);
  savePlayers(players);
  console.log(`Patched current rosters from nba.com/players: ${rows.length} players across ${teams.size} teams, ${linksAdded} teammate links added.`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
