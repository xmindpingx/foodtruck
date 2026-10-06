// truck.js — builds the 1990 GMC step-van (textures painted from the real photos), kitchen,
// worker, customer, props and the clickable 3D menu board. Pure geometry; no DOM, no camera.
import * as THREE from 'three';

// ---------- dimensions (m) : 1990 GMC step van ----------
export const BL=5.4, BW=2.3, BH=2.25, FLOOR=0.75;           // box
export const CL=1.55, CH=2.05;                               // cab
export const bx0=-BL/2+0.6;                                  // box center x  (front of truck = -x)

// service window (on +z side)
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

export async function buildTruck(S,{img,done,MENU,money}){
  const truck=new THREE.Group();S.add(truck);
  const [logo,slogan,tiles,rearU,frontL,interior,interiorBack]=await Promise.all(['logo.jpg','slogan.jpg','tiles.jpg','rear_upper.jpg','front_lower.jpg','interior.jpg','interior_back.jpg'].map(img));
  const PX=400; // px per meter
  // ---- service side (+z) with transparent window cut ----
  const sc=document.createElement('canvas');sc.width=BL*PX;sc.height=BH*PX;const g=sc.getContext('2d');
  galaxy(g,sc.width,sc.height,7);
  const toX=x=>(x-(bx0-BL/2))*PX, toY=y=>(FLOOR+BH-y)*PX;
  // pink talavera tile panels flanking window (as on truck)
  const tp=g.createPattern(tiles,'repeat');g.save();g.fillStyle=tp;
  g.fillRect(toX(WX0)-40,toY(WY1)-10,toX(WX1)-toX(WX0)+80,toY(WY0+0.0)-toY(WY1)+300);g.restore();
  // logo + sun above window
  g.drawImage(logo,toX(WX0)-10,toY(BH+FLOOR-0.02),1.7*PX,0.52*PX);
  paintSun(g,toX(WX0)+1.95*PX,toY(BH+FLOOR-0.3),0.24*PX);
  // slogan strip under counter
  g.drawImage(slogan,toX(WX0+.2),toY(1.45),2.6*PX,0.55*PX);
  // stainless trim
  g.fillStyle='#c9ccd2';g.fillRect(0,toY(1.62),sc.width,18);g.fillRect(0,toY(FLOOR+0.06),sc.width,14);
  g.clearRect(toX(WX0),toY(WY1),toX(WX1)-toX(WX0),toY(WY0)-toY(WY1)); // window opening
  const sideT=new THREE.CanvasTexture(sc);sideT.colorSpace=THREE.SRGBColorSpace;sideT.anisotropy=8;
  // ---- driver side (-z) closed panels ----
  const dc=document.createElement('canvas');dc.width=sc.width;dc.height=sc.height;const d=dc.getContext('2d');galaxy(d,dc.width,dc.height,3);
  d.fillStyle=d.createPattern(tiles,'repeat');d.fillRect(dc.width*.18,dc.height*.22,dc.width*.62,dc.height*.36);
  d.strokeStyle='#c9ccd2';d.lineWidth=14;d.strokeRect(dc.width*.18,dc.height*.22,dc.width*.62,dc.height*.36);
  d.save();d.translate(dc.width,0);d.scale(-1,1);d.restore();
  d.drawImage(logo,dc.width*.62,dc.height*.03,1.7*PX,.52*PX);paintSun(d,dc.width*.5,dc.height*.13,.22*PX);
  d.drawImage(slogan,dc.width*.2,dc.height*.66,2.6*PX,.55*PX);
  const drvT=new THREE.CanvasTexture(dc);drvT.colorSpace=THREE.SRGBColorSpace;drvT.wrapS=THREE.RepeatWrapping;drvT.repeat.x=-1;
  // ---- rear ----
  const rc=document.createElement('canvas');rc.width=BW*PX;rc.height=BH*PX;const r=rc.getContext('2d');galaxy(r,rc.width,rc.height,11);
  r.drawImage(rearU,0,0,rc.width,rc.height*0.62);
  r.fillStyle='#1b1546';r.fillRect(rc.width*.12,rc.height*.66,rc.width*.76,rc.height*.3);galaxy(r,0,0);
  r.strokeStyle='#c9ccd2';r.lineWidth=16;r.strokeRect(rc.width*.12,rc.height*.66,rc.width*.76,rc.height*.3);
  r.textAlign='center';r.font=`${.13*PX}px "Great Vibes"`;r.lineWidth=10;r.strokeStyle='#e83a73';r.fillStyle='#ffe03a';
  for(const [t,y] of [['See You On',.77],['The Other Side!',.88]]){r.strokeText(t,rc.width/2,rc.height*y);r.fillText(t,rc.width/2,rc.height*y);}
  const rearT=new THREE.CanvasTexture(rc);rearT.colorSpace=THREE.SRGBColorSpace;

  const paint=new THREE.MeshPhysicalMaterial({color:0x2b2470,roughness:.28,metalness:.12,clearcoat:.85,clearcoatRoughness:.08,envMapIntensity:1.2});
  const mat=(m)=>new THREE.MeshPhysicalMaterial({map:m,roughness:.32,metalness:.08,clearcoat:.7,clearcoatRoughness:.12,envMapIntensity:1.1});
  const roofM=new THREE.MeshStandardMaterial({color:0xd7d9dc,metalness:.6,roughness:.4});
  const sideM=mat(sideT);sideM.transparent=false;sideM.alphaTest=.5;sideM.side=THREE.DoubleSide;
  const body=new THREE.Mesh(new THREE.BoxGeometry(BL,BH,BW),[mat(rearT),roofM.clone(),roofM,roofM,sideM,mat(drvT)]);
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
  const il=new THREE.PointLight(0xfff4e0,5,5,1.6);il.position.set((WX0+WX1)/2,FLOOR+BH-.25,-.1);truck.add(il);
  const il2=new THREE.PointLight(0xfff4e0,3,4,1.6);il2.position.set(gX,FLOOR+BH-.6,IZ+.4);truck.add(il2);
  // stainless shelves visible through window (photo strip)
  const shelfT=new THREE.CanvasTexture(interior);shelfT.colorSpace=THREE.SRGBColorSpace;
  const shelf=new THREE.Mesh(new THREE.PlaneGeometry(WX1-WX0,0.8),new THREE.MeshStandardMaterial({map:shelfT,metalness:.4,roughness:.4,transparent:true,opacity:.0}));
  // counter (stainless ledge) outside window
  const counter=new THREE.Mesh(new THREE.BoxGeometry(WX1-WX0+.3,.05,.32),ss);counter.position.set((WX0+WX1)/2,WY0-.02,BW/2+.14);counter.castShadow=true;truck.add(counter);
  // window trim
  for(const [w,h,x,y] of [[WX1-WX0+.1,.06,(WX0+WX1)/2,WY1+.03],[.06,WY1-WY0,WX0-.03,(WY0+WY1)/2],[.06,WY1-WY0,WX1+.03,(WY0+WY1)/2]]){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.06),ss);m.position.set(x,y,BW/2+.02);truck.add(m);}
  // plexiglass sneeze guard (the one on order)
  const plex=new THREE.Mesh(new THREE.PlaneGeometry(WX1-WX0-.1,.42),new THREE.MeshPhysicalMaterial({transmission:1,roughness:.04,thickness:.01,transparent:true,opacity:.35}));
  plex.position.set((WX0+WX1)/2,WY1-.22,BW/2-.02);truck.add(plex);
  // awning door hinged up — striped canvas (pink/navy/white)
  const awCanC=document.createElement('canvas');awCanC.width=512;awCanC.height=64;
  {const g=awCanC.getContext('2d');const cols=['#e83a73','#1b1546','#ffffff','#f2c14e','#1b1546','#e83a73'];const sw=512/cols.length;cols.forEach((c,i)=>{g.fillStyle=c;g.fillRect(i*sw,0,sw,64);});}
  const awCanT=new THREE.CanvasTexture(awCanC);awCanT.colorSpace=THREE.SRGBColorSpace;awCanT.wrapS=THREE.RepeatWrapping;awCanT.repeat.x=1;
  const aw=new THREE.Group();aw.position.set((WX0+WX1)/2,WY1+.08,BW/2+.02);truck.add(aw);
  const awLen=1.0, awPanel=new THREE.Mesh(new THREE.BoxGeometry(WX1-WX0+.25,.05,awLen),[ss,ss,ss,new THREE.MeshStandardMaterial({map:awCanT,roughness:.6}),ss,ss]);
  awPanel.position.z=awLen/2;awPanel.castShadow=true;aw.add(awPanel);aw.rotation.x=-0.22;
  for(let i=0;i<4;i++){const L=new THREE.Mesh(new THREE.BoxGeometry(.55,.03,.12),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xfff3d0,emissiveIntensity:2.2}));
    L.position.set(-1.2+i*.8,-.04,.62);aw.add(L);const pl=new THREE.PointLight(0xfff0d0,1.2,4,2);pl.position.set(-1.2+i*.8,-.25,.7);aw.add(pl);}
  for(const x of [-.8,.8]){const sp=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.04,24),new THREE.MeshStandardMaterial({color:0x222,roughness:.8}));sp.position.set(x,-.04,.3);aw.add(sp);}
  for(const x of [WX0+.15,WX1-.15]){const st=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.95),new THREE.MeshStandardMaterial({color:0x111,metalness:.8,roughness:.3}));
    st.position.set(x,WY1+.33,BW/2+.32);st.rotation.x=.75;truck.add(st);}
  // roof vent hood + rear louvre
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.4,.28,1.1),roofM);hood.position.set(bx0+.9,FLOOR+BH+.14,0);hood.castShadow=true;truck.add(hood);
  // skirt / undercarriage
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(BL+CL,.45,BW-.1),new THREE.MeshStandardMaterial({color:0x111,roughness:.9}));skirt.position.set(bx0-CL/2,.55,0);truck.add(skirt);
  // rear bumper (diamond plate)
  const bump=new THREE.Mesh(new THREE.BoxGeometry(.25,.22,BW+.05),ss);bump.position.set(bx0+BL/2+.12,.62,0);bump.castShadow=true;truck.add(bump);
  // tail lights
  for(const z of [-.95,.95])for(let i=0;i<3;i++){const t=new THREE.Mesh(new THREE.BoxGeometry(.03,.14,.24),new THREE.MeshStandardMaterial({color:0xb5121b,emissive:0x400000,roughness:.3}));t.position.set(bx0+BL/2+.01,1.05+i*.16,z);truck.add(t);}
  // marker lights on roof edges
  for(const [x,z] of [[bx0-BL/2+.2,BW/2],[bx0+BL/2-.2,BW/2],[bx0+BL/2-.2,-BW/2],[bx0-BL/2+.2,-BW/2]]){const m=new THREE.Mesh(new THREE.SphereGeometry(.05,12,8),new THREE.MeshStandardMaterial({color:0xd01020,emissive:0x300000}));m.position.set(x,FLOOR+BH-.05,z);truck.add(m);}

  // ---- CAB ----
  const cab=new THREE.Group();truck.add(cab);const cx=bx0-BL/2-CL/2;
  const cc=document.createElement('canvas');cc.width=CL*PX;cc.height=CH*PX;const k=cc.getContext('2d');
  galaxy(k,cc.width,cc.height,5);k.fillStyle=k.createPattern(tiles,'repeat');
  k.beginPath();k.moveTo(0,cc.height*.25);k.lineTo(cc.width*.85,cc.height*.1);k.lineTo(cc.width,cc.height*.6);k.lineTo(cc.width*.7,cc.height);k.lineTo(0,cc.height);k.fill();
  k.drawImage(logo,cc.width*.18,cc.height*.68,cc.width*.62,cc.width*.19);
  const cabT=new THREE.CanvasTexture(cc);cabT.colorSpace=THREE.SRGBColorSpace;
  const fc=document.createElement('canvas');fc.width=BW*PX;fc.height=CH*PX;const f=fc.getContext('2d');galaxy(f,fc.width,fc.height,9);
  f.drawImage(frontL,0,fc.height*.42,fc.width,fc.height*.58);
  // windshield: dark glass + pink frames with scallops
  for(const x0 of [.05,.52]){f.fillStyle='#0e1a24';f.fillRect(fc.width*x0,fc.height*.06,fc.width*.43,fc.height*.3);f.strokeStyle='#e83a73';f.lineWidth=14;f.strokeRect(fc.width*x0,fc.height*.06,fc.width*.43,fc.height*.3);}
  const flow=['#4fc3d9','#e83a73','#f2c14e'];for(let i=0;i<12;i++){f.fillStyle=flow[i%3];f.beginPath();f.arc(fc.width*(.06+i*.08),fc.height*.03,14,0,7);f.fill();}
  const frontT=new THREE.CanvasTexture(fc);frontT.colorSpace=THREE.SRGBColorSpace;
  const glass=new THREE.MeshPhysicalMaterial({color:0x0b141c,roughness:.05,metalness:.2,clearcoat:1});
  const cabMesh=new THREE.Mesh(new THREE.BoxGeometry(CL,CH,BW),[paint,mat(frontT),paint,paint,mat(cabT),mat(cabT)]);
  cabMesh.material[1]=paint;cabMesh.material[0]=paint; // +x face hidden by box
  const front=new THREE.Mesh(new THREE.PlaneGeometry(BW,CH),mat(frontT));front.rotation.y=-Math.PI/2;front.position.set(cx-CL/2-.001,FLOOR+CH/2-.05,0);
  cabMesh.position.set(cx,FLOOR+CH/2-.05,0);cabMesh.castShadow=true;cab.add(cabMesh,front);
  // cab side windows (door open on passenger side like photo)
  const sw=new THREE.Mesh(new THREE.PlaneGeometry(.55,.7),glass);sw.position.set(cx-.2,2.15,BW/2+.003);cab.add(sw);
  const sw2=sw.clone();sw2.position.z=-BW/2-.003;sw2.rotation.y=Math.PI;cab.add(sw2);
  // mirrors
  for(const z of [1,-1]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.25),paint);arm.position.set(cx-.55,1.8,z*(BW/2+.12));cab.add(arm);
    const mir=new THREE.Mesh(new THREE.BoxGeometry(.08,.4,.25),new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:.6}));mir.position.set(cx-.55,1.95,z*(BW/2+.28));mir.castShadow=true;cab.add(mir);}
  // front bumper (chrome) + solar panel
  const fb=new THREE.Mesh(new THREE.BoxGeometry(.18,.22,BW+.08),new THREE.MeshStandardMaterial({color:0xeeeeee,metalness:1,roughness:.12}));fb.position.set(cx-CL/2-.08,.62,0);cab.add(fb);
  const sol=new THREE.Mesh(new THREE.BoxGeometry(.02,.42,.36),new THREE.MeshStandardMaterial({color:0x101a3a,metalness:.6,roughness:.2}));sol.position.set(cx-CL/2-.19,.9,.15);sol.rotation.z=-.15;cab.add(sol);

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
  const W=new THREE.Group();
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.24,.21,.62,24,1,false),shirt);torso.position.y=.31;torso.rotation.y=Math.PI/2+Math.PI;W.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.13,24,16),skin);head.position.y=.78;head.scale.y=1.12;W.add(head);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.06,.07,.1,12),skin);neck.position.y=.66;W.add(neck);
  // cap: blue w/ logo badge
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.14,24,12,0,Math.PI*2,0,Math.PI/2),blue);cap.position.y=.82;W.add(cap);
  const brim=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.015,24,1,false,0,Math.PI),blue);brim.position.set(0,.82,.08);brim.rotation.y=-Math.PI/2;brim.scale.set(1,1,1.1);W.add(brim);
  const badgeC=document.createElement('canvas');badgeC.width=256;badgeC.height=80;const bb=badgeC.getContext('2d');bb.drawImage(logo,0,0,256,80);
  const badge=new THREE.Mesh(new THREE.PlaneGeometry(.17,.053),new THREE.MeshBasicMaterial({map:Object.assign(new THREE.CanvasTexture(badgeC),{colorSpace:THREE.SRGBColorSpace}),transparent:false}));
  badge.position.set(0,.9,.12);badge.rotation.x=-.4;W.add(badge);
  // arms (resting on counter)
  for(const sx of [-1,1]){const up=new THREE.Mesh(new THREE.CapsuleGeometry(.06,.26,6,12),blue);up.position.set(sx*.28,.42,.06);up.rotation.x=.6;up.rotation.z=sx*.12;W.add(up);
    const fa=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.24,6,12),skin);fa.position.set(sx*.26,.24,.27);fa.rotation.x=1.4;W.add(fa);}
  // apron (pink/navy tile)
  const apron=new THREE.Mesh(new THREE.PlaneGeometry(.36,.3),new THREE.MeshStandardMaterial({map:Object.assign(new THREE.CanvasTexture(tiles),{colorSpace:THREE.SRGBColorSpace}),roughness:.9}));
  apron.position.set(0,.02,.215);W.add(apron);
  W.position.set((WX0+WX1)/2+.35,WY0-.12,BW/2-.42);W.traverse(o=>{o.castShadow=true;});truck.add(W);

  // ---- environmental props ----
  // propane tank behind truck
  const propC=new THREE.MeshStandardMaterial({color:0x8ab4c0,metalness:.75,roughness:.22});
  const prop=new THREE.Group();
  prop.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,.65,20),propC),{castShadow:true,receiveShadow:true}));
  const propTop=new THREE.Mesh(new THREE.SphereGeometry(.22,20,12,0,Math.PI*2,.5,Math.PI),propC);propTop.position.y=.325;prop.add(propTop);
  const propBot=new THREE.Mesh(new THREE.SphereGeometry(.22,20,12,0,Math.PI*2,Math.PI/2,Math.PI/2),propC);propBot.rotation.x=Math.PI;propBot.position.y=-.325;prop.add(propBot);
  const valve=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.12,8),new THREE.MeshStandardMaterial({color:0x888,metalness:.8,roughness:.3}));valve.position.y=.36;prop.add(valve);
  prop.position.set(bx0+BL/2-.3,FLOOR+.32,-BW/2-.3);truck.add(prop);
  // safety cones
  for(const [px,pz] of [[BW/2+1.6,-.5],[BW/2+1.6,.5]]){
    const cone=new THREE.Group();cone.add(Object.assign(new THREE.Mesh(new THREE.ConeGeometry(.08,.4,10),new THREE.MeshStandardMaterial({color:0xff5500,roughness:.8})),{castShadow:true}));
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.05,12),new THREE.MeshStandardMaterial({color:0x111,roughness:.9}));base.position.y=-.22;cone.add(base);
    // white reflective stripe
    const stripe=new THREE.Mesh(new THREE.CylinderGeometry(.082,.082,.025,10),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.6,emissive:0xffffff,emissiveIntensity:.3}));stripe.position.y=.05;cone.add(stripe);
    cone.position.set(bx0+WX1+px-BL/2+2.3,FLOOR,pz);truck.add(cone);}
  // customer figure waiting at window
  const custSkin=new THREE.MeshStandardMaterial({color:0xc8956c,roughness:.7});
  const custShirt=new THREE.MeshStandardMaterial({color:0x2a7a3a,roughness:.85}); // green shirt
  const cust=new THREE.Group();
  const ctorso=new THREE.Mesh(new THREE.CylinderGeometry(.22,.2,.58,20),custShirt);ctorso.position.y=.29;cust.add(ctorso);
  const ch=new THREE.Mesh(new THREE.SphereGeometry(.12,20,14),custSkin);ch.position.y=.7;ch.scale.y=1.1;cust.add(ch);
  const cneck=new THREE.Mesh(new THREE.CylinderGeometry(.055,.065,.09,12),custSkin);cneck.position.y=.62;cust.add(cneck);
  // jeans
  for(const sx of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.08,.07,.5,14),new THREE.MeshStandardMaterial({color:0x2a3f6e,roughness:.85}));leg.position.set(sx*.08,0,0);cust.add(leg);}
  cust.position.set(WX0-.15,FLOOR,BW/2+1.05);cust.rotation.y=Math.PI*.8;cust.traverse(o=>o.castShadow=true);truck.add(cust);

  // order sign on counter
  const oc=document.createElement('canvas');oc.width=512;oc.height=200;const o=oc.getContext('2d');o.fillStyle='#e83a73';o.fillRect(0,0,512,200);
  o.fillStyle='#1b1546';o.fillRect(8,8,496,184);o.fillStyle='#ffe03a';o.textAlign='center';o.font='70px "UnifrakturMaguntia"';o.fillText('Order Here',256,95);
  o.font='34px "Great Vibes"';o.fillStyle='#fff';o.fillText('tap to see the menu',256,155);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.6,.235),new THREE.MeshStandardMaterial({map:Object.assign(new THREE.CanvasTexture(oc),{colorSpace:THREE.SRGBColorSpace}),emissive:0x222222}));
  sign.position.set(WX0+.55,WY0+.13,BW/2+.24);sign.rotation.x=-.25;truck.add(sign);
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
  board.add(frame,face);board.position.set(WX1+.08+mbW/2,FLOOR+.25+mbH/2+.15,BW/2+.03);truck.add(board);
  // little spotlight on the board
  const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.03,.06,.12,16),new THREE.MeshStandardMaterial({color:0x111,metalness:.6}));lamp.rotation.x=Math.PI/2.6;
  lamp.position.set(board.position.x,board.position.y+mbH/2+.1,BW/2+.15);truck.add(lamp);
  const spot=new THREE.SpotLight(0xfff2d6,6,3,.7,.5,1.5);spot.position.copy(lamp.position);spot.target=face;truck.add(spot);
  // hover: pulse the board
  done();
  return {board:face,click:[sign,W,counter,face,frame],worker:W,cust};
}
