// One Three.js/WebGL renderer and one cached GLB for every Skubert tier.
// Physics is still handled by the lightweight 2D game; the visuals do not
// create additional physics engines or renderers per character.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';

const MODEL_PATH='../typing/models/skubert.glb';
const SKUBERT_LEVEL=9;
const MAX_VISIBLE_3D=14;
const RENDER_INTERVAL=1000/45;
const frameArea=document.querySelector('.scene');
const target=document.getElementById('game');
let ready=false,disabled=false;
let renderer,scene,camera,pool=[],dimension=1,root,modelCenter;
let lastW=0,lastH=0,lastDraw=-Infinity;
const shown=new Set();

function initModel(gltf){
  root=gltf.scene;
  const bounds=new THREE.Box3().setFromObject(root);
  if(bounds.isEmpty())throw new Error('Skubert model has no visible geometry');
  const size=bounds.getSize(new THREE.Vector3());
  dimension=Math.max(size.x,size.y,size.z);
  if(!(dimension>0))throw new Error('Invalid model dimensions');
  modelCenter=bounds.getCenter(new THREE.Vector3());
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.0;
  const layer=renderer.domElement;
  layer.id='skubert3d';layer.setAttribute('aria-hidden','true');
  frameArea.appendChild(layer);
  scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x6b7191,2.1));
  const key=new THREE.DirectionalLight(0xffffff,2.0);
  key.position.set(0,150,350);scene.add(key);
  const fill=new THREE.DirectionalLight(0xa4d7ff,.65);
  fill.position.set(-180,-90,200);scene.add(fill);
  camera=new THREE.OrthographicCamera(0,1,1,0,.01,3000);
  camera.position.set(0,0,1000);
  camera.lookAt(0,0,0);
  ready=true;
}
function ensurePool(i){
  while(pool.length<=i){
    const holder=new THREE.Group();
    const model=cloneSkinned(root);
    model.position.sub(modelCenter);
    holder.add(model);
    scene.add(holder);
    holder.visible=false;
    pool.push(holder);
  }
  return pool[i];
}
function resize(w,h){
  if(w===lastW&&h===lastH)return;
  lastW=w;lastH=h;
  renderer.setSize(w,h,false);
  camera.left=0;camera.right=w;camera.top=h;camera.bottom=0;
  camera.updateProjectionMatrix();
}
function render({balls,preview,W,H,left,right,boxTop,floor,time}){
  if(!ready||disabled)return null;
  shown.clear();
  // The queued Skubert must always be visible as a 3D head *before* dropping.
  // Reserve a renderer slot for the preview instead of allowing the pile to
  // exhaust the pool. On small devices, this is still just one WebGL canvas.
  const previewIsSkubert=preview?.level>=SKUBERT_LEVEL;
  const visible=[];
  if(previewIsSkubert)visible.push(preview);
  visible.push(...balls.filter(b=>b.level>=SKUBERT_LEVEL)
    .slice(0,MAX_VISIBLE_3D-(previewIsSkubert?1:0)));
  resize(W,H);
  for(let i=0;i<visible.length;i++){
    const b=visible[i],holder=ensurePool(i);
    holder.visible=true;
    holder.position.set(b.x,H-b.y,0);
    // The same GLB is scaled to each Skubert's collision diameter.
    // Its skeleton and textures are shared by cloned instances.
    const scale=(b.r*2*.88)/dimension;
    const puff=1+Math.max(0,b.pulse||0)*.15;
    holder.scale.setScalar(scale*puff);
    // A held Skubert faces the player and only rocks gently as they aim.
    // Dropped Skuberts continue to rotate with their physical rolling angle.
    holder.rotation.set(0,b.isPreview ? Math.sin(time*1.2)*.09 : Math.sin(time*.8+b.id*.3)*.12,
                         b.isPreview ? 0 : -(b.angle||0));
    if(b.squish){
      const squish=THREE.MathUtils.clamp(b.squish,-.2,.27);
      holder.scale.x*=1-squish;
      holder.scale.y*=1+squish*.65;
    }
    shown.add(b.id);
  }
  for(let i=visible.length;i<pool.length;i++)pool[i].visible=false;
  const now=performance.now();
  if(now-lastDraw>=RENDER_INTERVAL || lastDraw===-Infinity){
    // OpenGL scissor Y origin is bottom-left, while our physics is top-left.
    // Clip 3D Skuberts to the same rectangular playfield as 2D spheres.
    renderer.setScissor(left,H-floor,right-left,floor-boxTop);
    renderer.setScissorTest(true);
    renderer.render(scene,camera);
    lastDraw=now;
  }
  return shown;
}
window.SkubertEvolution3D={render,isReady:()=>ready&&!disabled};
try{
  new GLTFLoader().load(MODEL_PATH,initModel,undefined,err=>{
    disabled=true;
    console.warn('Skubert GLB could not load; using 2D fallback:',err);
    document.getElementById('message').textContent='Skubert 3D unavailable; showing 2D fallback.';
  });
}catch(e){
  disabled=true;
  console.warn('Skubert 3D unavailable:',e);
}
