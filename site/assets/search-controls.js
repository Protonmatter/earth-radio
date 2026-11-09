import {installFacetPicker} from './facet-picker.js?v=0.32.0';
import {matchesCountry} from './search-core.js?v=0.32.0';
import {getLocale,t} from '../i18n/index.js?v=0.32.0';

export function installSearchControls(root,adapter){
  const query=root.elements.namedItem('query'),clear=root.querySelector('[data-discovery-clear-query]'),country=root.querySelector('[data-search-country]');
  const main=document.getElementById('er-discovery-active'),palette=document.getElementById('er-search-active'),recovery=document.getElementById('er-search-recovery');
  let lastCount=null;
  const text=(key,params)=>t(`discovery.${key}`,params);
  const pickers=['genre','language'].map(name=>installFacetPicker(root.elements.namedItem(name),()=>({search:text(name==='genre'?'searchGenres':'searchLanguages'),options:text(name),all:text(name==='genre'?'allGenres':'allLanguages'),caption:text('loadedCatalog'),empty:text('noOptions')})));
  function clearQuery(){query.value='';query.dispatchEvent(new Event('input',{bubbles:true}));root.requestSubmit();query.focus();}
  clear.addEventListener('click',clearQuery);
  query.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&query.value){event.preventDefault();event.stopPropagation();clearQuery();}});
  function choice(name,value){const input=root.elements.namedItem(name);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}
  function labelCountry(value){
    const option=[...document.querySelectorAll('#filter-countries input')].map(input=>({name:input.value,code:''})).find(option=>matchesCountry({country:option.name},value));
    if(option)return option.name==='The Republic Of Korea'?'South Korea':option.name;
    try{if(/^[A-Z]{2}$/.test(value))return new Intl.DisplayNames([getLocale()],{type:'region'}).of(value);}catch{/* raw label remains usable */}
    return value;
  }
  function constraints(){
    const prefs=adapter.preferences(),context=adapter.context(),legacy=context.filters||{},items=[];
    const add=(label,remove)=>items.push({label,remove});
    for(const field of ['genre','language'])if(prefs[field])add(`${text(field)}: ${root.elements.namedItem(field).selectedOptions[0]?.textContent||prefs[field]}`,()=>choice(field,''));
    if(prefs.minBitrate)add(`${prefs.minBitrate}+ kbps`,()=>choice('minBitrate','0'));
    if(prefs.secureOnly)add(text('https'),()=>{root.elements.namedItem('secureOnly').checked=false;adapter.readControls();});
    if(prefs.avoidFailures)add(text('hideFailures'),()=>{root.elements.namedItem('avoidFailures').checked=false;adapter.readControls();});
    if(prefs.sort!=='best')add(root.elements.namedItem('sort').selectedOptions[0]?.textContent||prefs.sort,()=>choice('sort','best'));
    for(const [field,label]of [['countries','country'],['tags','genre'],['bitrates','bitrate']])for(const value of legacy[field]||[]){
      add(`${text(label)}: ${field==='countries'?labelCountry(value):value}`,()=>adapter.patchFilters({[field]:legacy[field].filter(item=>item!==value)}));
    }
    if(legacy.secureOnly)add(text('https'),()=>adapter.patchFilters({secureOnly:false}));
    if(legacy.minQuality>0)add(text('quality',{count:legacy.minQuality}),()=>adapter.patchFilters({minQuality:0}));
    if(['favorites','recent','similar'].includes(context.view))add(text(context.view),()=>adapter.showAll());
    if(adapter.hasArea())add(text('mapArea'),()=>adapter.clearArea());
    return{items,prefs,context,legacy};
  }
  function resetFilters(){const value=query.value;adapter.reset();query.value=value;adapter.readControls();}
  function render(count=lastCount){
    lastCount=count;const {items,prefs,legacy}=constraints();
    clear.hidden=!query.value;clear.setAttribute('aria-label',text('clearQuery'));clear.title=text('clearQuery');
    country.setAttribute('aria-label',text('chooseCountry'));
    const countries=legacy.countries||[];
    country.textContent=countries.length===1?`${text('country')}: ${labelCountry(countries[0])}`:countries.length?text('countries',{count:countries.length}):text('allCountries');country.title=country.textContent;
    root.querySelector('summary').setAttribute('data-filter-count',String(items.length));
    for(const target of [main,palette]){
      if(!target)continue;target.hidden=!items.length&&!prefs.query;target.replaceChildren();
      const rail=document.createElement('div');rail.className='er-active-rail';
      for(const item of items){
        const button=document.createElement('button');button.type='button';button.className='er-active-chip';button.setAttribute('aria-label',text('remove',{label:item.label}));
        const name=document.createElement('span');name.textContent=item.label;const cross=document.createElement('span');cross.textContent='×';cross.setAttribute('aria-hidden','true');button.append(name,cross);
        button.addEventListener('click',()=>{item.remove();if(!button.isConnected)(target===palette?document.getElementById('er-station-query'):query)?.focus({preventScroll:true});});rail.append(button);
      }
      const reset=document.createElement('button');reset.type='button';reset.className='er-search-reset';reset.textContent=text('clearAll');reset.setAttribute('aria-label',target===main?'Reset discovery':text('clearAll'));
      reset.addEventListener('click',()=>{adapter.reset();(target===palette?document.getElementById('er-station-query'):query)?.focus();});target.append(rail,reset);
    }
    recovery.hidden=count!==0||(!prefs.query&&!items.length);root.classList.toggle('er-has-recovery',!recovery.hidden);recovery.replaceChildren();
    if(!recovery.hidden){
      const heading=document.createElement('p');heading.className='er-search-recovery-title';heading.textContent=text('noStations');recovery.append(heading);
      const help=document.createElement('p');help.textContent=text('recoveryHelp');recovery.append(help);
      if(prefs.query){const button=document.createElement('button');button.type='button';button.textContent=text('clearQuery');button.addEventListener('click',clearQuery);recovery.append(button);}
      if(items.length){const button=document.createElement('button');button.type='button';button.textContent=text('resetFilters');button.addEventListener('click',resetFilters);recovery.append(button);}
    }
    pickers.forEach(picker=>picker.refresh());
  }
  new MutationObserver(()=>render()).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  return{render};
}
