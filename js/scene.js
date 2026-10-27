// scene.js — renderer, camera, 360° festival panorama sky/sun, grass field, click
// handling and the animation loop. Imports the truck from truck.js and the ordering UI from shop.js.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CONFIG,MENU,money,open,hooks} from './shop.js?v=6';
import {buildTruck,WX0,WX1,WY0,WY1,BW,BL,BH,bx0,FLOOR,CL} from './truck.js?v=6';
import * as Avatars from './avatars.js?v=7';
import * as Account from './account.js?v=6';   // phone-number arcade profiles (language-first sign-up)
import * as Arcade from './arcade.js?v=10';    // 🎪 The Midway props + six minigames + HIGH SCORES board

const canvas=document.getElementById('c');
const R=new THREE.WebGLRenderer({canvas,antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(innerWidth,innerHeight);
R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=1.05;R.outputColorSpace=THREE.SRGBColorSpace;
const S=new THREE.Scene();   // S.environment gets a panorama-buffered env map once it's painted (below)
const ALL_HYDRAULICS=[];   // lowriders "on switches" - cars that get a random hydraulic hop in the main render loop below
export const cam=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.1,400);
// distance needed so a span of 2*halfW meters fits across the screen (phones in portrait need to stand back)
const fitDist=(halfW,minD)=>{const hf=Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov/2))*cam.aspect);return Math.max(minD,halfW/Math.tan(hf));};
const portrait=()=>cam.aspect<1;
// spawn view: standing on the WINDOW side of the lot (north, right beside the jukebox),
// facing the truck's serving window + menu board dead-on — the queue, the claw machine and
// the bean-bag boards frame the first view (the stage/crowd side is now behind the camera)
if(portrait()) cam.position.set(-1.55,1.9,-fitDist(2.7,7.8)); else cam.position.set(-1.6,1.7,-7.8);
const ctl=new OrbitControls(cam,canvas);ctl.target.set(portrait()?-1.55:-2.1,1.6,0);ctl.enableDamping=true;
// these assume the truck sits unrotated at world (0,0) - kept as the "base" view and re-applied
// through the truck's actual position/rotation once that's known (see truckRig setup below).
const camBase=cam.position.clone(), targetBase=ctl.target.clone();
ctl.minDistance=2.2;ctl.maxDistance=20;ctl.maxPolarAngle=Math.PI*0.495;

// ---------- 360° equirectangular panorama: expansive daytime outdoor-music-festival backdrop
// (large stage in the distance, vendor-tent rows, crowd silhouettes) under a Mesa, Arizona sky -
// desert haze, Superstition-style flat-top ridges and the shimmer of Tempe Town Lake along the
// far edge of the lawn. Painted onto a 2:1 canvas - one full 360° sweep of longitude, with the horizon
// line at mid-height where equirect distortion is smallest, so all scenery sits in a narrow band
// around it. The sphere's lower half is normally hidden behind the 3D ground plane, but it still
// feeds the PMREM environment map below, giving the truck a soft green ground-bounce.
// Optional upgrade: if tex/panorama.jpg exists (owner-supplied equirect, e.g. an 8K render), the
// dome and the env map swap to it once loaded; until then this canvas painting is the panorama.
const TL=new THREE.TextureLoader();
const panoC=document.createElement('canvas');panoC.width=2048;panoC.height=1024;
{const g=panoC.getContext('2d'),W=2048,H=1024,HOR=H/2;
 // Arizona sky: deeper blue zenith → dusty light blue → warm sun-baked haze exactly at the
 // horizon (Mesa/Tempe look - the desert air picks up a ochre cast far away)
 const sky=g.createLinearGradient(0,0,0,HOR);
 sky.addColorStop(0,'#2160be');sky.addColorStop(.4,'#4187cf');sky.addColorStop(.66,'#8cb7da');sky.addColorStop(.86,'#dfd3ad');sky.addColorStop(1,'#ecdfb7');
 g.fillStyle=sky;g.fillRect(0,0,W,HOR+1);
 // sun: soft glow + small disc high up at the DirectionalLight's azimuth (u≈.35 - behind/right
 // of the default -z view), ~58° high like that light
 {const sx=W*.352,sy=80,glow=g.createRadialGradient(sx,sy,0,sx,sy,150);
  glow.addColorStop(0,'rgba(255,252,235,.95)');glow.addColorStop(.3,'rgba(255,248,220,.4)');glow.addColorStop(1,'rgba(255,248,220,0)');
  g.fillStyle=glow;g.beginPath();g.arc(sx,sy,150,0,7);g.fill();}
 // sparse cirrus (clear desert blue - keep them faint) + tiny bird specks
 g.save();g.filter='blur(7px)';g.globalAlpha=.5;
 for(const [cx,cy,w,h] of [[210,120,300,20],[520,80,210,15],[880,150,330,18],[1220,88,260,14],[1510,140,220,13],[1810,72,180,12]]){
   const cr=g.createRadialGradient(cx,cy,0,cx,cy,w/2);cr.addColorStop(0,'rgba(255,255,255,.9)');cr.addColorStop(1,'rgba(255,255,255,0)');
   g.fillStyle=cr;g.beginPath();g.ellipse(cx,cy,w/2,h,0,0,Math.PI*2);g.fill();}
 g.restore();g.fillStyle='rgba(50,54,60,.8)';
 for(const [bx,by] of [[980,196],[1012,180],[1044,200],[430,244],[462,232]]){
   g.beginPath();g.moveTo(bx-6,by);g.quadraticCurveTo(bx,by-7,bx+6,by);g.quadraticCurveTo(bx,by-2,bx-6,by);g.fill();}
 // Superstition-flavored flat-top ridges ringing the horizon behind everything (Sonoran desert
 // browns hazed out with distance; randomness decided once per bump, reused across the wrap)
 {const ridge=(amp,base,fill,blur)=>{const bumps=[];
    for(let x=0;x<W;x+=40+Math.random()*90)bumps.push([x,base+Math.random()*amp]);
    g.save();g.filter=`blur(${blur}px)`;
    for(const dx of [-W,0,W]){g.beginPath();g.moveTo(dx,HOR+6);
      for(const [bx,h] of bumps){g.lineTo(bx+dx,HOR-h);}
      g.lineTo(W+dx,HOR+6);g.closePath();g.fillStyle=fill;g.fill();}
    g.restore();};
  ridge(46,28,'rgba(138,107,82,.4)',7);    // far hazed ridge
  ridge(30,14,'rgba(111,81,56,.55)',3);   // nearer ridge: Superstition browns
  ridge(14,5,'rgba(90,63,40,.6)',1);}     // low desert shoulder
 // festival grounds: Tempe Town Lake water shimmering across the far edge, a sand shore, then
 // the irrigated green lawn the event sits on - Mesa parks run turf hard against desert sky.
 const grs=g.createLinearGradient(0,HOR,0,H);
 grs.addColorStop(0,'#3f7fa8');grs.addColorStop(.05,'#2c5f80');grs.addColorStop(.075,'#a8925f');
 grs.addColorStop(.16,'#95b356');grs.addColorStop(1,'#41682b');
 g.fillStyle=grs;g.fillRect(0,HOR-1,W,H-HOR+2);
 // sun glitter on the lake band + a suggestion of the Tempe Town Lake pedestrian bridge
 g.fillStyle='rgba(255,244,205,.35)';
 for(let i=0;i<90;i++){const y=HOR+1+Math.random()*12;g.fillRect(Math.random()*W,y,5+Math.random()*17,1.4);}
 {const bx=W*.2;for(const dx of [-W,0,W]){const x=bx+dx;
   g.strokeStyle='rgba(70,72,78,.65)';g.lineWidth=3;
   g.beginPath();g.moveTo(x-46,HOR-4);g.lineTo(x-46,HOR-34);g.moveTo(x+46,HOR-4);g.lineTo(x+46,HOR-34);
   g.moveTo(x-46,HOR-6);g.lineTo(x+46,HOR-6);g.stroke();   // deck line
   g.lineWidth=1.4;
   g.beginPath();g.moveTo(x-46,HOR-33);g.quadraticCurveTo(x-20,HOR-12,x,HOR-8);
   g.quadraticCurveTo(x+20,HOR-12,x+46,HOR-33);g.stroke();}}
 g.globalAlpha=.06;g.fillStyle='#fff';for(let y=HOR+74;y<H;y+=64)g.fillRect(0,y,W,32);
 g.globalAlpha=1;
 // every motif below straddles the horizon and is drawn thrice (base x, x±W) so the u=0/1 wrap
 // seam is invisible; randomness is decided ONCE per motif, then reused across the three copies.
 // distant treeline: a soft green shoulder ringing the whole field
 {const blobs=[];for(let x=80;x<W;x+=78+Math.random()*80)blobs.push([x,22+Math.random()*36]);
  g.save();g.filter='blur(4px)';
  for(const [bx,r] of blobs)for(const dx of [-W,0,W]){
    g.fillStyle=`rgba(88,124,56,${.42+(bx%9)/26})`;
    g.beginPath();g.ellipse(bx+dx,HOR+5,r,r*.5,0,Math.PI,0);g.fill();}
  g.restore();}
 // food-vendor tents: two arcs of colorful pitched canopies across the field, clear of the stage
 {const hues=[['#e8623a','#f4b08c'],['#4a90d9','#a5cbf0'],['#e8c23a','#f6e7a4'],['#7aa04a','#bcd793'],['#efe9dd','#cdc5b4'],['#ff6fa0','#ffc4d6']];
  const rows=[];for(let x=W*.045;x<W*.30;x+=W*.034+Math.random()*W*.02)rows.push([x,W*.012+Math.random()*W*.006,(x/W*997|0)%hues.length]);
  for(let x=W*.83;x<W*.98;x+=W*.036+Math.random()*W*.02)rows.push([x,W*.012+Math.random()*W*.006,(x/W*997|0)%hues.length]);
  for(const [tx,r,ci] of rows)for(const dx of [-W,0,W]){
    const [c1,c2]=hues[ci],x=tx+dx;
    g.fillStyle='rgba(70,70,66,.3)';g.beginPath();g.ellipse(x,HOR-1,r*.85,3,0,0,Math.PI*2);g.fill();
    g.beginPath();g.moveTo(x-r,HOR);g.lineTo(x,HOR-r*.8);g.lineTo(x+r,HOR);g.closePath();
    g.fillStyle=c1;g.fill();
    g.save();g.clip();g.fillStyle=c2;g.fillRect(x+r*.3,HOR-r,r,r);g.restore();   // lighter far face
    g.strokeStyle='rgba(255,255,255,.7)';g.lineWidth=1.1;
    g.beginPath();g.moveTo(x-r,HOR);g.lineTo(x-r-6,HOR-4);g.moveTo(x+r,HOR);g.lineTo(x+r+6,HOR-4);g.stroke();}}
 // the main stage: large roofed structure across ~10° of azimuth, gradient scrim festival
 // palette, deck lip, twin rafters with a cross-brace and PA stacks each side. u=.765 was
 // picked for the old +z spawn (stage dead-center in the first view); the spawn now stands on
 // the window side by the jukebox, so the stage crowns the lot behind it instead — still
 // fully there for the orbit/tour and walking.
 {const SX=W*.765,SW=W*.1,SH=86;
  for(const dx of [-W,0,W]){
   const cx=SX+dx,y0=HOR,hx=SW/2;
   const bg=g.createLinearGradient(0,y0-SH,0,y0);bg.addColorStop(0,'#3b1f7a');bg.addColorStop(.55,'#8a2f87');bg.addColorStop(1,'#e8623a');
   g.fillStyle=bg;g.fillRect(cx-hx+13,y0-SH*.92,SW-26,SH*.92);
   g.fillStyle='rgba(30,24,20,.9)';g.fillRect(cx-hx,y0-11,SW,11);   // deck lip / stage skirt
   g.strokeStyle='#3a332e';g.lineWidth=4;g.lineCap='round';
   g.beginPath();g.moveTo(cx-hx-9,y0-SH*.52);g.lineTo(cx,y0-SH);g.lineTo(cx+hx+9,y0-SH*.52);g.stroke();   // rafter truss
   g.lineWidth=1.5;g.globalAlpha=.8;
   g.beginPath();g.moveTo(cx-hx-9,y0-SH*.52);g.lineTo(cx+hx+9,y0-SH*.6);g.moveTo(cx+hx+9,y0-SH*.52);g.lineTo(cx-hx-9,y0-SH*.6);g.stroke();
   g.globalAlpha=1;
   g.fillStyle='#191512';
   g.fillRect(cx-hx-21,y0-58,18,58);g.fillRect(cx-hx-17,y0-76,10,18);
   g.fillRect(cx+hx+3,y0-58,18,58);g.fillRect(cx+hx+7,y0-76,10,18);   // PA stacks
   g.fillStyle='#efe5d8';   // grill bands across the PA stack faces
   g.fillRect(cx-hx-21,y0-40,18,3);g.fillRect(cx-hx-21,y0-30,18,3);
   g.fillRect(cx+hx+3,y0-40,18,3);g.fillRect(cx+hx+3,y0-30,18,3);
   g.lineWidth=2.5;
   g.beginPath();g.moveTo(cx-hx+5,y0-SH*.9);g.lineTo(cx-hx+5,y0-SH*1.16);g.moveTo(cx+hx-5,y0-SH*.9);g.lineTo(cx+hx-5,y0-SH*1.16);g.stroke();   // flag poles
   g.lineWidth=1.2;g.beginPath();g.moveTo(cx-hx+5,y0-SH*1.15);g.lineTo(cx+hx-5,y0-SH*1.15);g.stroke();   // pennant rope
   g.fillStyle='#f5efe0';
   for(const fv of [-.3,-.07,.16,.4]){const fx=cx-hx+5+fv*SW;   // pennant triangles
     g.beginPath();g.moveTo(fx,y0-SH*1.13);g.lineTo(fx+7,y0-SH*1.1);g.lineTo(fx,y0-SH*1.07);g.closePath();g.fill();}
   g.lineCap='butt';}}
 // crowd silhouettes: small clumps across the open field, thickening right in front of the stage
 {const clumps=[];
  for(let i=0;i<9;i++)clumps.push([W*.05+i*W*.043+Math.random()*W*.02,3+Math.floor(Math.random()*4)]);
  for(let i=0;i<5;i++)clumps.push([W*.83+i*W*.045+Math.random()*W*.02,3+Math.floor(Math.random()*4)]);
  for(let i=0;i<4;i++)clumps.push([W*.71+i*W*.028+Math.random()*W*.012,4+Math.floor(Math.random()*4)]);
  for(const [cx,n] of clumps){const figs=[];
    for(let i=0;i<n;i++)figs.push([Math.random()*36-18,.7+Math.random()*.55]);
    for(const dx of [-W,0,W])for(const [ox,s] of figs){
      const fx=cx+dx+ox;
      g.fillStyle='rgba(47,49,54,.82)';
      g.beginPath();g.arc(fx,HOR-8.4*s,2.1*s,0,7);g.fill();          // head
      g.fillRect(fx-1.5*s,HOR-6.6*s,3*s,6.8*s);}}}                   // body/legs stub
const panoT=new THREE.CanvasTexture(panoC);panoT.colorSpace=THREE.SRGBColorSpace;panoT.anisotropy=8;
const panoDome=new THREE.Mesh(new THREE.SphereGeometry(180,48,24),new THREE.MeshBasicMaterial({map:panoT,side:THREE.BackSide,fog:false}));
S.add(panoDome);
S.environment=new THREE.PMREMGenerator(R).fromEquirectangular(panoT).texture;   // panorama lights every material
S.fog=new THREE.FogExp2(0xe7dcc4,0.0042);   // warm desert haze to seat the truck in the horizon band
TL.load('tex/panorama.jpg',t=>{   // owner can drop a real equirect later; scene upgrades itself
  t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  panoDome.material.map=t;panoDome.material.needsUpdate=true;
  S.environment=new THREE.PMREMGenerator(R).fromEquirectangular(t).texture;},undefined,()=>{});}

