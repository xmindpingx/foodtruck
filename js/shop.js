// shop.js — business info, menu, cart, ordering and contact panels (plain DOM, no 3D).
// scene.js sets hooks.goWindow so opening the menu also flies the camera to the service window.
export const hooks={goWindow:()=>{}};
// Business details + menu are edited in /admin and loaded from the server.

const getJ=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
export const [CONFIG,MENU]=await Promise.all([getJ('/api/settings'),getJ('/api/menu')]).then(([s,m])=>[s||{},m||{categories:[],proteins:[]}]);
import * as Account from './account.js?v=4';   // language chosen first at sign-up → localized order copy + stage events
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=n=>'$'+Number(n).toFixed(2);const soon = '<span class="muted">Coming soon</span>';
// business rows: show the value, or hide the whole row when it is not set (no "Coming soon" placeholders on the public site)
const set=(id,v,href)=>{const el=document.getElementById(id);if(!v){const r=el.closest('.row');if(r)r.style.display='none';return;}
  el.innerHTML = href?`<a style="color:inherit" href="${esc(href)}">${esc(v)}</a>`:esc(v);};
set('cfgPhone',CONFIG.phone,CONFIG.phone&&'tel:'+CONFIG.phone.replace(/[^\d+]/g,''));
set('cfgEmail',CONFIG.email,CONFIG.email&&'mailto:'+CONFIG.email);
set('cfgSocial',CONFIG.social); set('cfgLoc',CONFIG.location); set('cfgHours',CONFIG.hours);

// ---------- brand / logo / copyright (edited in /admin → Settings → Business) ----------
// Cosmetic-only: anything missing here falls back to the static markup, so this can never
// blank the header or footer on its own.
try{
  const b=document.querySelector('.brand');
  if(b&&CONFIG.businessName){
    b.textContent=CONFIG.businessName;
    if(CONFIG.tagline)b.insertAdjacentHTML('beforeend',`<small>“${esc(CONFIG.tagline)}”</small>`);
    if(CONFIG.brandLogo)b.insertAdjacentHTML('afterbegin',`<img class="brandLogo" src="/media/${esc(CONFIG.brandLogo)}" alt="${esc(CONFIG.businessName)}">`);
    document.title=`${CONFIG.businessName}${CONFIG.tagline?` — ${CONFIG.tagline} · `:' · '}Food Truck · Mesa, AZ`;
  }
  const cl=document.getElementById('copyLine');
  if(cl&&CONFIG.copyrightLine)cl.textContent=CONFIG.copyrightLine;
}catch(err){/* branding is cosmetic; never block the shop */}

// ---------- menu + cart ----------
const ITEMS={};MENU.categories.forEach(c=>c.items.forEach(i=>ITEMS[i.id]=i));
const cart=[]; // {id, qty, protein}
const protSel=id=>ITEMS[id].protein&&MENU.proteins?.length?`<select id="p-${id}">${MENU.proteins.map(p=>`<option>${esc(p)}</option>`).join('')}</select>`:'';
document.getElementById('menuItems').innerHTML = MENU.categories.length ? MENU.categories.map(c=>`<div class="cat">${esc(c.name)}</div>`+c.items.map(i=>`
  <div class="item">${i.image?`<img src="${esc(i.image)}" alt="" style="width:56px;height:56px;border-radius:10px;object-fit:cover">`:''}
   <div class="nm"><b>${esc(i.name)}</b> <span style="color:var(--gold)">${money(i.price)}</span><small>${esc(i.desc)}</small>${protSel(i.id)}</div>
   <button class="add" data-add="${esc(i.id)}" aria-label="Add ${esc(i.name)}">+</button></div>`).join('')).join('')
  : `<p>${soon} — our menu is being finalized. Stop by the window!</p>`;
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const id=b.dataset.add,p=document.getElementById('p-'+id)?.value||'';
  const ex=cart.find(l=>l.id===id&&l.protein===p);ex?ex.qty++:cart.push({id,qty:1,protein:p});renderCart();
  b.textContent='✓';setTimeout(()=>b.textContent='+',600);});
// money math in whole cents (same formula as server.py) so the total shown always matches the order
const cents=d=>Math.round(Number(d)*100);
const taxCents=sc=>{const r=Math.round((CONFIG.taxRate||0)*1e6);return Math.floor((sc*r+500000)/1e6);};
function renderCart(){const lines=document.getElementById('cartLines');let sc=0,n=0;
  lines.innerHTML=cart.length?cart.map((l,k)=>{const i=ITEMS[l.id];sc+=cents(i.price)*l.qty;n+=l.qty;return `<div class="item"><div class="nm">${esc(i.name)}${l.protein?` <small>${esc(l.protein)}</small>`:''}</div>
   <div class="qty"><button data-q="${k}" data-d="-1" aria-label="Remove one">−</button>${l.qty}<button data-q="${k}" data-d="1" aria-label="Add one">+</button></div><b>${money(cents(i.price)*l.qty/100)}</b></div>`;}).join(''):'<p class="muted">Tap + to add items.</p>';
  lines.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{const k=+b.dataset.q,l=cart[k];l.qty+=+b.dataset.d;if(l.qty<1)cart.splice(k,1);renderCart();});
  const tc=taxCents(sc);
  document.getElementById('sub').textContent=money(sc/100);document.getElementById('tax').textContent=money(tc/100);document.getElementById('tot').textContent=money((sc+tc)/100);
  document.getElementById('taxLabel').textContent=`Tax (${+((CONFIG.taxRate||0)*100).toFixed(3)}%)`;
  const bar=document.getElementById('cartBar');bar.hidden=!n;bar.textContent=`View order · ${n} item${n>1?'s':''} · ${money((sc+tc)/100)}`;}
