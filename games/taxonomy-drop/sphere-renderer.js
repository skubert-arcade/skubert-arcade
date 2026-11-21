/**
 * Skubert Evolution - Phase 2 pilot: GPU sphere rendering with texture maps
 * for Genus, Family, Order, and Class. Original physics, timer, clipping and effects remain
 * owned by index.html.
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
const TEXTURE_PATHS={1:'textures/01-genus.png',2:'textures/02-family.png',3:'textures/03-order.png',4:'textures/04-class.png'};

const bridge={ready:false,render,renderDemo,clearDemo,renderNext,disable};
window.SkubertSphere3D=bridge;
let renderer=null,scene=null,camera=null,geometry=null,materials=[],previewMaterials=[];
let previewMesh=null;
const meshes=new Map();
let width=0,height=0,disabled=false;

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
  mesh.scale.set(ball.r*pulse*(1-squish),ball.r*pulse*(1+squish*.7),ball.r*pulse);
  mesh.rotation.set(0,0,ball.angle||0);
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


// The tutorial shares the *actual* live-game mesh geometry, texture maps,
// materials and lighting, but has its own WebGL canvas, scene and camera.
// No preview ball is added to the gameplay scene or physics state.
const tutorialCanvas=document.getElementById('mergeDemo3D');
let tutorialRenderer=null,tutorialScene=null,tutorialCamera=null;
let tutorialWidth=0,tutorialHeight=0,tutorialDisabled=false;
const tutorialMeshes=[];

function initDemo(){
  if(!tutorialCanvas||!bridge.ready||disabled||tutorialDisabled||!geometry)return false;
  try{
    tutorialRenderer=new THREE.WebGLRenderer({
      canvas:tutorialCanvas,alpha:true,antialias:true,powerPreference:'high-performance'
    });
    tutorialRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    tutorialRenderer.setClearColor(0x000000,0);
    tutorialRenderer.toneMapping=THREE.NoToneMapping;
    tutorialRenderer.outputColorSpace=THREE.SRGBColorSpace;
    tutorialRenderer.shadowMap.enabled=false;
    tutorialScene=new THREE.Scene();
    tutorialCamera=new THREE.OrthographicCamera(0,1,1,0,0.1,2000);
    tutorialCamera.position.set(0,0,900);
    tutorialCamera.lookAt(0,0,0);
    // Same lighting rig as init() for the active gameplay spheres.
    const hemi=new THREE.HemisphereLight(0xffffff,0xd7daea,1.05);
    tutorialScene.add(hemi);
    const key=new THREE.DirectionalLight(0xffffff,2.0);
    key.position.set(-180,280,360);
    tutorialScene.add(key);
    const fill=new THREE.DirectionalLight(0xf0f5ff,0.35);
    fill.position.set(270,-150,210);
    tutorialScene.add(fill);
    tutorialCanvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      console.warn('Taxonomy Drop: tutorial WebGL context lost; using 2D fallback.');
      tutorialDisabled=true;
      tutorialCanvas.style.visibility='hidden';
    },{passive:false});
    return true;
  }catch(error){
    console.warn('Taxonomy Drop: tutorial 3D unavailable; using 2D fallback.',error);
    tutorialDisabled=true;
    tutorialCanvas.style.visibility='hidden';
    return false;
  }
}

// Accepts the same ball fields as the live render() API: x/y/r/level/angle/
// squish/squishAxis/pulse. The only extra field is opacity for scripted fades.
function renderDemo({balls,width:w,height:h}){
  if(!bridge.ready||disabled||tutorialDisabled)return false;
  if(!tutorialRenderer && !initDemo())return false;
  if(!tutorialRenderer)return false;
  try{
    if(w!==tutorialWidth||h!==tutorialHeight){
      tutorialWidth=w;tutorialHeight=h;
      tutorialRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      tutorialRenderer.setSize(Math.round(w),Math.round(h),false);
      tutorialCamera.left=0;tutorialCamera.right=w;
      tutorialCamera.top=h;tutorialCamera.bottom=0;
      tutorialCamera.updateProjectionMatrix();
    }
    for(let i=0;i<balls.length;i++){
      const ball=balls[i];
      let mesh=tutorialMeshes[i];
      if(!mesh){
        mesh=new THREE.Mesh(geometry,materials[ball.level]);
        tutorialMeshes[i]=mesh;
        tutorialScene.add(mesh);
      }
      mesh.visible=true;
      // Ordinary demo balls use the SAME material object as live gameplay.
      // For the few fade frames, clone that material to avoid mutating the game.
      const alpha=Math.max(0,Math.min(1,ball.opacity??1));
      if(alpha<.999){
        if(mesh.userData.fadingLevel!==ball.level){
          mesh.userData.fadingMaterial?.dispose();
          mesh.userData.fadingMaterial=materials[ball.level].clone();
          mesh.userData.fadingMaterial.transparent=true;
          mesh.userData.fadingMaterial.depthWrite=false;
          mesh.userData.fadingLevel=ball.level;
        }
        mesh.userData.fadingMaterial.opacity=alpha;
        mesh.material=mesh.userData.fadingMaterial;
      }else{
        mesh.material=materials[ball.level];
      }
      syncMesh(mesh,ball,h);
    }
    for(let i=balls.length;i<tutorialMeshes.length;i++)tutorialMeshes[i].visible=false;
    tutorialRenderer.render(tutorialScene,tutorialCamera);
    tutorialCanvas.style.visibility='visible';
    return true;
  }catch(error){
    console.warn('Taxonomy Drop: tutorial 3D draw failed; using 2D fallback.',error);
    tutorialDisabled=true;
    tutorialCanvas.style.visibility='hidden';
    return false;
  }
}

// Called when instructions close. No physics or timer state is touched.
function clearDemo(){
  if(!tutorialRenderer||tutorialDisabled)return;
  for(const mesh of tutorialMeshes)mesh.visible=false;
  tutorialRenderer.render(tutorialScene,tutorialCamera);
}


// Next-ball station uses the SAME geometry, textured rank materials, lighting,
// and world-to-CSS radius as gameplay, but has no simulation or input handlers.
const nextBallCanvas=document.getElementById('nextBall3D');
let nextBallRenderer=null,nextBallScene=null,nextBallCamera=null,nextBallMesh=null;
let nextBallWidth=0,nextBallHeight=0,nextBallDisabled=false;
function initNextBall(){
  if(!nextBallCanvas||!bridge.ready||disabled||nextBallDisabled||!geometry)return false;
  try{
    nextBallRenderer=new THREE.WebGLRenderer({
      canvas:nextBallCanvas,alpha:true,antialias:true,powerPreference:'low-power'
    });
    nextBallRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    nextBallRenderer.setClearColor(0x000000,0);
    nextBallRenderer.toneMapping=THREE.NoToneMapping;
    nextBallRenderer.outputColorSpace=THREE.SRGBColorSpace;
    nextBallScene=new THREE.Scene();
    nextBallCamera=new THREE.OrthographicCamera(0,1,1,0,0.1,2000);
    nextBallCamera.position.set(0,0,900);
    nextBallCamera.lookAt(0,0,0);
    nextBallScene.add(new THREE.HemisphereLight(0xffffff,0xd7daea,1.05));
    const key=new THREE.DirectionalLight(0xffffff,2.0);
    key.position.set(-180,280,360);
    nextBallScene.add(key);
    const fill=new THREE.DirectionalLight(0xf0f5ff,0.35);
    fill.position.set(270,-150,210);
    nextBallScene.add(fill);
    nextBallMesh=new THREE.Mesh(geometry,materials[0]);
    nextBallScene.add(nextBallMesh);
    nextBallCanvas.addEventListener('webglcontextlost',e=>{
      e.preventDefault();
      nextBallDisabled=true;
      nextBallCanvas.style.visibility='hidden';
    },{passive:false});
    return true;
  }catch(e){
    console.warn('Taxonomy Drop: next-ball 3D preview unavailable.',e);
    nextBallDisabled=true;
    nextBallCanvas.style.visibility='hidden';
    return false;
  }
}
function renderNext({level,radius:r,width:w,height:h}){
  if(!bridge.ready||disabled||nextBallDisabled)return false;
  if(!nextBallRenderer&&!initNextBall())return false;
  try{
    if(w!==nextBallWidth||h!==nextBallHeight){
      nextBallWidth=w;nextBallHeight=h;
      nextBallRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      nextBallRenderer.setSize(Math.round(w),Math.round(h),false);
      nextBallCamera.left=0;nextBallCamera.right=w;
      nextBallCamera.top=h;nextBallCamera.bottom=0;
      nextBallCamera.updateProjectionMatrix();
    }
    nextBallMesh.material=materials[level];
    syncMesh(nextBallMesh,{x:w/2,y:h/2,r,angle:0,squish:0,pulse:0},h);
    nextBallRenderer.render(nextBallScene,nextBallCamera);
    nextBallCanvas.style.visibility='visible';
    return true;
  }catch(error){
    console.warn('Taxonomy Drop: next-ball 3D preview failed; using 2D.',error);
    nextBallDisabled=true;
    nextBallCanvas.style.visibility='hidden';
    return false;
  }
}

init();