// lights (Arizona midday sun — harsh overhead with warm bounce)
S.add(new THREE.HemisphereLight(0xb8d4f0,0x8b9c55,1.1));   // green ground-bounce for the grassy field
const sun=new THREE.DirectionalLight(0xfff5e0,3.2);sun.position.set(6,18,8);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-14,right:14,top:14,bottom:-14});sun.shadow.bias=-0.0003;sun.shadow.normalBias=0.02;S.add(sun);
// soft fill from the service-window side (reflected off the ground/lot)
const fill=new THREE.DirectionalLight(0xf0e8d8,0.55);fill.position.set(-4,3,9);S.add(fill);
// warm ambient bounce from street heat
const amb=new THREE.AmbientLight(0xffe4b0,0.28);S.add(amb);

const img=f=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='tex/'+f;});
function done(){const l=document.getElementById('load');if(!l)return;l.style.opacity=0;setTimeout(()=>l.remove(),700);}

// ground: grassy festival field. The old procedural asphalt-with-stripes, the aerial photo plane
// (lot-aerial.png) and the gravel strip are gone - the panorama above carries the scenery, so
// this plane only needs believable turf underfoot at photo-contact distance.
const grsC=document.createElement('canvas');grsC.width=grsC.height=1024;
{const g=grsC.getContext('2d');
 g.fillStyle='#5a8a3c';g.fillRect(0,0,1024,1024);
 g.globalAlpha=.05;g.fillStyle='#000';   // barely-there mow bands
 for(let y=0;y<1024;y+=128)g.fillRect(0,y+64,1024,64);
 g.globalAlpha=1;
 // course grain: thousands of specks oscillating between warm and cool greens
 for(let i=0;i<14000;i++){const x=Math.random()*1024,y=Math.random()*1024,r=Math.random()*2.2+.5,v=Math.random()*50;
   g.fillStyle=Math.random()<.5?`rgba(${(95+v)|0},${(135+v)|0},45,.16)`:`rgba(${(58+v/2)|0},${(96+v)|0},30,.15)`;
   g.beginPath();g.arc(x,y,r,0,7);g.fill();}
 // trampled paths: broad soft dirt ellipses the way a festival lawn wears
 g.fillStyle='rgba(150,126,80,.16)';
 for(const [px,py,rw,rh] of [[210,330,150,62],[640,760,180,70],[830,180,120,52],[120,800,140,56],[430,560,170,66]])
   {g.beginPath();g.ellipse(px,py,rw,rh,-.4+Math.random()*.8,0,Math.PI*2);g.fill();}
 // individual tufts: quick darker strokes
 g.strokeStyle='rgba(46,88,28,.35)';g.lineWidth=1.6;
 for(let i=0;i<2600;i++){const x=Math.random()*1024,y=Math.random()*1024;
   g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.random()*4-2,y-3-Math.random()*4);g.stroke();}}
const grsT=new THREE.CanvasTexture(grsC);grsT.wrapS=grsT.wrapT=THREE.RepeatWrapping;grsT.repeat.set(10,10);grsT.anisotropy=16;grsT.colorSpace=THREE.SRGBColorSpace;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardMaterial({map:grsT,roughness:.95,metalness:0,envMapIntensity:.35}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;S.add(ground);

await document.fonts.ready.catch(()=>{});
const T=await buildTruck(S,{img,done,MENU,money});
const CLICK=T.click;
Avatars.init(S);   // live "other visitors" avatars - safe to start before load finishes

// truck + its service queue + parked car move as one cluster, draggable in layout mode (see
// "layout mode" below). Position comes from settings (saved by a previous drag), defaulting to
// wherever a visitor last dragged it in their own browser, else dead center (0,0).
const truckRig=T.group;
Account.init();Arcade.init({scene:S,rig:truckRig,menu:MENU});   // 🎪 Midway props mount INSIDE the rig (move with the truck)
{let ox=0,oz=0,rot=0;
  try{const saved=JSON.parse(localStorage.getItem('eol_truckOffset')||'null');if(saved)ox=saved.x,oz=saved.z,rot=saved.r||0;}catch{}
  if(CONFIG && (CONFIG.truckOffsetX||CONFIG.truckOffsetZ||CONFIG.truckRotation) && !localStorage.getItem('eol_truckOffset')){ox=CONFIG.truckOffsetX||0;oz=CONFIG.truckOffsetZ||0;rot=CONFIG.truckRotation||0;}
  truckRig.position.set(ox,0,oz);truckRig.rotation.y=rot*Math.PI/180;
  // the default spawn view and the "tap to order" fly-to (goWindow, below) were both written
  // assuming the truck sits unrotated at world (0,0) - rotate+translate the base view by the
  // truck's actual position/rotation so it still frames the truck's service-window side
  // correctly, not just wherever the old unrotated math pointed.
  const axisY=new THREE.Vector3(0,1,0);
  cam.position.copy(camBase.clone().applyAxisAngle(axisY,truckRig.rotation.y).add(truckRig.position));
  ctl.target.copy(targetBase.clone().applyAxisAngle(axisY,truckRig.rotation.y).add(truckRig.position));}

// ---------- truck boombox became a ground-standing jukebox (music) + TV monitors (video);
// admin-uploaded via /admin, see server.py /api/admin/upload-media. Both are low-poly props
// built from primitives; the jukebox stands on the serving-side ground (moved off the roof so
// it doesn't crowd the truck line). Playback only starts once CONFIG says a file is set (and,
// for audio, once the visitor taps the speaker button - browsers block audio autoplay).
function buildBoombox(){
  const g=new THREE.Group();
  const cab=new THREE.MeshStandardMaterial({color:0x5a1420,roughness:.35});   // cherry cabinet
  const chrome=new THREE.MeshStandardMaterial({color:0xd8dadc,metalness:1,roughness:.2});
  const glow=new THREE.MeshStandardMaterial({color:0xffb030,emissive:0xff9a20,emissiveIntensity:1.6,roughness:.3});
  const dark=new THREE.MeshStandardMaterial({color:0x141414,roughness:.6});
  // plinth + arched cabinet: box body capped by a flattened half-dome (classic juke silhouette)
  const base=new THREE.Mesh(new THREE.BoxGeometry(.56,.06,.42),dark);base.position.y=.03;g.add(base);
  const body=new THREE.Mesh(new THREE.BoxGeometry(.52,.78,.36),cab);body.position.y=.45;g.add(body);
  const dome=new THREE.Mesh(new THREE.SphereGeometry(.26,20,12,0,Math.PI*2,0,Math.PI/2),cab);
  dome.position.y=.84;dome.scale.set(1.0,.85,1.35);g.add(dome);
  // glowing catalin arch tube + trim ring framing the front
  const arch=new THREE.Mesh(new THREE.TorusGeometry(.235,.026,10,28,Math.PI),glow);
  arch.position.set(0,.84,.30);g.add(arch);
  const trimTop=new THREE.Mesh(new THREE.TorusGeometry(.25,.014,8,28,Math.PI),chrome);
  trimTop.position.set(0,.84,.295);g.add(trimTop);
  // glass belly: record stack + spinning platter behind an inset dark pane
  const pane=new THREE.Mesh(new THREE.PlaneGeometry(.3,.52),new THREE.MeshPhysicalMaterial({color:0x0a1018,roughness:.05,metalness:.2,clearcoat:1,transparent:true,opacity:.85}));
  pane.position.set(0,.5,.185);g.add(pane);
  const platter=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.012,20),dark);platter.position.set(0,.42,.2);g.add(platter);
  const vinyl=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.014,20),new THREE.MeshStandardMaterial({color:0x161616,roughness:.4}));
  vinyl.position.set(0,.43,.2);g.add(vinyl);
  const label=new THREE.Mesh(new THREE.CylinderGeometry(.032,.032,.016,14),new THREE.MeshStandardMaterial({color:0xe83a73,roughness:.5}));
  label.position.set(0,.437,.2);g.add(label);
  for(let i=0;i<3;i++){   // record magazines poking up behind the window
    const rec=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.02,18),new THREE.MeshStandardMaterial({color:0x1d1d1d,roughness:.5}));
    rec.rotation.x=Math.PI/2;rec.position.set(-.05+i*.05,.6+i*.045,.16);g.add(rec);}
  // side speaker grilles + chrome side bands, then the coin slot + button row on the front
  for(const sx of [-1,1]){
    const spk=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.02,20),new THREE.MeshStandardMaterial({color:0x3a3a3a,roughness:.6}));
    spk.rotation.z=Math.PI/2;spk.position.set(sx*.27,.5,0);g.add(spk);
    const band=new THREE.Mesh(new THREE.BoxGeometry(.012,.78,.36),chrome);band.position.set(sx*.265,.45,0);g.add(band);}
  const coin=new THREE.Mesh(new THREE.BoxGeometry(.05,.012,.006),chrome);coin.position.set(-.04,.13,.19);g.add(coin);
  const btns=new THREE.Mesh(new THREE.BoxGeometry(.1,.05,.01),new THREE.MeshStandardMaterial({color:0xe8e2d4,roughness:.5}));
  btns.position.set(.03,.125,.19);g.add(btns);
  g.traverse(o=>{o.castShadow=true;o.receiveShadow=true;});
  return g;
}
function buildTVMonitor(){
  const g=new THREE.Group();
  const frame=new THREE.Mesh(new THREE.BoxGeometry(1.0,.58,.06),new THREE.MeshStandardMaterial({color:0x111111,roughness:.5}));g.add(frame);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.92,.5),new THREE.MeshBasicMaterial({color:0x000000}));
  screen.position.z=.031;g.add(screen);
  g.traverse(o=>{o.castShadow=true;o.receiveShadow=true;});
  return {group:g,screenMesh:screen};
}
const jukebox=buildBoombox();
// ground-standing jukebox pulled off the serving-side lawn to stand beside the HIGH SCORES
// board (east flank; claw machine on the west) — user layout pass
jukebox.position.set(-1.7,0,-8.3);jukebox.rotation.y=.32;
truckRig.add(jukebox);
// TV monitors: two hang on both cab side walls, just over the side windows near the front
// (leaning slightly against the roofline); the service wall TV is tucked in the clear strip
// ahead of the window; front/rear end caps each carry one.
const cabCx=bx0-BL/2-CL/2;   // cab center x (front of truck = -x), mirrors truck.js's local cx
const tvBack=buildTVMonitor();
tvBack.group.position.set(cabCx-.2,2.56,-BW/2-.04);tvBack.group.rotation.set(-.12,Math.PI,0);truckRig.add(tvBack.group);   // over the driver-side window
const tvService=buildTVMonitor();
tvService.group.position.set(cabCx-.2,2.56,BW/2+.04);tvService.group.rotation.x=.12;truckRig.add(tvService.group);   // over the passenger-side window
const tvFront=buildTVMonitor();
tvFront.group.position.set(bx0-BL/2-.035,FLOOR+BH*.62,0);tvFront.group.rotation.y=-Math.PI/2;truckRig.add(tvFront.group);   // front end cap
const ALL_TVS=[tvBack,tvService,tvFront];   // rear-end TV removed per owner (kept: cab sides + front)

