// One listener action owns all its sibling attempts. No network or persisted data.
export function createPlaybackIntent({budgetMs=7500,now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),onExpire=()=>{}}={}) {
  if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>8000)throw new RangeError('Invalid connection budget');
  let current=null,timer=null,revision=0;
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  function arm(){
    clear();const token=current.token;
    timer=setTimer(()=>{
      timer=null;
      if(!current||current.token!==token||current.phase!=='connecting'||current.expired)return;
      if(now()<current.deadlineAt){arm();return;}
      current.expired=true;onExpire(current.station);
    },Math.max(0,current.deadlineAt-now()));
  }
  function canRecover(key){
    if(!current||current.key!==key||current.phase==='failed'||current.expired)return false;
    if(current.phase==='playing'){
      current.phase='connecting';current.deadlineAt=now()+budgetMs;arm();
    }
    return now()<current.deadlineAt;
  }
  return {
    begin(key,station,{intent='station',recovery=false}={}){
      if(typeof key!=='string'||!key||!station?.stationuuid)return null;
      if(recovery){if(!canRecover(key))return null;current.station=station;return current.token;}
      clear();current={key,station,token:++revision,intent:intent==='world-scan'?'world-scan':'station',phase:'connecting',deadlineAt:now()+budgetMs,expired:false};arm();return current.token;
    },
    canRecover,
    isCurrent:token=>Boolean(current&&current.token===token&&current.phase!=='failed'&&!current.expired),
    playing(key){
      if(!current||current.key!==key||current.phase==='failed'||current.expired||current.phase==='connecting'&&now()>=current.deadlineAt)return false;
      clear();current.phase='playing';return true;
    },
    canAutoSkip:()=>Boolean(current&&current.intent==='world-scan'&&current.phase!=='failed'),
    fail(key){if(!current||current.key!==key)return false;clear();current.phase='failed';return true;},
    cancel(){clear();current=null;revision++;},
    state:()=>current?Object.freeze({...current}):null
  };
}
