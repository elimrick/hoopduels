const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {applyHistoricalCorrections, validateGameEvidence} = require('../lib/historical-corrections');
const {PlayerStore, canonicalizeSourceName} = require('../lib/player-store');
const {RosterSync, addSnapshot, mergeAdditions} = require('../lib/roster-sync');
const {addTransactionOverlaps} = require('../lib/roster-transactions');
const corrections = require('../data/historical-audit-corrections.json');
const findings = require('../data/historical-audit-findings.json');
const graph = require('../data/players-2000-present.json');

(async () => {
  assert.deepEqual(applyHistoricalCorrections(graph, corrections), graph, 'corrections must be idempotent');
  for (const evidence of findings.addedConnections) {
    const [a, b] = evidence.players.map(canonicalizeSourceName);
    assert(graph[a].teammates.includes(b) && graph[b].teammates.includes(a), a + ' / ' + b);
    const gameLimit = evidence.teamGameLimit ?? 82;
    assert.equal(gameLimit, evidence.teamGameLimit ? ({2012:66, 2021:72}[evidence.season]) : 82);
    assert(evidence.appearances.every(row => row.games <= gameLimit));
    assert(evidence.appearances.reduce((sum, row) => sum + row.games, 0) > gameLimit);
  }

  for (const evidence of findings.addedGameConnections || []) {
    validateGameEvidence(evidence);
    const [a, b] = evidence.players.map(canonicalizeSourceName);
    assert(graph[a].teammates.includes(b) && graph[b].teammates.includes(a));
  }
  const sample = structuredClone(findings.addedGameConnections[0]);
  sample.appearances[0].minutes = '43:60';
  validateGameEvidence(sample);
  sample.appearances[0].minutes = '0:00';
  assert.throws(() => validateGameEvidence(sample));
  sample.appearances[0].minutes = '1:00';
  sample.appearances[1].nbaId = sample.appearances[0].nbaId;
  assert.throws(() => validateGameEvidence(sample));
  assert.throws(() => validateGameEvidence({...findings.addedGameConnections[0], gameId:'0029900001', season:2000}));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoopduels-history-audit-'));
  try {
    const seed = path.join(directory, 'players.json');
    fs.writeFileSync(seed, JSON.stringify(graph));
    fs.writeFileSync(path.join(directory, 'historical-audit-corrections.json'), JSON.stringify(corrections));
    const store = new PlayerStore({seedJsonPath:seed, dbPath:path.join(directory, 'players.db')});
    store.init();
    try {
      for (const {players:[a,b]} of corrections.removedPairs) assert(!store.areTeammates(a,b), a + ' / ' + b);
      for (const {name} of corrections.removedPlayers) assert(!store.hasPlayer(name));
      for (const {name} of findings.confirmedRosterOnlyEligibility) assert(store.hasPlayer(name), name);
      assert.equal(store.resolveKey('Christopher Cenac Jr.'), store.resolveKey('Chris Cenac Jr.'));
      assert.equal(store.resolveKey('Nikola Đurisic'), store.resolveKey('Nikola Djurisic'));
      assert(store.areTeammates('Allen Iverson', 'Antonio McDyess'), 'a return signing can make trade counterparts valid');
      assert(store.areTeammates('Michael Jordan', 'Kwame Brown'), 'eligible Washington connection must remain');
      assert(store.areTeammates('Allen Iverson', 'Vernon Maxwell'));
      assert.equal(store.resolveKey('Hansen Yang'), store.resolveKey('Yang Hansen'));
      assert.equal(store.resolveKey('Nene Hilario'), store.resolveKey('Nene'));
      assert.equal(store.getName('Ha Ha'), 'Ha Seung-Jin');
      assert.notEqual(store.resolveKey('Gary Payton'), store.resolveKey('Gary Payton II'));

      const legacy = {
        updatedAt:new Date().toISOString(),
        additions:{
          'Aaron Gordon':['Gary Harris'], 'Gary Harris':['Aaron Gordon'],
          'Hansen Yang':['Jerami Grant'], 'Jerami Grant':['Hansen Yang'],
          'Charles Barkley':['Scottie Pippen'], 'Scottie Pippen':['Charles Barkley']
        }
      };
      const statePath = path.join(directory, 'sync.json');
      fs.writeFileSync(statePath, JSON.stringify(legacy));
      const sync = new RosterSync({playerStore:store, statePath});
      await sync.init();
      assert.equal(sync.state.auditRevision, corrections.revision);
      assert.equal(sync.state.updatedAt, null, 'migration must schedule a fresh update');
      assert(!store.areTeammates('Aaron Gordon','Gary Harris'));
      assert(!store.hasPlayer('Charles Barkley'));
      assert(store.areTeammates('Yang Hansen','Jerami Grant'));

      const future = structuredClone(sync.state);
      addSnapshot(future.additions, [{players:['Aaron Gordon','Gary Harris']}], graph);
      assert.equal(sync.reconcileAudit(future), future, 'a real future roster overlap must be allowed');
      assert(mergeAdditions(graph, future.additions)['Aaron Gordon'].teammates.includes('Gary Harris'));

      const cutoff = Date.parse(corrections.asOf);
      const additions = {};
      const intervals = [
        {name:'Aaron Gordon',teamId:1,start:cutoff-200,end:cutoff-100},
        {name:'Gary Harris',teamId:1,start:cutoff-200,end:cutoff-100}
      ];
      addTransactionOverlaps(additions, intervals, graph, addSnapshot, cutoff);
      assert.deepEqual(additions, {}, 'old transaction backfills must not undo reviewed corrections');
      intervals.forEach(interval => { interval.start = cutoff+100; interval.end = cutoff+200; });
      addTransactionOverlaps(additions, intervals, graph, addSnapshot, cutoff);
      assert(additions['Aaron Gordon'].includes('Gary Harris'));
    } finally {
      store.db.close();
    }
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
  console.log('PASS: all confirmed additions, reviewed removals, return-signing protection, aliases, saved-state migration and future legitimate overlap.');
})().catch(error => { console.error(error); process.exitCode = 1; });
