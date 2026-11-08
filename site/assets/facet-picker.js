import {filterFacetOptions} from './search-core.js?v=0.30.0';

// Progressive enhancement: the named select remains the form's value authority.
// DOM focus stays in the text input; only aria-activedescendant moves in the list.
export function installFacetPicker(select,copy){
  if(!select||select.dataset.facetEnhanced)return{refresh(){}};
  select.dataset.facetEnhanced='true';select.classList.add('er-facet-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const field=select.name,input=document.createElement('input'),list=document.createElement('div');
  input.id=`er-facet-${field}`;input.type='text';input.autocomplete='off';input.spellcheck=false;input.maxLength=64;
  input.className='er-facet-input';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
  list.id=`er-facet-${field}-list`;list.className='er-facet-list';list.setAttribute('role','listbox');list.hidden=true;
  input.setAttribute('aria-controls',list.id);select.after(input);document.body.append(list);
  const label=select.parentElement.querySelector('label');if(label)label.htmlFor=input.id;
  let open=false,composing=false,typed='',active=-1,visible=[];
  const choices=()=>[...select.options].filter(option=>option.value).map(option=>({value:option.value,label:option.textContent,count:Number(option.dataset.count)||0}));
  const selectedLabel=()=>select.selectedOptions[0]?.value?select.selectedOptions[0].textContent:'';
  function position(){
    if(!open)return;
    const box=input.getBoundingClientRect(),view=window.visualViewport;
    const left=view?.offsetLeft||0,top=view?.offsetTop||0,width=view?.width||innerWidth,height=view?.height||innerHeight;
    const availableBelow=top+height-box.bottom-8,availableAbove=box.top-top-8;
    const below=availableBelow>=150||availableBelow>=availableAbove,space=Math.max(72,Math.min(288,below?availableBelow:availableAbove));
    const menuWidth=Math.min(Math.max(box.width,220),width-16);
    list.style.width=`${menuWidth}px`;list.style.left=`${Math.max(left+8,Math.min(box.left,left+width-menuWidth-8))}px`;
    list.style.maxHeight=`${space}px`;list.style.top=below?`${box.bottom+4}px`:'auto';list.style.bottom=below?'auto':`${Math.max(4,innerHeight-box.top+4)}px`;
  }
  function paintActive(){
    const options=[...list.querySelectorAll('[role="option"]')];
    options.forEach((option,index)=>{option.classList.toggle('is-active',index===active);option.setAttribute('aria-selected',String(index===active));});
    if(options[active]){input.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
    else input.removeAttribute('aria-activedescendant');
  }
  function render(){
    const text=copy();input.setAttribute('aria-label',text.search);input.placeholder=text.all;list.setAttribute('aria-label',text.options);
    const old=visible[active]?.value;
    visible=filterFacetOptions(choices(),typed,typed?24:23);
    if(!typed)visible.unshift({value:'',label:text.all,count:0});
    if(!typed&&select.value&&!visible.some(option=>option.value===select.value)){
      visible.splice(1,0,{value:select.value,label:selectedLabel(),count:0});visible=visible.slice(0,24);
    }
    active=old===undefined?-1:visible.findIndex(option=>option.value===old);
    list.replaceChildren();
    const caption=document.createElement('p');caption.className='er-facet-caption';caption.textContent=text.caption;list.append(caption);
    if(!visible.length){const empty=document.createElement('p');empty.className='er-facet-empty';empty.textContent=text.empty;list.append(empty);}
    for(const [index,option]of visible.entries()){
      const button=document.createElement('button');button.type='button';button.tabIndex=-1;button.id=`er-facet-${field}-option-${index}`;
      button.className='er-facet-option';button.setAttribute('role','option');button.setAttribute('aria-selected','false');
      const name=document.createElement('span');name.textContent=option.label;
      const count=document.createElement('small');count.textContent=option.value?option.count.toLocaleString():'';count.setAttribute('aria-hidden','true');button.append(name,count);
      button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>choose(option));list.append(button);
    }
    paintActive();position();
  }
  function setOpen(next){
    if(open===next)return;
    open=next;list.hidden=!next;input.setAttribute('aria-expanded',String(next));
    if(next){render();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);window.visualViewport?.addEventListener('resize',position);}
    else{active=-1;typed='';input.value=selectedLabel();input.removeAttribute('aria-activedescendant');window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);window.visualViewport?.removeEventListener('resize',position);}
  }
  function choose(option){
    select.value=option.value;setOpen(false);input.value=selectedLabel();select.dispatchEvent(new Event('change',{bubbles:true}));input.focus({preventScroll:true});
  }
  input.addEventListener('focus',()=>{typed='';setOpen(true);input.select();});
  input.addEventListener('click',()=>{if(!open){typed='';setOpen(true);input.select();}});
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;typed=input.value;active=-1;setOpen(true);render();});
  input.addEventListener('input',event=>{
    if(composing||event.isComposing)return;typed=input.value;active=-1;setOpen(true);render();
    if(!typed&&select.value){select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  input.addEventListener('keydown',event=>{
    if(composing||event.isComposing||event.keyCode===229)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();setOpen(true);if(visible.length)active=active<0?(event.key==='ArrowDown'?0:visible.length-1):(active+(event.key==='ArrowDown'?1:-1)+visible.length)%visible.length;paintActive();
    }else if(event.key==='Enter'){
      event.preventDefault();event.stopPropagation();if(open&&visible.length)choose(visible[active<0?0:active]);
    }else if(event.key==='Escape'){
      if(open){event.preventDefault();event.stopPropagation();setOpen(false);}
    }else if(event.key==='Tab')setOpen(false);
  });
  input.addEventListener('blur',()=>{setOpen(false);});
  document.addEventListener('pointerdown',event=>{if(open&&!list.contains(event.target)&&event.target!==input)setOpen(false);});
  select.addEventListener('change',()=>{if(document.activeElement!==input)input.value=selectedLabel();if(open)render();});
  new MutationObserver(()=>{if(document.activeElement!==input)input.value=selectedLabel();if(open)render();}).observe(select,{childList:true});
  function refresh(){const text=copy();input.setAttribute('aria-label',text.search);input.placeholder=text.all;if(!open)input.value=selectedLabel();else render();}
  refresh();return{refresh};
}
