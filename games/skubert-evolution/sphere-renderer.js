/**
 * Skubert Evolution - Phase 2 pilot: GPU sphere rendering with texture maps
 * for all eight ranks. A fixed virtual world separates physics from the
 * responsive WebGL display. Original physics, timer, clipping and effects remain
 * owned by index.html.
 */
import * as THREE from 'three';

const canvas=document.getElementById('sphere-layer');
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const LEVEL_COLORS=[
  '#ea7dea', // Species (pink)
  '#7d75f6', // Genus (purple)
  '#50a8fc', // Family (blue)
  '#5efbf4', // Order (aqua)
  '#83fa5a', // Class (green)
  '#fdc93a', // Phylum (yellow)
  '#fc6c16', // Kingdom (orange)
  '#fa514f'  // Domain (salmon)
];
const TEXTURE_PATHS={0:'textures/00-species.png',1:'textures/01-genus.png',2:'textures/02-family.png',3:'textures/03-order.png',4:'textures/04-class.png',5:'textures/05-phylum.png',6:'textures/06-kingdom.png',7:'textures/07-domain.png'};

const bridge={ready:false,render,disable};
window.SkubertSphere3D=bridge;
let renderer=null,scene=null,camera=null,geometry=null,materials=[],previewMaterials=[];
let previewMesh=null;
const meshes=new Map();
let width=0,height=0,worldWidth=0,worldHeight=0,renderDpr=0,disabled=false;

function buildMaterial(color,map,preview=false){
  return new THREE.MeshStandardMaterial({
    color:map ? new THREE.Color(0xffffff) : new THREE.Color(color),
    roughness:0.34,metalness:0.02,
    map: map || null,
    transparent: preview,
    opacity: preview ? 0.82 : 1,
    depthWrite: preview ? false : true
  });
}

function disable(){
  bridge.ready=false;
  disabled=true;
  if(canvas)canvas.style.display='none';
  for(const mesh of meshes.values())mesh.parent?.remove(mesh);
  meshes.clear();
  previewMesh?.parent?.remove(previewMesh);
}

function loadTextures(loader){
  const arr=new Array(LEVEL_COLORS.length).fill(null);
  for(const [level,path] of Object.entries(TEXTURE_PATHS)){
    try{
      const tex=loader.load(path);
      tex.colorSpace=THREE.SRGBColorSpace;
      tex.wrapS=THREE.RepeatWrapping;
      tex.wrapT=THREE.ClampToEdgeWrapping;
      tex.minFilter=THREE.LinearMipmapLinearFilter;
      tex.magFilter=THREE.LinearFilter;
      arr[Number(level)]=tex;
    }catch(err){
      console.warn('Texture load failed for',path,err);
    }
  }
  return arr;
}

function init(){
  if(!canvas)return;
  try {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x000000,0);
    renderer.toneMapping=THREE.NoToneMapping;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.shadowMap.enabled=false;
    scene=new THREE.Scene();
    camera=new THREE.OrthographicCamera(0,1,1,0,0.1,2000);
    camera.position.set(0,0,900);
    camera.lookAt(0,0,0);
    const hemi=new THREE.HemisphereLight(0xffffff,0xd7daea,1.05);
    scene.add(hemi);
    const key=new THREE.DirectionalLight(0xffffff,2.0);
    key.position.set(-180,280,360);
    scene.add(key);
    const fill=new THREE.DirectionalLight(0xf0f5ff,0.35);
    fill.position.set(270,-150,210);
    scene.add(fill);
    geometry=new THREE.SphereGeometry(1,32,24);
    const loader=new THREE.TextureLoader();
    const maps=loadTextures(loader);
    materials=LEVEL_COLORS.map((color,level)=>buildMaterial(color,maps[level],false));
    previewMaterials=LEVEL_COLORS.map((color,level)=>buildMaterial(color,maps[level],true));
    previewMesh=new THREE.Mesh(geometry,previewMaterials[0]);
    previewMesh.visible=false;
    previewMesh.renderOrder=10;
    scene.add(previewMesh);
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      console.warn('Skubert Evolution: WebGL context lost; reverting to 2D.');
      disable();
    },{passive:false});
    bridge.ready=true;
  } catch(err) {
    console.warn('Skubert Evolution: cannot initialize Three.js; using 2D.',err);
    disable();
  }
}

function resize(worldW,worldH,cssW,cssH){
  if(disabled||!renderer)return;
  const displayW=Math.max(1,Math.round(cssW||worldW));
  const displayH=Math.max(1,Math.round(cssH||worldH));
  const dpr=Math.min(window.devicePixelRatio||1,2);
  if(displayW===width && displayH===height &&
     worldW===worldWidth && worldH===worldHeight && dpr===renderDpr)return;
  width=displayW;height=displayH;
  worldWidth=worldW;worldHeight=worldH;renderDpr=dpr;
  // CSS size changes the canvas resolution but never the virtual world.
  renderer.setPixelRatio(dpr);
  renderer.setSize(displayW,displayH,false);
  camera.left=0;camera.right=worldW;camera.top=worldH;camera.bottom=0;
  camera.updateProjectionMatrix();
}

function syncMesh(mesh,ball,h){
  mesh.position.set(ball.x,h-ball.y,0);
  const squish=clamp(ball.squish||0,-.22,.27);
  const pulse=ball.pulse>0?1+.1*ball.pulse/.26:1;
  mesh.scale.set(ball.r*pulse*(1-squish),ball.r*pulse*(1+squish*.7),ball.r*pulse);
  mesh.rotation.set(0,0,ball.angle||0);
}

function render({balls,preview,width:w,height:h,displayWidth,displayHeight}){
  if(!bridge.ready||disabled||!renderer)return false;
  try {
    resize(w,h,displayWidth,displayHeight);
    const liveIds=new Set();
    for(const ball of balls){
      liveIds.add(ball.id);
      let mesh=meshes.get(ball.id);
      if(!mesh){
        mesh=new THREE.Mesh(geometry,materials[ball.level]);
        mesh.userData.level=ball.level;
        meshes.set(ball.id,mesh);
        scene.add(mesh);
      }else if(mesh.userData.level!==ball.level){
        mesh.material=materials[ball.level];
        mesh.userData.level=ball.level;
      }
      syncMesh(mesh,ball,h);
    }
    for(const [id,mesh] of meshes){
      if(!liveIds.has(id)){
        scene.remove(mesh);
        meshes.delete(id);
      }
    }
    previewMesh.visible=Boolean(preview);
    if(preview){
      previewMesh.material=previewMaterials[preview.level];
      syncMesh(previewMesh,preview,h);
    }
    renderer.render(scene,camera);
    return true;
  } catch(err) {
    console.warn('Skubert Evolution: 3D draw failed; reverting to 2D.',err);
    disable();
    return false;
  }
}

init();
