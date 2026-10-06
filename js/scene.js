// scene.js — renderer, camera, Arizona sky/sun, asphalt lot, trees, click handling and the
// animation loop. Imports the truck from truck.js and the ordering UI from shop.js.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {CONFIG,MENU,money,open,hooks} from './shop.js';
import {buildTruck,WX0,WX1,WY0,WY1} from './truck.js';

const canvas=document.getElementById('c');
const R=new THREE.WebGLRenderer({canvas,antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(innerWidth,innerHeight);
R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=1.05;R.outputColorSpace=THREE.SRGBColorSpace;
const S=new THREE.Scene();
S.environment=new THREE.PMREMGenerator(R).fromScene(new RoomEnvironment(),0.04).texture;
export const cam=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.1,400);
// distance needed so a span of 2*halfW meters fits across the screen (phones in portrait need to stand back)
const fitDist=(halfW,minD)=>{const hf=Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov/2))*cam.aspect);return Math.max(minD,halfW/Math.tan(hf));};
const portrait=()=>cam.aspect<1;
if(portrait()) cam.position.set(-1.55,1.9,fitDist(2.7,7.8)); else cam.position.set(-1.6,1.7,7.8);
const ctl=new OrbitControls(cam,canvas);ctl.target.set(portrait()?-1.55:-2.1,1.6,0);ctl.enableDamping=true;
ctl.minDistance=2.2;ctl.maxDistance=20;ctl.maxPolarAngle=Math.PI*0.495;

// sky dome — Arizona midday with cirrus haze and distant mountains
const skyC=document.createElement('canvas');skyC.width=1024;skyC.height=512;
{const g=skyC.getContext('2d');
 // gradient from deep blue zenith → pale azure horizon → sandy haze
 const gr=g.createLinearGradient(0,0,0,512);gr.addColorStop(0,'#1a5cc4');gr.addColorStop(.25,'#3f8fd8');gr.addColorStop(.6,'#7bbde8');gr.addColorStop(.8,'#c8dfe8');gr.addColorStop(1,'#ddd0b0');
 g.fillStyle=gr;g.fillRect(0,0,1024,512);
 // distant desert mountain silhouette
 g.fillStyle='rgba(160,140,110,.35)';g.beginPath();g.moveTo(0,430);
 const mpts=[[0,430],[120,388],[200,400],[310,370],[400,380],[480,360],[560,375],[650,355],[720,368],[800,385],[900,365],[950,375],[1024,390],[1024,512],[0,512]];
 for(const [mx,my] of mpts)g.lineTo(mx,my);g.fill();
 // wispy cirrus clouds
 g.globalAlpha=.55;g.filter='blur(6px)';
 for(const [cx,cy,w,h] of [[180,90,280,22],[450,60,200,16],[700,110,320,18],[900,80,180,14],[120,140,150,12],[600,50,130,10]]){
   const cr=g.createRadialGradient(cx,cy,0,cx,cy,w/2);cr.addColorStop(0,'rgba(255,255,255,.9)');cr.addColorStop(.6,'rgba(255,255,255,.4)');cr.addColorStop(1,'rgba(255,255,255,0)');
   g.fillStyle=cr;g.beginPath();g.ellipse(cx,cy,w/2,h,0,0,Math.PI*2);g.fill();}
 g.filter='none';g.globalAlpha=1;}
const skyT=new THREE.CanvasTexture(skyC);skyT.colorSpace=THREE.SRGBColorSpace;
S.add(new THREE.Mesh(new THREE.SphereGeometry(200,32,20),new THREE.MeshBasicMaterial({map:skyT,side:THREE.BackSide,fog:false})));
S.fog=new THREE.FogExp2(0xccc5b0,0.006);

// lights (Arizona midday sun — harsh overhead with warm bounce)
S.add(new THREE.HemisphereLight(0xb8d4f0,0x9e8858,1.1));
const sun=new THREE.DirectionalLight(0xfff5e0,3.2);sun.position.set(6,18,8);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-14,right:14,top:14,bottom:-14});sun.shadow.bias=-0.0003;sun.shadow.normalBias=0.02;S.add(sun);
// soft fill from the service-window side (reflected off the ground/lot)
const fill=new THREE.DirectionalLight(0xf0e8d8,0.55);fill.position.set(-4,3,9);S.add(fill);
// warm ambient bounce from street heat
const amb=new THREE.AmbientLight(0xffe4b0,0.28);S.add(amb);

const TL=new THREE.TextureLoader();let pending=0;
const tex=(f,rep)=>{pending++;const t=TL.load('tex/'+f,()=>{if(--pending===0)done();});t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;if(rep){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...rep);}return t;};
const img=f=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='tex/'+f;});
function done(){const l=document.getElementById('load');if(!l)return;l.style.opacity=0;setTimeout(()=>l.remove(),700);}

