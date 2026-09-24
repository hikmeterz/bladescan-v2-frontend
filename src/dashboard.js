const $=id=>document.getElementById(id);
const labels={submitted:'Preparing',running:'In progress',finalizing:'Finalizing',succeeded:'Completed',aborted:'Failed',canceled:'Canceled',not_sent:'Not sent',unknown:'Outcome unknown'};
const roles={admin:'Administrator',operator:'Operator',viewer:'Viewer'};
const date=n=>n?new Date(n).toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'}):'—';
const meters=n=>Number(n||0).toLocaleString('en-GB',{maximumFractionDigits:2})+' m';
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let me,page=1,pages=1,loading=0,statusBusy=false,starting=false,startUncertain=false;
async function request(path,body){
  const r=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(r.status===401){location.replace('/login');throw Error('Session expired.');}
  if(!r.ok)throw Object.assign(Error(data.error || 'Operation failed.'),{status:r.status});return data;
}
function pill(state){const p=node('span',labels[state]||state,'pill');p.dataset.state=state;return p;}
async function load(){
  const epoch=++loading;$('count').textContent='Loading inspections…';
  try {
    const params=new URLSearchParams({page,q:$('query').value,state:$('state').value});
    const data=await request('/api/inspections?'+params);if(epoch!==loading)return;
    pages=data.pages;
    $('rows').replaceChildren();$('empty').hidden=!!data.items.length;
    for(const r of data.items){
      const tr=node('tr'),locationCell=node('td');locationCell.append(node('strong',r.plant),node('small',r.turbine));tr.append(locationCell);
      tr.append(node('td',r.blade+' / '+r.section),node('td',date(r.created_at)),node('td',meters(r.distance_m)));
      const state=node('td');state.append(pill(r.state));tr.append(state);
      const action=node('td'),button=node('button','Detay →');button.addEventListener('click',()=>detail(r.request_id));action.append(button);tr.append(action);$('rows').append(tr);
    }
    $('total').textContent=data.stats.total;$('completed').textContent=data.stats.completed;$('attention').textContent=data.stats.attention;$('distance').textContent=meters(data.stats.distance_m);
    $('count').textContent=data.total+' records';$('page').textContent=page+' / '+pages;$('prev').disabled=page<=1;$('next').disabled=page>=pages;
  }catch(e){$('message').textContent=e.message;$('count').textContent='Could not load inspections.';}
}
async function status(){
  if(statusBusy)return;statusBusy=true;
  try {
    const [c,r]=await Promise.all([request('/api/inspections/current'),request('/api/robot/state')]);
    const banner=$('banner');banner.replaceChildren();banner.classList.toggle('warn',!!c.robot_busy || !r.rosbridgeConnected || r.stale);
    let text=!r.rosbridgeConnected?'Waiting for robot connection.':r.stale?'Robot data is stale.':'Robot connected · Ready for a new inspection.';
    if(c.blocked)text='Robot is busy with another inspection or one with no assigned owner.';
    if(c.active)text=c.inspection.state==='unknown'?'Inspection outcome is unknown. Check its status before starting a new recording.':'You have an inspection in progress.';
    banner.append(node('span',text));
    if(c.active){const a=node('a','Return to inspection →');a.href='/inspection';banner.append(a);}
    $('new-button').disabled=starting || startUncertain || me.role==='viewer' || c.robot_busy || !r.rosbridgeConnected || r.stale;
    if(startUncertain && c.active && c.inspection?.operator_user_id===me.id){location.assign('/inspection');}
  }catch(e){$('banner').textContent='Connection unavailable. '+e.message;$('new-button').disabled=true;}
  finally{statusBusy=false;}
}
async function detail(id){
  const dialog=$('detail-dialog');$('detail-title').textContent='Loading…';$('detail-body').replaceChildren();dialog.showModal();
  try{
    const d=await request('/api/inspections/'+id);if(!dialog.open)return;
    const r=d.inspection;$('detail-title').textContent=r.plant+' / '+r.turbine;
    const out=$('detail-body');out.append(pill(r.state));const grid=node('div',undefined,'detail-grid');
    for(const [key,value] of [['Operator',r.operator_name_snapshot],['Blade / Section',r.blade+' / '+r.section],['Started',date(r.created_at)],['Finished',date(r.finished_at)],['Distance',meters(r.distance_m)],['Inspection ID',r.ros_inspection_id||'Not assigned yet']]){
      const p=node('p');p.append(node('small',key),document.createTextNode(value));grid.append(p);
    }
    out.append(grid,node('p',r.message,'muted small'),node('h3','Recordings'));
    const c=d.camera;
    out.append(node('p',c?.validated?'Preview: all frames validated.':c?.quick_checked?'Preview: quick file check passed. Full frame validation was not performed.':'No preview validation information.','muted small'));
    out.append(node('p',d.native?'Native recording metadata is available. This does not confirm that INSV files were downloaded to Jetson.':'Native recording metadata was not found.','muted small'));
    if(!d.assets.length)out.append(node('p','No media files available.','muted'));
    for(const a of d.assets){const row=node('div',undefined,'asset');row.append(node('span',(a.kind==='preview'?'Preview MP4':'Native recording metadata')+' · '+(a.size_bytes/1048576).toFixed(1)+' MB'));
      const link=node('a','Open ↗');link.href='/api/assets/'+a.id;link.target='_blank';link.rel='noopener';row.append(link);out.append(row);}
    out.append(node('h3','Event history'));
    for(const e of d.events){const item=node('div',undefined,'event');item.append(node('small',date(e.occurred_at)+' · '+(labels[e.event_type]||e.event_type)),node('span',e.message));out.append(item);}
  }catch(e){$('detail-title').textContent='Could not load details';$('detail-body').textContent=e.message;}
}
async function users(){
  try{const d=await request('/api/users');$('users-list').replaceChildren(...d.users.map(u=>node('p',u.display_name+' · '+u.username+' · '+roles[u.role]+(u.is_active?'':' · Pasif'))));}catch(e){$('user-message').textContent=e.message;}
}
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
$('filters').addEventListener('submit',e=>{e.preventDefault();page=1;load();});
$('prev').addEventListener('click',()=>{if(page>1){page--;load();}});$('next').addEventListener('click',()=>{if(page<pages){page++;load();}});
$('refresh').addEventListener('click',()=>{load();status();});
$('new-button').addEventListener('click',()=>{$('start-message').textContent='';$('new-dialog').showModal();});
$('new-form').addEventListener('submit',async e=>{
  e.preventDefault();if(starting || startUncertain)return;starting=true;$('start').disabled=true;$('start-message').textContent='Starting inspection…';
  try{const d=await request('/api/inspections',Object.fromEntries(new FormData(e.target)));if(!d.inspection?.request_id)throw Error('Response could not be verified.');location.assign('/inspection');}
  catch(e){startUncertain=!e.status || e.status>=500;$('start-message').textContent=e.message+(startUncertain?' Checking the request outcome; it will not be sent again.':'');}
  finally{starting=false;$('start').disabled=startUncertain;status();}
});
$('logout').addEventListener('click',async()=>{try{await request('/api/auth/logout',{});location.replace('/login');}catch(e){$('message').textContent=e.message;}});
$('users-button').addEventListener('click',()=>{$('users-dialog').showModal();users();});
$('user-form').addEventListener('submit',async e=>{e.preventDefault();$('create-user').disabled=true;$('user-message').textContent='';try{await request('/api/users',Object.fromEntries(new FormData(e.target)));e.target.reset();$('user-message').textContent='User created.';users();}catch(e){$('user-message').textContent=e.message;}finally{$('create-user').disabled=false;}});
try {me=(await request('/api/auth/me')).user;$('user-name').textContent=me.display_name;$('user-role').textContent=roles[me.role];$('avatar').textContent=me.display_name.slice(0,1).toLocaleUpperCase('en-GB');$('users-button').hidden=me.role!=='admin';await Promise.all([load(),status()]);setInterval(()=>{if(!document.hidden)status();},4000);}catch(e){$('message').textContent=e.message;}