if(CONFIG.bgMusicEnabled && CONFIG.bgMusicFile){
  const audioEl=document.createElement('audio');
  audioEl.src='/media/'+CONFIG.bgMusicFile;audioEl.loop=true;audioEl.preload='auto';
  audioEl.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(audioEl);
  const btn=document.createElement('button');
  btn.textContent='🔊 Music';
  btn.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:40;padding:.5em .9em;border-radius:999px;border:none;background:#000a;color:#fff;font-size:14px;cursor:pointer;';
  document.body.appendChild(btn);
  let playing=false;
  btn.onclick=()=>{
    if(playing){audioEl.pause();playing=false;btn.textContent='🔊 Music';}
    else{audioEl.play().then(()=>{playing=true;btn.textContent='🔇 Music';}).catch(()=>{});}
  };
}
let sharedVideoTexture=null;   // reused on the stage backdrops too (see buildStage below) so the same video decodes once, not three times
if(CONFIG.tvEnabled && CONFIG.tvVideoFile){
  const videoEl=document.createElement('video');
  videoEl.src='/media/'+CONFIG.tvVideoFile;videoEl.loop=true;videoEl.muted=true;videoEl.playsInline=true;videoEl.autoplay=true;videoEl.preload='auto';
  videoEl.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(videoEl);
  videoEl.play().catch(()=>{});   // muted autoplay is allowed; if it's still blocked the screen just stays black until a tap
  addEventListener('pointerdown',()=>{if(videoEl.paused)videoEl.play().catch(()=>{});},{once:true});
  const vt=new THREE.VideoTexture(videoEl);vt.colorSpace=THREE.SRGBColorSpace;
  for(const t of ALL_TVS) t.screenMesh.material=new THREE.MeshBasicMaterial({map:vt});
  sharedVideoTexture=vt;
}

// ---------- flavor: lunch tables with seated eaters + a parked car ----------
// The old standing queue by the window is gone; people now sit at picnic tables on the lawn
// behind the truck (buildTable + buildEater below). buildWaitingPerson stays generic - the
// stage performer and pano crowd mannequins are built from it too.
function buildWaitingPerson(skinHex, shirtHex, pantsHex){
  const skin=new THREE.MeshStandardMaterial({color:skinHex,roughness:.7});
  const shirt=new THREE.MeshStandardMaterial({color:shirtHex,roughness:.85});
  const pants=new THREE.MeshStandardMaterial({color:pantsHex,roughness:.85});
  const p=new THREE.Group();
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.21,.19,.56,16),shirt);torso.position.y=.28;p.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.115,18,14),skin);head.position.y=.68;head.scale.y=1.1;p.add(head);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,.08,10),skin);neck.position.y=.6;p.add(neck);
  for(const sx of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.075,.065,.48,12),pants);leg.position.set(sx*.08,0,0);p.add(leg);}
  for(const sx of [-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.34,6,10),shirt);arm.position.set(sx*.24,.32,0);arm.rotation.z=sx*.15;p.add(arm);}
  p.traverse(o=>o.castShadow=true);
  return p;
}
// stylized low-poly picnic tables + seated eaters in the same hand-built style as truck.js
// (boxes & primitives, not photoreal) - scene decoration, not a factual record of who's there.
function buildTable(canopyHex){
  const g=new THREE.Group();
  const wood=new THREE.MeshStandardMaterial({color:0x9a6b3f,roughness:.85});
  const woodD=new THREE.MeshStandardMaterial({color:0x7a5028,roughness:.9});
  const steel=new THREE.MeshStandardMaterial({color:0x2b2b2b,roughness:.6});
  const top=new THREE.Mesh(new THREE.BoxGeometry(1.5,.06,.9),wood);top.position.y=.72;g.add(top);
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,.72,10),steel);post.position.y=.36;g.add(post);
  const foot=new THREE.Mesh(new THREE.CylinderGeometry(.3,.34,.05,14),steel);foot.position.y=.025;g.add(foot);
  // benches on the two long sides + plates and cups set out
  for(const s of [1,-1]){
    const bench=new THREE.Mesh(new THREE.BoxGeometry(1.5,.05,.28),woodD);bench.position.set(0,.45,s*.72);g.add(bench);
    for(const bx of [-.55,.55]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.05,.43,.24),woodD);leg.position.set(bx,.215,s*.72);g.add(leg);}}
  for(const [px,pz] of [[-.38,-.16],[.38,-.16],[-.38,.16],[.38,.16]]){
    const plate=new THREE.Mesh(new THREE.CylinderGeometry(.1,.085,.014,14),new THREE.MeshStandardMaterial({color:0xf4f6f0,roughness:.4}));
    plate.position.set(px,.76,pz);g.add(plate);
    const cup=new THREE.Mesh(new THREE.CylinderGeometry(.032,.028,.08,10),new THREE.MeshStandardMaterial({color:0xe83a73,roughness:.5}));
    cup.position.set(px+.15,.79,pz-.3);g.add(cup);}
  // market umbrella: pole + scalloped canopy rim
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.025,.03,2.4,8),steel);pole.position.set(0,1.2,.08);g.add(pole);
  const canopy=new THREE.Mesh(new THREE.ConeGeometry(1.45,.5,12),new THREE.MeshStandardMaterial({color:canopyHex,roughness:.55,side:THREE.DoubleSide}));
  canopy.position.set(0,2.34,.08);g.add(canopy);
  const fringe=new THREE.Mesh(new THREE.TorusGeometry(1.42,.028,6,24),new THREE.MeshStandardMaterial({color:0xf6e7c8,roughness:.5}));
  fringe.rotation.x=Math.PI/2;fringe.position.y=2.09;g.add(fringe);
  g.traverse(o=>o.castShadow=true);
  return g;
}
function buildEater(skinHex,shirtHex,pantsHex){
  const skin=new THREE.MeshStandardMaterial({color:skinHex,roughness:.7});
  const shirt=new THREE.MeshStandardMaterial({color:shirtHex,roughness:.85});
  const pants=new THREE.MeshStandardMaterial({color:pantsHex,roughness:.85});
  const p=new THREE.Group();   // root sits ON the bench top (y offset handled by the caller)
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.21,.19,.5,16),shirt);torso.position.y=.3;p.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.115,18,14),skin);head.position.y=.66;head.scale.y=1.1;p.add(head);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,.08,10),skin);neck.position.y=.58;p.add(neck);
  // seated: hips just above the root, thighs horizontal to the knees, shins dropping below the
  // root line to the grass (figure faces -z by construction)
  for(const sx of [-1,1]){
    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(.078,.068,.42,12),pants);
    thigh.rotation.x=Math.PI/2;thigh.position.set(sx*.08,.07,-.2);p.add(thigh);
    const shin=new THREE.Mesh(new THREE.CylinderGeometry(.066,.056,.46,12),pants);
    shin.position.set(sx*.075,-.15,-.44);shin.rotation.x=-.12;p.add(shin);
    const shoe=new THREE.Mesh(new THREE.BoxGeometry(.13,.08,.24),new THREE.MeshStandardMaterial({color:0x191919,roughness:.9}));
    shoe.position.set(sx*.075,-.4,-.5);p.add(shoe);}
  for(const sx of [-1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.34,6,10),shirt);
    arm.position.set(sx*.24,.35,-.05);arm.rotation.z=sx*.2;arm.rotation.x=.5;p.add(arm);}
  // the eating arm: shoulder pitched forward, forearm standing up from the tabletop to the mouth
  {const up=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.22,6,10),shirt);
    up.position.set(.24,.38,-.2);up.rotation.x=1.2;p.add(up);
  const fore=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.26,6,10),shirt);
    fore.position.set(.24,.56,-.28);fore.rotation.x=1.5;p.add(fore);
  const snack=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),new THREE.MeshStandardMaterial({color:0xe8c23a,roughness:.7}));
    snack.position.set(.24,.64,-.31);p.add(snack);}
  p.traverse(o=>o.castShadow=true);
  p.userData.head=head;
  return p;
}
const eaterLooks=[[0xd9a978,0xb5342f,0x2b2b2b],[0xa8714a,0xe8c23a,0x374a6b],[0xf0c7a0,0x3f7a6b,0x4a4a4a],
  [0xe8b98c,0x4a6fb5,0x232323],[0xc0724a,0x7a4bd1,0x303030],[0x9c6f4e,0xe8425f,0x2b2f4a]];
const eaters=[],TABLE_HIT=[];
const UMCYC=[0xe8578a,0xf2c14e,0x4fc3d9];   // pink / gold / teal canopies cycling across the lawn
// fourteen picnic tables ring the truck in a full 360° seating chain: two pre-occupied tables
// open the ring, a dozen OPEN tables (canopy colour cycling) fill the rest for waiting
// customers / the hot-dog contest (the first open one carries the contest sign; tapping any
// opens the contest panel). Radii stagger so the ring doesn't read as a drill square, and the
// slot straight out the serving window stays clear as the walk-up lane.
const TRUCK_CX=-2.9;                                        // centre of the truck footprint
let openIdx=0;
const OCC_T=[[[-.42,-1,0],[.42,-1,1],[0,1,2]]];             // pre-seated trios in table-local coords
const RELOC={0:[3.2,-4.1],3:[10.6,4.9],4:[3.9,7.0],12:[-13.4,-5.6],13:[-15.1,-1.4]};   // layout pass: s0/s13 clear the serving-window front, s12 leaves the HIGH SCORES board lawn, s3/s4 get off the Impala
for(let s=0;s<14;s++){
  let a,px,pz;
  if(RELOC[s]){[px,pz]=RELOC[s];a=Math.atan2(pz,px-TRUCK_CX);}   // relocated tables keep bench-facing-the-truck rotation
  else{a=-Math.PI/2+(s+1)*2*Math.PI/14;const r=s%2?9.9:8.0;px=TRUCK_CX+Math.cos(a)*r;pz=Math.sin(a)*r;}   // ring pushed out ~1/3 for walking room
  const tab=buildTable(s<2?[0xe8578a,0xf2c14e][s]:UMCYC[openIdx++%3]);
  tab.position.set(px,0,pz);
  tab.rotation.y=Math.PI/2-a;                 // one long side (bench) always faces the truck
  truckRig.add(tab);TABLE_HIT.push(tab);
  if(s<2)for(const [dx,seat,li] of OCC_T[0]){  // occupied: a pair + one across, all mid-bite
    const e=buildEater(...eaterLooks[li%eaterLooks.length]);
    e.position.set(dx,.475,seat*.76);e.rotation.y=seat<0?Math.PI:0;
    e.userData.by=.475;e.userData.ph=Math.random()*6.28;
    tab.add(e);eaters.push(e);}
}
// contest sign: a little billboard riding the first open table's umbrella pole — sprites are
// one quad, camera-facing, basically free; tapping that table (any table) opens the contest.
{const sc2=document.createElement('canvas');sc2.width=256;sc2.height=96;const sg2=sc2.getContext('2d'); sg2.fillStyle='rgba(14,10,18,.86)';sg2.beginPath();sg2.roundRect(3,3,250,90,18);sg2.fill();
 sg2.strokeStyle='#e83a73';sg2.lineWidth=4;sg2.stroke();
 sg2.fillStyle='#f6e7c8';sg2.font='bold 25px Inter';sg2.textAlign='center';
 sg2.fillText('🌭 EATING CONTEST',128,34);
 sg2.fillStyle='#e8c23a';sg2.font='16px Inter';sg2.fillText('tap the table to enter',128,66);
 const signT=new THREE.CanvasTexture(sc2);signT.colorSpace=THREE.SRGBColorSpace;
 const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:signT,transparent:true,depthWrite:false}));
 const ct=TABLE_HIT[2];sign.position.set(0,3.15,.08);sign.scale.set(2.1,.79,1);ct.add(sign);}
// seat list for avatars.js' "ordered a food → grab a table" flow: a function so layout-mode
// drags always hand back the truck cluster's current world position for the seats
window.__EOL_SEATS=()=>TABLE_HIT.map(t=>{const w=truckRig.localToWorld(t.position.clone());return {x:w.x,z:w.z};});

