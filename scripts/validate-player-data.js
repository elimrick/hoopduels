const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'players-2000-present.json');
const KNOWN_PAIRS_PATH = path.join(__dirname, '..', 'data', 'validator-known-pairs.json');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(messages) {
  for (const message of messages) {
    console.error(`[validate:data] ${message}`);
  }
  process.exit(1);
}

function inferMinPlayersFromStartYear() {
  const raw = process.env.BUILD_START_SEASON_END_YEAR;
  const startYear = Number.isFinite(Number(raw)) ? Number(raw) : 1977;
  if (startYear <= 1977) return 4000;
  if (startYear <= 1990) return 3300;
  if (startYear <= 2000) return 2600;
  return 2000;
}

function validateGraph(data, config) {
  const errors = [];
  const names = Object.keys(data);

  if (!names.length) {
    errors.push('No players were found in the dataset.');
    return errors;
  }

  if (names.length < config.minPlayers) {
    errors.push(`Player count too low: ${names.length} < ${config.minPlayers}`);
  }

  let allStarCount = 0;
  for (const name of names) {
    const row = data[name] || {};
    if (row.allStar) allStarCount += 1;
    if (!Array.isArray(row.teammates)) {
      errors.push(`Player "${name}" has invalid teammates list.`);
      continue;
    }
    if (row.teammates.includes(name)) {
      errors.push(`Player "${name}" lists themselves as a teammate.`);
    }
  }

  if (allStarCount < config.minAllStars) {
    errors.push(`All-star count too low: ${allStarCount} < ${config.minAllStars}`);
  }

  for (const name of names) {
    const teammates = data[name].teammates || [];
    for (const teammate of teammates) {
      const peer = data[teammate];
      if (!peer) {
        errors.push(`Missing player node for teammate reference "${teammate}" (from "${name}").`);
        continue;
      }
      if (!Array.isArray(peer.teammates) || !peer.teammates.includes(name)) {
        errors.push(`Asymmetric teammate link: "${name}" -> "${teammate}" but not reverse.`);
      }
    }
  }

  return errors;
}

function validateKnownPairs(data, known) {
  const errors = [];
  for (const playerName of known.playersMustExist || []) {
    if (!data[playerName]) {
      errors.push(`Known player missing: "${playerName}"`);
    }
  }

  for (const group of known.playersMustExistAny || []) {
    if (!Array.isArray(group) || !group.length) continue;
    const found = group.some((name) => Boolean(data[name]));
    if (!found) {
      errors.push(`Known player missing (any-of): ${group.map((n) => `"${n}"`).join(', ')}`);
    }
  }

  for (const pair of known.mustBeTeammates || []) {
    const a = pair.a;
    const b = pair.b;
    if (!data[a]) {
      errors.push(`Known pair failed: "${a}" missing.`);
      continue;
    }
    if (!data[b]) {
      errors.push(`Known pair failed: "${b}" missing.`);
      continue;
    }
    const ok =
      Array.isArray(data[a].teammates) &&
      Array.isArray(data[b].teammates) &&
      data[a].teammates.includes(b) &&
      data[b].teammates.includes(a);
    if (!ok) {
      errors.push(`Known pair missing teammate link: "${a}" <-> "${b}"`);
    }
  }
  return errors;
}

function main() {
  const data = loadJson(DATA_PATH);
  const known = loadJson(KNOWN_PAIRS_PATH);
  const minPlayers = Number(process.env.VALIDATE_MIN_PLAYERS || inferMinPlayersFromStartYear());
  const minAllStars = Number(process.env.VALIDATE_MIN_ALL_STARS || 120);

  const errors = [
    ...validateGraph(data, { minPlayers, minAllStars }),
    ...validateKnownPairs(data, known)
  ];

  if (errors.length) {
    fail(errors);
  }

  console.log(
    `[validate:data] PASS players=${Object.keys(data).length} allStars=${
      Object.values(data).filter((p) => p && p.allStar).length
    }`
  );
}

main();
