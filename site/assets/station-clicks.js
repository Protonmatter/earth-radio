// Radio Browser counters accept directory UUIDs only. No persistent history,
// account IDs, timers or retry loop: a response can be lost after acceptance.
export function isRadioBrowserUuid(value) {
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function createStationClickReporter(send) {
  if(typeof send!=='function')throw new TypeError('A click sender is required');
  const reported=new Set();
  return async station=>{
    if(!isRadioBrowserUuid(station?.stationuuid))return null;
    const uuid=station.stationuuid.toLowerCase();
    if(reported.has(uuid))return null;
    // Reserve before async I/O: reconnects and repeated events can overlap.
    reported.add(uuid);
    try{return await send({...station,stationuuid:uuid});}catch{return null;}
  };
}