// stylized '64-ish Impala lowrider mock-up, parked beside the truck (low-poly proportions, not a
// photo, not a photoreal brand recreation - generic candy paint, chrome Dayton-style wire wheels,
// hydraulics ("on switches") and a trunk/back-seat subwoofer setup, all built from primitives.
function buildChromeDWheel(){   // chrome wire-spoke "Daytons" look
  const wheel=new THREE.Group();
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.22,24),new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:.9}));wheel.add(tire);
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.26,24),new THREE.MeshStandardMaterial({color:0xe8ecef,roughness:.08,metalness:1}));wheel.add(rim);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.29,16),new THREE.MeshStandardMaterial({color:0xf3d98a,roughness:.15,metalness:.9}));wheel.add(hub);   // gold knock-off spinner
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;
    const spoke=new THREE.Mesh(new THREE.BoxGeometry(.02,.22,.02),new THREE.MeshStandardMaterial({color:0xe8ecef,roughness:.08,metalness:1}));
    spoke.position.set(Math.cos(a)*.13,0,Math.sin(a)*.13);spoke.rotation.y=a;wheel.add(spoke);}
  wheel.rotation.z=Math.PI/2;
  return wheel;
}
function buildLowriderImpala(){
  const car=new THREE.Group();
  const CANDY=0x4a0f72;   // deep candy purple over a dark base, classic lowrider paint
  const paint=new THREE.MeshStandardMaterial({color:CANDY,roughness:.16,metalness:.55});
  const glass=new THREE.MeshStandardMaterial({color:0x10131a,roughness:.1,metalness:.3});
  const chrome=new THREE.MeshStandardMaterial({color:0xe8ecef,roughness:.08,metalness:1});
  const woofMat=new THREE.MeshStandardMaterial({color:0x111111,roughness:.4,metalness:.3});
  const tan=new THREE.MeshStandardMaterial({color:0xa8763e,roughness:.8});
  const steel=new THREE.MeshStandardMaterial({color:0x8d939b,metalness:.9,roughness:.3});
  const LEN=5.4, WID=1.95;
  // interior first so the shell sits over it: split bench + receiver/front seats, dash and wheel
  {const seat=new THREE.Mesh(new THREE.BoxGeometry(WID*.6,.22,.85),tan);seat.position.set(0,.62,.75);car.add(seat);
   const seatBack=new THREE.Mesh(new THREE.BoxGeometry(WID*.6,.3,.12),tan);seatBack.position.set(0,.8,1.18);seatBack.rotation.x=-.2;car.add(seatBack);
   const dash=new THREE.Mesh(new THREE.BoxGeometry(WID*.78,.16,.5),new THREE.MeshStandardMaterial({color:0x1a1214,roughness:.7}));
   dash.position.set(0,.8,LEN*.3-.95);dash.rotation.x=.3;car.add(dash);
   const wheel=new THREE.Mesh(new THREE.TorusGeometry(.16,.02,8,20),new THREE.MeshStandardMaterial({color:0x2a1a10,roughness:.6}));
   wheel.rotation.x=1.15;wheel.position.set(-.36,.86,LEN*.3-1.15);car.add(wheel);
   const post=new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.2,6),chrome);post.position.set(-.36,.78,LEN*.3-1.0);post.rotation.x=.4;car.add(post);}
  const body=new THREE.Mesh(new THREE.BoxGeometry(WID,.56,LEN),paint);body.position.y=.5;car.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(WID*.82,.46,LEN*.4),paint);cabin.position.set(0,.98,.35);car.add(cabin);
  // greenhouse glass runs a touch WIDER but shorter than the paint cabin, so it shows as the
  // window band all around instead of hiding inside the roof box
  const windsh=new THREE.Mesh(new THREE.BoxGeometry(WID*.84,.32,LEN*.32),glass);windsh.position.set(0,1.0,.35);car.add(windsh);
  const spear=new THREE.Mesh(new THREE.BoxGeometry(WID+.02,.05,LEN*.78),chrome);spear.position.set(0,.52,-.1);car.add(spear);   // chrome side spear
  // period details: door seams + handles, side mirrors, roof drip rail, A/C louvres on the cowl
  for(const sx of [1,-1]){
    const seamB=new THREE.Mesh(new THREE.BoxGeometry(.014,.5,.01),new THREE.MeshStandardMaterial({color:0x2a1450,roughness:.6}));
    seamB.position.set(sx*(WID/2+.002),.5,.42);car.add(seamB);
    const seamF=seamB.clone();seamF.rotation.y=0;seamF.position.set(sx*(WID/2+.002),.5,-.62);car.add(seamF);
    const seamT=new THREE.Mesh(new THREE.BoxGeometry(.02,.5,.014),new THREE.MeshStandardMaterial({color:0x2a1450,roughness:.6}));
    seamT.position.set(sx*(WID/2-.02),.5,1.25);car.add(seamT);
    for(const hz of [.7,-.8]){const h=new THREE.Mesh(new THREE.BoxGeometry(.02,.035,.12),chrome);h.position.set(sx*(WID/2+.01),.56,hz);car.add(h);}
    const mrArm=new THREE.Mesh(new THREE.BoxGeometry(.04,.04,.2),chrome);mrArm.position.set(sx*(WID/2+.14),.92,LEN*.3-.55);car.add(mrArm);
    const mr=new THREE.Mesh(new THREE.BoxGeometry(.05,.2,.12),chrome);mr.position.set(sx*(WID/2+.2),1.04,LEN*.3-.62);mr.castShadow=true;car.add(mr);
    // fender louvres: three little vents behind each front wheel arch
    for(let v=0;v<3;v++){const vent=new THREE.Mesh(new THREE.BoxGeometry(.02,.18,.035),steel);
      vent.position.set(sx*(WID/2+.01),.55,LEN/2-.95+v*.13);car.add(vent);}}
  // drip rail: thin chrome trim riding the roof edges (a full plate read as a giant white slab)
  {const dz=LEN*.21;
   for(const sx of [-1,1]){const s=new THREE.Mesh(new THREE.BoxGeometry(.025,.03,LEN*.42),chrome);s.position.set(sx*(WID*.41),1.22,.35);car.add(s);}
   for(const sz of [-1,1]){const c=new THREE.Mesh(new THREE.BoxGeometry(WID*.82,.03,.025),chrome);c.position.set(0,1.22,.35+sz*dz);car.add(c);}}
  const bumperF=new THREE.Mesh(new THREE.BoxGeometry(WID*1.04,.22,.22),chrome);bumperF.position.set(0,.3,LEN/2-.02);car.add(bumperF);
  const bumperR=new THREE.Mesh(new THREE.BoxGeometry(WID*1.04,.22,.22),chrome);bumperR.position.set(0,.3,-LEN/2+.02);car.add(bumperR);
  for(const sx of [-1,1]){const guard=new THREE.Mesh(new THREE.BoxGeometry(.12,.2,.5),chrome);
    guard.position.set(sx*(WID*.72),.32,LEN/2-.02);car.add(guard);}   // bumper guards
  // grille: chrome bar + vertical teeth, dual round headlights in bezels
  const grille=new THREE.Mesh(new THREE.BoxGeometry(WID*.6,.2,.05),chrome);grille.position.set(0,.54,LEN/2+.03);car.add(grille);
  for(let i=0;i<6;i++){const tooth=new THREE.Mesh(new THREE.BoxGeometry(.05,.16,.02),steel);
    tooth.position.set(-.4+i*.16,.54,LEN/2+.06);car.add(tooth);}
  for(const sx of [-1,1]){const bez=new THREE.Mesh(new THREE.CylinderGeometry(.145,.145,.05,14),steel);
    bez.rotation.x=Math.PI/2;bez.position.set(sx*(WID*.4),.54,LEN/2+.05);car.add(bez);
    const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.03,14),new THREE.MeshStandardMaterial({color:0xfff3cf,emissive:0xfff3cf,emissiveIntensity:.4}));
    lamp.rotation.x=Math.PI/2;lamp.position.set(sx*(WID*.4),.54,LEN/2+.08);car.add(lamp);}
  for(const sx of [-1,1]){const fin=new THREE.Mesh(new THREE.BoxGeometry(.06,.3,.5),paint);   // subtle period tailfins
    fin.position.set(sx*(WID/2-.03),.78,-LEN/2+.35);fin.rotation.x=-.12;car.add(fin);}
  for(const sz of [-1,1]){const lcol=sz>0?0xfff3cf:0xaa1f1f;
    const light=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.06,16),new THREE.MeshStandardMaterial({color:lcol,emissive:lcol,emissiveIntensity:.55}));
    light.rotation.x=Math.PI/2;light.position.set(WID/2-.26,.5,sz*(LEN/2+.02));car.add(light);
    const light2=light.clone();light2.position.x=-WID/2+.26;car.add(light2);}
  const pass=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.02,20),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.5}));   // white essays? no: plates
  pass.rotation.x=Math.PI/2;pass.position.set(0,.42,LEN/2+.05);car.add(pass);
  // whitewalls + hydraulics hardware at every corner: double-acting cylinders, hoses, springs
  const hose=new THREE.MeshStandardMaterial({color:0xa32b1e,roughness:.6});
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const w=buildChromeDWheel();w.position.set(sx*(WID/2-.01),.34,sz*(LEN/2-1.05));car.add(w);
    const w1=new THREE.Mesh(new THREE.TorusGeometry(.235,.02,8,24),new THREE.MeshStandardMaterial({color:0xf4f6f0,roughness:.5}));
    w1.position.copy(w.position);w1.position.y-=.02;car.add(w1);w1.rotation.z=Math.PI/2;
    // pump cylinders: two chrome tubes bolted beside the axle, rams under the frame points
    for(const oy of [-.08,.08]){const cyl=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.26,10),chrome);
      cyl.position.set(sx*(WID/2-.05)+(sz<0?.0:-.0),.22,sz*(LEN/2-1.05)+oy*1.6);car.add(cyl);
      const ram=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.22,8),steel);
      ram.position.set(cyl.position.x,.34,cyl.position.z);car.add(ram);}
    const pkg=new THREE.Mesh(new THREE.TorusGeometry(.1,.028,8,20),hose);   // High-pressure hose arc to the pump
    pkg.position.set(sx*(WID/2-.09),.3,sz*(LEN/2-1.05)-sz*.28);pkg.rotation.y=Math.PI/2*sz;pkg.rotation.x=.4*sz;car.add(pkg);
    const spg=new THREE.Mesh(new THREE.TorusGeometry(.11,.022,6,18),steel);   // spring coil visible between body & axle
    spg.position.set(sx*(WID/2-.06),.44,sz*(LEN/2-1.05));spg.rotation.z=Math.PI/2;car.add(spg);}
  // ---- trunk, popped open, showing a big dual-sub box (the "jackhammer"-style setup) ----
  const trunkLid=new THREE.Mesh(new THREE.BoxGeometry(WID*.9,.06,LEN*.22),paint);
  trunkLid.position.set(0,.84,-LEN/2+LEN*.11);trunkLid.rotation.x=-.95;car.add(trunkLid);   // tilted open, hinge at the rear edge
  const trunkRail=new THREE.Mesh(new THREE.BoxGeometry(WID*.9,.03,LEN*.22),chrome);trunkRail.position.set(0,.82,-LEN/2+LEN*.11);trunkRail.rotation.x=-.95;car.add(trunkRail);
  const subBox=new THREE.Mesh(new THREE.BoxGeometry(WID*.78,.5,.55),new THREE.MeshStandardMaterial({color:0x2a2018,roughness:.75}));
  subBox.position.set(0,.74,-LEN/2+.55);car.add(subBox);
  for(const sx of [-.42,.42]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.19,.03,12,24),chrome);ring.position.set(sx*WID*.5,.74,-LEN/2+.28);car.add(ring);
    const cone=new THREE.Mesh(new THREE.CylinderGeometry(.16,.19,.1,20),woofMat);cone.rotation.x=Math.PI/2;cone.position.set(sx*WID*.5,.74,-LEN/2+.3);car.add(cone);}
  const amp=new THREE.Mesh(new THREE.BoxGeometry(.5,.07,.3),new THREE.MeshStandardMaterial({color:0x18181c,roughness:.5,metalness:.4}));
  amp.position.set(0,.68,-LEN/2+.3);amp.rotation.x=.35;car.add(amp);
  const glow=new THREE.Mesh(new THREE.BoxGeometry(.5,.02,.02),new THREE.MeshStandardMaterial({color:0x39d0ff,emissive:0x39d0ff,emissiveIntensity:1.2}));
  glow.position.set(0,.725,-LEN/2+.3);glow.rotation.x=.35;car.add(glow);
  // ---- hydraulics switch console on the trunk lip: engraved panel + 4 gold toggles with
  // status LEDs (banks: front / back / left / right). Tap a switch to arm/disarm its bank,
  // tap the car to make it hop. Click wiring lives in the "interaction" block in scene.js.
  const panel=new THREE.Mesh(new THREE.BoxGeometry(.34,.16,.14),new THREE.MeshStandardMaterial({color:0x101014,roughness:.45,metalness:.35}));
  panel.position.set(.44,.8,-LEN/2+.9);panel.rotation.x=-.35;car.add(panel);
  const engrave=new THREE.Mesh(new THREE.BoxGeometry(.30,.10,.005),new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:.3,metalness:.6}));
  engrave.position.set(.44,.805,-LEN/2+.895);engrave.rotation.x=-.35;car.add(engrave);
  const label=document.createElement('canvas');label.width=128;label.height=48;const lg=label.getContext('2d');
  lg.fillStyle='#0a0a0e';lg.fillRect(0,0,128,48);lg.fillStyle='#e8c23a';lg.font='bold 15px Inter';lg.textAlign='center';
  lg.fillText('ON SWITCHES',64,20);lg.font='11px Inter';lg.fillStyle='#e8ecef';lg.fillText('F B L R',64,40);
  const plateT=new THREE.CanvasTexture(label);plateT.colorSpace=THREE.SRGBColorSpace;
  const plate=new THREE.Mesh(new THREE.PlaneGeometry(.23,.086),new THREE.MeshBasicMaterial({map:plateT}));
  plate.position.set(.44,.815,-LEN/2+.828);plate.rotation.x=-.35+Math.PI;plate.rotation.z=Math.PI;car.add(plate);
  const banks=['front','back','left','right'];const switches=[],leds=[];
  for(let i=0;i<4;i++){
    const on=banks[i]==='front';
    const sw=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.085,8),new THREE.MeshStandardMaterial({color:0xf3d98a,metalness:.9,roughness:.15}));
    sw.position.set(.44-.115+i*.077,.84,-LEN/2+.85);sw.rotation.x=on?-.45:.5;sw.userData.bank=banks[i];car.add(sw);switches.push(sw);
    const led=new THREE.Mesh(new THREE.SphereGeometry(.014,8,6),new THREE.MeshStandardMaterial({color:0x330000,emissive:0xff2020,emissiveIntensity:on?1.8:.15}));
    led.position.set(sw.position.x,.885,-LEN/2+.79);car.add(led);leds.push(led);}
  car.userData.switches=switches;car.userData.switchLeds=leds;car.userData.banks={front:true,back:false,left:false,right:false};
  car.traverse(o=>{o.castShadow=true;o.receiveShadow=true;});
  return car;
}
const lexus=buildLowriderImpala();   // kept the var name so nothing else in this file needs touching
lexus.position.set(WX1+6.2,0,BW/2+2.1);lexus.rotation.y=Math.PI/2+.08;   // parked further off, out of the walk-up queue; y=0 so the wheels sit on the ground, not FLOOR (the truck's cargo-box height)
lexus.userData.baseY=0;
truckRig.add(lexus);
lexus.userData.hopSeed=Math.random()*6;lexus.userData.hopSide=Math.random()<.5?-1:1;
ALL_HYDRAULICS.push(lexus);   // "on switches" - gets a random hydraulic hop in the main render loop

