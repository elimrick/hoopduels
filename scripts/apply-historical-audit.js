const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {applyHistoricalCorrections, validateGameEvidence} = require('../lib/historical-corrections');
const {addSnapshot, mergeAdditions} = require('../lib/roster-sync');
const {canonicalizeSourceName} = require('../lib/player-store');
const corrections = require('../data/historical-audit-corrections.json');
const findings = require('../data/historical-audit-findings.json');

const seedPath = path.join(__dirname, '../data/players-2000-present.json');
const original = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const baseline = applyHistoricalCorrections(original, corrections);
const additions = {};
// shortcut: Shared-game proofs cover these additions; verify roster-only cases using dated roster evidence.
for (const evidence of findings.addedConnections) {
  assert(evidence.season >= 2001 && evidence.season <= 2027);
  assert.equal(evidence.appearances.length, 2);
  assert.notEqual(evidence.appearances[0].id, evidence.appearances[1].id);
  assert(evidence.appearances.every(row => Number.isInteger(row.games) && row.games > 0 && row.games <= 82));
  const gameLimit = evidence.teamGameLimit ?? 82;
  assert.equal(gameLimit, evidence.teamGameLimit ? ({2012:66, 2021:72}[evidence.season]) : 82);
  assert(evidence.appearances.every(row => row.games <= gameLimit));
  assert(evidence.appearances[0].games + evidence.appearances[1].games > gameLimit);
  assert(evidence.players.every(name => baseline[canonicalizeSourceName(name)]));
}
for (const evidence of findings.addedGameConnections || []) {
  validateGameEvidence(evidence);
  assert(evidence.players.every(name => baseline[canonicalizeSourceName(name)]));
}
const confirmed = [...findings.addedConnections, ...(findings.addedGameConnections || [])];
addSnapshot(additions, confirmed.map(evidence => ({players:evidence.players})), baseline);
const updated = mergeAdditions(baseline, additions);
for (const removal of corrections.removedPairs) {
  const [a, b] = removal.players.map(canonicalizeSourceName);
  assert(!updated[a]?.teammates.includes(b), 'Conflicting historical evidence');
}
const temporary = seedPath + '.tmp';
fs.writeFileSync(temporary, JSON.stringify(updated, null, 2) + '\n');
fs.renameSync(temporary, seedPath);
console.log('Applied corroborated historical connections, reviewed removals, and name corrections.');
