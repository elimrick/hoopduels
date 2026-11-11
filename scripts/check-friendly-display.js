const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/game.js'),'utf8');
function functionSource(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));}
const element=()=>({textContent:'',innerHTML:'',classList:{toggle(){},remove(){}}});
const left=element(),right=element();
const context={currentState:{mode:'friend'},pregamePlayerElos:{},window:{HoopFeedback:{setFouls(){}}},document:{getElementById:id=>id==='player-left-elo'?left:right},renderPlayerClocks(){},getAccountEloByName(){return null;},formatRatingMeta:s=>s,formatEloChange:n=>String(n)};
for(const name of ['playerLeftNameEl','playerRightNameEl','playerLeftStrikesEl','playerRightStrikesEl','playerLeftEl','playerRightEl'])context[name]=element();
vm.createContext(context);
vm.runInContext(functionSource('calculateRankedEloOutcome','extractGuessedName')+functionSource('renderScoreboard','stopTimer'),context);
const players=[{playerId:'a',username:'One',signedIn:true,elo:1200,strikes:0},{playerId:'b',username:'Two',signedIn:true,elo:1200,strikes:0}];
context.renderScoreboard(players,'a',{winnerPlayerId:'a',loserPlayerId:'b'});
assert.equal(left.innerHTML,'1200');assert.equal(right.innerHTML,'1200');
context.currentState.mode='ranked';context.renderScoreboard(players,'a',{winnerPlayerId:'a',loserPlayerId:'b'});
assert.match(left.innerHTML,/1216/);assert.match(right.innerHTML,/1184/);
console.log('PASS: actual scoreboard leaves friendly ratings unchanged and still displays ranked changes.');