// ---------- movable lot props (#layout registry) + the saved layout EVERY visitor gets ----------
// Everything the owner might want to re-place is registered here with its compiled-in base
// (rig-local x/z + rotation in degrees). All visitors get the admin-saved arrangement
// (Settings layoutProps, written by #layout's "Save as default"); a #layout session previews
// in localStorage first. Prop ids are stable — they persist in settings.json.
const LAYOUT_MOVERS=[];   // {id,label,obj,base} — the truck itself is handled separately (own settings keys)
{const reg=(id,label,obj)=>{if(obj)LAYOUT_MOVERS.push({id,label,obj,base:{x:obj.position.x,z:obj.position.z,y:obj.position.y,
  r:((obj.rotation.y*180/Math.PI)%360+360)%360}});};
 reg('jukebox','Jukebox',jukebox);
 reg('claw','Claw machine',Arcade.prop('claw'));
 (Arcade.prop('bbt')||[]).forEach((b,i)=>reg('bbt'+i,'Bean-bag board '+(i+1),b));
 reg('tag','Tag arena',Arcade.prop('tag'));
 reg('scores','HIGH SCORES board',Arcade.prop('board'));
 reg('impala','Impala lowrider',lexus);
 TABLE_HIT.forEach((t,i)=>reg('table'+i,'Picnic table '+(i+1),t));}
const propLayoutAll=()=>Object.fromEntries(LAYOUT_MOVERS.map(m=>{const v={x:+m.obj.position.x.toFixed(2),z:+m.obj.position.z.toFixed(2),
  r:+(((m.obj.rotation.y*180/Math.PI)%360+360)%360).toFixed(1)};if(m.id==='scores')v.y=+m.obj.position.y.toFixed(2);return [m.id,v];}));
function applyPropLayout(src){
  for(const m of LAYOUT_MOVERS){const v=(src||{})[m.id];if(!v)continue;
    m.obj.position.set(+v.x||0,(v.y!=null?+v.y:m.obj.position.y)||0,+v.z||0);
    m.obj.rotation.y=(+v.r||0)*Math.PI/180;}
}
{let saved=null;try{saved=JSON.parse(localStorage.getItem('eol_layoutProps')||'null');}catch{}
 applyPropLayout(saved||CONFIG.layoutProps||{});}   // this browser's #layout preview > admin-saved > built-in
window.__EOL_PROPS=()=>LAYOUT_MOVERS.map(m=>{const w=new THREE.Vector3();m.obj.getWorldPosition(w);
  return {id:m.id,x:+w.x.toFixed(2),z:+w.z.toFixed(2)};});   // 📱 GPS app: live prop positions for the lot map

// a little billboard hint so the switches/car are discoverable: sprites are a single quad,
// always camera-facing, and recolored for the same hand-painted tone as the rest of the prop text
{const hc=document.createElement('canvas');hc.width=256;hc.height=72;const hg=hc.getContext('2d');
 hg.fillStyle='rgba(12,8,18,.78)';hg.beginPath();hg.roundRect(2,2,252,68,16);hg.fill();
 hg.strokeStyle='rgba(232,58,115,.9)';hg.lineWidth=3;hg.stroke();
 hg.fillStyle='#f6e7c8';hg.font='600 22px Inter';hg.textAlign='center';
 hg.fillText('Tap the car to hop it',128,28);
 hg.fillStyle='#e8c23a';hg.font='15px Inter';hg.fillText('Flip the ON-SWITCHES for corners',128,56);
 const hsT=new THREE.CanvasTexture(hc);hsT.colorSpace=THREE.SRGBColorSpace;
 const hint=new THREE.Sprite(new THREE.SpriteMaterial({map:hsT,transparent:true,depthWrite:false}));
 hint.position.set(.35,1.62,-1.65);hint.scale.set(1.55,.44,1);lexus.add(hint);}

// scenery: the owner asked for the house, fence and trees gone — the 360° panorama now carries
// all the scenery, so the grounds stay open apart from the stages, booths and crowd figures.

// ---------- music-festival staging: two stages flanking the truck/car/people cluster in the
// open grass, facing each other across the grounds. Stylized
// low-poly trussing/platform/PA/spotlights - not based on any real venue, vendor, or event,
// and not tied to the truck's draggable position (that moves separately in layout mode), so
// if the truck gets dragged much further out later these may need repositioning too.
function buildStage(o={}){
  const g=new THREE.Group();
  const W=o.W||9,D=o.D||5.5,H=o.H||0.7,k=W/9;   // k scales stage furniture with the deck width
  const deck=new THREE.Mesh(new THREE.BoxGeometry(W,H,D),new THREE.MeshStandardMaterial({color:0x2b2420,roughness:.9}));
  deck.position.y=H/2;deck.castShadow=deck.receiveShadow=true;g.add(deck);
  // backdrop: a simple gradient canvas panel (festival colors) - no real branding or text
  const bc=document.createElement('canvas');bc.width=512;bc.height=256;
  {const bg=bc.getContext('2d');const gr=bg.createLinearGradient(0,0,0,256);
   gr.addColorStop(0,'#2a1a5e');gr.addColorStop(.55,'#8a2f87');gr.addColorStop(1,'#e8623a');
   bg.fillStyle=gr;bg.fillRect(0,0,512,256);
   bg.fillStyle='rgba(255,255,255,.12)';for(let i=0;i<6;i++){bg.beginPath();bg.arc(256,260,60+i*34,Math.PI,0);bg.fill();}}
  const backT=new THREE.CanvasTexture(bc);backT.colorSpace=THREE.SRGBColorSpace;
  const backH=.42*W;
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(W-.4,backH),new THREE.MeshStandardMaterial({map:backT,roughness:.8,side:THREE.DoubleSide}));
  backdrop.position.set(0,H+backH/2,-D/2+0.15);g.add(backdrop);
  // truss towers + top beam + colored spotlights aimed at the front of the deck
  const trussM=new THREE.MeshStandardMaterial({color:0x1b1b1b,metalness:.6,roughness:.5});
  const towerH=.58*W;
  for(const sx of [-1,1]){
    for(const ty of [0,.4,.8]){const bar=new THREE.Mesh(new THREE.BoxGeometry(.3,.16,.3),trussM);
      bar.position.set(sx*(W/2-.3),H+ty*towerH,-D/2+0.1);g.add(bar);}
    const tower=new THREE.Mesh(new THREE.BoxGeometry(.26,towerH,.26),trussM);
    tower.position.set(sx*(W/2-.3),H+towerH/2,-D/2+0.1);tower.castShadow=true;g.add(tower);}
  const beam=new THREE.Mesh(new THREE.BoxGeometry(W-.2,.24,.24),trussM);beam.position.set(0,H+towerH,-D/2+0.1);g.add(beam);
  const lampM=new THREE.MeshStandardMaterial({color:0x111111,metalness:.5});
  const hues=[0xff4d6d,0x4dd2ff,0xffd24d,0x7dff4d,0xb44dff];
  const lasers=[];
  const nL=Math.max(3,Math.round(W*.2));   // thin beams, not a wall of light (reduced on request)
  for(let i=0;i<nL;i++){
    const lx=-W/2+0.6+i*(W-1.2)/(nL-1),big=H+towerH-.3;
    const lamp=new THREE.Mesh(new THREE.ConeGeometry(.2,.36,10),lampM);lamp.rotation.x=Math.PI*.7;lamp.position.set(lx,big,-D/2+0.35);g.add(lamp);
    const tgt=new THREE.Object3D();tgt.position.set(lx*.35,H,D/2-1);g.add(tgt);
    const spot=new THREE.SpotLight(hues[i%hues.length],5,14,.55,.45,1.3);spot.position.copy(lamp.position);spot.target=tgt;g.add(spot);
    // laser beam: a fat additive-blended cylinder, parented to the lamp so it inherits its
    // base aim, with its own sweep animated in the render loop. Scales up with stage width.
    const laserLen=.85*(D/2+H+towerH+towerH*.4);
    const laser=new THREE.Mesh(new THREE.CylinderGeometry(.02*k+.012,.085*k+.05,laserLen,8),
      new THREE.MeshBasicMaterial({color:hues[i%hues.length],transparent:true,opacity:.3,blending:THREE.AdditiveBlending,depthWrite:false}));
    laser.position.y=laserLen/2;lamp.add(laser);
    lasers.push({mesh:laser,phase:Math.random()*Math.PI*2,speed:.35+Math.random()*.5,axis:i%2?'x':'z',amp:.3+Math.random()*.28});
  }
  // PA stacks
  const paM=new THREE.MeshStandardMaterial({color:0x151515,roughness:.85});
  for(const sx of [-1,1]){const pa=new THREE.Mesh(new THREE.BoxGeometry(.95*k,1.8*k,.95*k),paM);pa.position.set(sx*(W/2+1.15),.9*k,-D/2+0.6);pa.castShadow=true;g.add(pa);}
  // an animated entertainer, mid-deck facing the crowd
  const performer=buildWaitingPerson(0xe8b98a,0xff2fa0,0x2b1b3a);
  performer.position.set(0,H+.24,D*.12);g.add(performer);
  performer.userData.baseY=performer.position.y;
  g.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});
  return {group:g,lasers,performer,backdrop};
}
function buildSmoke(stageGroup,count){
  const sc=document.createElement('canvas');sc.width=sc.height=128;
  {const g=sc.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);
   gr.addColorStop(0,'rgba(255,255,255,.9)');gr.addColorStop(.5,'rgba(225,225,225,.35)');gr.addColorStop(1,'rgba(225,225,225,0)');
   g.fillStyle=gr;g.fillRect(0,0,128,128);}
  const tex=new THREE.CanvasTexture(sc);
  const parts=[];
  for(let i=0;i<count;i++){
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,opacity:0}));
    spr.visible=false;stageGroup.add(spr);
    parts.push({spr,age:0,life:0,vel:new THREE.Vector3()});
  }
  return parts;
}
function tickSmoke(parts,dt){
  for(const p of parts){
    if(p.life<=0){
      if(Math.random()<0.006){   // random fog-machine puffs, not constant
        p.spr.position.set((Math.random()-.5)*3,.3,-1.8+(Math.random()-.5)*1.6);
        p.spr.scale.set(.6,.6,1);p.vel.set((Math.random()-.5)*.3,.55+Math.random()*.3,(Math.random()-.5)*.2);
        p.life=2.6+Math.random()*2;p.age=0;p.spr.visible=true;p.spr.material.opacity=0;
      }
    } else {
      p.age+=dt;const k=p.age/p.life;
      p.spr.position.addScaledVector(p.vel,dt);
      const sc=.6+k*2.1;p.spr.scale.set(sc,sc,1);
      p.spr.material.opacity=Math.sin(Math.min(k,1)*Math.PI)*.45;
      if(p.age>=p.life){p.life=0;p.spr.visible=false;}
    }
  }
}
// placed on the horizon, fronting the truck+crowd zone along the painted-desert azimuth so it
// reads as THE make-shift festival stage (the only one - owner nixed a small truck-side stage):
// uploaded TV video across its backdrop, fat sweeping laser beams off the truss lamps,
// colored spotlights, an animated performer mid-deck, and random fog-machine smoke puffs.
const stageRB=buildStage({W:32,D:13,H:2});const stageBack=stageRB.group;stageBack.position.set(8,0,-70);S.add(stageBack);   // pushed ~25 yd (23 m) back so the truck zone breathes
if(sharedVideoTexture){   // same uploaded TV video, playing across the big stage's backdrop
  stageRB.backdrop.material=new THREE.MeshBasicMaterial({map:sharedVideoTexture,side:THREE.DoubleSide,fog:false});
}
// the performing band on the deck: lead vocal center-front, two players flanking, and a
// drummer behind a riser-mounted kit at the back. Every figure rides the same dance pulse
// in the render loop (ALL_PERFORMERS), so the whole band moves together.
const bandee=(skin,shirt,pants,x,y,z)=>{const m=buildWaitingPerson(skin,shirt,pants);
  m.position.set(x,y,z);m.userData.baseY=y;stageBack.add(m);return m;};
