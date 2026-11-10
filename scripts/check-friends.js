const assert=require('node:assert/strict');
const {AccountStore}=require('../lib/account-store');
const {FriendStore}=require('../lib/friend-store');
const base='http://127.0.0.1:3101';
async function api(path,body,token,status=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,status,path);return r.json();}
async function client(playerId,token){return new Promise((resolve,reject)=>{
 const ws=new WebSocket('ws://127.0.0.1:3101/socket.io/?EIO=4&transport=websocket');const events=[];const listeners=[];
 const timer=setTimeout(()=>reject(Error('socket timeout')),5000);
 const c={ws,events,send:(name,data)=>ws.send('42'+JSON.stringify([name,data])),wait:name=>new Promise((res,rej)=>{const old=events.find(e=>e[0]===name);if(old)return res(old[1]);const t=setTimeout(()=>rej(Error('event timeout '+name)),5000);listeners.push({name,fn:d=>{clearTimeout(t);res(d)}});})};
 ws.onmessage=({data})=>{if(data.startsWith('0'))ws.send('40'+JSON.stringify({playerId,token}));else if(data==='2')ws.send('3');else if(data.startsWith('42')){const e=JSON.parse(data.slice(2));events.push(e);for(const l of listeners.filter(l=>l.name===e[0]))l.fn(e[1]);if(e[0]==='session:ready'){clearTimeout(timer);resolve(c);}}};
 ws.onerror=reject;
});}
(async()=>{
 const accounts=new AccountStore({dbPath:':memory:'});accounts.init();
 const store=new FriendStore(accounts);await store.init();
 const a=accounts.createUser('FriendOne','preview123'),b=accounts.createUser('FriendTwo','preview123'),c=accounts.createUser('FriendThree','preview123');
 await assert.rejects(store.request(a,'FriendOne'));await assert.rejects(store.request(a,'MissingAccount'));
 await store.request(a,'friendtwo');await assert.rejects(store.request(a,'FriendTwo'));await assert.rejects(store.act(a,b,'accept'));await assert.rejects(store.act(c,b,'accept'));
 await store.act(b,a,'accept');assert(await store.areFriends(a,b));assert(await store.areFriends(b,a));await store.act(a,b,'remove');assert(!await store.areFriends(a,b));accounts.db.close();
 console.log('PASS: friendship persistence, self/duplicate rejection, recipient-only acceptance, removal.');
 const users=[];for(const username of ['PreviewOne','PreviewTwo','PreviewThree']){let r=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'preview123'})});users.push(r.ok?await r.json():await api('/api/auth/signin',{username,password:'preview123'}));}
 const [u,v,w]=users;await api('/api/friends',null,null,401);
 const initial=await api('/api/friends',null,u.token);for(const f of initial.friends)await api('/api/friends/action',{userId:Number(f.id),action:'remove'},u.token);
 await api('/api/friends/request',{username:'PreviewTwo'},u.token);
 let data=await api('/api/friends',null,v.token);const incoming=data.friends.find(f=>f.username==='PreviewOne');assert(incoming.incoming);
 const other=(await api('/api/friends',null,u.token)).friends.find(f=>f.username==='PreviewTwo');
 await api('/api/friends/action',{userId:Number(other.id),action:'accept'},u.token,400);
 await api('/api/friends/action',{userId:Number(incoming.id),action:'accept'},v.token);
 await api('/api/friends/challenge',{userId:Number(other.id)},u.token,400);
 const ca=await client('friend-preview-one',u.token),cb=await client('friend-preview-two',v.token);
 try {
  ca.send('friends:ready');cb.send('friends:ready');
  // Wait for server presence, not an arbitrary sleep.
  for(let i=0;i<30;i++){data=await api('/api/friends',null,u.token);if(data.friends[0].online)break;}
  assert(data.friends[0].online);
  await api('/api/friends/challenge',{userId:Number(other.id)},u.token);
  data=await api('/api/friends',null,v.token);const challenge=data.challenges[0];assert(challenge.incoming);
  await api('/api/friends/respond',{id:challenge.id,action:'accept'},w.token,400);
  await api('/api/friends/respond',{id:challenge.id,action:'accept'},u.token,400);
  await api('/api/friends/respond',{id:challenge.id,action:'decline'},v.token);
  assert.equal((await api('/api/friends',null,u.token)).challenges.length,0);
  await api('/api/friends/challenge',{userId:Number(other.id)},u.token);
  data=await api('/api/friends',null,v.token);
  const before=(await api('/api/account/profile',null,u.token)).profile;
  await api('/api/friends/respond',{id:data.challenges[0].id,action:'accept'},v.token);
  const game=await ca.wait('game:state');assert.equal(game.mode,'friend');
  await api('/api/friends/challenge',{userId:Number(other.id)},u.token,400);
  ca.send('matchmaking:leave');const ended=await ca.wait('game:ended');assert.equal(ended.eloUpdate,null);
  const after=(await api('/api/account/profile',null,u.token)).profile;
  for(const key of ['wins','losses','elo','streak'])assert.equal(after[key],before[key],key);
  assert.equal(after.games[0].ranked,false);assert.equal(after.games[0].opponent,'PreviewTwo');
  console.log('PASS: online challenge, unauthorized acceptance, decline, busy rejection, unranked game and unchanged rating/record.');
 }finally{ca.ws.close();cb.ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
