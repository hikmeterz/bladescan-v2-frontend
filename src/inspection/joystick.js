export function joystickVector(dx,dy,radius,level=3){
  const r=Math.max(1,radius),distance=Math.hypot(dx,dy);
  const scale=Math.min(1,r/Math.max(1,distance));
  const x=dx*scale/r,y=dy*scale/r;
  const magnitude=Math.hypot(x,y),deadzone=0.12;
  if(magnitude<=deadzone)return {x,y,linear:0,angular:0};
  const sensitivity=(magnitude-deadzone)/(1-deadzone)/magnitude;
  const speed=Math.max(1,Math.min(5,Number(level)||1))/5;
  return {x,y,linear:Math.max(-.2,Math.min(.2,-y*sensitivity*.2*speed)),angular:Math.max(-2,Math.min(2,-x*sensitivity*2*(.5+.5*speed)))};
}
export function attachJoystick({pad,knob,speed,onVector,onStop,isReady}){
  let pointer=null,enabled=false,keys=new Set();
  const arrows=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
  function visual(x=0,y=0){const radius=pad.clientWidth*.29;knob.style.transform=`translate(${x*radius}px, ${y*radius}px)`;pad.classList.toggle('engaged',!!(x||y));}
  function reset(){const previous=pointer;pointer=null;keys.clear();visual();if(previous!==null){try{pad.releasePointerCapture(previous);}catch{}}}
  function stop(){reset();onStop();}
  function update(event){
    if(!enabled||!isReady()){stop();return;}
    const bounds=pad.getBoundingClientRect();
    const v=joystickVector(event.clientX-bounds.left-bounds.width/2,event.clientY-bounds.top-bounds.height/2,bounds.width*.38,speed.value);
    visual(v.x,v.y);onVector(v.linear,v.angular);
  }
  pad.addEventListener('pointerdown',event=>{
    if(!enabled||!isReady()||pointer!==null||event.button!==0)return;
    event.preventDefault();keys.clear();pointer=event.pointerId;
    pad.focus({preventScroll:true});
    try{pad.setPointerCapture(pointer);}catch{stop();return;}
    update(event);
  });
  pad.addEventListener('pointermove',event=>{if(event.pointerId===pointer){event.preventDefault();update(event);}});
  const release=event=>{if(event.pointerId===pointer)stop();};
  pad.addEventListener('pointerup',release);pad.addEventListener('pointercancel',release);pad.addEventListener('lostpointercapture',release);
  pad.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key===' '){event.preventDefault();stop();return;}
    if(!arrows.has(event.key)||!enabled||!isReady()||pointer!==null)return;
    event.preventDefault();keys.add(event.key);
    const x=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft'));
    const y=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
    const v=joystickVector(x,y,1,speed.value);visual(v.x,v.y);onVector(v.linear,v.angular);
  });
  pad.addEventListener('keyup',event=>{if(arrows.has(event.key)){event.preventDefault();stop();}});
  pad.addEventListener('blur',stop);
  speed.addEventListener('input',stop);
  return {reset,setEnabled(value){enabled=!!value;pad.classList.toggle('is-disabled',!enabled);pad.setAttribute('aria-disabled',String(!enabled));speed.disabled=!enabled;if(!enabled&&(pointer!==null||keys.size))stop();}};
}
