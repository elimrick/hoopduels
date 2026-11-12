const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const source = read('friends.js');
const rows = [];
const calls = [];
const nodes = Object.fromEntries(['friend-list','friend-requests','friend-request-count'].map(id => [id, {children:[],replaceChildren(){this.children=[];}}]));
let payload;
let confirmed = false;
const context = {
  navigating:false,lastData:'',message:{},document:{getElementById:id=>nodes[id]},
  api:async()=>payload,
  action:(...args)=>calls.push(args),
  window:{confirm:()=>confirmed},
  row:(container,...args)=>{container.children.push({});rows.push(args);}
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  async function refresh()'),source.indexOf("  const input=document.getElementById")),context);
async function render(challenges) {
  rows.length=0;context.lastData='';
  payload={friends:[{id:2,username:'Friend',accepted:1,online:true,available:true,rating:1200,record:{wins:2,losses:1}}],challenges};
  await context.refresh();return rows[0][2];
}
(async()=>{
  let buttons=await render([]);
  assert.equal(buttons[0][0],'Challenge');buttons[0][1]();assert.equal(calls.pop()[0],'/challenge');
  buttons.at(-1)[1]();assert.equal(calls.length,0);
  confirmed=true;buttons.at(-1)[1]();assert.equal(calls.pop()[1].action,'remove');
  buttons=await render([{id:'challenge',username:'Friend',incoming:false}]);
  assert.equal(buttons[0][0],'Challenge sent');assert.equal(buttons[0][2],true);
  buttons=await render([{id:'challenge',username:'Friend',incoming:true}]);
  assert.equal(buttons[0][0],'Accept challenge');buttons[0][1]();assert.equal(calls.pop()[1].action,'accept');
  buttons[1][1]();assert.equal(calls.pop()[1].action,'decline');
  const app=read('app.js');let signOutHandler,signOuts=0;
  const signOutContext={window:{confirm:()=>confirmed,location:{},HoopState:{signOut:async()=>signOuts++}},document:{getElementById:()=>({addEventListener:(_,fn)=>{signOutHandler=fn;}})}};
  vm.createContext(signOutContext);
  vm.runInContext(app.slice(app.indexOf('  function wireSignOut()'),app.indexOf('  function wireHomeFindGame()'))+'wireSignOut();',signOutContext);
  confirmed=false;await signOutHandler();assert.equal(signOuts,0);
  confirmed=true;await signOutHandler();assert.equal(signOuts,1);
  const game=read('game.js');const gameContext={playerId:'me'};vm.createContext(gameContext);
  for(const [name,next] of [['formatRatingMeta','getLocalProfileName'],['formatEloChange','getAccountEloByName'],['getEndDisplay','renderHistory'],['parseStrikeMessage','getLastStrikeGuess'],['capitalizeFirstChar','getEndDisplay']]) {
    vm.runInContext(game.slice(game.indexOf('function '+name+'('),game.indexOf('function '+next+'(')),gameContext);
  }
  assert.equal(gameContext.formatRatingMeta('1200'),'(1200)');
  assert.match(gameContext.formatEloChange(16),/rating-gain.*\+16/);
  assert.match(gameContext.formatEloChange(-16),/rating-loss.*-16/);
  assert.equal(gameContext.getEndDisplay('disconnect','me','other').title,'You won!');
  assert.equal(gameContext.getEndDisplay('disconnect','other','me').title,'You lost.');
  for(const reason of ['unknown player','repeat player','not a teammate of LeBron James']) {
    const info=gameContext.parseStrikeMessage(`Me guessed "Test" and got a strike (${reason}).`);
    assert.equal(gameContext.capitalizeFirstChar(info.reason)+'.',reason[0].toUpperCase()+reason.slice(1)+'.');
  }
  console.log('PASS: inline challenge states, removal/sign-out confirmation, rating colors, outcome wording and foul messages.');
})().catch(error=>{console.error(error);process.exitCode=1;});