// ground: asphalt parking lot with painted lines and gravel border
const aspC=document.createElement('canvas');aspC.width=aspC.height=1024;
{const g=aspC.getContext('2d');
 g.fillStyle='#2a2926';g.fillRect(0,0,1024,1024);
 // asphalt aggregate noise
 for(let i=0;i<18000;i++){const x=Math.random()*1024,y=Math.random()*1024,r=Math.random()*2.5+.5,v=Math.floor(Math.random()*40)+20;g.fillStyle=`rgba(${v+80},${v+70},${v+60},.18)`;g.beginPath();g.arc(x,y,r,0,7);g.fill();}
 // tar cracks
 g.strokeStyle='rgba(0,0,0,.45)';g.lineWidth=1.2;
 for(let i=0;i<8;i++){g.beginPath();let cx=100+Math.random()*800,cy=100+Math.random()*800;g.moveTo(cx,cy);for(let j=0;j<6;j++){cx+=Math.random()*60-30;cy+=Math.random()*60-30;g.lineTo(cx,cy);}g.stroke();}
 // faded yellow parking stripes
 g.strokeStyle='rgba(240,220,60,.22)';g.lineWidth=18;
 for(let x=80;x<1024;x+=120){g.beginPath();g.moveTo(x,0);g.lineTo(x,1024);g.stroke();}
}
const aspT=new THREE.CanvasTexture(aspC);aspT.wrapS=aspT.wrapT=THREE.RepeatWrapping;aspT.repeat.set(8,8);aspT.anisotropy=16;aspT.colorSpace=THREE.SRGBColorSpace;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardMaterial({map:aspT,roughness:.92,metalness:.04,envMapIntensity:.3}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;S.add(ground);
// gravel/dirt strip behind the truck
const grav=tex('gravel.jpg',[12,12]);
const gravel=new THREE.Mesh(new THREE.PlaneGeometry(20,10),new THREE.MeshStandardMaterial({map:grav,roughness:1}));
gravel.rotation.x=-Math.PI/2;gravel.position.set(-2,.001,-7);gravel.receiveShadow=true;S.add(gravel);

await document.fonts.ready.catch(()=>{});
pending++;
const T=await buildTruck(S,{img,done,MENU,money});
const CLICK=T.click;

// scenery: palo verde style trees
const trunk=new THREE.MeshStandardMaterial({color:0x6f8a3a,roughness:.9}),leaf=new THREE.MeshStandardMaterial({color:0x7aa04a,roughness:1});
for(const [x,z,s] of [[-11,-7,1.3],[9,-9,1.1],[-14,6,1],[15,4,1.4],[2,-14,1.2]]){
  const t=new THREE.Group();const tr=new THREE.Mesh(new THREE.CylinderGeometry(.12*s,.18*s,2.2*s,8),trunk);tr.position.y=1.1*s;t.add(tr);
  for(let i=0;i<7;i++){const b=new THREE.Mesh(new THREE.IcosahedronGeometry((.9+Math.random()*.6)*s,1),leaf);b.position.set((Math.random()-.5)*2.4*s,2.4*s+Math.random()*s,(Math.random()-.5)*2.4*s);t.add(b);}
  t.position.set(x,0,z);t.traverse(o=>o.castShadow=true);S.add(t);}

// ---------- interaction ----------
const ray=new THREE.Raycaster(),m2=new THREE.Vector2();
canvas.addEventListener('click',e=>{m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
  if(ray.intersectObjects(CLICK,true).length){open('menu');goWindow();}});
canvas.addEventListener('pointermove',e=>{m2.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(m2,cam);
  const hit=ray.intersectObjects(CLICK,true).length>0;canvas.style.cursor=hit?'pointer':'';T.board.material.emissiveIntensity=hit?.8:.55;});
let fly=null;
function flyTo(p,t,ms=1400){fly={p0:cam.position.clone(),t0:ctl.target.clone(),p,t,s:performance.now(),ms};}
hooks.goWindow=goWindow;
function goWindow(){   // frame the service window + menu board
  if(portrait()) flyTo(new THREE.Vector3(-1.55,1.9,fitDist(2.4,4.6)),new THREE.Vector3(-1.55,1.9,0));
  else flyTo(new THREE.Vector3(-2.1,1.8,4.6),new THREE.Vector3(-2.1,1.9,0));}
let tour=false;document.getElementById('tour').onclick=()=>{tour=!tour;ctl.autoRotate=tour;ctl.autoRotateSpeed=1.2;document.getElementById('tour').textContent=tour?'Stop Tour':'Walk Around';};
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);});
const clock=new THREE.Clock();
R.setAnimationLoop(()=>{const t=clock.getElapsedTime();
  if(fly){const k=Math.min(1,(performance.now()-fly.s)/fly.ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;cam.position.lerpVectors(fly.p0,fly.p,e);ctl.target.lerpVectors(fly.t0,fly.t,e);if(k>=1)fly=null;}
  {const w=T.worker;w.children[1].rotation.y=Math.sin(t*.7)*.25;w.position.y=WY0-.12+Math.sin(t*1.6)*.006;}
  {T.cust.rotation.y=Math.PI*.8+Math.sin(t*.4)*.06;}
  ctl.update();R.render(S,cam);});
