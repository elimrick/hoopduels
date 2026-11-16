const assert = require('node:assert/strict');
const {canonicalizeSourceName} = require('./player-store');

function pairKey(a, b) {
  return [canonicalizeSourceName(a), canonicalizeSourceName(b)].sort().join('|');
}

function applyHistoricalCorrections(graph, corrections) {
  const removedPlayers = new Set(corrections.removedPlayers.map(row => canonicalizeSourceName(row.name)));
  const removedPairs = new Set(corrections.removedPairs.map(row => pairKey(...row.players)));
  const result = {};
  for (const [name, row] of Object.entries(graph)) {
    const canonical = canonicalizeSourceName(name);
    if (removedPlayers.has(canonical)) continue;
    result[canonical] ||= {...row, teammates:[]};
    result[canonical].allStar ||= Boolean(row.allStar);
  }
  for (const [name, row] of Object.entries(graph)) {
    const canonical = canonicalizeSourceName(name);
    if (!result[canonical]) continue;
    const peers = new Set(result[canonical].teammates);
    for (const peer of row.teammates) {
      const target = canonicalizeSourceName(peer);
      if (target === canonical || removedPlayers.has(target) || removedPairs.has(pairKey(canonical, target))) continue;
      if (!result[target]) throw new Error('Historical correction references a missing player.');
      peers.add(target);
    }
    result[canonical].teammates = [...peers].sort();
  }
  return result;
}

function validateGameEvidence(evidence) {
  assert(/^(002|004)\d{7}$/.test(evidence.gameId), 'Expected an NBA regular-season or playoff game');
  assert.equal(evidence.season, 2001 + Number(evidence.gameId.slice(3, 5)));
  assert(evidence.season >= 2001 && evidence.season <= new Date().getUTCFullYear() + 1);
  assert(Number.isInteger(evidence.teamId) && evidence.teamId >= 1610612737 && evidence.teamId <= 1610612766);
  assert.equal(evidence.appearances.length, 2);
  assert.notEqual(evidence.appearances[0].nbaId, evidence.appearances[1].nbaId);
  assert.notEqual(evidence.players[0], evidence.players[1]);
  for (const player of evidence.appearances) {
    assert(Number.isInteger(player.nbaId) && player.nbaId > 0);
    assert(player.sourceName.trim());
    // Archived NBA box scores occasionally round the seconds field to 60.
    assert(/^\d+:(?:[0-5]\d|60)$/.test(player.minutes));
    const [minutes, seconds] = player.minutes.split(':').map(Number);
    assert(minutes * 60 + seconds > 0, 'Game proof requires recorded playing time');
  }
  assert.deepEqual(evidence.appearances.map(player => player.name).sort(), [...evidence.players].sort());
}

module.exports = {applyHistoricalCorrections, validateGameEvidence};
