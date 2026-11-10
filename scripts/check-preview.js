const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {load}=require('cheerio');
const root=require('node:path').join(__dirname,'..');
const base='http://127.0.0.1:3101';
async function api(path,body,token){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert(res.ok,`${path}: ${res.status}`);return res.json();}
async function client(playerId,token){return new Promise((resolve,reject)=>{
 const ws=new WebSocket('ws://127.0.0.1:3101/socket.io/?EIO=4&transport=websocket');const events=[];const listeners=[];
 const timeout=setTimeout(()=>reject(Error('socket timeout')),5000);
 const client={ws,events,send:(name,data)=>ws.send('42'+JSON.stringify([name,data])),wait:(name)=>new Promise((res,rej)=>{const old=events.find(e=>e[0]===name);if(old)return res(old[1]);const timer=setTimeout(()=>rej(Error('event timeout '+name)),5000);listeners.push({name,callback:data=>{clearTimeout(timer);res(data)}});})};
 ws.onmessage=({data})=>{if(data.startsWith('0'))ws.send('40'+JSON.stringify({playerId,token}));else if(data.startsWith('40')){clearTimeout(timeout);resolve(client)}else if(data==='2')ws.send('3');else if(data.startsWith('42')){const event=JSON.parse(data.slice(2));events.push(event);for(const l of listeners.filter(l=>l.name===event[0]))l.callback(event[1]);}};
 ws.onerror=reject;
});}
(async()=>{
 for(const [route,file] of Object.entries({'/':'index.html','/practice':'practice.html','/game':'game.html','/leaderboard':'leaderboard.html','/game-history':'game-history.html','/profile':'profile.html','/signin':'signin.html','/create-account':'create-account.html','/how-to-play':'how-to-play.html','/friends':'friends.html','/settings':'settings.html'})){
  const res=await fetch(base+route);assert.equal(res.status,200);const html=await res.text();const $=load(html);assert.equal($('h1').length,1);assert.equal($('main').length,1);assert.equal($('link[href="styles.css?v=redesign-1"]').length,1);assert(!html.includes('pagead2'));const ids=$('[id]').map((_,el)=>$(el).attr('id')).get();assert.equal(new Set(ids).size,ids.length,route+' duplicate IDs');
  const previous=load(execFileSync('git',['show','17642b3:public/'+file],{cwd:root,encoding:'utf8'}));for(const id of previous('[id]').map((_,el)=>previous(el).attr('id')).get())assert(ids.includes(id),route+' missing behavior hook '+id);
 }
 const historyRedirect=await fetch(base+'/game-history',{redirect:'manual'});assert.equal(historyRedirect.status,302);assert.equal(historyRedirect.headers.get('location'),'/profile#game-history');
 console.log('PASS: all 11 pages respond, preserve behavior hooks, and load the shared redesign.');
 const names=await api('/api/players');assert(names.players.length>2000);
 const turn=await api('/api/practice/turn',{currentPlayer:'LeBron James',usedPlayers:['LeBron James'],guess:'Dwyane Wade'});assert.equal(turn.ok,true);assert.equal(turn.userGuess,'Dwyane Wade');assert(turn.computerGuess);
 const invalid=await api('/api/practice/turn',{currentPlayer:'LeBron James',usedPlayers:['LeBron James'],guess:'Not a player'});assert.equal(invalid.ok,false);
 console.log('PASS: player search data, valid practice turn, CPU response, and invalid guess.');
 const users=[];for(const username of ['PreviewOne','PreviewTwo']){let result;const body={username,password:'preview123'};try{result=await api('/api/auth/signup',body)}catch{result=await api('/api/auth/signin',body)}users.push(result);}
 const a=await client('design-preview-one',users[0].token);const b=await client('design-preview-two',users[1].token);
 a.send('matchmaking:join');b.send('matchmaking:join');
 try {const state=await a.wait('game:state');assert(state);a.send('matchmaking:leave');await a.wait('game:ended');console.log('PASS: local account creation/sign-in, multiplayer matchmaking and completed game.');}finally{a.ws.close();b.ws.close();}
 const profile=await api('/api/account/profile',null,users[0].token);assert(profile.profile.games.length>0);console.log('PASS: completed game persists to isolated account history.');
})().catch(error=>{console.error(error);process.exitCode=1;});