document.getElementById('cartBar').onclick=()=>document.getElementById('cart').scrollIntoView({behavior:'smooth',block:'start'});
renderCart();
if(CONFIG.orderNote)document.querySelector('#oform .muted').textContent=CONFIG.orderNote;
if(CONFIG.orderingOpen===false){document.getElementById('oform').innerHTML='<p><b>Online ordering is closed right now.</b> Come order at the window!</p>';}
document.getElementById('oform').onsubmit=async e=>{e.preventDefault();if(!cart.length)return alert(Account.lang()==='es'?'Tu carrito está vacío.':'Your cart is empty.');
  const f=new FormData(e.target),btn=document.getElementById('placeBtn');btn.disabled=true;btn.textContent=Account.lang()==='es'?'Enviando…':'Sending…';
  const es=Account.lang()==='es';
  const ST={new:['received','recibido'],cooking:['cooking 🔥','en la plancha 🔥'],ready:['READY — come to the window!','¡LISTO — ven a la ventana!'],done:['picked up','entregado'],cancelled:['cancelled — please see the window','cancelado — ve a la ventana por favor']};
  const stage=st=>{        // drive the chat chips (avatars.js) by the visitor's order stage
    let o=null;try{o=JSON.parse(localStorage.getItem('eol-last-order')||'null')}catch(err){}
    if(o){o.status=st;try{localStorage.setItem('eol-last-order',JSON.stringify(o))}catch(err){}}
    dispatchEvent(new CustomEvent('eol:order-stage',{detail:{status:st}}));};
  try{const r=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),phone:f.get('phone'),notes:f.get('notes'),items:cart,smsConsent:f.get('smsConsent')==='on'})});
    const j=await r.json();if(!r.ok)throw new Error(j.error||'Order failed');
    dispatchEvent(new Event('eol:order-placed'));   // tells avatars.js to make my avatar walk to the window
    try{localStorage.setItem('eol-last-order',JSON.stringify({id:j.id,number:j.number,phone:(f.get('phone')||'').replace(/\D/g,''),status:'new',ts:Date.now()}))}catch(err){}
    stage('new');
    cart.length=0;renderCart();e.target.style.display='none';const d=document.getElementById('ordDone');d.style.display='block';
    d.innerHTML=`<div class="tiles"></div><h2 style="font-size:26px">¡Gracias!</h2><p>${es?'Pedido':'Order'} <b style="color:var(--gold);font-size:22px">#${j.number}</b> — ${es?'total':'total'} ${money(j.total)}.</p><p id="ostat" class="muted">${es?'Estado':'Status'}: ${ST.new[es?1:0]}</p>${f.get('smsConsent')==='on'?`<p class="muted" id="smsNote">${es?`Alerta de texto cuando esté listo: <b>ACTIVADA</b>. El Otro Lado (John Switzer) enviará UN mensaje a ${esc(f.get('phone'))} cuando este pedido esté listo. Tarifas y datos pueden aplicar. Responde STOP para salir, HELP para ayuda.`:`Order-ready text alert: <b>ON</b>. El Otro Lado (John Switzer) will send one text to ${esc(f.get('phone'))} when this order is ready. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.`}</p>`:''}<p class="muted">${es?'Págalo en la ventana cuando recojas tu pedido.':'Pay at the window when you pick up.'}</p><button type="button" class="cta" id="newOrder" style="width:100%">${es?'Iniciar un pedido nuevo':'Start a new order'}</button>`;
    d.scrollIntoView({behavior:'smooth',block:'start'});   // show the order number, not the top of the menu
    clearInterval(window.__poll);
    window.__poll=setInterval(async()=>{const s=await getJ('/api/order/'+j.id);if(!s)return;stage(s.status);
      const el=document.getElementById('ostat');if(el)el.innerHTML=(es?'Estado':'Status')+': <b>'+((ST[s.status]||['',''])[es?1:0]||s.status)+'</b>';if(['done','cancelled'].includes(s.status))clearInterval(window.__poll);},5000);
    document.getElementById('newOrder').onclick=()=>{clearInterval(window.__poll);d.style.display='none';d.innerHTML='';e.target.style.display='';
      e.target.querySelector('[name=notes]').value='';document.getElementById('menu').scrollTo({top:0,behavior:'smooth'});
      try{localStorage.removeItem('eol-last-order')}catch(err){}
      stage('none');};
  }catch(err){alert(err.message);}finally{btn.disabled=false;btn.textContent='Place Order';}};
document.getElementById('cform').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);
  if(!CONFIG.email){alert('Contact email not set up yet.');return;}
  location.href=`mailto:${CONFIG.email}?subject=${encodeURIComponent('Food truck inquiry from '+f.get('name'))}&body=${encodeURIComponent(f.get('msg')+'\n\nReply to: '+f.get('from'))}`;};
export const open=id=>{document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('open',p.id===id));
  dispatchEvent(new Event(id==='menu'?'eol:menu-open':'eol:menu-close'));};
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{open(b.dataset.p);if(b.dataset.p==='menu')hooks.goWindow();});
document.querySelectorAll('.x').forEach(b=>b.onclick=()=>open(null));