const ALL_LASERS=stageRB.lasers;
const ALL_PERFORMERS=[
  bandee(0xe8b98a,0xff2fa0,0x2b1b3a,0,2.24,2.3),          // lead vocal
  bandee(0xa8714a,0x4fc3d9,0x374a6b,-7.2,2.24,2.9),       // stage-left player
  bandee(0xc0724a,0xf2c14e,0x232323,7.0,2.24,2.8),        // stage-right player
  bandee(0x8a5a35,0x2e8b3d,0x1a1a1a,0,2.48,-3.35)         // drummer, up on the riser
];
{ // drum riser: plinth + kick out front with a head, snare, two toms and a cymbal on a stand
  const riser=new THREE.Mesh(new THREE.BoxGeometry(2.2,.24,1.5),new THREE.MeshStandardMaterial({color:0x1b1410,roughness:.9}));riser.position.set(0,2.12,-2.9);stageBack.add(riser);
  const shellM=new THREE.MeshStandardMaterial({color:0x8a1b2e,roughness:.35});
  const hdM=new THREE.MeshStandardMaterial({color:0xe8e2d4,roughness:.5});
  const kick=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.5,18),shellM);kick.rotation.x=Math.PI/2;kick.position.set(0,2.58,-2.55);stageBack.add(kick);
  const kickF=new THREE.Mesh(new THREE.CylinderGeometry(.30,.30,.02,18),hdM);kickF.rotation.x=Math.PI/2;kickF.position.set(0,2.58,-2.29);stageBack.add(kickF);
  const snare=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.16,16),shellM);snare.position.set(-.44,2.72,-2.75);stageBack.add(snare);
  for(const [tx,ty] of [[-.26,3.0],[.3,3.02]]){const tom=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.2,14),shellM);tom.rotation.x=.5;tom.position.set(tx,ty,-2.95);stageBack.add(tom);}
  const cymbal=new THREE.Mesh(new THREE.CylinderGeometry(.28,.3,.014,14),new THREE.MeshStandardMaterial({color:0xd9b23a,metalness:.85,roughness:.3}));cymbal.position.set(.5,3.06,-2.62);stageBack.add(cymbal);
  const stand=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.52,6),new THREE.MeshStandardMaterial({color:0x777,metalness:.7,roughness:.3}));stand.position.set(.5,2.56,-2.62);stageBack.add(stand);
}
const ALL_SMOKE=[buildSmoke(stageBack,24)];

// ---------- crowd: random loose clusters of festival-goers filling the open ground between
// the house/truck cluster and the two stages. Same low-poly figure as the truck's queue, just
// recolored per person and scattered - not a factual record of attendance, pure scene dressing.
// reggae/cannabis-fest palette: Rasta-leaning reds/golds/greens/black plus a few bright
// tie-dye-ish accents, instead of generic streetwear colors.
const CROWD_LOOKS=[[0xd9a978,0xd42a2a,0x1a1a1a],[0xa8714a,0xf2c14e,0x2e8b3d],[0xf0c7a0,0x2e8b3d,0x1a1a1a],
  [0xc78f5e,0x1a1a1a,0xf2c14e],[0x8a5a35,0xe85fa0,0x2e8b3d],[0xe6b98a,0xd42a2a,0xf2c14e],
  [0xb07a4e,0xf2a33c,0x1a1a1a],[0x7a4a2a,0x9b4de8,0x2e8b3d],[0xd9a978,0xf2c14e,0xd42a2a],
  [0xa8714a,0x2e8b3d,0xe85fa0],[0xf0c7a0,0xd42a2a,0x2e8b3d],[0x8a5a35,0xf2c14e,0x1a1a1a]];
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
function spawnCrowd(cx,cz,n,faceStage){
  for(let i=0;i<n;i++){
    const person=buildWaitingPerson(...pick(CROWD_LOOKS));
    person.position.set(cx+(Math.random()-.5)*2.6,.24,cz+(Math.random()-.5)*2.6);
    person.rotation.y=faceStage?Math.atan2(8-person.position.x,-70-person.position.z)+(Math.random()-.5)*.3:Math.random()*Math.PI*2;   // stage-front rows watch the band
    S.add(person);
    if(Math.random()<.45) lightPipe(person);   // festival-goers puffing hand pipes
  }
}
// ----------
// pipe smokers: a bowl-and-stem pipe held to the mouth, plus two staggered smoke puffs that
// rise off the bowl and fade instead of one shared fog-machine plume. Per-puff sprite
// material so each puff fades on its own; the shared texture keeps it cheap.
const ALL_PUFFS=[];
{const pc=document.createElement('canvas');pc.width=pc.height=64;
 const pg=pc.getContext('2d');const pgr=pg.createRadialGradient(32,32,0,32,32,32);
 pgr.addColorStop(0,'rgba(235,235,238,.85)');pgr.addColorStop(.45,'rgba(230,230,235,.4)');pgr.addColorStop(1,'rgba(230,230,235,0)');
 pg.fillStyle=pgr;pg.fillRect(0,0,64,64);
 window.__EOL_PUFF_TEX=new THREE.CanvasTexture(pc);
}
const _pd=new THREE.Vector3(),_pu=new THREE.Vector3(0,1,0);
function lightPipe(person){
  const wood=new THREE.MeshStandardMaterial({color:0x7a4a28,roughness:.65});
  const pipe=new THREE.Group();
  const bowl=new THREE.Mesh(new THREE.SphereGeometry(.05,8,6),wood);bowl.scale.y=.8;pipe.add(bowl);
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(.052,.048,.022,8),new THREE.MeshStandardMaterial({color:0xd9d9d9,metalness:.7,roughness:.35}));
  rim.position.y=.028;pipe.add(rim);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,.2,6),wood);
  _pd.set(-.16,.05,-.09).normalize();                 // bowl -> mouth direction, angled down-back
  stem.quaternion.setFromUnitVectors(_pu,_pd);
  stem.position.copy(_pd.clone().multiplyScalar(.1));pipe.add(stem);
  pipe.position.set(.16,.85,.14);pipe.rotation.y=.5;person.add(pipe);   // hand-held at head height
  const puffA=new THREE.Vector3(.2,.94,.17);
  for(let j=0;j<3;j++){   // three staggered puffs per smoker so the drift reads continuous
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:window.__EOL_PUFF_TEX,transparent:true,depthWrite:false,opacity:0}));
    spr.visible=false;spr.position.copy(puffA);person.add(spr);
    ALL_PUFFS.push({spr,t:.4+j*2.2+Math.random()*2,age:0,life:0});
  }
}
function tickPuff(p,dt){
  if(p.life>0){                                       // rising, drifting, fading puff
    p.age+=dt;const k=p.age/p.life;
    p.spr.position.y=.95+k*.62;p.spr.position.x=.2+k*.15;
    const s=.2+k*.6;p.spr.scale.set(s,s,1);
    p.spr.material.opacity=Math.sin(Math.min(1,k)*Math.PI)*.55;
    if(k>=1){p.life=0;p.spr.visible=false;p.t=2+Math.random()*5;}   // then wait between puffs
  }else{
    p.t-=dt;
    if(p.t<=0){p.life=2.7;p.age=0;p.spr.visible=true;p.spr.material.opacity=0;p.spr.position.set(.2,.95,.17);}
  }
}
// south ground (toward the stage pit) and pass-around packs, clear of the house/fence
// (x:[-17,17] z:[-45,-8]), the truck's current spot and the lawn table ring. Thinned to one
// figure per cluster - the dense mass of the festival lives in the panorama. Everyone fronts
// the stage's truck-facing side now: a wide pit band across the full deck width plus flank
// packs at either end - nobody hangs behind the deck.
for(let i=0;i<13;i++) spawnCrowd(-28+Math.random()*72, -4+Math.random()*24, 1);
for(let i=0;i<22;i++) spawnCrowd(-8+Math.random()*32, -61.5+Math.random()*8, 1, true);    // pit, at the stage front, watching the band
for(let i=0;i<5;i++) spawnCrowd(-14.5+Math.random()*5, -61+Math.random()*7, 1, true);     // west flank pack, facing the stage
for(let i=0;i<5;i++) spawnCrowd(26.5+Math.random()*5, -61+Math.random()*7, 1, true);      // east flank pack, facing the stage

// ~200 extra festival-goers packed as the stage-front audience - but cheap: two InstancedMeshes
// (bodies + heads) is the whole thing, two draw calls, no per-frame updates, no shadow casters.
// Phones and laptops both carry that without touching their frame budget. (Used to be a ring on
// the FAR side of the stage; the owner pulled the whole crowd around to the front to watch.)
{const N=200,UP=new THREE.Vector3(0,1,0);
 const bodies=new THREE.InstancedMesh(new THREE.CylinderGeometry(.19,.16,.52,7),
   new THREE.MeshStandardMaterial({roughness:.85}),N);
 const skins=[0xd9a978,0xa8714a,0xf0c7a0,0xc78f5e,0x8a5a35,0xe8b98c,0xb07a4e];
 const shirts=[0xd42a2a,0xf2c14e,0x2e8b3d,0x1a1a1a,0xe85fa0,0xf2a33c,0x9b4de8,0x4a90d9];
 const heads=new THREE.InstancedMesh(new THREE.SphereGeometry(.11,6,5),
   new THREE.MeshStandardMaterial({roughness:.7}),N);
 const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),P=new THREE.Vector3(),Sc=new THREE.Vector3(),C=new THREE.Color();
 const STAGE={x:8,z:-70},BOOTH=[[16,-52],[36,-64],[-24,-50]];   // audience pack fronting the deck (lip at z≈-63.5)
 let placed=0;
 while(placed<N){
   const t=Math.pow(Math.random(),1.5),z=-62.9+t*13.6;   // dense at the stage lip, thinning toward the truck
   const half=16-6*t,x=STAGE.x+(Math.random()*2-1)*half;   // widest at the stage, funneling forward
   if(BOOTH.some(([bx,bz])=>Math.hypot(x-bx,z-bz)<3))continue;   // keep the booth lanes walkable
   const s=.88+Math.random()*.3;
   Q.setFromAxisAngle(UP,Math.atan2(STAGE.x-x,STAGE.z-z)+(Math.random()-.5)*.35);   // every body turned to the stage
   M.compose(P.set(x,.26*s,z),Q,Sc.set(s,s,s));bodies.setMatrixAt(placed,M);
   M.compose(P.set(x,0,z).setY(.62*s),Q,Sc);heads.setMatrixAt(placed,M);
   bodies.setColorAt(placed,C.setHex(shirts[placed%shirts.length]));
   heads.setColorAt(placed,C.setHex(skins[placed%skins.length]));
   placed++;}
 bodies.instanceMatrix.needsUpdate=true;heads.instanceMatrix.needsUpdate=true;
 if(bodies.instanceColor)bodies.instanceColor.needsUpdate=true;
 if(heads.instanceColor)heads.instanceColor.needsUpdate=true;
 S.add(bodies,heads);}

// ---------- vendor booths: little canopy stalls with punny signs, scattered in the same two
// ground areas as the crowd. Fictional stall names for scene flavor, not real businesses.
const BOOTH_NAMES=['Lettuce Turnip the Beet','Thai Tanic','Nacho Average Churro','Kiln It',
  "Bout Tyme Chimes",'Grillz Gone Wild',"Sun's Out, Buns Out",'Scoop There It Is','Aloe There','Shear Madness',
  'Canna-Believe It','High Hopes Hammocks',"Mary's Tie-Dye",'Puff n Stuff Pretzels','Zen & Terpenes','Baked Goods Bakery'];
const BOOTH_HUES=[0xe8623a,0x4a90d9,0xe8c23a,0x7aa04a,0xb44dff,0xff6fa0,0x4caf50,0x66bb6a];
function buildBooth(name,hue){
  const g=new THREE.Group();
  const W=2.6,D=2.2,H=2.1;
  const legM=new THREE.MeshStandardMaterial({color:0x3a3228,roughness:.9});
  for(const sx of [-1,1])for(const sz of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,H,8),legM);
    leg.position.set(sx*(W/2-.1),H/2,sz*(D/2-.1));g.add(leg);}
  const canopy=new THREE.Mesh(new THREE.ConeGeometry(Math.max(W,D)*.78,.9,4),new THREE.MeshStandardMaterial({color:hue,roughness:.75,side:THREE.DoubleSide}));
  canopy.rotation.y=Math.PI/4;canopy.position.y=H+.45;canopy.castShadow=true;g.add(canopy);
  const table=new THREE.Mesh(new THREE.BoxGeometry(W*.85,.5,.55),new THREE.MeshStandardMaterial({color:0x6b4a2f,roughness:.85}));
  table.position.set(0,.25,D/2-.35);g.add(table);
  // random merch piled on the table - folded-fabric stacks, jars/bottles, small pouches - just
  // varied low-poly shapes, not any specific product.
  const merchColors=[0xe8623a,0x4a90d9,0xe8c23a,0x7aa04a,0xb44dff,0xff6fa0,0xd42a2a,0xf2c14e,0x2e8b3d,0x1a1a1a,0xffffff];
  const merchCount=3+Math.floor(Math.random()*4);
  for(let i=0;i<merchCount;i++){
    const mc=merchColors[Math.floor(Math.random()*merchColors.length)],kind=Math.random();
    let item,ly;
    if(kind<.4){item=new THREE.Mesh(new THREE.BoxGeometry(.28,.07,.22),new THREE.MeshStandardMaterial({color:mc,roughness:.9}));ly=.07;}
    else if(kind<.72){item=new THREE.Mesh(new THREE.CylinderGeometry(.06,.07,.22,10),new THREE.MeshStandardMaterial({color:mc,roughness:.35,metalness:.15}));ly=.14;}
    else{item=new THREE.Mesh(new THREE.SphereGeometry(.09,10,8),new THREE.MeshStandardMaterial({color:mc,roughness:.8}));ly=.11;}
    item.position.set((Math.random()-.5)*(W*.65),.5+ly,D/2-.35+(Math.random()-.5)*.35);
    item.rotation.y=Math.random()*Math.PI;item.castShadow=item.receiveShadow=true;g.add(item);
  }
  // a couple of tie-dye-ish fabric swatches hanging off the canopy edge
  for(const sx of [-1,1]){
    const sw=new THREE.Mesh(new THREE.PlaneGeometry(.5,.7),new THREE.MeshStandardMaterial({color:merchColors[Math.floor(Math.random()*merchColors.length)],side:THREE.DoubleSide,roughness:.95}));
    sw.position.set(sx*(W/2-.15),H+.05,D/2-.4);sw.rotation.y=sx*.3;g.add(sw);
  }
  const sc=document.createElement('canvas');sc.width=512;sc.height=160;
  const sg=sc.getContext('2d');sg.fillStyle='#fff8ec';sg.fillRect(0,0,512,160);
  sg.strokeStyle='#2b2420';sg.lineWidth=8;sg.strokeRect(6,6,500,148);
  sg.fillStyle='#2b2420';sg.textAlign='center';sg.font='700 48px Georgia';
  const words=name.split(' ');let lines=[],cur='';
  for(const w of words){const t=(cur?cur+' ':'')+w;if(sg.measureText(t).width>460&&cur){lines.push(cur);cur=w;}else cur=t;}
  if(cur)lines.push(cur);
  const lh=56,startY=80-((lines.length-1)*lh)/2;
  lines.forEach((ln,i)=>sg.fillText(ln,256,startY+i*lh+16));
  const signT=new THREE.CanvasTexture(sc);signT.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.9,0.6),new THREE.MeshStandardMaterial({map:signT,roughness:.6}));
  sign.position.set(0,H-0.55,D/2-.02);g.add(sign);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return g;
}
{let ni=0;
  // thinned by three stalls for the panorama switch - 7 booths, both zones still populated
  const boothSpots=[[-18,8],[16,14],[26,24],[-18,-58],[16,-52],[36,-64],[-24,-50]];
  const names=[...BOOTH_NAMES].sort(()=>Math.random()-.5);   // shuffle so the lineup varies, not the same 6 every load
  for(const [bx,bz] of boothSpots){
    const booth=buildBooth(names[ni%names.length],BOOTH_HUES[ni%BOOTH_HUES.length]);
    const faceSouth=bz<-8;   // "south-zone" booths face +z (toward the middle), "north-zone" ones face -z
    booth.position.set(bx,0,bz);booth.rotation.y=faceSouth?Math.PI:0;
    S.add(booth);
    // a short line of 2-4 people queued up at the table, standing single-file facing the booth
    const lineLen=2+Math.floor(Math.random()*3), dz=faceSouth?-1:1;
    for(let li=0;li<lineLen;li++){
      const p=buildWaitingPerson(...pick(CROWD_LOOKS));
      p.position.set(bx+(Math.random()-.5)*.5, .24, bz+dz*(1.6+li*.75));
      p.rotation.y=(faceSouth?0:Math.PI)+(Math.random()-.5)*.3;
      S.add(p);
    }
    ni++;
  }
}

