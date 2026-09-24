const form=document.querySelector('form'),message=document.querySelector('#message'),button=document.querySelector('#submit');
fetch('/api/auth/me',{cache:'no-store'}).then(r=>{if(r.ok)location.replace('/dashboard');}).catch(()=>{});
form.addEventListener('submit',async e=>{
  e.preventDefault();button.disabled=true;message.textContent='';
  try {
    const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form))),signal:AbortSignal.timeout(15000)});
    const data=await res.json();if(!res.ok)throw Error(data.error);location.replace('/dashboard');
  }catch(e){message.textContent=e.message || 'Sign-in failed.';button.disabled=false;}
});
