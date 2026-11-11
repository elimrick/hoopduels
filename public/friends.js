(async function () {
  await window.HoopState.init();
  const token=window.HoopState.getToken();
  const content=document.getElementById('friends-content');
  if(!window.HoopState.getProfile().signedIn){document.getElementById('friends-auth').hidden=false;return;}
  content.hidden=false;
  const message=document.getElementById('friends-message');
  const socket=io({auth:{playerId:window.HoopState.getClientId(),token}});
  let navigating=false,busy=false,lastData='';
  async function api(path,body) {
    const response=await fetch('/api/friends'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not load friends.');return result;
  }
  async function action(path,body,success) {
    if(busy)return;busy=true;
    try {await api(path,body);message.textContent=success;await refresh();}catch(e){message.textContent=e.message;}finally{busy=false;}
  }
  function row(container,name,detail,buttons,rating=null) {
    let table=container.querySelector('table');
    if(!table){
      table=document.createElement('table');table.className='leaderboard-table friends-table';
      table.innerHTML='<thead><tr><th scope="col">Player</th><th scope="col">Actions</th></tr></thead><tbody></tbody>';
      table.setAttribute('aria-labelledby',container.id+'-heading');container.append(table);
    }
    const el=document.createElement('tr');
    const copy=document.createElement('td'),strong=document.createElement('strong'),small=document.createElement('small');
    strong.textContent=name;small.textContent=detail;copy.append(strong);
    if(rating!==null){const badge=document.createElement('span');badge.className='friend-rating';badge.textContent=String(rating);badge.setAttribute('aria-label','Rating '+rating);copy.append(badge);}
    copy.append(small);el.append(copy);
    const actions=document.createElement('td');actions.className='friend-actions';
    for(const [label,fn,disabled] of buttons){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=label;b.disabled=!!disabled;if(disabled)b.title='Both players need Friends open and must not already be in a game.';b.addEventListener('click',fn);actions.append(b);}
    el.append(actions);table.querySelector('tbody').append(el);
  }
  async function refresh() {
    if(navigating)return;
    try {
      const data=await api('');const serial=JSON.stringify(data);if(serial===lastData)return;lastData=serial;
      const list=document.getElementById('friend-list'),requests=document.getElementById('friend-requests'),challenges=document.getElementById('friend-challenges');
      list.replaceChildren();requests.replaceChildren();challenges.replaceChildren();
      for(const f of data.friends){const act=(actionName)=>action('/action',{userId:Number(f.id),action:actionName},actionName==='accept'?'Friend added.':'Removed.');
        if(Number(f.accepted))row(list,f.username,(f.online?'Online':'Offline')+' · Your record: '+f.record.wins+'–'+f.record.losses,[
          ['Challenge',()=>action('/challenge',{userId:Number(f.id)},'Challenge sent. It expires in one minute.'),!f.available],['Remove',()=>act('remove')]],f.rating);
        else row(requests,f.username,f.incoming?'Wants to add you as a friend':'Request sent',f.incoming?[['Accept',()=>act('accept')],['Decline',()=>act('remove')]]:[['Cancel request',()=>act('remove')]]);
      }
      for(const c of data.challenges){const respond=(a)=>action('/respond',{id:c.id,action:a},a==='accept'?'Starting game...':'Challenge closed.');row(challenges,c.username,c.incoming?'Challenged you to an unranked duel':'Waiting for a response',c.incoming?[['Accept challenge',()=>respond('accept')],['Decline',()=>respond('decline')]]:[['Cancel challenge',()=>respond('cancel')]]);}
      if(!list.children.length)list.textContent='No friends yet. Add someone by username above.';
      if(!requests.children.length)requests.textContent='No pending requests.';
      challenges.closest('.friends-section').hidden=!challenges.children.length;
      document.getElementById('friend-request-count').textContent=String(data.friends.filter(f=>!Number(f.accepted)).length);
    }catch(e){message.textContent=e.message;}
  }
  const input=document.getElementById('friend-username');
  await window.HoopAutocomplete.attach(input, {
    label:'Usernames',emptyText:'No matching accounts. Try another username.',
    search:async query=>(await api('/search?q='+encodeURIComponent(query))).users.map(user=>user.username),
    onSelect:()=>{document.getElementById('friend-search-help').textContent='Select Send request to add this account.';}
  });
  document.getElementById('friend-add-form').addEventListener('submit',async e=>{e.preventDefault();await action('/request',{username:document.getElementById('friend-username').value.trim()},'Friend request sent.');});
  socket.on('session:ready',()=>{socket.emit('friends:ready');message.textContent='';refresh();});
  socket.on('game:state',()=>{navigating=true;window.location.href='/game';});
  socket.on('auth:invalid',()=>{message.textContent='Your session expired. Sign in again.';socket.disconnect();});
  socket.on('disconnect',reason=>{if(!navigating)message.textContent=reason==='io server disconnect'?'Friends is open in another tab. Reload this page to play here.':'Reconnecting to Friends...';});
  await refresh();const timer=setInterval(refresh,3000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);socket.disconnect();});
})();
