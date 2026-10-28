// truck.js — builds the 1990 GMC step-van (textures painted from the real photos), kitchen,
// worker, props and the clickable 3D menu board. Pure geometry; no DOM, no camera.
import * as THREE from 'three';
import * as People from './people.js?v=11';   // the cook uses the same realistic bodies as the crowd

// ---------- dimensions (m) : 1990 GMC step van ----------
export const BL=5.4, BW=2.3, BH=2.25, FLOOR=0.75;           // box
export const CL=1.55, CH=2.05;                               // cab
export const bx0=-BL/2+0.6;                                  // box center x  (front of truck = -x)

// service window (on -z side — the real truck serves from the far side; the big cloud mural
// with the wordmark faces the other way, per the reference photos)
export const WX0=-3.6, WX1=-0.6, WY0=1.75, WY1=2.55;        // world coords

// galaxy wrap painter
function galaxy(g,w,h,seed=1){
  const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'#2a3fae');gr.addColorStop(.45,'#3a2a8c');gr.addColorStop(1,'#1a1240');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
  let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<40;i++){const x=rnd()*w,y=rnd()*h,r=40+rnd()*160;const n=g.createRadialGradient(x,y,0,x,y,r);n.addColorStop(0,`rgba(${120+rnd()*100|0},${80+rnd()*80|0},255,.18)`);n.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=n;g.fillRect(x-r,y-r,2*r,2*r);}
  for(let i=0;i<w*h/900;i++){const a=rnd();g.fillStyle=`rgba(${200+rnd()*55|0},${180+rnd()*75|0},255,${.3+a*.7})`;g.beginPath();g.arc(rnd()*w,rnd()*h,a*a*3.2+.4,0,7);g.fill();}
}
function paintSun(g,x,y,r){g.save();g.translate(x,y);g.fillStyle='#ffd23f';g.strokeStyle='#d6336c';g.lineWidth=r*.08;
  for(let i=0;i<12;i++){g.rotate(Math.PI/6);g.beginPath();g.moveTo(r*.7,-r*.13);g.lineTo(r*1.45,0);g.lineTo(r*.7,r*.13);g.fill();g.stroke();}
  g.beginPath();g.arc(0,0,r*.75,0,7);g.fill();g.stroke();g.beginPath();g.arc(0,0,r*.45,.3,5.6);g.stroke();g.restore();}
// pastes an image MIRRORED — the driver-side face's UVs run flipped (repeat.x=-1), so every
// photo paste there is pre-flipped so the double mirror cancels and it reads correctly.
function mid(g,c,x,y,w,h){g.save();g.translate(x+w,y);g.scale(-1,1);g.drawImage(c,0,0,w,h);g.restore();}
// cloud puffs rising above a boundary — the wrap's cloud-edge transition between galaxy and tiles
function paintClouds(g,x0,y0,x1,r){
  g.fillStyle='#eef1f4';
  for(let x=x0;x<x1;x+=r*2.2){const rr=r*(.7+((x/r|0)%3)*.18);
    g.beginPath();g.arc(x,y0,rr,Math.PI,0);g.arc(x+r,y0+2,rr*.55,Math.PI,0);g.fill();}}
// pink splatter petals + flying dots (the daisy-splatter motif from the door photos)
function paintSplat(g,x,y,r,flip){
  g.save();g.translate(x,y);if(flip)g.scale(-1,1);g.fillStyle='#e8355f';
  for(const [a,l,w] of [[-1.35,r*1.5,r*.9],[-1.0,r*1.9,r*.8],[-.55,r*2.1,r*.75],[.05,r*1.7,r*.6],[.5,r*1.3,r*.5],[.95,r*1.05,r*.42]]){
    g.save();g.rotate(a);g.beginPath();g.ellipse(0,-l/2-r*.1,w/2,l/2,0,0,7);g.fill();g.restore();}
  g.beginPath();g.arc(-r*.6,r*.6,r*.12,0,7);g.arc(-r*.22,r*.9,r*.09,0,7);g.arc(r*.45,r*.8,r*.07,0,7);g.arc(-r*.95,r*.3,r*.08,0,7);g.fill();g.restore();}
// six-petal daisy with a cream centre
function paintDaisy(g,x,y,r){
  g.save();g.translate(x,y);g.fillStyle='#e8425f';
  for(let i=0;i<6;i++){g.rotate(Math.PI/3);g.beginPath();g.ellipse(r*.8,0,r*.52,r*.3,0,0,7);g.fill();}
  g.fillStyle='#f6e7c8';g.beginPath();g.arc(0,0,r*.42,0,7);g.fill();g.restore();}
// the cream moon with olive craters (rear top-right in the photos)
function paintMoon(g,x,y,r){
  g.save();g.translate(x,y);g.fillStyle='#f1f2e2';g.beginPath();g.arc(0,0,r,0,7);g.fill();
  g.fillStyle='#99a287';
  for(const [cx,cy,cr] of [[.38,-.32,.15],[-.08,-.5,.11],[-.4,.02,.13],[.12,.28,.16],[.44,.4,.11],[.02,-.02,.085],[.27,.08,.07],[-.2,.45,.1],[-.5,-.35,.09]]){
    g.beginPath();g.ellipse(cx*r,cy*r,cr*r,cr*r,.4,0,7);g.fill();
    g.fillStyle='#787a68';g.beginPath();g.arc((cx+.3*cr)*r,(cy-.2*cr)*r,cr*r*.3,0,7);g.fill();
    g.fillStyle='#99a287';}
  g.restore();}

