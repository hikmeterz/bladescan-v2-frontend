import { sectionLabel } from '../lib/format.js';
// Catalog selection UI; the same plant/turbine relationship is checked by the API.
export function createInspectionOptions({form,button,message,request,isBusy}){
  const fields=['plant','turbine','blade','section'].map(name=>form.elements.namedItem(name));
  const [plant,turbine,blade,section]=fields;
  let catalog=null,loading=false,epoch=0;
  function fill(select,values,label){
    select.replaceChildren(new Option(label,''),...values.map(v=>new Option(v,v)));
    select.value='';
  }
  function sync(){
    const busy=isBusy();
    plant.disabled=busy||loading||!catalog;
    turbine.disabled=busy||loading||!catalog||!plant.value;
    blade.disabled=section.disabled=busy||loading||!catalog;
    button.disabled=busy||loading||!catalog||!fields.every(f=>f.value);
  }
  plant.addEventListener('change',()=>{
    fill(turbine,catalog?.plants.find(p=>p.name===plant.value)?.turbines||[],'Select a turbine');
    sync();
  });
  for(const f of [turbine,blade,section])f.addEventListener('change',sync);
  async function open(){
    const mine=++epoch;catalog=null;loading=true;
    fill(plant,[],'Loading plants…');fill(turbine,[],'Select a plant first');
    fill(blade,[],'Choose blade');fill(section,[],'Choose a section');
    message.textContent='Loading inspection options…';sync();
    try{
      const data=await request('/api/inspection-options');
      if(mine!==epoch)return;
      if(!Array.isArray(data.plants)||!data.plants.length||!Array.isArray(data.blades)||!Array.isArray(data.sections))throw Error('Inspection options could not be loaded.');
      catalog=data;fill(plant,data.plants.map(p=>p.name),'Select a plant');
      fill(blade,data.blades,'Choose blade');fill(section,data.sections,'Choose a section');for(const o of section.options)if(o.value)o.textContent=sectionLabel(o.value);
      message.textContent='';
    }catch(e){if(mine===epoch)message.textContent=e.message+' Close and reopen this form to retry.';}
    finally{if(mine===epoch){loading=false;sync();}}
  }
  function valid(){
    return !!catalog && !loading && fields.every(f=>f.value) &&
      !!catalog.plants.find(p=>p.name===plant.value)?.turbines.includes(turbine.value) &&
      catalog.blades.includes(blade.value)&&catalog.sections.includes(section.value);
  }
  return {open,sync,valid};
}