// ---------- interaction ----------
const ray=new THREE.Raycaster(),m2=new THREE.Vector2();
// taps vs drags: orbiting the camera ends with a click event; without this guard merely
// spinning the view over a table/car/menu would fire their tap actions (contest popping
// open "on its own"). Only clicks that start+end within 8px count, and the click must be
// preceded by a real pointerdown on the canvas — synthetic .click() calls (focus dumps,
// automated tools) carry no pointerdown, so they can never fire table/car/menu actions.
let tapX=0,tapY=0,tapArmed=false;
canvas.addEventListener('pointerdown',e=>{tapX=e.clientX;tapY=e.clientY;tapArmed=true;});
const isTap=e=>tapArmed&&Math.hypot(e.clientX-tapX,e.clientY-tapY)<=8;
const CAR_HIT=ALL_HYDRAULICS.filter(c=>c.userData.switches);   // lowriders with switch consoles are tap targets:
canvas.addEventListener('click',e=>{m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
  if(location.hash.includes('layout')){tapArmed=false;return;}   // #layout: editing the lot, not playing it — suppress game/menu taps
  const used=isTap(e);tapArmed=false;if(!used)return;   // flip a switch = arm/disarm a hydraulics bank, tap the body = popped burst
  const hitCar=CAR_HIT.length?ray.intersectObjects(CAR_HIT,true):[];
  if(hitCar.length){
    const o=hitCar[0].object,car=o.parent&&o.parent.userData&&o.parent.userData.switches?o.parent:null;
    if(car){
      car.userData.lastUse=performance.now();   // interacting keeps the armed-bank show alive
      if(o.userData.bank){const u=car.userData,b=o.userData.bank,i=u.switches.indexOf(o);
        u.banks[b]=!u.banks[b];o.rotation.x=u.banks[b]?-.45:.5;
        u.switchLeds[i].material.emissiveIntensity=u.banks[b]?1.8:.15;}
      else if((car.userData.burst||0)<3)car.userData.burst=(car.userData.burst||0)+1;}
  }else if(Arcade.targets().length&&ray.intersectObjects(Arcade.targets(),true).length){   // 🎪 midway prop → its minigame / score board
    Arcade.openFrom(ray.intersectObjects(Arcade.targets(),true)[0].object);
  }else if(jukebox.parent&&ray.intersectObject(jukebox,true).length){   // 💿 jukebox → pay points to play a song (js/jukebox.js)
    dispatchEvent(new Event('eol:juke-open'));
  }else if(ray.intersectObjects(TABLE_HIT,true).length){   // tap a lawn table → the contest
    dispatchEvent(new Event('eol:hd-open-table'));
  }else if(ray.intersectObjects(CLICK,true).length){open('menu');goWindow();}});
canvas.addEventListener('pointermove',e=>{m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
  const hit=ray.intersectObjects(CLICK,true).length>0;
  const hitTruck=CAR_HIT.length?ray.intersectObjects(CAR_HIT,true).length>0:false;
  const hitTable=ray.intersectObjects(TABLE_HIT,true).length>0;
  const hitArc=Arcade.targets().length?ray.intersectObjects(Arcade.targets(),true).length>0:false;
  const hitJb=jukebox.parent?ray.intersectObject(jukebox,true).length>0:false;   // 💿 jukebox counts as a tappable prop
  canvas.style.cursor=(hit||hitTruck||hitTable||hitArc||hitJb)?'pointer':'';T.board.material.emissiveIntensity=hit?.8:.55;});

// ---------- 3rd-person walk mode ----------
// When nothing is open (no shop menu, contest panel, look picker, chat typing) the arrow keys
// waltz YOUR avatar around the lot in third person - up/down move, left/right turn, space
// jumps - and the camera trails behind. Any UI opening, Escape, or clicking off hands control
// straight back to the orbit camera at the walker's spot.
const walk={on:false,keys:new Set(),yaw:0,py:0,vy:0,x:0,z:0,hold:0,grp:null};
window.__EOL_WALK=()=>({x:+walk.x.toFixed(2),z:+walk.z.toFixed(2),on:walk.on,yaw:+walk.yaw.toFixed(2)});   // 📱 GPS app: your ground position + heading
window.__EOL_LOOK=()=>({x:+ctl.target.x.toFixed(2),z:+ctl.target.z.toFixed(2)});   // 📱 GPS app: where you're looking when not walking (stable while orbiting)
const walkTyping=()=>{const a=document.activeElement;
  return !!a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);};
const walkUI=()=>(!!document.querySelector('.panel.open'))||
  ['eolHd','eolLook','eolMidway','eolScores','eolAcct','eolJuke'].some(id=>{const el=document.getElementById(id);return el&&!el.hidden;})||
  walkTyping();