export async function buildTruck(S,{img,done,MENU,money}){
  const truck=new THREE.Group();S.add(truck);
  const [logo,slogan,tiles,frontArt,sideArt,rooster,louvre,interior,interiorBack]=await Promise.all(['logo.jpg','slogan.jpg','tiles.jpg','frontart.jpg','sideart.jpg','rooster.jpg','louvre.jpg','interior.jpg','interior_back.jpg'].map(img));
  const PX=400; // px per meter
  // ---- service side: the -z face. On this face the canvas' left edge is the body's rear
  // (+x) corner, so positions go through toXm (world-x mirrored) and pastes read correctly
  // with no texture-side flipping. Big serving window with a chrome ring, talavera awning
  // panels folded above the opening, logo + magenta sun on the top band, big spl. springs. ----
  const sc=document.createElement('canvas');sc.width=BL*PX;sc.height=BH*PX;const g=sc.getContext('2d');
  galaxy(g,sc.width,sc.height,7);
  const xMin=bx0-BL/2, xMax=bx0+BL/2;
  const toXm=x=>(xMax-x)*PX, toY=y=>(FLOOR+BH-y)*PX;
  // talavera awning cover panels folded down over the glass, chrome ring framing the opening
  const tp=g.createPattern(tiles,'repeat');g.save();g.fillStyle=tp;
  g.fillRect(toXm(WX1)-44,toY(WY1)-10,((toXm(WX0)-toXm(WX1))+88),toY(WY0)-toY(WY1)+66);g.restore();
  paintClouds(g,toXm(WX1)-44,toY(WY1)-16,(toXm(WX0)-toXm(WX1))+88,24);
  g.strokeStyle='#c9ccd2';g.lineWidth=14;
  g.strokeRect(toXm(WX1)-16,toY(WY1)-12,(toXm(WX0)-toXm(WX1))+32,toY(WY0)-toY(WY1)+24);
  // logo script + the big magenta sun ride the band above the opening (photo 6163)
  {const wcx=(toXm(WX1)+toXm(WX0))/2;   // window centre on the mirrored canvas
   g.drawImage(logo,wcx-1.15*PX,toY(BH+FLOOR-0.06),2.3*PX,0.68*PX);}
  paintSun(g,toXm(WX0-.15),toY(BH+FLOOR-0.34),0.34*PX);
  // skirt script the length of the wheelbase (photo: low on the skirt, ahead of the rear wheel)
  g.drawImage(slogan,toXm(xMax-1.55),toY(1.52),2.25*PX,2.25*PX*slogan.height/slogan.width);
  // pink splatter + daisies on the rear quarter (photo motif) + two X-splats near the cab
  paintSplat(g,toXm(bx0+BL/2-3.1)+150,toY(1.7),92,0);
  paintDaisy(g,toXm(-.4),toY(1.32),40);paintDaisy(g,toXm(-2.2),toY(1.16),28);paintDaisy(g,toXm(-1.1),toY(1.86),24);
  // stainless shoulder + sill trim lines
  g.fillStyle='#c9ccd2';g.fillRect(0,toY(1.62),sc.width,18);g.fillRect(0,toY(FLOOR+0.06),sc.width,14);
  g.clearRect(toXm(WX1),toY(WY1),toXm(WX0)-toXm(WX1),toY(WY0)-toY(WY1)); // window opening
  const sideSrvT=new THREE.CanvasTexture(sc);sideSrvT.colorSpace=THREE.SRGBColorSpace;sideSrvT.anisotropy=8;
  // ---- mural side: the +z face (canvas-left = the cab end). Talavera tiles wrap the cab and
  // the body's forward section to a cloud cut; a two-pane window rides the tile zone; then
  // the night-sky mural: photo-crop gothic wordmark + "The Other Side" script, the rainbow
  // rooster marching on skeleton feet over the rear corner, splatter fans + webs, family-
  // owned script near the bottom rear, AC louvres at the top rear edge (photo series
  // 6846-6849 / 6855-6857). Plain toX mapping here: canvas-left = front (cab end). ----
  const dc=document.createElement('canvas');dc.width=sc.width;dc.height=sc.height;const d=dc.getContext('2d');galaxy(d,dc.width,dc.height,3);
  const toX=x=>(x-xMin)*PX;
  // tile mass from the cab seam out to a cloud cut (~40% of the body length)
  d.fillStyle=d.createPattern(tiles,'repeat');d.fillRect(0,dc.height*.155,dc.width*.42,dc.height*.68);
  paintClouds(d,dc.width*.40,dc.height*1.005,dc.width*.5,26);        // puffs drifting off the cut line
  paintClouds(d,0,dc.height*1.02,dc.width*1.05,22);                 // ...and foaming along the sill
  paintClouds(d,dc.width*.42-30,dc.height*.79,dc.width*.44,20);
  // two-pane saloon window in the tile zone (chrome frame, dark glass, center mullion)
  {const wx=dc.width*.085,wy=dc.height*.315,ww=dc.width*.235,wh=dc.height*.27;
   d.fillStyle='#131a24';d.fillRect(wx,wy,ww,wh);
   d.strokeStyle='rgba(230,233,238,.9)';d.lineWidth=12;d.strokeRect(wx-6,wy-6,ww+12,wh+12);
   d.strokeStyle='rgba(201,204,210,.8)';d.lineWidth=7;
   d.beginPath();d.moveTo(wx+ww*.485,wy-6);d.lineTo(wx+ww*.485,wy+wh+6);d.stroke();}
  // wordmark crop (photo) + hand-lettered script beneath, then the rooster over the rear corner
  d.drawImage(sideArt,dc.width*.40,dc.height*.14,dc.width*.46,dc.width*.46*sideArt.height/sideArt.width);
  d.fillStyle='rgba(246,242,234,.96)';d.font='700 44px "Great Vibes"';d.textAlign='center';
  d.fillText('"The Other Side"',dc.width*.615,dc.height*.47);
  d.drawImage(rooster,dc.width*.875,dc.height*.30,dc.height*.55*rooster.width/rooster.height,dc.height*.55);
  // fuel door mid-lower body + splatter fan cluster to its left
  d.fillStyle='rgba(205,210,216,.92)';d.fillRect(dc.width*.345,dc.height*.628,dc.width*.115,dc.height*.125);
  d.strokeStyle='#8d939b';d.lineWidth=7;d.strokeRect(dc.width*.345,dc.height*.628,dc.width*.115,dc.height*.125);
  d.fillStyle='#6b7078';d.beginPath();d.arc(dc.width*.40,dc.height*.645,8,0,7);d.fill();
  paintSplat(d,dc.width*.27,dc.height*.70,85,1);
  paintDaisy(d,dc.width*.46,dc.height*.80,40);paintDaisy(d,dc.width*.545,dc.height*.72,30);paintDaisy(d,dc.width*.42,dc.height*.87,26);
  // faint spider web glint, family-owned script near the bottom rear, AC louvres at the rear top
  d.strokeStyle='rgba(230,235,240,.5)';d.lineWidth=4;
  {const cxw=dc.width*.72,cyw=dc.height*.66;
   for(let i=0;i<5;i++){d.beginPath();d.arc(cxw,cyw,10+i*13,.4,2.4);d.stroke();}
   for(let i=0;i<6;i++){d.beginPath();d.moveTo(cxw,cyw);d.lineTo(cxw+Math.cos(.4+i*.4)*55,cyw+Math.sin(.4+i*.4)*55);d.stroke();}}
  d.drawImage(slogan,dc.width*.60,dc.height*.80,dc.width*.34,dc.width*.34*slogan.height/slogan.width);
  for(let i=0;i<6;i++){d.fillStyle=i%2?'#b9bec6':'#8d939b';d.fillRect(dc.width-46,dc.height*.10+i*.055*dc.height,26,dc.height*.03);}
  const muralT=new THREE.CanvasTexture(dc);muralT.colorSpace=THREE.SRGBColorSpace;muralT.anisotropy=8;
  // ---- rear: wordmark + painted moon top band, the closed engine hatch (photo crop), the
  // diamond-plate message band and the AZ plate. The doors-open photo isn't usable as a whole-
  // face texture, so the face is composed here to match the closed truck. ----
  const rc=document.createElement('canvas');rc.width=BW*PX;rc.height=BH*PX;const r=rc.getContext('2d');galaxy(r,rc.width,rc.height,11);
  r.drawImage(logo,rc.width*.13,rc.height*.035,rc.width*.5,rc.width*.5*logo.height/logo.width);
  paintMoon(r,rc.width*.77,rc.height*.12,rc.height*.085);
  // engine hatch corner: painted louvre slats on a chrome sill — the photo crop here read as a
  // big dark "TV" (owner nixed it), so proper vent slats instead
  {const lw=rc.width*.52,lh=rc.height*.15,lx=rc.width*.24,ly=rc.height*.2;
    r.fillStyle='#b9bec6';r.fillRect(lx-10,ly-10,lw+20,lh+20);
    r.fillStyle='#8d939b';
    for(let i=0;i<6;i++)r.fillRect(lx+14,ly+10+i*(lh*.155),lw-28,lh*.10);
    r.strokeStyle='#d7dade';r.lineWidth=10;r.strokeRect(lx-10,ly-10,lw+20,lh+20);}
  // diamond-plate band with the real rear message
  {const bx=rc.width*.085,by=rc.height*.62,bw=rc.width*.83,bh=rc.height*.15;
    r.fillStyle='#c9cdd4';r.fillRect(bx,by,bw,bh);
    r.strokeStyle='rgba(110,116,124,.45)';r.lineWidth=3;
    for(let x=-bh;x<bw;x+=26){r.beginPath();r.moveTo(bx+x,by+bh);r.lineTo(bx+x+bh,by);r.moveTo(bx+x,by);r.lineTo(bx+x+bh,by+bh);r.stroke();}
    r.strokeStyle='#e3e5e8';r.lineWidth=8;r.strokeRect(bx-4,by-4,bw+8,bh+8);
    r.fillStyle='#b5121b';r.textAlign='center';r.font='800 46px Inter';
    r.fillText('THIS VEHICLE MAKES',rc.width*.5,by+bh*.42);r.fillText("SLOW TURNS, SO DON'T PUSH",rc.width*.5,by+bh*.82);}
  // stacked script between the tail lights — yellow w/ piped pink outline (photo rear band)
  {r.textAlign='center';r.font='700 56px "Great Vibes"';r.strokeStyle='#e83a73';r.lineWidth=7;
   r.strokeText('see you on',rc.width*.5,rc.height*.47);r.strokeText('the other side',rc.width*.5,rc.height*.555);
   r.fillStyle='#ffdf3a';
   r.fillText('see you on',rc.width*.5,rc.height*.47);r.fillText('the other side',rc.width*.5,rc.height*.555);}
  // no real plate info on the rear anymore, per owner
  const rearT=new THREE.CanvasTexture(rc);rearT.colorSpace=THREE.SRGBColorSpace;

  const paint=new THREE.MeshPhysicalMaterial({color:0x2b2470,roughness:.28,metalness:.12,clearcoat:.85,clearcoatRoughness:.08,envMapIntensity:1.2});
  const mat=(m)=>new THREE.MeshPhysicalMaterial({map:m,roughness:.32,metalness:.08,clearcoat:.7,clearcoatRoughness:.12,envMapIntensity:1.1});
  const roofM=new THREE.MeshStandardMaterial({color:0xd7d9dc,metalness:.6,roughness:.4});
  const muralM=mat(muralT);
  const sideM=mat(sideSrvT);sideM.transparent=false;sideM.alphaTest=.5;sideM.side=THREE.DoubleSide;
  // face order [px(rear),nx(front),py(roof),ny,pz(+z mural side),nz(-z serving side)]
  const body=new THREE.Mesh(new THREE.BoxGeometry(BL,BH,BW),[mat(rearT),roofM.clone(),roofM,roofM,muralM,sideM]);
  body.material[1]=paint;body.position.set(bx0,FLOOR+BH/2,0);body.castShadow=body.receiveShadow=true;
  // hollow interior: inner walls stainless
  const ss=new THREE.MeshStandardMaterial({color:0xcfd3d8,metalness:.85,roughness:.28});
  // diamond-plate stainless texture for interior walls
  const dpC=document.createElement('canvas');dpC.width=dpC.height=256;{const q=dpC.getContext('2d');
    const gr=q.createLinearGradient(0,0,256,256);gr.addColorStop(0,'#d9dde2');gr.addColorStop(.5,'#b9bfc6');gr.addColorStop(1,'#dfe3e8');q.fillStyle=gr;q.fillRect(0,0,256,256);
    q.strokeStyle='rgba(255,255,255,.55)';q.lineWidth=3;for(let i=-256;i<512;i+=32){q.beginPath();q.moveTo(i,0);q.lineTo(i+256,256);q.stroke();q.beginPath();q.moveTo(i+256,0);q.lineTo(i,256);q.stroke();}
    q.strokeStyle='rgba(60,66,74,.25)';q.lineWidth=1;for(let i=-256;i<512;i+=32){q.beginPath();q.moveTo(i+2,0);q.lineTo(i+258,256);q.stroke();}}
  const dpT=new THREE.CanvasTexture(dpC);dpT.wrapS=dpT.wrapT=THREE.RepeatWrapping;dpT.repeat.set(8,4);dpT.colorSpace=THREE.SRGBColorSpace;
  const wallM=new THREE.MeshStandardMaterial({map:dpT,metalness:.55,roughness:.35,side:THREE.BackSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const floorM=new THREE.MeshStandardMaterial({color:0x3a3d42,metalness:.4,roughness:.7,side:THREE.BackSide});
  const ceilM=new THREE.MeshStandardMaterial({color:0xf2f2f0,roughness:.6,side:THREE.BackSide});
  // inner shell (walls are BackSide so the window-side wall is invisible from outside)
  const inner=new THREE.Mesh(new THREE.BoxGeometry(BL-.1,BH-.1,BW-.1),[wallM,wallM,ceilM,floorM,wallM,wallM]);
  inner.position.copy(body.position);truck.add(inner);
  truck.add(body);
  // ---- real 3D kitchen line along the back wall ----
  const IZ=-BW/2+.05;                      // inside face of back wall
  const ssB=new THREE.MeshStandardMaterial({color:0xd4d8dd,metalness:.9,roughness:.22});
  const ssDark=new THREE.MeshStandardMaterial({color:0x8d939b,metalness:.9,roughness:.3});
  const add=(geo,m,x,y,z)=>{const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;truck.add(o);return o;};
  const lineX0=bx0-BL/2+.15, lineX1=bx0+BL/2-.15, lineW=lineX1-lineX0, lineCx=(lineX0+lineX1)/2;
  // base cabinets + countertop
  const CT=FLOOR+.92, CD=.62;
  add(new THREE.BoxGeometry(lineW,CT-FLOOR-.05,CD),ssDark,lineCx,FLOOR+(CT-FLOOR-.05)/2,IZ+CD/2);
  add(new THREE.BoxGeometry(lineW,.04,CD+.03),ssB,lineCx,CT,IZ+CD/2+.015);
  for(let x=lineX0+.35;x<lineX1;x+=.62){add(new THREE.BoxGeometry(.56,.6,.01),ssB,x,FLOOR+.45,IZ+CD+.006);
    add(new THREE.BoxGeometry(.12,.02,.02),ssDark,x,FLOOR+.68,IZ+CD+.02);}
  // backsplash
  add(new THREE.BoxGeometry(lineW,.35,.02),ssB,lineCx,CT+.18,IZ+.015);
  // 2-bowl sink (like the photo) with gooseneck faucet
  const sinkX=lineX0+.75;
  for(const dx of [-.22,.22]){const bowl=add(new THREE.BoxGeometry(.38,.02,.36),new THREE.MeshStandardMaterial({color:0x5b6168,metalness:.9,roughness:.15}),sinkX+dx,CT+.012,IZ+CD/2+.04);}
  add(new THREE.CylinderGeometry(.015,.015,.28,12),ssB,sinkX,CT+.16,IZ+.08);
  const spout=add(new THREE.TorusGeometry(.1,.012,8,16,Math.PI),ssB,sinkX,CT+.3,IZ+.18);spout.rotation.y=Math.PI/2;
  // flat-top griddle + hood
  const gX=lineCx+.7;
  add(new THREE.BoxGeometry(.92,.12,.55),ssDark,gX,CT+.08,IZ+.32);
  add(new THREE.BoxGeometry(.9,.015,.5),new THREE.MeshStandardMaterial({color:0x1c1c1e,metalness:.7,roughness:.45}),gX,CT+.145,IZ+.32);
  for(let i=0;i<3;i++)add(new THREE.CylinderGeometry(.025,.025,.03,16),new THREE.MeshStandardMaterial({color:0x111}),gX-.3+i*.3,CT+.06,IZ+.6).rotation.x=Math.PI/2;
  const hoodG=new THREE.BoxGeometry(1.25,.4,.75);const hoodI=add(hoodG,ssB,gX,FLOOR+BH-.32,IZ+.37);
  add(new THREE.BoxGeometry(1.15,.03,.6),new THREE.MeshStandardMaterial({color:0x6d737a,metalness:.8,roughness:.4}),gX,FLOOR+BH-.53,IZ+.33);
  // upper stainless shelving (3 tiers w/ lips) left of hood, as in photo
  const shX0=lineX0+.05, shX1=gX-.7, shW=shX1-shX0, shCx=(shX0+shX1)/2;
  for(let i=0;i<3;i++){const y=CT+.55+i*.36;add(new THREE.BoxGeometry(shW,.025,.32),ssB,shCx,y,IZ+.17);add(new THREE.BoxGeometry(shW,.06,.015),ssB,shCx,y+.03,IZ+.33);}
  for(const x of [shX0,shX1])add(new THREE.BoxGeometry(.03,1.1,.32),ssB,x,CT+.88,IZ+.17);
  // a few items on shelves: hotel pans, squeeze bottles, containers
  const pan=new THREE.BoxGeometry(.3,.1,.25),panM=new THREE.MeshStandardMaterial({color:0xe5e8eb,metalness:.8,roughness:.25});
  for(let i=0;i<4;i++)add(pan,panM,shX0+.3+i*.38,CT+.61,IZ+.17);
  const bottle=new THREE.CylinderGeometry(.03,.03,.2,12);const bCols=[0xd9302c,0xf2c14e,0x3aa655,0xffffff];
  for(let i=0;i<6;i++)add(bottle,new THREE.MeshStandardMaterial({color:bCols[i%4],roughness:.5}),shX0+.2+i*.12,CT+1.07,IZ+.17);
  const tub=new THREE.CylinderGeometry(.09,.08,.14,16),tubM=new THREE.MeshPhysicalMaterial({color:0xffffff,transmission:.5,roughness:.3,transparent:true,opacity:.85});
  for(let i=0;i<4;i++)add(tub,tubM,shX0+.25+i*.3,CT+1.36,IZ+.17);
  // right end: upright refrigerator
  add(new THREE.BoxGeometry(.7,BH-.15,CD),ssB,lineX1-.35,FLOOR+(BH-.15)/2,IZ+CD/2);
  add(new THREE.BoxGeometry(.03,.5,.03),ssDark,lineX1-.62,FLOOR+1.2,IZ+CD+.02);
  // interior lighting centered on the window
  const il=new THREE.PointLight(0xfff4e0,5,5,1.6);il.position.set((WX0+WX1)/2,FLOOR+BH-.25,.1);truck.add(il);
  const il2=new THREE.PointLight(0xfff4e0,3,4,1.6);il2.position.set(gX,FLOOR+BH-.6,IZ+.4);truck.add(il2);
  // stainless shelves visible through window (photo strip)
  const shelfT=new THREE.CanvasTexture(interior);shelfT.colorSpace=THREE.SRGBColorSpace;
  const shelf=new THREE.Mesh(new THREE.PlaneGeometry(WX1-WX0,0.8),new THREE.MeshStandardMaterial({map:shelfT,metalness:.4,roughness:.4,transparent:true,opacity:.0}));
  // counter (stainless ledge) outside window — serving side is -z now
  const counter=new THREE.Mesh(new THREE.BoxGeometry(WX1-WX0+.3,.05,.32),ss);counter.position.set((WX0+WX1)/2,WY0-.02,-BW/2-.14);counter.castShadow=true;truck.add(counter);
  // window trim
  for(const [w,h,x,y] of [[WX1-WX0+.1,.06,(WX0+WX1)/2,WY1+.03],[.06,WY1-WY0,WX0-.03,(WY0+WY1)/2],[.06,WY1-WY0,WX1+.03,(WY0+WY1)/2]]){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.06),ss);m.position.set(x,y,-BW/2-.02);truck.add(m);}
  // plexiglass sneeze guard (the one on order)
  const plex=new THREE.Mesh(new THREE.PlaneGeometry(WX1-WX0-.1,.42),new THREE.MeshPhysicalMaterial({transmission:1,roughness:.04,thickness:.01,transparent:true,opacity:.35}));
  plex.position.set((WX0+WX1)/2,WY1-.22,-BW/2+.02);truck.add(plex);
  // awning door hinged up — aluminum lid with warm strip lights (photo: flat silver lid)
  const awCanC=document.createElement('canvas');awCanC.width=512;awCanC.height=64;
  {const g2=awCanC.getContext('2d');const gr2=g2.createLinearGradient(0,0,0,64);
   gr2.addColorStop(0,'#dfe3e8');gr2.addColorStop(.5,'#b9bfc6');gr2.addColorStop(1,'#eef1f4');
   g2.fillStyle=gr2;g2.fillRect(0,0,512,64);
   g2.strokeStyle='rgba(60,66,74,.28)';g2.lineWidth=3;
   for(let i=-64;i<576;i+=42){g2.beginPath();g2.moveTo(i,0);g2.lineTo(i+64,64);g2.stroke();}}
  const awCanT=new THREE.CanvasTexture(awCanC);awCanT.colorSpace=THREE.SRGBColorSpace;awCanT.wrapS=THREE.RepeatWrapping;awCanT.repeat.x=3;
  const aw=new THREE.Group();aw.position.set((WX0+WX1)/2,WY1+.08,-BW/2-.02);truck.add(aw);
  const awLen=1.05, awPanel=new THREE.Mesh(new THREE.BoxGeometry(WX1-WX0+.25,.05,awLen),[ss,ss,ss,new THREE.MeshStandardMaterial({map:awCanT,roughness:.55,metalness:.25}),ss,ss]);
  awPanel.position.z=awLen/2;awPanel.castShadow=true;aw.add(awPanel);aw.rotation.y=Math.PI;aw.rotation.x=-.10;
  for(let i=0;i<4;i++){const L=new THREE.Mesh(new THREE.BoxGeometry(.55,.03,.12),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xfff3d0,emissiveIntensity:2.2}));
    L.position.set(-1.2+i*.8,-.04,.62);aw.add(L);const pl=new THREE.PointLight(0xfff0d0,1.2,4,2);pl.position.set(-1.2+i*.8,-.25,.7);aw.add(pl);}
  for(const x of [-.8,.8]){const sp=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.04,24),new THREE.MeshStandardMaterial({color:0x222,roughness:.8}));sp.position.set(x,-.04,.3);aw.add(sp);}
  for(const x of [WX0+.15,WX1-.15]){const st=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.95),new THREE.MeshStandardMaterial({color:0x111,metalness:.8,roughness:.3}));
    st.position.set(x,WY1+.28,-BW/2-.32);st.rotation.x=-.75;truck.add(st);}
  // roof vent hood + rear louvre
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.4,.28,1.1),roofM);hood.position.set(bx0+.9,FLOOR+BH+.14,0);hood.castShadow=true;truck.add(hood);
  // skirt / undercarriage
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(BL+CL,.45,BW-.1),new THREE.MeshStandardMaterial({color:0x111,roughness:.9}));skirt.position.set(bx0-CL/2,.55,0);truck.add(skirt);
  // rear bumper (diamond plate)
  const bump=new THREE.Mesh(new THREE.BoxGeometry(.25,.22,BW+.05),ss);bump.position.set(bx0+BL/2+.12,.62,0);bump.castShadow=true;truck.add(bump);
  // rear taillight clusters: black housing, twin red lenses + white reverse lamp
  // (photo placement — outboard, mid-face height, not the old roof-edge loop)
  {const tX=bx0+BL/2,redM=new THREE.MeshStandardMaterial({color:0xb5121b,emissive:0x3a0000,roughness:.3});
    for(const z of [-(BW/2-.32),BW/2-.32]){
      const hs=new THREE.Mesh(new THREE.BoxGeometry(.06,.44,.3),new THREE.MeshStandardMaterial({color:0x191b1f,roughness:.55}));hs.position.set(tX+.03,.98,z);truck.add(hs);
      for(const dy of [.11,-.01]){const l=new THREE.Mesh(new THREE.BoxGeometry(.02,.12,.22),redM);l.position.set(tX+.066,.98+dy,z);truck.add(l);}
      const rv=new THREE.Mesh(new THREE.BoxGeometry(.02,.08,.22),new THREE.MeshStandardMaterial({color:0xdcdcda,roughness:.4}));rv.position.set(tX+.066,.83,z);truck.add(rv);}}
  // plate removed per owner: no real registration info shown on the truck
  // marker lights on roof edges
  for(const [x,z] of [[bx0-BL/2+.2,BW/2],[bx0+BL/2-.2,BW/2],[bx0+BL/2-.2,-BW/2],[bx0-BL/2+.2,-BW/2]]){const m=new THREE.Mesh(new THREE.SphereGeometry(.05,12,8),new THREE.MeshStandardMaterial({color:0xd01020,emissive:0x300000}));m.position.set(x,FLOOR+BH-.05,z);truck.add(m);}

  // ---- CAB ----
  const cab=new THREE.Group();truck.add(cab);const cx=bx0-BL/2-CL/2;
  // cab side faces: pz u=0 at the cab's front corner, nz u=0 at its rear corner — so each
  // canvas maps world-x through its own direction: features land on the right end of the cab
  // and everything paints right side out with no mirroring
  const pzX=x=>(x-(cx-CL/2))*PX, nzX=x=>((cx+CL/2)-x)*PX;
  const paintCab=(k,X,h,glassFill)=>{
    // beltline chrome wrapping the cab low
    k.strokeStyle='rgba(201,204,210,.85)';k.lineWidth=9;
    k.beginPath();k.moveTo(0,h*.885);k.lineTo(k.canvas.width,h*.885);k.stroke();
    // chrome-framed door glass with a slider split (painted, like the wrap)
    const gx0=X(cx-.44),gx1=X(cx-.10);
    k.fillStyle=glassFill;k.fillRect(gx0,h*.16,gx1-gx0,h*.28);
    k.strokeStyle='rgba(216,218,220,.95)';k.lineWidth=8;k.strokeRect(gx0,h*.16,gx1-gx0,h*.28);
    k.strokeStyle='rgba(201,204,210,.7)';k.lineWidth=5;
    k.beginPath();k.moveTo(X(cx-.31),h*.17);k.lineTo(X(cx-.31),h*.29);k.stroke();   // slider split
    // door seam + chrome handle
    k.strokeStyle='rgba(196,202,210,.8)';k.lineWidth=6;
    k.beginPath();k.moveTo(X(cx+.03),h*.06);k.lineTo(X(cx+.03),h*.96);k.stroke();
    k.fillStyle='#e6e9ec';k.fillRect(X(cx+.10),h*.47,X(cx+.25)-X(cx+.10),h*.045);
  };
  // mural side (+z): talavera tiles wrap the whole cab; stacked white gothic wordmark
  // with teal sprig curls, like photo 6165
  const cc=document.createElement('canvas');cc.width=CL*PX;cc.height=CH*PX;const k=cc.getContext('2d');
  k.fillStyle=k.createPattern(tiles,'repeat');k.fillRect(0,0,cc.width,cc.height);
  paintClouds(k,cc.width*.5,cc.height*.7,cc.width*.8,15);           // cloud puffs breaking the tile field
  k.fillStyle='rgba(250,248,243,.97)';k.textAlign='center';
  k.font='800 84px "UnifrakturMaguntia"';
  k.fillText('el Otro',pzX(cx-.26),cc.height*.53);k.fillText('Lado',pzX(cx-.26),cc.height*.67);
  k.strokeStyle='#3fbcd9';k.lineWidth=6;                            // teal sprig curls flanking the mark
  k.beginPath();k.arc(pzX(cx-.62),cc.height*.605,30,.5,2.7);k.stroke();
  k.beginPath();k.arc(pzX(cx+.1),cc.height*.605,30,.5,2.7);k.stroke();
  paintCab(k,pzX,cc.height,'#0f1822');
  const cabT=new THREE.CanvasTexture(cc);cabT.colorSpace=THREE.SRGBColorSpace;cabT.anisotropy=8;
  // serving side (-z): galaxy cab with the blue fixed door glass (photo 6166) + daisies low
  const ccN=document.createElement('canvas');ccN.width=cc.width;ccN.height=cc.height;const kn=ccN.getContext('2d');
  galaxy(kn,ccN.width,ccN.height,9);
  paintSplat(kn,nzX(cx+.62),ccN.height*.78,44,1);
  paintDaisy(kn,nzX(cx-.6),ccN.height*.94,26);paintDaisy(kn,nzX(cx+.55),ccN.height*.6,20);
  paintCab(kn,nzX,ccN.height,'rgba(21,52,84,.94)');
  const cabTn=new THREE.CanvasTexture(ccN);cabTn.colorSpace=THREE.SRGBColorSpace;cabTn.anisotropy=8;
  // ---- cab front face: galaxy + pink scalloped windshield panes + flower header band, then the
  // gold heart/wing flourish + teal drops + cream pad-dot row pasted in from the front photo ----
  const fc=document.createElement('canvas');fc.width=BW*PX;fc.height=CH*PX;const f=fc.getContext('2d');galaxy(f,fc.width,fc.height,9);
  f.fillStyle='#10151c';
  f.fillRect(fc.width*.055,fc.height*.055,fc.width*.42,fc.height*.27);   // left pane
  f.fillRect(fc.width*.505,fc.height*.055,fc.width*.415,fc.height*.27);  // right pane
  f.strokeStyle='#e83a73';f.lineWidth=12;
  f.strokeRect(fc.width*.055,fc.height*.055,fc.width*.42,fc.height*.27);
  f.strokeRect(fc.width*.505,fc.height*.055,fc.width*.415,fc.height*.27);
  f.fillStyle='#e83a73';   // scallop fringe along each frame's top and bottom edges
  for(const [x0,x1] of [[.055,.475],[.505,.92]])for(let i=0;i<12;i++){
    f.beginPath();f.arc(fc.width*(x0+(x1-x0)*i/11),fc.height*.055,13,Math.PI,0);f.fill();
    f.beginPath();f.arc(fc.width*(x0+(x1-x0)*i/11),fc.height*.325,13,0,Math.PI);f.fill();}
  // flower band across the header, alternating petal hues like the wrap
  {const petals=['#e83a73','#f2c14e','#4fc3d9','#f4f6f0'];
   for(let i=0;i<9;i++){const r=15+(i%3)*4;
     f.save();f.translate(fc.width*(.1+.095*i),fc.height*.028);
     for(let p=0;p<6;p++){f.rotate(Math.PI/3);f.fillStyle=petals[i%4];f.beginPath();f.ellipse(r*.8,0,r*.5,r*.28,0,0,7);f.fill();}
     f.restore();}}
  // below the windshield sits dark cab shadow - the protruding hood volume covers this zone
  f.fillStyle='rgba(16,21,28,.55)';f.fillRect(0,fc.height*.34,fc.width,fc.height*.66);
  const frontT=new THREE.CanvasTexture(fc);frontT.colorSpace=THREE.SRGBColorSpace;
  const cabMesh=new THREE.Mesh(new THREE.BoxGeometry(CL,CH,BW),[paint,mat(frontT),paint,paint,mat(cabT),mat(cabTn)]);
  cabMesh.material[1]=paint;cabMesh.material[0]=paint; // +x face hidden by box
  const front=new THREE.Mesh(new THREE.PlaneGeometry(BW,CH),mat(frontT));front.rotation.y=-Math.PI/2;front.position.set(cx-CL/2-.001,FLOOR+CH/2-.05,0);
  cabMesh.position.set(cx,FLOOR+CH/2-.05,0);cabMesh.castShadow=true;cab.add(cabMesh,front);
  // door glass now lives in the painted cab canvases (photos: painted panes + slider, chrome frames)
  // mirrors
  for(const z of [1,-1]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.25),paint);arm.position.set(cx-.55,1.8,z*(BW/2+.12));cab.add(arm);
    const mir=new THREE.Mesh(new THREE.BoxGeometry(.08,.4,.25),new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:.6}));mir.position.set(cx-.55,1.95,z*(BW/2+.28));mir.castShadow=true;cab.add(mir);}
  // ---- van-engine nose: the flat bus face grows a real protruding hood volume - deep box with a
  // sloped lid running up to the windshield base, chrome lip bumper, grille and lamp pods recessed
  // into the face, so the front finally has the depth of an engine instead of a spray body ----
  {const frontx=cx-CL/2-.004,ND=.52,nx=frontx-ND;
    const dkM=new THREE.MeshStandardMaterial({color:0x141519,roughness:.55,metalness:.3});
    const slM=new THREE.MeshStandardMaterial({color:0x2e3338,metalness:.65,roughness:.4});
    const lampM=new THREE.MeshStandardMaterial({color:0xd9dee2,roughness:.12,metalness:.35,emissive:0x9aa4ad,emissiveIntensity:.3});
    const amb=new THREE.MeshStandardMaterial({color:0xc06410,roughness:.4,metalness:.15});
    // hood front-face canvas: galaxy night bg with cream pill rows (front photo), pink scallop
    // fringe, the photo's heart/wing flourish, splatter + daisy corners, dark grille paintbacks
    const nc=document.createElement('canvas');nc.width=Math.round(2.26*PX);nc.height=Math.round(1.09*PX);
    const ng=nc.getContext('2d');
    galaxy(ng,nc.width,nc.height,11);
    ng.fillStyle='#f4f0ea';
    for(let x=14;x<nc.width-96;x+=118){
      ng.beginPath();ng.roundRect(x,nc.height*.15,86,nc.height*.125,40);ng.fill();
      ng.beginPath();ng.roundRect(x+40,nc.height*.725,86,nc.height*.125,40);ng.fill();}
    ng.fillStyle='#e83a73';
    for(let x=0;x<nc.width;x+=26){ng.beginPath();ng.arc(x+13,nc.height*.075,11,Math.PI,0);ng.fill();}
    paintClouds(ng,nc.width*.8,nc.height*.93,nc.width*1.02,9);
    paintSplat(ng,nc.width*.07,nc.height*.84,15);
    paintDaisy(ng,nc.width*.9,nc.height*.79,13);
    ng.fillStyle='#15181d';
    ng.fillRect(nc.width*.3,nc.height*.62,nc.width*.4,nc.height*.38);   // grille bay
    for(const ux of [.05,.95]){ng.beginPath();ng.arc(nc.width*ux,nc.height*.395,nc.width*.05,0,7);ng.fill();}   // lamp wells
    ng.drawImage(frontArt,nc.width*.19,nc.height*.05,nc.width*.62,nc.width*.62*frontArt.height/frontArt.width);
    const noseT=new THREE.CanvasTexture(nc);noseT.colorSpace=THREE.SRGBColorSpace;
    const noseMat=new THREE.MeshStandardMaterial({map:noseT,roughness:.38});
    // hood mass: front face .66..1.75, sides stay the trim white so the fender line continues
    const hood=new THREE.Mesh(new THREE.BoxGeometry(ND,1.09,2.26),[paint,paint,paint,paint,noseMat,paint]);
    hood.position.set(frontx-ND/2,.66+1.09/2,0);hood.castShadow=true;cab.add(hood);
    // sloped lid from the hood's front lip up to the windshield base, chrome edge strips along it
    const ang=Math.atan2(.32,.52);
    const lid=new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(.32,.52)+.03,.035,2.26),paint);
    lid.position.set(frontx-.27,1.90,0);lid.rotation.z=ang;lid.castShadow=true;cab.add(lid);
    for(const z of [1,-1]){const trim=new THREE.Mesh(new THREE.BoxGeometry(ND+.12,.035,.05),ss);
      trim.position.set(frontx-.27,1.90,z*1.11);trim.rotation.z=ang;cab.add(trim);}
    // dark under-nose rocker closing the engine bay off the lawn
    const rocker=new THREE.Mesh(new THREE.BoxGeometry(.34,.5,2.2),new THREE.MeshStandardMaterial({color:0x181a1e,roughness:.9}));
    rocker.position.set(frontx-.34,.3,0);cab.add(rocker);
    // radiator grille with chrome slats riding proud of the face
    const grille=new THREE.Mesh(new THREE.BoxGeometry(.14,.42,.8),dkM);grille.position.set(nx-.06,.89,0);grille.castShadow=true;cab.add(grille);
    for(let i=0;i<8;i++){const sl=new THREE.Mesh(new THREE.BoxGeometry(.016,.38,.05),slM);sl.position.set(nx-.135,.89,-.34+i*.097);cab.add(sl);}
    // dual lamp pods each side, chrome brows, amber markers on the valance
    for(const z of [-.63,.63]){
      const bez=new THREE.Mesh(new THREE.BoxGeometry(.06,.22,.4),dkM);bez.position.set(nx-.02,1.32,z);bez.castShadow=true;cab.add(bez);
      for(const dz of [-.09,.09]){const lp=new THREE.Mesh(new THREE.BoxGeometry(.03,.18,.15),lampM);lp.position.set(nx-.055,1.32,z+dz);cab.add(lp);}
      const brow=new THREE.Mesh(new THREE.BoxGeometry(.05,.035,.46),ss);brow.position.set(nx-.005,1.455,z);cab.add(brow);
      const am=new THREE.Mesh(new THREE.BoxGeometry(.03,.08,.18),amb);am.position.set(nx-.015,.92,z*1.3);cab.add(am);}
    // wipers on the windshield, clear of the hood's back edge
    for(const [z,a] of [[-.35,.55],[.32,-.7]]){const wp=new THREE.Mesh(new THREE.BoxGeometry(.016,.022,.5),new THREE.MeshStandardMaterial({color:0x0a0a0c}));
      wp.position.set(frontx-.02,2.11,z);wp.rotation.x=a;cab.add(wp);}
    // solar panel propped face-up on the hood slope (photo: leaning mid-grille)
    const solC=document.createElement('canvas');solC.width=solC.height=128;const sg=solC.getContext('2d');
    sg.fillStyle='#0e1738';sg.fillRect(0,0,128,128);sg.strokeStyle='rgba(225,232,240,.6)';sg.lineWidth=2;
    for(let i=10;i<128;i+=16){sg.beginPath();sg.moveTo(i,0);sg.lineTo(i,128);sg.moveTo(0,i);sg.lineTo(128,i);sg.stroke();}
    const solT=new THREE.CanvasTexture(solC);solT.colorSpace=THREE.SRGBColorSpace;
    const solMat=new THREE.MeshStandardMaterial({map:solT,roughness:.3,metalness:.45});
    const solSide=new THREE.MeshStandardMaterial({color:0x3a3f46,metalness:.6,roughness:.4});
    const sol=new THREE.Mesh(new THREE.BoxGeometry(.54,.03,.34),[solSide,solSide,solMat,solSide,solSide,solSide]);
    sol.position.set(frontx-.3,1.905,.02);sol.rotation.z=.5;sol.castShadow=true;cab.add(sol);}
  // front bumper (chrome) hugging the nose as a low lip
  const fb=new THREE.Mesh(new THREE.BoxGeometry(.18,.22,BW+.08),new THREE.MeshStandardMaterial({color:0xeeeeee,metalness:1,roughness:.12}));fb.position.set(cx-CL/2-.6,.62,0);cab.add(fb);

  // ---- WHEELS ----
  const tire=new THREE.MeshStandardMaterial({color:0x151515,roughness:.95}),rim=new THREE.MeshStandardMaterial({color:0xdddddd,metalness:1,roughness:.18});
  const wheel=()=>{const w=new THREE.Group();const t=new THREE.Mesh(new THREE.TorusGeometry(.33,.14,16,40),tire);w.add(t);
    const r=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.2,32),rim);r.rotation.x=Math.PI/2;w.add(r);
    for(let i=0;i<8;i++){const n=new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.24,8),rim);n.rotation.x=Math.PI/2;n.position.set(Math.cos(i*.785)*.15,Math.sin(i*.785)*.15,0);w.add(n);}
    w.traverse(o=>o.castShadow=true);return w;};
  for(const x of [cx-.05, bx0+1.3])for(const z of [1,-1]){const w=wheel();w.position.set(x,.47,z*(BW/2-.12));truck.add(w);
    const arch=new THREE.Mesh(new THREE.TorusGeometry(.56,.05,8,24,Math.PI),ss);arch.position.set(x,.5,z*(BW/2+.005));truck.add(arch);}

  // ---- WORKER (El Otro Lado crew) ----
  const shirtC=document.createElement('canvas');shirtC.width=512;shirtC.height=512;const s=shirtC.getContext('2d');
  s.fillStyle='#1f4fd6';s.fillRect(0,0,512,512);
  // back/front logo
  s.fillStyle='#1b1546';s.fillRect(56,150,400,150);s.drawImage(logo,66,160,380,118);
  s.fillStyle='#e83a73';s.fillRect(56,300,400,10);
  s.font='600 30px Inter';s.fillStyle='#fff';s.textAlign='center';s.fillText('CREW · Mesa, AZ',256,350);
  const shirtT=new THREE.CanvasTexture(shirtC);shirtT.colorSpace=THREE.SRGBColorSpace;
  const skin=new THREE.MeshStandardMaterial({color:0xb07a54,roughness:.7});
  const shirt=new THREE.MeshStandardMaterial({map:shirtT,roughness:.85});
  const blue=new THREE.MeshStandardMaterial({color:0x1f4fd6,roughness:.7});
  // ---- the cook: a people.js body (painted face, articulated arms, bent elbows) in a branded cap and
  // tiled apron. He stands on the box floor with his head framed in the service window and his hands
  // resting on the counter edge, replacing the old cylinder-and-sphere bust.
  const W=new THREE.Group();
  const cook=People.buildAvatar(28,{},0,{skin:0xb07a54,shirt:0xf4f1ea,pants:0x2b2f3a,sleeve:'short',
    vest:0,dress:false,hat:null,goggles:false,beard:false,hair:'short',hairC:0x3a2a1c,expr:'smile',eye:1,scale:1});
  const cookBody=cook.children[0];
  W.add(cook);
  // the head is one merged mesh with its vertices up at y~1.6, so give it a neck pivot to turn about
  const NECK=1.52, headPivot=cook.userData.headPivot;   // people.js builds the neck pivot now; just borrow it
  W.userData.headPivot=headPivot;W.userData.arms=cook.userData.arms;
  // hands resting on the counter edge: shoulders forward, elbows bent
  const [armL,armR]=cook.userData.arms;
  for(const a of [armL,armR]){a.rotation.x=-.95;a.userData.sub.rotation.x=-1.0;}
  armL.rotation.z=.16;armR.rotation.z=-.16;
  // apron (pink/navy tile), bib and skirt
  const apronM=new THREE.MeshStandardMaterial({map:Object.assign(new THREE.CanvasTexture(tiles),{colorSpace:THREE.SRGBColorSpace}),roughness:.9,side:THREE.DoubleSide});
  const apron=new THREE.Mesh(new THREE.PlaneGeometry(.34,.44),apronM);apron.position.set(0,1.05,.178);cookBody.add(apron);
  const bib=new THREE.Mesh(new THREE.PlaneGeometry(.19,.22),apronM);bib.position.set(0,1.37,.168);cookBody.add(bib);
  // cap: blue w/ logo badge, riding the head so it turns with it
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.113,24,12,0,Math.PI*2,0,Math.PI/2),blue);
  cap.position.y=1.655-NECK;headPivot.add(cap);
  const brim=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.015,24,1,false,0,Math.PI),blue);
  brim.position.set(0,1.652-NECK,.075);brim.rotation.y=-Math.PI/2;brim.scale.set(1,1,1.15);headPivot.add(brim);
  const badgeC=document.createElement('canvas');badgeC.width=256;badgeC.height=80;const bb=badgeC.getContext('2d');bb.drawImage(logo,0,0,256,80);
  const badge=new THREE.Mesh(new THREE.PlaneGeometry(.15,.047),new THREE.MeshBasicMaterial({map:Object.assign(new THREE.CanvasTexture(badgeC),{colorSpace:THREE.SRGBColorSpace}),transparent:false}));
  badge.position.set(0,1.716-NECK,.098);badge.rotation.x=-.35;headPivot.add(badge);
  // cool raybans: dark lenses + bridge + temples, riding the head so they turn with it
  const rbM=new THREE.MeshStandardMaterial({color:0x0a0a0c,roughness:.12,metalness:.4,transparent:true,opacity:.85});
  const rbFrame=new THREE.MeshStandardMaterial({color:0x1a1a1e,roughness:.3,metalness:.6});
  for(const sx of [-1,1]){
    const lens=new THREE.Mesh(new THREE.BoxGeometry(.09,.045,.012),rbM);lens.position.set(sx*.055,1.605-NECK,.105);headPivot.add(lens);
    const rim=new THREE.Mesh(new THREE.BoxGeometry(.105,.06,.014),rbFrame);rim.position.set(sx*.055,1.605-NECK,.10);headPivot.add(rim);
  }
  const bridge=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.03,8),rbFrame);bridge.rotation.z=Math.PI/2;bridge.position.set(0,1.605-NECK,.102);headPivot.add(bridge);
  for(const sx of [-1,1]){
    const temple=new THREE.Mesh(new THREE.BoxGeometry(.008,.012,.12),rbFrame);temple.position.set(sx*.11,1.605-NECK,.05);temple.rotation.y=sx*.15;headPivot.add(temple);
  }
  // worker stands in the aisle just in front of the counter run (the kitchen line rides the
  // serving-side wall now), facing the -z window with hands resting at the counter edge
  // dropped below the box floor so his head is framed in the window and clears the overhead shelf
  W.position.set((WX0+WX1)/2+.35,0.62,-BW/2+.95);W.rotation.y=Math.PI;W.traverse(o=>{o.castShadow=true;});truck.add(W);

  // ---- environmental props ----
  // propane tank behind truck
  const propC=new THREE.MeshStandardMaterial({color:0x8ab4c0,metalness:.75,roughness:.22});
  const prop=new THREE.Group();
  prop.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,.65,20),propC),{castShadow:true,receiveShadow:true}));
  const propTop=new THREE.Mesh(new THREE.SphereGeometry(.22,20,12,0,Math.PI*2,.5,Math.PI),propC);propTop.position.y=.325;prop.add(propTop);
  const propBot=new THREE.Mesh(new THREE.SphereGeometry(.22,20,12,0,Math.PI*2,Math.PI/2,Math.PI/2),propC);propBot.rotation.x=Math.PI;propBot.position.y=-.325;prop.add(propBot);
  const valve=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.12,8),new THREE.MeshStandardMaterial({color:0x888,metalness:.8,roughness:.3}));valve.position.y=.36;prop.add(valve);
  prop.position.set(bx0+BL/2-.3,FLOOR+.32,BW/2+.3);truck.add(prop);   // moved to the far rear corner: it was standing in front of the menu board
  // safety cones
  for(const [px,pz] of [[BW/2+1.6,-.5],[BW/2+1.6,.5]]){
    const cone=new THREE.Group();cone.add(Object.assign(new THREE.Mesh(new THREE.ConeGeometry(.08,.4,10),new THREE.MeshStandardMaterial({color:0xff5500,roughness:.8})),{castShadow:true}));
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.05,12),new THREE.MeshStandardMaterial({color:0x111,roughness:.9}));base.position.y=-.22;cone.add(base);
    // white reflective stripe
    const stripe=new THREE.Mesh(new THREE.CylinderGeometry(.082,.082,.025,10),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.6,emissive:0xffffff,emissiveIntensity:.3}));stripe.position.y=.05;cone.add(stripe);
    cone.position.set(bx0+WX1+px-BL/2+2.3,FLOOR,pz);truck.add(cone);}
  // order sign on counter
  const oc=document.createElement('canvas');oc.width=512;oc.height=200;const o=oc.getContext('2d');o.fillStyle='#e83a73';o.fillRect(0,0,512,200);
  o.fillStyle='#1b1546';o.fillRect(8,8,496,184);o.fillStyle='#ffe03a';o.textAlign='center';o.font='70px "UnifrakturMaguntia"';o.fillText('Order Here',256,95);
  o.font='34px "Great Vibes"';o.fillStyle='#fff';o.fillText('tap to see the menu',256,155);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.6,.235),new THREE.MeshStandardMaterial({map:Object.assign(new THREE.CanvasTexture(oc),{colorSpace:THREE.SRGBColorSpace}),emissive:0x222222}));
  sign.position.set(WX0+.55,WY0+.13,-BW/2-.24);sign.rotation.set(.25,Math.PI,0);truck.add(sign);
  // ---- 3D MENU BOARD mounted beside the service window (click to order) ----
  const mbW=1.05, mbH=1.5;
  const mc=document.createElement('canvas');mc.width=1024;mc.height=Math.round(1024*mbH/mbW);const b=mc.getContext('2d');
  b.fillStyle='#14103a';b.fillRect(0,0,mc.width,mc.height);
  b.fillStyle=b.createPattern(tiles,'repeat');const bd=34;
  b.fillRect(0,0,mc.width,bd);b.fillRect(0,mc.height-bd,mc.width,bd);b.fillRect(0,0,bd,mc.height);b.fillRect(mc.width-bd,0,bd,mc.height);
  b.strokeStyle='#c9ccd2';b.lineWidth=6;b.strokeRect(bd,bd,mc.width-2*bd,mc.height-2*bd);
  b.textAlign='center';b.fillStyle='#fff';b.font='120px "UnifrakturMaguntia"';b.fillText('Menú',mc.width/2,170);
  b.font='44px "Great Vibes"';b.fillStyle='#f2c14e';b.fillText('Family Owned, Signature Choices',mc.width/2,225);
  const cats=MENU.categories.filter(c=>c.items.length);
  const nLines=cats.reduce((n,c)=>n+c.items.length+1.4,0)||1;
  const lh=Math.min(58,(mc.height-330)/nLines);let y=290;
  for(const c of cats){b.textAlign='left';b.fillStyle='#ff8fb3';b.font=`800 ${Math.round(lh*.62)}px Inter`;b.fillText(c.name.toUpperCase(),80,y+lh*.55);y+=lh*1.15;
    for(const it of c.items){b.font=`600 ${Math.round(lh*.6)}px Inter`;b.fillStyle='#fff';b.textAlign='left';b.fillText(it.name,95,y+lh*.5);
      const nw=b.measureText(it.name).width;b.textAlign='right';b.fillStyle='#f2c14e';const pr=money(it.price);b.fillText(pr,mc.width-90,y+lh*.5);
      const pw=b.measureText(pr).width;b.fillStyle='rgba(255,255,255,.35)';for(let x=95+nw+14;x<mc.width-90-pw-14;x+=14)b.fillRect(x,y+lh*.42,4,4);y+=lh;}
    y+=lh*.25;}
  if(!cats.length){b.textAlign='center';b.fillStyle='#fff';b.font='600 48px Inter';b.fillText('Menu coming soon',mc.width/2,mc.height/2);}
  b.textAlign='center';b.fillStyle='#e83a73';b.fillRect(mc.width/2-260,mc.height-120,520,64);b.fillStyle='#fff';b.font='800 34px Inter';b.fillText('TAP TO ORDER',mc.width/2,mc.height-76);
  const mbT=new THREE.CanvasTexture(mc);mbT.colorSpace=THREE.SRGBColorSpace;mbT.anisotropy=8;
  const board=new THREE.Group();
  const face=new THREE.Mesh(new THREE.PlaneGeometry(mbW,mbH),new THREE.MeshStandardMaterial({map:mbT,roughness:.35,emissive:0xffffff,emissiveMap:mbT,emissiveIntensity:.55}));face.position.z=.026;
  const frame=new THREE.Mesh(new THREE.BoxGeometry(mbW+.06,mbH+.06,.05),ss);frame.castShadow=true;
  board.add(frame,face);board.rotation.y=Math.PI;board.position.set(WX1+.08+mbW/2,FLOOR+.25+mbH/2+.15,-BW/2-.03);truck.add(board);
  // little spotlight on the board
  const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.03,.06,.12,16),new THREE.MeshStandardMaterial({color:0x111,metalness:.6}));lamp.rotation.x=-Math.PI/2.6;
  lamp.position.set(board.position.x,board.position.y+mbH/2+.1,-BW/2-.15);truck.add(lamp);
  const spot=new THREE.SpotLight(0xfff2d6,6,3,.7,.5,1.5);spot.position.copy(lamp.position);spot.target=face;truck.add(spot);
  // hover: pulse the board
  done();
  return {board:face,click:[sign,W,counter,face,frame],worker:W,group:truck};
}
