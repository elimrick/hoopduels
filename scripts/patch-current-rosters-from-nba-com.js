const fs = require('node:fs');
const path = require('node:path');
const {MOVEMENT_URL, transactionIntervals, addTransactionOverlaps} = require('../lib/roster-transactions');
const {fetchRosters, addSnapshot, mergeAdditions} = require('../lib/roster-sync');
const {fetchTenDayEnds, fetchSeasonWindows, inSeason, nbaDay} = require('../lib/roster-season');
const audit = require('../data/historical-audit-corrections.json');

(async () => {
  const dataPath = path.join(__dirname, '../data/players-2000-present.json');
  const baseline = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const {rosters, source} = await fetchRosters();
  const additions = {};
  const windows = await fetchSeasonWindows(fetch, rosters, Date.parse(audit.asOf));
  const response = await fetch(MOVEMENT_URL, {signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`NBA transactions returned ${response.status}`);
  const movement = await response.json();
  const tenDayEnds = await fetchTenDayEnds(fetch, movement, rosters, windows, Date.parse(audit.asOf));
  addTransactionOverlaps(additions, transactionIntervals(movement,Date.now(),rosters,tenDayEnds), baseline, addSnapshot, Date.parse(audit.asOf), windows);
  addSnapshot(additions, rosters.filter(roster => inSeason(roster.teamId, nbaDay(Date.now()), windows)), baseline);
  const updated = mergeAdditions(baseline, additions);
  fs.writeFileSync(dataPath + '.tmp', JSON.stringify(updated, null, 2));
  fs.renameSync(dataPath + '.tmp', dataPath);
  console.log(`Verified ${rosters.length} current NBA rosters from ${source}. ${Object.keys(updated).length} players in total.`);
})().catch(error => {console.error(error.message); process.exitCode = 1;});
