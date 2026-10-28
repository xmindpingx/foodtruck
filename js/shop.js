// shop.js — business info, menu, cart, ordering and contact panels (plain DOM, no 3D).
// scene.js sets hooks.goWindow so opening the menu also flies the camera to the service window.
export const hooks={goWindow:()=>{}};
// Business details + menu are edited in /admin and loaded from the server.

const getJ=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
export const [CONFIG,MENU]=await Promise.all([getJ('/api/settings'),getJ('/api/menu')]).then(([s,m])=>[s||{},m||{categories:[],proteins:[]}]);
import * as Account from './account.js?v=8';   // language chosen first at sign-up → localized order copy + stage events
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
const eff=i=>i.specialCents!=null?Math.round(Number(i.specialCents)):Math.round(Number(i.price)*100);   // live specials — create_order prices exactly the same way
document.getElementById('menuItems').innerHTML = MENU.categories.length ? MENU.categories.map(c=>`<div class="cat">${esc(c.name)}</div>`+c.items.map(i=>`
  <div class="item">${i.image?`<img src="${esc(i.image)}" alt="" style="width:56px;height:56px;border-radius:10px;object-fit:cover">`:''}
   <div class="nm"><b>${esc(i.name)}</b> <span style="color:var(--gold)">${money(eff(i)/100)}</span>${i.specialCents!=null?' <span style="font-size:10px;font-weight:800;background:var(--pink);color:#fff;padding:1px 6px;border-radius:999px;vertical-align:2px">SPECIAL</span>':''}<small>${esc(i.desc)}</small>${protSel(i.id)}</div>
   <button class="add" data-add="${esc(i.id)}" aria-label="Add ${esc(i.name)}">+</button></div>`).join('')).join('')
  : `<p>${soon} — our menu is being finalized. Stop by the window!</p>`;
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const id=b.dataset.add,p=document.getElementById('p-'+id)?.value||'';
  const ex=cart.find(l=>l.id===id&&l.protein===p);ex?ex.qty++:cart.push({id,qty:1,protein:p});renderCart();
  b.textContent='✓';setTimeout(()=>b.textContent='+',600);});
// money math in whole cents (same formula as server.py) so the total shown always matches the order
const cents=d=>Math.round(Number(d)*100);
const taxCents=sc=>{const r=Math.round((CONFIG.taxRate||0)*1e6);return Math.floor((sc*r+500000)/1e6);};
let REWARD_OFF=0,REWARD_ID='',REWARD_NAME='';   // chosen reward (client preview only — the server re-validates and re-prices)
function renderCart(){const lines=document.getElementById('cartLines');let sc=0,n=0;
  lines.innerHTML=cart.length?cart.map((l,k)=>{const i=ITEMS[l.id];sc+=eff(i)*l.qty;n+=l.qty;return `<div class="item"><div class="nm">${esc(i.name)}${l.protein?` <small>${esc(l.protein)}</small>`:''}</div>
   <div class="qty"><button data-q="${k}" data-d="-1" aria-label="Remove one">−</button>${l.qty}<button data-q="${k}" data-d="1" aria-label="Add one">+</button></div><b>${money(eff(i)*l.qty/100)}</b></div>`;}).join(''):'<p class="muted">Tap + to add items.</p>';
  lines.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{const k=+b.dataset.q,l=cart[k];l.qty+=+b.dataset.d;if(l.qty<1)cart.splice(k,1);renderCart();});
  const rd=Math.min(REWARD_OFF,sc),tc=taxCents(sc-rd),dr=document.getElementById('discRow');
  if(dr){dr.hidden=!rd;if(rd){document.getElementById('disc').textContent='-'+money(rd/100);document.getElementById('discLabel').textContent=REWARD_NAME||'Reward';}}
  document.getElementById('sub').textContent=money(sc/100);document.getElementById('tax').textContent=money(tc/100);document.getElementById('tot').textContent=money((sc-rd+tc)/100);
  document.getElementById('taxLabel').textContent=`Tax (${+((CONFIG.taxRate||0)*100).toFixed(3)}%)`;
  const bar=document.getElementById('cartBar');bar.hidden=!n;bar.textContent=`View order · ${n} item${n>1?'s':''} · ${money((sc-rd+tc)/100)}`;}
