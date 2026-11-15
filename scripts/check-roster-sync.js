const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseRosters, addSnapshot, mergeAdditions, RosterSync} = require('../lib/roster-sync');
const {PlayerStore} = require('../lib/player-store');
const {transactionIntervals, addTransactionOverlaps} = require('../lib/roster-transactions');

(async () => {
  const baseline = {A:{allStar:true,teammates:[]},B:{allStar:false,teammates:[]}};
  const additions = {};
  addSnapshot(additions, [{teamId:1,players:['A','C']},{teamId:2,players:['B','D']}], baseline);
  addSnapshot(additions, [{teamId:1,players:['B','C']},{teamId:2,players:['A','D']}], baseline);
  const graph = mergeAdditions(baseline, additions);
  assert(!graph.A.teammates.includes('B'), 'players swapped for each other must not be linked');
  assert(graph.A.teammates.includes('C'), 'previous teammates must remain linked');
  assert(graph.A.teammates.includes('D'), 'new teammates must be linked');
  addSnapshot(additions, [{teamId:3,players:['A','B']}], baseline);
  assert(mergeAdditions(baseline, additions).A.teammates.includes('B'), 'a later shared roster must count');

  const rows = Array.from({length:30}, (_,team) => Array.from({length:15}, (_,player) => ({
    PERSON_ID:team*15+player+1, TEAM_ID:team+1, ROSTER_STATUS:1, TO_YEAR:2026,
    PLAYER_FIRST_NAME:`Player${team}`, PLAYER_LAST_NAME:String(player)
  }))).flat();
  const html = data => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{players:data}}})}</script>`;
  assert.equal(parseRosters(html(rows), new Date('2026-11-15')).length,30);
  assert.throws(()=>parseRosters(html(rows.slice(15)),new Date('2026-11-15')));
  assert.throws(()=>parseRosters(html([...rows,rows[0]]),new Date('2026-11-15')));
  assert.throws(()=>parseRosters(html(rows),new Date('2027-11-15')));

  const moves = [
    {PLAYER_ID:90001,TEAM_ID:1,Transaction_Type:'Signing',TRANSACTION_DATE:'2026-01-01',TRANSACTION_DESCRIPTION:'Team signed guard Alpha to a 10-Day Contract.'},
    {PLAYER_ID:90002,TEAM_ID:1,Transaction_Type:'Signing',TRANSACTION_DATE:'2026-01-12',TRANSACTION_DESCRIPTION:'Team signed guard Beta to a Contract.'},
    {PLAYER_ID:90003,TEAM_ID:1,Transaction_Type:'Signing',TRANSACTION_DATE:'2026-01-02',TRANSACTION_DESCRIPTION:'Team signed guard Gamma to a Contract.'},
    {PLAYER_ID:90003,TEAM_ID:1,Transaction_Type:'Waive',TRANSACTION_DATE:'2026-01-12',TRANSACTION_DESCRIPTION:'Team waived guard Gamma.'},
    {PLAYER_ID:90004,TEAM_ID:1,Transaction_Type:'Trade',TRANSACTION_DATE:'2026-01-02',TRANSACTION_DESCRIPTION:'Team received guard Draft Rights from Other.',Additional_Sort:2}
  ];
  const movement = {NBA_Player_Movement:{rows:[...moves,...Array.from({length:1000},()=>({PLAYER_ID:0,Transaction_Type:'Trade'}))]}};
  const dated = {};
  addTransactionOverlaps(dated,transactionIntervals(movement,Date.parse('2026-11-15')),{},addSnapshot);
  assert(dated.Alpha.includes('Gamma'),'overlapping signed roster members count without game appearances');
  assert(!dated.Alpha.includes('Beta'),'10-day expiration ends roster membership');
  assert(!dated.Gamma.includes('Beta'),'same-day departure and arrival cannot establish overlap');
  assert(!dated['Draft Rights'],'traded draft rights do not establish roster membership');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'hoopduels-sync-test-'));
  const seed = path.join(temp,'players.json');
  fs.writeFileSync(seed,JSON.stringify(baseline));
  const store = new PlayerStore({dbPath:path.join(temp,'players.db'),seedJsonPath:seed});
  store.init();
  store.replaceFromData(graph);
  assert(store.teammatesByKey.get('a').has('c'));
  const before = store.getCounts();
  assert.throws(()=>store.replaceFromData({Broken:{allStar:false,teammates:{}}}));
  assert.deepEqual(store.getCounts(),before);

  let calls = 0;
  const sync = new RosterSync({playerStore:store,statePath:path.join(temp,'sync.json'),fetcher:async()=>{
    calls++;
    return {ok:true,text:async()=>html(rows.map(row=>({...row,TO_YEAR:new Date().getUTCFullYear()}))),json:async()=>movement};
  }});
  await sync.init();
  await Promise.all([sync.refresh(),sync.refresh()]);
  assert.equal(calls,2,'concurrent refreshes must share one request');
  assert.equal(sync.status().teams,30);
  await sync.refresh();assert.equal(calls,2,'successful updates must wait until the next day');
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate()-1);
  yesterday.setUTCHours(23,59,59,0);
  sync.state.updatedAt = yesterday.toISOString();
  sync.lastAttempt = 0;
  await sync.refresh();
  assert.equal(calls,4,'a new UTC day must refresh even when fewer than 24 hours have elapsed');
  const restarted = new RosterSync({playerStore:store,statePath:path.join(temp,'sync.json')});
  await restarted.init();
  assert.equal(restarted.status().updatedAt,sync.status().updatedAt);
  const lastGood = store.getCounts();
  restarted.state.updatedAt = '2000-01-01';
  restarted.fetcher = async()=>{throw new Error('Test source outage');};
  await assert.rejects(restarted.refresh());
  assert.deepEqual(store.getCounts(),lastGood);
  store.reloadFromJson(path.join(__dirname,'../data/players-2000-present.json'));
  assert(store.areTeammates('Jimmy Butler','Jeff Teague'));
  assert.equal(store.resolveKey('Jimmy Butler III'),store.resolveKey('Jimmy Butler'));
  for (const [father,son] of [['Gary Payton','Gary Payton II'],['Tim Hardaway','Tim Hardaway Jr.'],['Jaren Jackson','Jaren Jackson Jr.']]) {
    assert.notEqual(store.resolveKey(father),store.resolveKey(son));
  }
  for (const [a,b] of [['Luka Doncic','Anthony Davis'],['Kawhi Leonard','DeMar DeRozan'],['Tyrese Haliburton','Domantas Sabonis']]) assert(!store.areTeammates(a,b));
  store.db.close();
  fs.rmSync(temp,{recursive:true,force:true});
  console.log('PASS roster swaps, historical overlap, coverage, duplicate/stale rejection, atomic replacement, concurrency, persistence and source-outage recovery');
})().catch(error=>{console.error(error);process.exitCode=1});
