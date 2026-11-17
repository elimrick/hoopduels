const assert = require('node:assert/strict');
const {fetchSeasonWindows, mergeSeasonWindows, inSeason, nbaDay} = require('../lib/roster-season');
const {addTransactionOverlaps} = require('../lib/roster-transactions');
const {addSnapshot} = require('../lib/roster-sync');
const day = value => Date.parse(`${value}T00:00:00Z`);
const rosters = [{teamId:1,abbreviation:'ATL'}, {teamId:2,abbreviation:'NYK'}];
const calendars = {
  2:['2025-10-21','2026-04-13'],
  3:['2026-04-18','2026-06-27'],
  5:['2026-04-13','2026-04-18']
};
async function fetcher(url) {
  let data;
  if (url.includes('/scoreboard')) data = {leagues:[{slug:'nba',season:{year:2026}}]};
  else if (url.includes('/types/')) {
    const type = Number(url.split('/').at(-1));
    data = {year:2026,type,startDate:calendars[type][0],endDate:calendars[type][1]};
  } else {
    const type = Number(new URL(url).searchParams.get('seasontype'));
    const code = url.match(/teams\/([^/]+)/)[1];
    data = {status:'success',team:{abbreviation:code},events:[]};
    if (code === 'ATL' && type === 3) {
      data.requestedSeason = {year:2026,type};
      data.events = [{date:'2026-04-25T23:00:00Z',season:{year:2026},seasonType:{type},
        competitions:[{status:{type:{name:'STATUS_FINAL'}}}]}];
    }
  }
  return {ok:true,json:async()=>data};
}
(async () => {
  const windows = await fetchSeasonWindows(fetcher,rosters,day('2026-01-01'),day('2026-07-01'));
  assert(inSeason(1,day('2025-10-21'),windows));
  assert(!inSeason(1,day('2025-10-20'),windows),'preseason excluded');
  assert(inSeason(1,day('2026-04-15'),windows),'qualifying team remains eligible before playoffs');
  assert(inSeason(1,day('2026-04-25'),windows),'last playoff day included');
  assert(!inSeason(1,day('2026-04-26'),windows),'eliminated team excluded');
  assert(!inSeason(2,day('2026-04-13'),windows),'nonparticipant excluded after regular season');
  assert(!inSeason(1,day('2026-07-01'),windows),'offseason excluded');
  assert.equal(nbaDay('2026-04-26T02:00:00Z'),day('2026-04-25'));
  const previous = [{season:2026,type:3,teamId:2,start:day('2026-04-13'),end:day('2026-06-27')}];
  assert(!inSeason(2,day('2026-05-01'),mergeSeasonWindows(previous,windows)),'empty schedule replaces stale window');
  const intervals = [
    {teamId:1,name:'A',start:day('2025-09-01'),end:day('2026-07-01')},
    {teamId:1,name:'Camp',start:day('2025-09-01'),end:day('2025-10-20')},
    {teamId:1,name:'Injured',start:day('2026-01-01'),end:day('2026-02-01')},
    {teamId:1,name:'Summer',start:day('2026-06-01'),end:day('2026-07-01')}
  ];
  const additions = {};
  addTransactionOverlaps(additions,intervals,{},addSnapshot,0,windows);
  assert.deepEqual(additions.A,['Injured'],'only overlapping eligible roster membership counts');
  await assert.rejects(fetchSeasonWindows(async()=>({ok:false,status:503}),rosters,day('2026-01-01')));
  console.log('PASS regular season, postseason, elimination, offseason, timezone, stale windows and non-playing roster overlap');
})().catch(error=>{console.error(error);process.exitCode=1});
