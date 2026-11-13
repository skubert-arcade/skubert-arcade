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
  function layoutModels(now){
    const {left,top,right,bottom}=viewport.getBoundingClientRect();
    const visible=[];
    const markerNodes=getMarkers(), heads=getHeads();
    for(const h of heads){
      const marker=markerNodes.get(h.id);if(!marker || isCompleted(h.id))continue;
      const b=marker.getBoundingClientRect();
      const inView=b.right>left && b.left<right && b.bottom>top && b.top<bottom;
      marker.dataset.threeVisible='false';
      if(inView)visible.push({h,marker,b});
    }
    visible.slice(0,MAX_VISIBLE_3D).forEach(({h,marker,b},idx)=>{
      const pivot=pool[idx];
      pivot.visible=true;
      const size=Math.min(b.width,b.height);
      const effect=getEffect(h.id,now);
      pivot.scale.setScalar(Math.max(0.001,size/maxDimension*0.90*(effect?.scale??1)));
      const x=(b.left+b.right)*.5-left-lastWidth/2;
      const y=lastHeight/2-((b.top+b.bottom)*.5-top);
      pivot.position.set(x,y,0);
      // Yaw turns left/right around the vertical axis. Pitch tilts up/down
      // around the model's horizontal X axis; YXZ applies yaw before local pitch.
      const yaw=THREE.MathUtils.degToRad(h.rotationDeg)+Math.sin(now*.001)*.06+(effect?.spin??0);
      const pitch=THREE.MathUtils.degToRad(h.pitchDeg||0);
      pivot.rotation.set(pitch,yaw,0,'YXZ');
      marker.dataset.threeVisible='true';
    });
    for(let i=Math.min(MAX_VISIBLE_3D,visible.length);i<pool.length;i++)pool[i].visible=false;
  }
  function animate(now){
    if(disposed)return;
    raf=requestAnimationFrame(animate);
    const capturing=getHeads().some(h=>getEffect(h.id,now));
    if(!refreshPending && now-lastRender<1000/(capturing?60:MAX_RENDER_FPS))return;
    updateViewSize();layoutModels(now);
    renderer.render(scene,camera);
    lastRender=now;refreshPending=false;
  }
  updateViewSize();
  raf=requestAnimationFrame(animate);
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
