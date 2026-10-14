export function startHardwareStatus(){
  const definitions=[['motors','Motors'],['thermal','Thermal'],['dslr','DSLR'],['imu','IMU'],['lidar','LiDAR'],['realsense','RealSense'],['insta360','Insta360'],['lidar3d','3D LiDAR'],['leds','LEDs'],['webcam','Webcam']];
  const grid=document.getElementById('hardware-grid'),controls=new Map();
  for(const [id,name] of definitions){
    const row=document.createElement('label');row.className='hardware-node';row.dataset.state='error';
    const check=document.createElement('input');check.type='checkbox';check.disabled=true;check.setAttribute('aria-label',name+' node status');
    const label=document.createElement('span');label.textContent=name;row.append(check,label);grid.append(row);controls.set(id,{row,check});
  }
  let running=true,timer;
  function render(data,error){
    for(const [id,{row,check}] of controls){const item=data?.items?.find(i=>i.id===id);check.checked=!error&&item?.ok===true;row.dataset.state=check.checked?'ready':'error';row.title=error||item?.detail||'Status unavailable';}
    for(const [id,target,unit] of [['robot_temp','robot-temp','°C'],['led_temp','led-temp','°C'],['battery_percentage','battery-value','%']]){
      const item=data?.items?.find(i=>i.id===id),el=document.getElementById(target);
      el.textContent=(!error&&item?.ok===true&&Number.isFinite(item.value)?item.value.toFixed(1):'—')+' '+unit;
      el.title=error||item?.detail||'No sensor data';
    }
    const insta=data?.items?.find(i=>i.id==='insta360');
    document.getElementById('insta-reading').textContent=error?'Unavailable':insta?.ok?'Online':'Offline';
  }
  async function poll(){
    try{const r=await fetch('/api/hardware/status',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Status unavailable');const data=await r.json();if(!Array.isArray(data.items))throw Error('Invalid status');if(running)render(data);}
    catch{if(running)render(null,'Status unavailable');}
    if(running)timer=setTimeout(poll,3000);
  }
  render(null,'Checking…');poll();
  const offline=()=>render(null,'Connection lost');window.addEventListener('offline',offline);
  return ()=>{running=false;clearTimeout(timer);window.removeEventListener('offline',offline);};
}
