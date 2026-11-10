const { randomUUID } = require('node:crypto');
const { FriendStore } = require('./friend-store');

function installFriends({ app, io, accounts, getSocket, getGame, createGame, waitingQueue }) {
  const store = new FriendStore(accounts);
  const challenges = new Map();
  const socketsFor = id => [...io.sockets.sockets.values()].filter(s => s.connected && Number(s.data.userId) === Number(id));
  const available = id => socketsFor(id).find(s => s.data.friendsReady && !getGame(s.data.playerId) && !waitingQueue.includes(s.data.playerId));
  function prune() {
    for (const [id,c] of challenges) if (c.expiresAt <= Date.now() || !getSocket(c.fromPlayer) || !getSocket(c.toPlayer)) challenges.delete(id);
  }
  function route(method, url, handler) {
    app[method](url, async (req,res) => {
      try {
        const token = (req.headers.authorization || '').replace(/^Bearer /,'');
        const user = await accounts.getUserByToken(token);
        if (!user) return res.status(401).json({error:'Sign in to use Friends.'});
        prune();
        await handler(req,res,user);
      } catch (error) {
        console.error('Friends request failed:', error.message);
        res.status(400).json({error: error.code ? 'Could not update friends. Please try again.' : error.message});
      }
    });
  }
  route('get','/api/friends',async (_req,res,user)=> {
    const rows = await store.list(user.id);
    res.json({friends:rows.map(r=>({...r, incoming:Number(r.sender_id)!==Number(user.id), online:!!available(r.id)})),
      challenges:[...challenges.values()].filter(c=>c.from===Number(user.id)||c.to===Number(user.id)).map(c=>({id:c.id,username:c.from===Number(user.id)?c.toName:c.fromName,incoming:c.to===Number(user.id),expiresAt:c.expiresAt}))});
  });
  route('post','/api/friends/request',async (req,res,user)=> {await store.request(user.id,req.body.username);res.json({ok:true});});
  route('post','/api/friends/action',async (req,res,user)=> {
    await store.act(user.id,req.body.userId,req.body.action);
    for(const [id,c] of challenges) if ([c.from,c.to].includes(Number(user.id)) && [c.from,c.to].includes(req.body.userId)) challenges.delete(id);
    res.json({ok:true});
  });
  route('post','/api/friends/challenge',async (req,res,user)=> {
    const other = req.body.userId;
    if (!Number.isSafeInteger(other) || !await store.areFriends(user.id,other)) throw Error('You can only challenge an accepted friend.');
    const from = available(user.id), to = available(other);
    if (!from || !to) throw Error('Both players must be on Friends and available to play.');
    if ([...challenges.values()].some(c=>[c.from,c.to].includes(Number(user.id))||[c.from,c.to].includes(other))) throw Error('One player already has a pending challenge.');
    const id=randomUUID();
    challenges.set(id,{id,from:Number(user.id),to:other,fromName:user.username,toName:to.data.username,fromPlayer:from.data.playerId,toPlayer:to.data.playerId,expiresAt:Date.now()+60000});
    res.json({ok:true});
  });
  route('post','/api/friends/respond',async (req,res,user)=> {
    const c=challenges.get(req.body.id);
    if (!c || ![c.from,c.to].includes(Number(user.id))) throw Error('This challenge has expired or was cancelled.');
    if (req.body.action === 'accept') {
      if(c.to!==Number(user.id)) throw Error('Only the invited player can accept.');
      if(!await store.areFriends(c.from,c.to)) throw Error('This friendship is no longer available.');
      // Recheck after the database await: a simultaneous accept must not start two games.
      if(challenges.get(c.id)!==c || c.expiresAt<=Date.now()) throw Error('This challenge has expired.');
      const from=available(c.from),to=available(c.to);
      if(!from||!to||from.data.playerId!==c.fromPlayer||to.data.playerId!==c.toPlayer) throw Error('A player is no longer available.');
      challenges.delete(c.id);
      createGame(c.fromPlayer,c.toPlayer,'friend');
    } else if(req.body.action==='decline'||req.body.action==='cancel') challenges.delete(c.id);
    else throw Error('Invalid action.');
    res.json({ok:true});
  });
  return store;
}
module.exports={installFriends};
