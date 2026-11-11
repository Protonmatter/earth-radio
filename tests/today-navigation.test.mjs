import test from 'node:test';
import assert from 'node:assert/strict';
import {launchDestination,primaryDestination} from '../site/assets/responsive-ui.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function routeFixture(){
 const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8'),name=html.match(/assets\/(index-[\w-]{8}\.js)/)[1];
 const source=await readFile(new URL('../site/assets/'+name,import.meta.url),'utf8'),listeners=new Map(),values=[];
 const location={hash:'#listen'},context={location,URLSearchParams,yo:false,bo:()=>location.hash,
  history:{replaceState:(_state,_title,hash)=>{location.hash=hash;}},window:{addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name)}};
 vm.runInNewContext(source.slice(source.indexOf('function xo('),source.indexOf('function Co(')),context);
 context.So(value=>values.push(value));return{context,values,change:hash=>{location.hash=hash;listeners.get('hashchange')();}};
}
test('a programmatic replace does not consume the next actual user hash change',async()=>{
 const fixture=await routeFixture();fixture.context.xo({});fixture.change('#countries=Germany&minQuality=90');
 assert.deepEqual(fixture.values,['#countries=Germany&minQuality=90']);
});
test('a real programmatic hash assignment suppresses only its own feedback event',async()=>{
 const fixture=await routeFixture();fixture.context.xo({station:'selected'},{replace:false});fixture.change('#station=selected');
 assert.deepEqual(fixture.values,[]);fixture.change('#countries=Germany');assert.deepEqual(fixture.values,['#countries=Germany']);
});
test('launch is Today unless the URL explicitly selects a legacy view or station',()=>{
 assert.equal(launchDestination(''),'today');assert.equal(launchDestination('#today'),'today');
 for(const destination of ['listen','search','map','saved','you'])assert.equal(launchDestination('#'+destination),destination);
 assert.equal(launchDestination('#station=abc'),'listen');
 assert.equal(launchDestination('#view=favorites'),'saved');assert.equal(launchDestination('#view=recent'),'saved');
 assert.equal(launchDestination('#unknown'),'listen');
});
test('three primary destinations group every retained internal destination',()=>{
 for(const destination of ['today','map'])assert.equal(primaryDestination(destination),'atlas');
 for(const destination of ['saved','you'])assert.equal(primaryDestination(destination),'library');
 for(const destination of ['listen','search'])assert.equal(primaryDestination(destination),'search');
});
test('explicit reload/back navigation preserves the current workflow while a fresh root starts Today',()=>{
 for(const navigationType of ['reload','back_forward'])for(const previousDestination of ['listen','search','saved','you','today','map'])assert.equal(launchDestination('',{navigationType,previousDestination}),previousDestination);
 assert.equal(launchDestination('',{navigationType:'navigate',previousDestination:'listen'}),'today');
 assert.equal(launchDestination('',{navigationType:'reload',previousDestination:'invalid'}),'today');
 for(const hash of ['#station=legacy-alias','#view=favorites','#q=jazz'])assert.equal(launchDestination(hash,{navigationType:'reload',previousDestination:'you'}),'you');
 assert.equal(launchDestination('#station=legacy-alias',{navigationType:'navigate',previousDestination:'you'}),'listen');
 for(const hash of ['#q=jazz','#countries=KR','#tags=jazz','#bitrates=128','#secure=1','#minQuality=80','#view=similar'])assert.equal(launchDestination(hash),'listen',hash);
});