const walkChip=document.createElement('div');walkChip.id='eolWalkHint';walkChip.hidden=true;
walkChip.textContent='◀ ▲ ▼ ▶ move · space jump · esc stop';document.body.appendChild(walkChip);
const _wv=new THREE.Vector3(),_wm=new THREE.Matrix4();
function walkPushEdge(ex0,ex1,ez0,ez1){   // box push: walk out to the nearest edge of the rect
  if(walk.x>ex0&&walk.x<ex1&&walk.z>ez0&&walk.z<ez1){
    const dl=walk.x-ex0,dr=ex1-walk.x,df=ez1-walk.z,db=walk.z-ez0;
    if(dl<=dr&&dl<=db)walk.x=ex0;else if(dr<=db)walk.x=ex1;
    else if(walk.z-ez0<ez1-walk.z)walk.z=ez0;else walk.z=ez1;
  }
}
function walkCollide(){
  // circle push-out vs tables / jukebox / lowrider, box push vs truck body + stage deck
  const clear=(ox,oz,r)=>{const dx=walk.x-ox,dz=walk.z-oz,d2=dx*dx+dz*dz;
    if(d2<r*r&&d2>1e-6){const d=Math.sqrt(d2);walk.x=ox+dx/d*r;walk.z=oz+dz/d*r;}};
  for(const t of TABLE_HIT){t.getWorldPosition(_wv);clear(_wv.x,_wv.z,.92);}
  if(jukebox.parent){jukebox.getWorldPosition(_wv);clear(_wv.x,_wv.z,.55);}
  if(lexus.parent){lexus.getWorldPosition(_wv);const ry=lexus.rotation.y;
    clear(_wv.x,_wv.z,1.0);clear(_wv.x+Math.sin(ry)*1.7,_wv.z+Math.cos(ry)*1.7,1.0);}
  for(const b of Arcade.walkBalls())clear(b.x,b.z,b.r);   // claw machine, bean-bag boards, tag flag, score board
  truckRig.updateMatrixWorld();
  _wv.set(walk.x,FLOOR,walk.z).applyMatrix4(_wm.copy(truckRig.matrixWorld).invert());
  if(_wv.x>bx0-.55&&_wv.x<bx0+BL+.55&&Math.abs(_wv.z)<BW/2+.55){   // truck footprint, in rig space
    const dl=_wv.x-(bx0-.55),dr=(bx0+BL+.55)-_wv.x,dz=(BW/2+.55)-Math.abs(_wv.z);
    const back=()=>_wv.applyMatrix4(truckRig.matrixWorld);        // carry it back to world
    if(dz<=dl&&dz<=dr){_wv.z=Math.sign(_wv.z||1)*(BW/2+.55);back();}
    else{_wv.x=_wv.x<bx0+BL/2?bx0-.55:bx0+BL+.55;back();}
  }
  walkPushEdge(-9,25.2,-54.2,-39.9);            // stage deck box (world: 32x13 at 8,0,-47)
  walk.x=Math.max(-62,Math.min(62,walk.x));     // stay inside the painted lot
  walk.z=Math.max(-60,Math.min(34,walk.z));
}
function walkStart(){
  let hue=null;try{const p=JSON.parse(localStorage.getItem('eol-visitor-profile')||'null');
    if(p&&Number.isFinite(+p.hue))hue=Math.max(0,Math.min(359,+p.hue|0));}catch(e){}
  const fwd=ctl.target.clone().sub(cam.position);fwd.y=0;
  if(fwd.lengthSq()<1e-4)fwd.set(0,0,-1);fwd.normalize();
  // your avatar steps in on the ground between the camera and where it was looking
  walk.x=cam.position.x+fwd.x*4.4;walk.z=cam.position.z+fwd.z*4.4;
  walk.yaw=Math.atan2(fwd.x,fwd.z);walk.py=0;walk.vy=0;walk.hold=0;
  walk.grp=buildWaitingPerson(0xd9a978,new THREE.Color().setHSL((hue??(Math.abs(Date.now())%360))/360,.55,.48),0x1a1a1a);
  walk.grp.traverse(o=>{o.castShadow=true;});
  // little nameplate: same white-on-dark pill style as the presence avatars
  let name='You';try{name=localStorage.getItem('eol-visitor-name')||'You';}catch(e){}
  const nc=document.createElement('canvas');nc.width=220;nc.height=56;const ng=nc.getContext('2d');
  ng.fillStyle='rgba(10,8,5,.55)';const rr=(x,y,w,h,r)=>{ng.beginPath();ng.moveTo(x+r,y);ng.arcTo(x+w,y,x+w,y+h,r);ng.arcTo(x+w,y+h,x,y+h,r);ng.arcTo(x,y+h,x,y,r);ng.arcTo(x,y,x+w,y,r);ng.fill();};
  rr(2,2,216,52,14);ng.fillStyle='#fff';ng.font='bold 26px Inter, sans-serif';ng.textAlign='center';ng.textBaseline='middle';ng.fillText(name,110,30);
  const npT=new THREE.CanvasTexture(nc);
  const np=new THREE.Sprite(new THREE.SpriteMaterial({map:npT,transparent:true,depthTest:false}));
  np.renderOrder=999;np.scale.set(1.05,.27,1);np.position.y=1.3;walk.grp.add(np);
  walkCollide();
  walk.grp.position.set(walk.x,FLOOR,walk.z);S.add(walk.grp);
  walk.on=true;ctl.enabled=false;walkChip.hidden=false;
}
function walkStop(){
  if(!walk.on)return;
  walk.on=false;walk.keys.clear();
  if(walk.grp){S.remove(walk.grp);walk.grp=null;}
  walkChip.hidden=true;ctl.enabled=true;
  ctl.target.set(walk.x,1.15,walk.z);      // orbit resumes pivoting right where they stood
}
function walkTick(dt,t){
  if(walkUI()){walkStop();return;}
  const k=walk.keys;
  const fwd=(k.has('ArrowUp')?1:0)-(k.has('ArrowDown')?1:0),turn=(k.has('ArrowRight')?1:0)-(k.has('ArrowLeft')?1:0);
  walk.yaw-=turn*2.7*dt;   // screen-right turns the avatar's RIGHT: yaw must decrease here
  const spd=fwd>0?2.2:fwd<0?1.5:0;
  walk.x+=Math.sin(walk.yaw)*spd*dt;walk.z+=Math.cos(walk.yaw)*spd*dt;
  if(k.has(' ')&&walk.py<=0&&walk.vy<=0.05){walk.vy=4.8;walk.py=.001;}   // space = hop
  walk.vy-=dt*13.5;walk.py+=walk.vy*dt;
  if(walk.py<0){walk.py=0;walk.vy=0;}
  walkCollide();
  const moving=spd>0||turn!==0,bob=moving&&walk.py<=0?Math.abs(Math.sin(t*8.5))*.05:0;
  walk.grp.position.set(walk.x,FLOOR+walk.py+bob,walk.z);
  walk.grp.rotation.y=walk.yaw;
  // camera trails behind; mouse-drag offsets fade back to dead-rear while you move
  if(fwd)walk.hold*=Math.exp(-dt*1.1);
  const eye=walk.yaw+Math.PI+walk.hold;
  const dx=Math.sin(eye)*3.4,dz=Math.cos(eye)*3.4;
  cam.position.lerp(_wv.set(walk.x+dx,FLOOR+walk.py+1.78,walk.z+dz),Math.min(1,dt*8));
  const hy=FLOOR+1.05+walk.py;
  cam.lookAt(walk.x,hy,walk.z);ctl.target.set(walk.x,hy,walk.z);
}
addEventListener('keydown',e=>{
  if(walkTyping())return;
  if(e.key==='Escape'&&walk.on){walkStop();return;}
  if(e.key===' '&&walk.on){e.preventDefault();if(!e.repeat)walk.keys.add(' ');return;}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  if(walkUI())return;
  e.preventDefault();
  if(!walk.on)walkStart();
  if(!e.repeat)walk.keys.add(e.key);
});
addEventListener('keyup',e=>{walk.keys.delete(e.key);});
addEventListener('blur',()=>walk.keys.clear());
{   // look-around drag while walking: cheap pointer tracker, orthogonal to the tap guard
  let dragX=0,dragging=false;
  canvas.addEventListener('pointerdown',e=>{if(walk.on){dragging=true;dragX=e.clientX;}});
  addEventListener('pointermove',e=>{if(!(dragging&&walk.on))return;walk.hold-=(e.clientX-dragX)*.006;dragX=e.clientX;});
  addEventListener('pointerup',()=>dragging=false);
}
// ---------- layout mode: drag to move + buttons to turn — the TRUCK cluster (queue + parked
// car ride along) AND every standalone prop (picnic tables, jukebox, claw machine, bean-bag
// boards, tag arena, HIGH SCORES board, Impala). Visit with #layout; normal visitors never
// see the panel or drag behavior, but they DO get whatever arrangement the admin saved.
if(location.hash.includes('layout')){
  const dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const dragPt=new THREE.Vector3(),dragW=new THREE.Vector3(),dragOffset=new THREE.Vector3();
  let dragging=null;   // the object under the pointer (truckRig or one of the movers)
  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;left:12px;bottom:12px;z-index:9999;background:rgba(20,16,40,.92);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:10px;max-width:300px;box-shadow:0 4px 18px rgba(0,0,0,.4)';
  panel.innerHTML='<b>Layout mode</b><br>Pick an object below or just <b>click it in the lot</b>, then drag to move. Dragging the truck carries its whole cluster (tables, jukebox, claw, Impala ride along).<br>'+
    '<select id="layoutSel" style="margin-top:6px;max-width:100%;padding:4px 6px;border-radius:6px"></select><br>'+
    '<span id="layoutPos" style="display:block;margin-top:4px;opacity:.85"></span>'+
    '<button id="layoutRoof" style="display:none;margin-top:6px;padding:4px 8px;border-radius:6px;border:0;background:#444;color:#fff;cursor:pointer">⇅ Roof / Ground</button><br>'+
    '<button id="layoutRotL" style="margin-top:6px;padding:4px 8px;border-radius:6px;border:0;background:#444;color:#fff;cursor:pointer">⟲ 15°</button> '+
    '<button id="layoutRotR" style="padding:4px 8px;border-radius:6px;border:0;background:#444;color:#fff;cursor:pointer">15° ⟳</button> '+
    '<button id="layoutReset" style="padding:4px 8px;border-radius:6px;border:0;background:#444;color:#fff;cursor:pointer">Reset this</button><br>'+
    '<button id="layoutSave" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:0;background:#e83a73;color:#fff;cursor:pointer">Save as default (everyone)</button> '+
    '<button id="layoutResetAll" style="padding:4px 8px;border-radius:6px;border:0;background:#444;color:#fff;cursor:pointer">Reset all</button>';
  document.body.appendChild(panel);
  const selEl=panel.querySelector('#layoutSel'),posEl=panel.querySelector('#layoutPos'),roofEl=panel.querySelector('#layoutRoof');
  const truckMover={id:'truck',label:'Truck (whole cluster)',obj:truckRig,base:{x:0,z:0,y:0,r:0}};
  const RAY_ORDER=[...LAYOUT_MOVERS,truckMover];        // props first: a click on a prop beats the truck's group hit
  const SEL_ORDER=[truckMover,...LAYOUT_MOVERS];        // dropdown reads better with the truck up top
  selEl.innerHTML=SEL_ORDER.map(m=>`<option value="${m.id}">${m.label}</option>`).join('');
  let selected=truckMover;
  const persist=()=>{localStorage.setItem('eol_truckOffset',JSON.stringify({x:truckRig.position.x,z:truckRig.position.z,r:truckRig.rotation.y*180/Math.PI}));
    localStorage.setItem('eol_layoutProps',JSON.stringify(propLayoutAll()));};
  const updatePos=()=>{const o=selected.obj,deg=((o.rotation.y*180/Math.PI)%360+360)%360;
    posEl.textContent=selected.label+` — x=${o.position.x.toFixed(2)}, z=${o.position.z.toFixed(2)}, rot=${deg.toFixed(0)}°`+
      (selected.id==='scores'?', y='+o.position.y.toFixed(2):'')+' — saved in this browser only until you hit Save';
    roofEl.style.display=selected.id==='scores'?'':'none';
    roofEl.textContent='⇅ '+(o.position.y>1?'Put on the ground':'Put on the roof');};
  const select=id=>{const m=RAY_ORDER.find(x=>x.id===id);if(m){selected=m;selEl.value=id;updatePos();}};
  selEl.onchange=()=>select(selEl.value);
  updatePos();
  panel.querySelector('#layoutRotL').onclick=()=>{selected.obj.rotation.y-=Math.PI/12;persist();updatePos();};
  panel.querySelector('#layoutRotR').onclick=()=>{selected.obj.rotation.y+=Math.PI/12;persist();updatePos();};
  roofEl.onclick=()=>{if(selected.id!=='scores')return;const o=selected.obj;o.position.y=o.position.y>1?0:2.0;persist();updatePos();};
  panel.querySelector('#layoutReset').onclick=()=>{  // this object back to its compiled-in spot
    if(selected.id==='truck'){selected.obj.position.set(0,0,0);selected.obj.rotation.y=0;localStorage.removeItem('eol_truckOffset');}
    else{const b=selected.base;selected.obj.position.set(b.x,b.y,b.z);selected.obj.rotation.y=b.r*Math.PI/180;}
    persist();updatePos();};
  panel.querySelector('#layoutResetAll').onclick=()=>{  // the whole lot back to how it shipped
    truckRig.position.set(0,0,0);truckRig.rotation.y=0;
    for(const m of LAYOUT_MOVERS){const b=m.base;m.obj.position.set(b.x,b.y,b.z);m.obj.rotation.y=b.r*Math.PI/180;}
    localStorage.removeItem('eol_truckOffset');localStorage.removeItem('eol_layoutProps');
    select('truck');updatePos();};
  panel.querySelector('#layoutSave').onclick=async()=>{
    const pw=prompt('Admin password, to save this layout (truck + every prop) for every visitor:');
    if(!pw)return;
    const btn=panel.querySelector('#layoutSave');
    try{
      const lr=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
      const lj=await lr.json();if(!lr.ok)throw new Error(lj.error||'login failed');
      const sr=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+lj.token},
        body:JSON.stringify({truckOffsetX:truckRig.position.x,truckOffsetZ:truckRig.position.z,truckRotation:truckRig.rotation.y*180/Math.PI,
          layoutProps:propLayoutAll()})});
      const sj=await sr.json();if(!sr.ok)throw new Error(sj.error||'save failed');
      btn.textContent='Saved ✓';
    }catch(e){alert('Could not save: '+e.message);}
  };
  canvas.addEventListener('pointerdown',e=>{
    m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
    let best=null,bd=1e9;
    for(const m of RAY_ORDER){const h=ray.intersectObject(m.obj,true)[0];if(h&&h.distance<bd){bd=h.distance;best=m;}}
    if(!best)return;
    select(best.id);
    ray.ray.intersectPlane(dragPlane,dragPt);
    best.obj.getWorldPosition(dragW);
    dragOffset.copy(dragW).sub(dragPt);
    dragging=best.obj;ctl.enabled=false;canvas.style.cursor='grabbing';
  });
  addEventListener('pointermove',e=>{
    if(!dragging)return;
    m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
    if(ray.ray.intersectPlane(dragPlane,dragPt)){
      const tw=dragPt.clone().add(dragOffset);   // target world position on the ground plane
      if(dragging===truckRig)truckRig.position.set(tw.x,0,tw.z);
      else{const lp=dragging.parent.worldToLocal(tw.clone());   // props live in truck-rig space
        dragging.position.set(lp.x,dragging.position.y,lp.z);}  // y untouched: ground props stay grounded, the roof board stays on the roof
      updatePos();
    }
  });
  addEventListener('pointerup',()=>{if(!dragging)return;dragging=null;ctl.enabled=true;canvas.style.cursor='';persist();});
}


let fly=null;
function flyTo(p,t,ms=1400){fly={p0:cam.position.clone(),t0:ctl.target.clone(),p,t,s:performance.now(),ms};}
hooks.goWindow=goWindow;
function goWindow(){   // frame the service window + menu board, wherever the truck's been moved/turned to
  const axisY=new THREE.Vector3(0,1,0),rotY=truckRig.rotation.y;
  const toWorld=(lx,ly,lz)=>new THREE.Vector3(lx,ly,lz).applyAxisAngle(axisY,rotY).add(truckRig.position);
  if(portrait()) flyTo(toWorld(-1.55,1.9,-fitDist(2.4,4.6)),toWorld(-1.55,1.9,0));
  else flyTo(toWorld(-2.1,1.8,-4.6),toWorld(-2.1,1.9,0));}
let tour=false;document.getElementById('tour').onclick=()=>{tour=!tour;ctl.autoRotate=tour;ctl.autoRotateSpeed=1.2;document.getElementById('tour').textContent=tour?'Stop Tour':'Walk Around';};
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);});
const clock=new THREE.Clock();
R.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),0.1),t=clock.elapsedTime;
  if(fly){const k=Math.min(1,(performance.now()-fly.s)/fly.ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;cam.position.lerpVectors(fly.p0,fly.p,e);ctl.target.lerpVectors(fly.t0,fly.t,e);if(k>=1)fly=null;}
  {const w=T.worker;w.children[1].rotation.y=Math.sin(t*.7)*.25;w.position.y=WY0-.12+Math.sin(t*1.6)*.006;}
  for(const e of eaters){e.userData.head.rotation.x=Math.sin(t*1.2+e.userData.ph)*.07;e.position.y=e.userData.by+Math.sin(t*.9+e.userData.ph)*.004;}
  for(const l of ALL_LASERS){const sweep=Math.sin(t*l.speed+l.phase)*l.amp;if(l.axis==='x')l.mesh.rotation.x=sweep;else l.mesh.rotation.z=sweep;}
  for(const perf of ALL_PERFORMERS){
    perf.position.y=perf.userData.baseY+Math.abs(Math.sin(t*2.4))*.18;
    perf.rotation.y=Math.sin(t*.6)*.5;
    perf.children[5].rotation.x=Math.sin(t*3+.4)*1.1-.3;
    perf.children[6].rotation.x=Math.sin(t*3+Math.PI+.4)*1.1-.3;
  }
  for(const parts of ALL_SMOKE) tickSmoke(parts,dt);
  for(const p of ALL_PUFFS) tickPuff(p,dt);
  if(walk.on)walkTick(dt,t);
  for(const car of ALL_HYDRAULICS){   // lowrider hydraulics: armed banks pulse each on their own
    const u=car.userData,seed=u.hopSeed||0,base=u.baseY||0;   // clock; tapping the car/switches
    let hop=0,tiltX=0,tiltZ=0;                                 // arms banks or fires hop bursts
    if(u.burst>0){u.burstT=(u.burstT||0)+dt*3.1;
      if(u.burstT>=1){u.burstT=0;u.burst=(u.burst||0)-1;}
      hop=Math.sin(Math.min(1,u.burstT)*Math.PI)*.42;}
    if(u.banks){
      // armed banks idle out: pulses stop ~90s after the last tap/swipe, cue resumes on contact
      const fresh=(performance.now()-(u.lastUse||0))<90000;
      const b=u.banks,pulse=i=>{const p=(t*1.15+seed+i*.62)%1.6;return Math.pow(Math.max(0,Math.sin(Math.min(1,p/1.6)*Math.PI)),2)*.28;};
      const vF=u.burst>0||!fresh?0:(b.front?pulse(0):0),vB=u.burst>0||!fresh?0:(b.back?pulse(1):0),
            vL=u.burst>0||!fresh?0:(b.left?pulse(2):0),vR=u.burst>0||!fresh?0:(b.right?pulse(3):0);
      hop=Math.max(hop,vF,vB,vL,vR);
      tiltX=(vB-vF)*.5;tiltZ=(vL-vR)*.45;}
    car.position.y=base+hop;car.rotation.x=tiltX;car.rotation.z=tiltZ;
  }
  Avatars.tick(t,dt);
  ctl.update();R.render(S,cam);});

// TEMP dev-only camera override for QA framing (?eolcam=x,y,z + ?eollook=x,y,z); fires only
// when both params are present, so production URLs are untouched. Strip before commit.
// QA camera/debug handle removed: scene dev pulls are done, the shipped page exposes nothing
// extra and ignores ?eolcam/?eollook debug params.
