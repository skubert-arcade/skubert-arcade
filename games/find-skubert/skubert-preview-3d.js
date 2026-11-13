// Optional Placement Mode preview. One renderer/canvas, one GLB load, six reusable
// head clones sharing model geometry and textures. Click targets remain ordinary
// positioned HTML elements and are independent of WebGL.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';

const MAX_VISIBLE_3D=6;
const MAX_RENDER_FPS=30;

export async function createThreePreview({gameEl,viewport,modelPath,getHeads,getMarkers,getEffect=()=>null,isCompleted=()=>false}){
  const gltf=await new GLTFLoader().loadAsync(modelPath);
  const root=gltf.scene;
  const bounds=new THREE.Box3().setFromObject(root);
  if(bounds.isEmpty())throw new Error('GLB has no visible geometry');
  const dimensions=bounds.getSize(new THREE.Vector3());
  const modelCenter=bounds.getCenter(new THREE.Vector3());
  const maxDimension=Math.max(dimensions.x,dimensions.y,dimensions.z);
  if(!Number.isFinite(maxDimension)||maxDimension<=0)throw new Error('Invalid GLB dimensions');

  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'default'});
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.35));
  const canvas=renderer.domElement;
  canvas.className='skubert-shared-webgl';
  canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{
    position:'absolute',inset:'0',height:'100%',width:'100%',
    zIndex:'4',pointerEvents:'none',display:'block'
  });
  gameEl.appendChild(canvas);

  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-300,300,200,-200,.01,3000);
  camera.position.set(0,0,800);camera.lookAt(0,0,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x879ab3,2.25));
  const key=new THREE.DirectionalLight(0xffffff,2.35);key.position.set(150,250,420);scene.add(key);
  const fill=new THREE.DirectionalLight(0xbbd7fb,.7);fill.position.set(-250,-100,230);scene.add(fill);

  // Build a small reusable pool; do not create a renderer or GPU model per head.
  const pool=[];
  for(let i=0;i<MAX_VISIBLE_3D;i++){
    const holder=new THREE.Group();
    const model=cloneSkinned(root);
    model.position.sub(modelCenter);
    holder.add(model);
    holder.visible=false;
    scene.add(holder);pool.push(holder);
  }
  let disposed=false,lastRender=0,lastWidth=0,lastHeight=0,raf=0;
  let refreshPending=true;

  function updateViewSize(){
    const w=Math.max(1,gameEl.clientWidth),h=Math.max(1,gameEl.clientHeight);
    if(w!==lastWidth||h!==lastHeight){
      lastWidth=w;lastHeight=h;
      renderer.setSize(w,h,false);
      camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;
      camera.updateProjectionMatrix();refreshPending=true;
    }
  }
  // Collect visible heads without changing their placeholder state yet. The
  // canvas is drawn first, then we hide PNGs for heads we actually rendered.
  function layoutModels(now){
    const {left,top,right,bottom}=viewport.getBoundingClientRect();
    const visible=[];
    const markerNodes=getMarkers(), heads=getHeads();
    for(const h of heads){
      const marker=markerNodes.get(h.id);
      if(!marker || isCompleted(h.id))continue;
      const b=marker.getBoundingClientRect();
      if(b.right>left && b.left<right && b.bottom>top && b.top<bottom)visible.push({h,marker,b});
    }
    const renderedIds=new Set();
    const inPool=visible.slice(0,MAX_VISIBLE_3D);
    inPool.forEach(({h,b},idx)=>{
      const pivot=pool[idx];
      pivot.visible=true;
      const size=Math.min(b.width,b.height);
      const effect=getEffect(h.id,now);
      pivot.scale.setScalar(Math.max(0.001,size/maxDimension*0.90*(effect?.scale??1)));
      const x=(b.left+b.right)*.5-left-lastWidth/2;
      const y=lastHeight/2-((b.top+b.bottom)*.5-top);
      pivot.position.set(x,y,0);
      const yaw=THREE.MathUtils.degToRad(h.rotationDeg)+Math.sin(now*.001)*.06+(effect?.spin??0);
      const pitch=THREE.MathUtils.degToRad(h.pitchDeg||0);
      pivot.rotation.set(pitch,yaw,0,'YXZ');
      renderedIds.add(h.id);
    });
    for(let i=inPool.length;i<pool.length;i++)pool[i].visible=false;
    return renderedIds;
  }
  function commitVisibility(renderedIds){
    // Update only if visibility ACTUALLY changes. The old code set false then
    // true every frame; transitions could make the PNG appear to flicker.
    for(const [id,marker] of getMarkers()){
      const next=renderedIds.has(id)?'true':'false';
      if(marker.dataset.threeVisible!==next)marker.dataset.threeVisible=next;
    }
  }
  let firstFrameResolve,firstFrameReject;
  const firstFrame=new Promise((resolve,reject)=>{firstFrameResolve=resolve;firstFrameReject=reject});
  function animate(now){
    if(disposed)return;
    raf=requestAnimationFrame(animate);
    const capturing=getHeads().some(h=>getEffect(h.id,now));
    if(!refreshPending && now-lastRender<1000/(capturing?60:MAX_RENDER_FPS))return;
    try{
      updateViewSize();
      const renderedIds=layoutModels(now);
      renderer.render(scene,camera);
      // A successful WebGL frame precedes PNG removal.
      commitVisibility(renderedIds);
      lastRender=now;refreshPending=false;
      if(firstFrameResolve){firstFrameResolve();firstFrameResolve=null;firstFrameReject=null;}
    }catch(error){
      if(firstFrameReject){firstFrameReject(error);firstFrameResolve=null;firstFrameReject=null;}
      disposed=true;cancelAnimationFrame(raf);commitVisibility(new Set());
      renderer.dispose();canvas.remove();
      console.error('3D Skubert render failed; falling back to PNG images.',error);
    }
  }
  updateViewSize();
  raf=requestAnimationFrame(animate);
  // Do not mark the renderer "ready" before the first actual successful frame.
  await firstFrame;
  return {
    refresh(){refreshPending=true;},
    dispose(){
      if(disposed)return;disposed=true;
      cancelAnimationFrame(raf);
      for(const m of getMarkers().values())m.dataset.threeVisible='false';
      for(const obj of pool){scene.remove(obj);}
      renderer.dispose();canvas.remove();
    }
  };
}