document.getElementById('cartBar').onclick=()=>document.getElementById('cart').scrollIntoView({behavior:'smooth',block:'start'});
renderCart();
if(CONFIG.orderNote)document.getElementById('payNote').textContent=CONFIG.orderNote;
{ // payment methods straight from /api/settings — only the ones the owner switched on
  const M={stripe:CONFIG.payStripe,cashapp:CONFIG.payCashapp,zelle:CONFIG.payZelle,cash:CONFIG.payCash};
  const opts=[['stripe','Card 💳'],['cashapp','CashApp 💸'],['zelle','Zelle 🏦'],['cash','Cash 🪙 at window']].filter(([k])=>M[k]);
  const box=document.getElementById('payBox');
  if(box&&opts.length)box.innerHTML='<div style="font-size:10.5px;font-weight:800;letter-spacing:.5px;color:var(--gold);margin:6px 0 4px">PAYMENT METHOD</div>'
    +opts.map(([k,lab])=>`<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;margin:4px 0;cursor:pointer"><input type="radio" name="payMethod" value="${k}" ${k==='cash'?'checked':''} style="accent-color:var(--gold)">${lab}</label>`).join('')
    +(CONFIG.cashappTag&&M.cashapp?`<div style="font-size:11.5px;opacity:.75;margin:4px 0 0 24px">CashApp: ${esc(CONFIG.cashappTag)}</div>`:'')
    +(CONFIG.zelleContact&&M.zelle?`<div style="font-size:11.5px;opacity:.75;margin:4px 0 0 24px">Zelle: ${esc(CONFIG.zelleContact)}</div>`:'');
}
{ // rewards: points balance for the typed phone + redemption picker
  const phIn=document.querySelector('#oform [name=phone]');
  if(phIn)phIn.addEventListener('blur',async()=>{
    const box=document.getElementById('rewardBox');if(!box)return;
    const d=(phIn.value||'').replace(/\D/g,'');
    if(!CONFIG.rewardsOn||d.length<10){box.innerHTML='';return;}
    let r=null;try{r=await getJ('/api/rewards/'+d)}catch(err){}
    const list=(CONFIG.rewardItems||[]);
    if(!r||!r.points){box.innerHTML=list.length?'<div style="font-size:12px;opacity:.7;margin:4px 0">⭐ Earn points on every order — sign up at the arcade midway.</div>':'';return;}
    const okd=list.filter(x=>x.points<=r.points);
    box.innerHTML=`<div style="font-size:12px;color:var(--gold);margin:4px 0">⭐ ${r.points} points</div>`
      +(okd.length?`<select id="rewardSel" style="width:100%"><option value="">No reward — save my points</option>${okd.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} (${x.points} pts)</option>`).join('')}</select>`:'');
    const sel=document.getElementById('rewardSel');
    if(sel)sel.onchange=()=>{const x=list.find(y=>y.id===sel.value)||null;REWARD_OFF=x?(x.offCents||0):0;REWARD_ID=x?x.id:'';REWARD_NAME=x?x.name:'';renderCart();};
  });
}
if(CONFIG.bannerText){const b=document.createElement('div');
  b.style.cssText='margin:10px 0;padding:10px 12px;border:1px dashed rgba(255,255,255,.4);border-radius:10px;color:var(--gold);font-weight:600'+(CONFIG.bannerLink?';cursor:pointer':'');
  b.textContent=CONFIG.bannerText;if(CONFIG.bannerLink)b.onclick=()=>window.open(CONFIG.bannerLink,'_blank');
  const mp=document.getElementById('menu');if(mp)mp.prepend(b);}
{ // delivery partner links on the Find Us panel
  const ps=[['Grubhub',CONFIG.partnerGrubhubOn,CONFIG.partnerGrubhubLink],['Uber Eats',CONFIG.partnerUberOn,CONFIG.partnerUberLink],['DoorDash',CONFIG.partnerDoorDashOn,CONFIG.partnerDoorDashLink],['Instacart',CONFIG.partnerInstacartOn,CONFIG.partnerInstacartLink]].filter(p=>p[1]&&p[2]);
  const f=document.getElementById('find');
  if(f&&ps.length)f.insertAdjacentHTML('beforeend',`<div class="tiles"></div><div class="row"><span>Order on</span><b>${ps.map(p=>`<a href="${esc(p[2])}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${esc(p[0])}</a>`).join(' · ')}</b></div>`);
}
if(CONFIG.orderingOpen===false){document.getElementById('oform').innerHTML='<p><b>Online ordering is closed right now.</b> Come order at the window!</p>';}
document.getElementById('oform').onsubmit=async e=>{e.preventDefault();if(!cart.length)return alert(Account.lang()==='es'?'Tu carrito está vacío.':'Your cart is empty.');
  const f=new FormData(e.target),btn=document.getElementById('placeBtn');btn.disabled=true;btn.textContent=Account.lang()==='es'?'Enviando…':'Sending…';
  const es=Account.lang()==='es';
  const ST={new:['received','recibido'],cooking:['cooking 🔥','en la plancha 🔥'],ready:['READY — come to the window!','¡LISTO — ven a la ventana!'],done:['picked up','entregado'],cancelled:['cancelled — please see the window','cancelado — ve a la ventana por favor']};
  const stage=st=>{        // drive the chat chips (avatars.js) by the visitor's order stage
    let o=null;try{o=JSON.parse(localStorage.getItem('eol-last-order')||'null')}catch(err){}
    if(o){o.status=st;try{localStorage.setItem('eol-last-order',JSON.stringify(o))}catch(err){}}
    dispatchEvent(new CustomEvent('eol:order-stage',{detail:{status:st}}));};
  try{const r=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),phone:f.get('phone'),notes:f.get('notes'),items:cart,smsConsent:f.get('smsConsent')==='on',payMethod:(document.querySelector('input[name=payMethod]:checked')||{}).value||'cash',promoCode:(document.getElementById('promoCode')||{}).value||'',rewardId:REWARD_ID})});
    const j=await r.json();if(!r.ok)throw new Error(j.error||'Order failed');
    dispatchEvent(new Event('eol:order-placed'));   // tells avatars.js to make my avatar walk to the window
    try{localStorage.setItem('eol-last-order',JSON.stringify({id:j.id,number:j.number,phone:(f.get('phone')||'').replace(/\D/g,''),status:'new',ts:Date.now()}))}catch(err){}
    stage('new');
    cart.length=0;renderCart();e.target.style.display='none';const d=document.getElementById('ordDone');d.style.display='block';
    const pmSel=(document.querySelector('input[name=payMethod]:checked')||{}).value||'cash';
    const payNote=pmSel==='cashapp'&&CONFIG.cashappTag?`Send ${money(j.total)} to <b>${esc(CONFIG.cashappTag)}</b> on CashApp — we confirm it at the window.`
      :pmSel==='zelle'&&CONFIG.zelleContact?`Send ${money(j.total)} via Zelle to <b>${esc(CONFIG.zelleContact)}</b> — we confirm it at the window.`
      :es?'Págalo en la ventana cuando recojas tu pedido.':'Pay at the window when you pick up.';
    d.innerHTML=`<div class="tiles"></div><h2 style="font-size:26px">¡Gracias!</h2><p>${es?'Pedido':'Order'} <b style="color:var(--gold);font-size:22px">#${j.number}</b> — ${es?'total':'total'} ${money(j.total)}${j.discount>0?` <small style="color:var(--gold)">(-${money(j.discount)} off)</small>`:''}.</p><p id="ostat" class="muted">${es?'Estado':'Status'}: ${ST.new[es?1:0]}</p>${f.get('smsConsent')==='on'?`<p class="muted" id="smsNote">${es?`Alerta de texto cuando esté listo: <b>ACTIVADA</b>. El Otro Lado (Summer and Jesse) enviará UN mensaje a ${esc(f.get('phone'))} cuando este pedido esté listo. Tarifas y datos pueden aplicar. Responde STOP para salir, HELP para ayuda.`:`Order-ready text alert: <b>ON</b>. El Otro Lado (Summer and Jesse) will send one text to ${esc(f.get('phone'))} when this order is ready. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.`}</p>`:''}<p class="muted">${payNote}</p><button type="button" class="cta" id="newOrder" style="width:100%">${es?'Iniciar un pedido nuevo':'Start a new order'}</button>`;
    d.scrollIntoView({behavior:'smooth',block:'start'});   // show the order number, not the top of the menu
    if(pmSel==='stripe'){   // card: swap the confirmation for Stripe's hosted checkout
      try{const cr=await fetch('/api/checkout/stripe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:j.id})});
        const cj=await cr.json().catch(()=>({}));
        if(cr.ok&&cj.url){d.insertAdjacentHTML('beforeend','<p class="muted" id="stripeGo">Opening secure card payment…</p>');location.href=cj.url;return;}
        d.insertAdjacentHTML('beforeend','<p class="muted" id="stripeGo">Card payment is not available right now — pay at the window.</p>');
      }catch(err){}
    }
    clearInterval(window.__poll);
    window.__poll=setInterval(async()=>{const s=await getJ('/api/order/'+j.id);if(!s)return;stage(s.status);
      const el=document.getElementById('ostat');if(el)el.innerHTML=(es?'Estado':'Status')+': <b>'+((ST[s.status]||['',''])[es?1:0]||s.status)+'</b>';if(['done','cancelled'].includes(s.status))clearInterval(window.__poll);},5000);
    document.getElementById('newOrder').onclick=()=>{clearInterval(window.__poll);d.style.display='none';d.innerHTML='';e.target.style.display='';
      e.target.querySelector('[name=notes]').value='';{const mp=document.getElementById('menu');mp.scrollTo({top:0,behavior:'smooth'});mp.scrollIntoView({behavior:'smooth',block:'start'});}
      try{localStorage.removeItem('eol-last-order')}catch(err){}
      stage('none');};
  }catch(err){alert(err.message);}finally{btn.disabled=false;btn.textContent='Place Order';}};
document.getElementById('cform').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);
  if(!CONFIG.email){alert('Contact email not set up yet.');return;}
  location.href=`mailto:${CONFIG.email}?subject=${encodeURIComponent('Food truck inquiry from '+f.get('name'))}&body=${encodeURIComponent(f.get('msg')+'\n\nReply to: '+f.get('from'))}`;};
let _backdrop=null;
function ensureBackdrop(){
  if(_backdrop&&_backdrop.isConnected)return _backdrop;
  _backdrop=document.createElement('div');_backdrop.id='eolModalBackdrop';document.body.appendChild(_backdrop);
  return _backdrop;
}
export const open=id=>{document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('open',p.id===id));
  const anyOpen=!!document.querySelector('.panel.open');
  document.body.classList.toggle('panel-open',anyOpen);
  if(anyOpen){const bd=ensureBackdrop();bd.onclick=()=>open(null);}
  else if(_backdrop&&_backdrop.isConnected)_backdrop.remove();
  dispatchEvent(new Event(id==='menu'?'eol:menu-open':'eol:menu-close'));};
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{open(b.dataset.p);if(b.dataset.p==='menu')hooks.goWindow();});
document.querySelectorAll('.x').forEach(b=>b.onclick=()=>open(null));
