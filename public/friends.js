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
  async function action(path,body,success='') {
    if(busy)return;busy=true;
    try {await api(path,body);message.textContent=success;await refresh();}catch(e){message.textContent=e.message;}finally{busy=false;}
  }
  function row(container,name,detail,buttons,rating=null,online=null) {
    let table=container.querySelector('table');
    if(!table){
      table=document.createElement('table');table.className='leaderboard-table friends-table';
      table.innerHTML='<thead><tr><th scope="col">Player</th><th scope="col">Actions</th></tr></thead><tbody></tbody>';
      table.setAttribute('aria-labelledby',container.id+'-heading');container.append(table);
    }
    const el=document.createElement('tr');
    const copy=document.createElement('td'),strong=document.createElement('strong'),small=document.createElement('small');
    strong.textContent=name;small.textContent=detail;copy.append(strong);
    if (online !== null) {
      const status=document.createElement('span');
      status.className=online ? 'friend-online' : 'friend-offline';
      status.textContent=online ? 'Online' : 'Offline';
      small.prepend(status, ' · ');
    }
    if(rating!==null){const badge=document.createElement('span');badge.className='friend-rating';badge.textContent='('+rating+')';badge.setAttribute('aria-label','Rating '+rating);copy.append(badge);}
    if (detail || online !== null) copy.append(small);
    el.append(copy);
    const actions=document.createElement('td');actions.className='friend-actions';
    for (const [label, fn, disabled] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = label.startsWith('Accept') ? 'btn' : 'btn btn-secondary';
      button.textContent = label;
      if (label === 'Remove') {
        button.classList.add('friend-remove');
        button.textContent = '×';
        button.setAttribute('aria-label', 'Remove ' + name);
      }
      button.disabled = Boolean(disabled);
      if (disabled && label === 'Challenge') button.title = 'Both players need Friends open and must not already be in a game.';
      button.addEventListener('click', fn);
      actions.append(button);
    }
    el.append(actions);table.querySelector('tbody').append(el);
  }
  async function refresh() {
    if(navigating)return;
    try {
      const data=await api('');const serial=JSON.stringify(data);if(serial===lastData)return;lastData=serial;
      const list=document.getElementById('friend-list'),requests=document.getElementById('friend-requests');
      list.replaceChildren();requests.replaceChildren();
      for (const f of data.friends) {
        const act=actionName=>action('/action',{userId:Number(f.id),action:actionName});
        if (Number(f.accepted)) {
          const challenge=data.challenges.find(c=>c.username===f.username);
          const buttons = challenge
            ? (challenge.incoming
                ? [['Accept challenge', () => action('/respond', {id:challenge.id, action:'accept'})],
                   ['Decline', () => action('/respond', {id:challenge.id, action:'decline'})]]
                : [['Cancel challenge', () => action('/respond', {id:challenge.id, action:'cancel'})]])
            : [['Challenge', () => action('/challenge', {userId:Number(f.id)}), !f.available]];
          buttons.push(['Remove',()=>{
            if(window.confirm(`Remove ${f.username} from your friends?`))act('remove');
          }]);
          row(list,f.username,'Your record: '+f.record.wins+'–'+f.record.losses,buttons,f.rating,f.online);
        } else {
          row(requests,f.username,f.incoming?'':'Request sent',
            f.incoming?[['Accept',()=>act('accept')],['Decline',()=>act('remove')]]:[['Cancel request',()=>act('remove')]], f.rating);
        }
      }
      if(!list.children.length)list.textContent='No friends yet. Add someone by username above.';
      if(!requests.children.length)requests.textContent='No pending requests.';
      document.getElementById('friend-request-count').textContent=String(data.friends.filter(f=>!Number(f.accepted)).length);
    }catch(e){message.textContent=e.message;}
  }
  const input=document.getElementById('friend-username');
  await window.HoopAutocomplete.attach(input, {
    label:'Usernames',emptyText:'No matching accounts. Try another username.',
    search:async query=>(await api('/search?q='+encodeURIComponent(query))).users.map(user=>user.username)
  });
  document.getElementById('friend-add-form').addEventListener('submit',async e=>{e.preventDefault();await action('/request',{username:document.getElementById('friend-username').value.trim()},'Friend request sent.');});
  socket.on('session:ready',()=>{socket.emit('friends:ready');message.textContent='';refresh();});
  socket.on('game:state',()=>{navigating=true;window.location.href='/game';});
  socket.on('auth:invalid',()=>{message.textContent='Your session expired. Sign in again.';socket.disconnect();});
  socket.on('disconnect',reason=>{if(!navigating)message.textContent=reason==='io server disconnect'?'Friends is open in another tab. Reload this page to play here.':'Reconnecting to Friends...';});
  await refresh();const timer=setInterval(refresh,3000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);socket.disconnect();});
})();
