const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(){this.children=[];this.attributes={};this.listeners={};this.classList={toggle(){},remove(){}};this.value='';}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  insertBefore(child,before){child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);}
  set innerHTML(_){this.children=[];}
  setAttribute(key,value){this.attributes[key]=value;}
  getAttribute(key){return this.attributes[key];}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
  dispatch(name,data={}){for(const fn of this.listeners[name]||[])fn({preventDefault(){},...data});}
  scrollIntoView(){}
}
const context={window:{},document:{createElement:()=>new Element()},fetch:async()=>({json:async()=>({players:['LeBron James','Dwyane Wade']})}),setTimeout};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/player-autocomplete.js'),'utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const input=new Element();input.id='friends';new Element().appendChild(input);const pending=[];let chosen;
 await context.window.HoopAutocomplete.attach(input,{search:query=>new Promise(resolve=>pending.push({query,resolve})),onSelect:name=>{chosen=name;}});
 input.dispatch('focus');input.value='pr';input.dispatch('input');input.value='pre';input.dispatch('input');
 pending[1].resolve(['PreviewOne','PreviewTwo']);await flush();pending[0].resolve(['Outdated']);await flush();
 const dropdown=input.parentNode.children[1];assert.equal(dropdown.children[0].textContent,'PreviewOne');
 assert.equal(dropdown.children[0].getAttribute('aria-selected'),'true');
 input.dispatch('keydown',{key:'Enter'});assert.equal(chosen,'PreviewOne');assert.equal(input.value,'PreviewOne');assert(dropdown.hidden);
 input.value='old';input.dispatch('input');input.value='';input.dispatch('input');pending[2].resolve(['Old']);await flush();assert(dropdown.hidden);
 const player=new Element();player.id='player';new Element().appendChild(player);await context.window.HoopAutocomplete.attach(player);player.value='lebr';player.dispatch('focus');assert.equal(player.parentNode.children[1].children[0].textContent,'LeBron James');
 console.log('PASS: shared player/friend autocomplete, stale-result protection, keyboard selection and empty-query dismissal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
