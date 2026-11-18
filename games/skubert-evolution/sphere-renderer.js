/**
 * Skubert Evolution - Phase 1 GPU sphere rendering.
 * Original game physics, 3-second auto-drop, score, clipping and effects remain
 * owned by index.html. This module owns only the visual meshes and WebGL canvas.
 * Only Genus has a wrapped silhouette UV texture in this trial. All other
 * materials remain plain colored spheres, as in Phase 1.
 */
import * as THREE from 'three';

const canvas=document.getElementById('sphere-layer');
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const LEVEL_COLORS=[
  '#eaaeea', // Species (pink)
  '#b2adf6', // Genus (purple)
  '#97cbfc', // Family (blue)
  '#a0fbf7', // Order (aqua)
  '#b5fa9d', // Class (green)
  '#fdde89', // Phylum (yellow)
  '#fca571', // Kingdom (orange)
  '#fa9796'  // Domain (salmon)
];

const bridge={ready:false,render,disable};
window.SkubertSphere3D=bridge;
let renderer=null,scene=null,camera=null,geometry=null,materials=[],previewMaterials=[];
let previewMesh=null;
const meshes=new Map();
let width=0,height=0,disabled=false;
const TEXTURED_LEVEL=1; // Genus: Cryptopithecus; single-row proof of concept
let genusTexture=null;

function disable(){
  bridge.ready=false;
  disabled=true;
  if(canvas)canvas.style.display='none';
  for(const mesh of meshes.values())mesh.parent?.remove(mesh);
  meshes.clear();
  previewMesh?.parent?.remove(previewMesh);
}

function loadGenusTexture(){
  const url=new URL('./textures/01-genus.png',import.meta.url);
  new THREE.TextureLoader().load(
    url.href,
    texture=>{
      if(disabled){texture.dispose();return;}
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.wrapS=THREE.RepeatWrapping;
      texture.wrapT=THREE.ClampToEdgeWrapping;
      texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
      texture.needsUpdate=true;
      genusTexture=texture;
      // Important: no second color tint over the baked purple texture.
      for(const material of [materials[TEXTURED_LEVEL],previewMaterials[TEXTURED_LEVEL]]){
        material.color.set(0xffffff);
        material.map=genusTexture;
        material.needsUpdate=true;
      }
      console.info('Skubert Evolution: Genus silhouette texture loaded.');
    },
    undefined,
    error=>{
      console.warn('Skubert Evolution: Genus texture not loaded; using solid purple sphere.',error);
    }
  );
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
    // World-space lighting makes the existing pastel colors look round without
    // real-time shadows or any extra environment-map downloads.
    const hemi=new THREE.HemisphereLight(0xffffff,0xd7daea,1.05);
    scene.add(hemi);
    const key=new THREE.DirectionalLight(0xffffff,2.0);
    key.position.set(-180,280,360);
    scene.add(key);
    const fill=new THREE.DirectionalLight(0xf0f5ff,0.35);
    fill.position.set(270,-150,210);
    scene.add(fill);
    // Only one geometry and eight materials, regardless of sphere count.
    geometry=new THREE.SphereGeometry(1,32,24);
    materials=LEVEL_COLORS.map(color=>new THREE.MeshStandardMaterial({
      color:new THREE.Color(color),roughness:0.34,metalness:0.02
    }));
    previewMaterials=LEVEL_COLORS.map(color=>new THREE.MeshStandardMaterial({
      color:new THREE.Color(color),roughness:0.34,metalness:0.02,
      transparent:true,opacity:0.78,depthWrite:false
    }));
    previewMesh=new THREE.Mesh(geometry,previewMaterials[0]);
    previewMesh.visible=false;
    previewMesh.renderOrder=10;
    scene.add(previewMesh);
    loadGenusTexture();
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

function resize(w,h){
  if(disabled||!renderer)return;
  if(w===width&&h===height)return;
  width=w;height=h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(Math.round(w),Math.round(h),false);
  camera.left=0;camera.right=w;camera.top=h;camera.bottom=0;
  camera.updateProjectionMatrix();
}

function syncMesh(mesh,ball,h){
  mesh.position.set(ball.x,h-ball.y,0);
  const squish=clamp(ball.squish||0,-.22,.27);
  const pulse=ball.pulse>0?1+.1*ball.pulse/.26:1;
  // Mesh scaling is purely visual: collisions remain mathematically circular.
  mesh.scale.set(ball.r*pulse*(1-squish),ball.r*pulse*(1+squish*.7),ball.r*pulse);
  const angle=ball.angle||0;
  if(ball.level===TEXTURED_LEVEL){
    // A small Y-axis tumble exposes the printed motifs around the entire sphere;
    // rotation is still driven ONLY by the existing physics (no idle spinning).
    mesh.rotation.set(angle*.14,angle*.65,angle*.32);
  } else {
    mesh.rotation.set(0,0,angle);
  }
}

function render({balls,preview,width:w,height:h}){
  if(!bridge.ready||disabled||!renderer)return false;
  try {
    resize(w,h);
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
