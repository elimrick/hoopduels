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

module.exports = {applyHistoricalCorrections};
