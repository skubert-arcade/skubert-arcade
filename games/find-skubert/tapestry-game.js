(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const gameEl = $('game'), viewport = $('viewport'), strip = $('strip');
  const seek = $('seek'), panelEl = $('placementPanel');
  // Source dimensions come from the actual 9 PNGs in the uploaded ZIP.
  // Tiles are lossless and keep original alpha; no scaling was applied to the files.
  const ROWS = [{"width":4800,"height":370,"tiles":[{"file":"tapestry-01-01.webp","width":960},{"file":"tapestry-01-02.webp","width":960},{"file":"tapestry-01-03.webp","width":960},{"file":"tapestry-01-04.webp","width":960},{"file":"tapestry-01-05.webp","width":960}]},{"width":4800,"height":375,"tiles":[{"file":"tapestry-02-01.webp","width":960},{"file":"tapestry-02-02.webp","width":960},{"file":"tapestry-02-03.webp","width":960},{"file":"tapestry-02-04.webp","width":960},{"file":"tapestry-02-05.webp","width":960}]},{"width":4799,"height":367,"tiles":[{"file":"tapestry-03-01.webp","width":960},{"file":"tapestry-03-02.webp","width":960},{"file":"tapestry-03-03.webp","width":960},{"file":"tapestry-03-04.webp","width":960},{"file":"tapestry-03-05.webp","width":959}]},{"width":4775,"height":372,"tiles":[{"file":"tapestry-04-01.webp","width":960},{"file":"tapestry-04-02.webp","width":960},{"file":"tapestry-04-03.webp","width":960},{"file":"tapestry-04-04.webp","width":960},{"file":"tapestry-04-05.webp","width":935}]},{"width":4800,"height":369,"tiles":[{"file":"tapestry-05-01.webp","width":960},{"file":"tapestry-05-02.webp","width":960},{"file":"tapestry-05-03.webp","width":960},{"file":"tapestry-05-04.webp","width":960},{"file":"tapestry-05-05.webp","width":960}]},{"width":4800,"height":369,"tiles":[{"file":"tapestry-06-01.webp","width":960},{"file":"tapestry-06-02.webp","width":960},{"file":"tapestry-06-03.webp","width":960},{"file":"tapestry-06-04.webp","width":960},{"file":"tapestry-06-05.webp","width":960}]},{"width":4800,"height":365,"tiles":[{"file":"tapestry-07-01.webp","width":960},{"file":"tapestry-07-02.webp","width":960},{"file":"tapestry-07-03.webp","width":960},{"file":"tapestry-07-04.webp","width":960},{"file":"tapestry-07-05.webp","width":960}]},{"width":4784,"height":360,"tiles":[{"file":"tapestry-08-01.webp","width":960},{"file":"tapestry-08-02.webp","width":960},{"file":"tapestry-08-03.webp","width":960},{"file":"tapestry-08-04.webp","width":960},{"file":"tapestry-08-05.webp","width":944}]},{"width":4783,"height":331,"tiles":[{"file":"tapestry-09-01.webp","width":960},{"file":"tapestry-09-02.webp","width":960},{"file":"tapestry-09-03.webp","width":960},{"file":"tapestry-09-04.webp","width":960},{"file":"tapestry-09-05.webp","width":943}]}];
  const EDITOR_MODE = new URLSearchParams(location.search).get('place') === '1';
  const DRAFT_KEY = 'skubert-tapestry-placements-v1';
  const PLACEHOLDER = 'assets/skubert-preview.png';
  const MODEL_FILE = '../typing/models/skubert.glb';
  const SCROLL_SPEED = 295;
  const panels = [], markers = new Map(), images = [];
  let heads = [], selectedId = null, auto = false, lastFrame = 0;
  let draggingPan = null, draggingHead = null, three = null, threeBusy = false;
  let debounceSave = 0, timerMessage = 0;
  const undoStack = [];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (v, n = 3) => Number(v.toFixed(n));
  const totalScroll = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const isForm = el => ['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(el?.tagName);

  function toast(message, error=false) {
    const el=$('status');el.hidden=false;el.textContent=message;el.classList.toggle('error', error);
    clearTimeout(timerMessage);timerMessage=setTimeout(()=>{el.hidden=true},3500);
  }
  function serializable(){
    return {
      version: 1, coordinateSystem: 'row-percent',
      notes: 'scene is 1–9. xPercent/yPercent are relative to that scene. sizePercent is percent of displayed tapestry height. rotationDeg is yaw; pitchDeg is tilt around the horizontal X axis (negative = up, positive = down).',
      heads: heads.map(h=>({...h}))
    };
  }
  const formattedJson=()=>JSON.stringify(serializable(),null,2)+'\n';
  function saveDraft(){
    if(!EDITOR_MODE)return;
    clearTimeout(debounceSave);
    debounceSave=setTimeout(()=>{
      try{localStorage.setItem(DRAFT_KEY,JSON.stringify(serializable()))}
      catch(e){console.warn('Could not save placement draft',e);}
    },180);
  }
  function remember(){
    undoStack.push(JSON.stringify(heads));
    if(undoStack.length>60)undoStack.shift();
    $('undo').disabled=false;
  }
  function normalizeHead(h,i,seen){
    if(typeof h!=='object' || !h) return null;
    const scene=Number(h.scene),xp=Number(h.xPercent),yp=Number(h.yPercent);
    if(!Number.isInteger(scene)||scene<1||scene>ROWS.length || !Number.isFinite(xp)||!Number.isFinite(yp)) return null;
    let id = String(h.id||`skubert-${i+1}`).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,36) || `skubert-${i+1}`;
    while(seen.has(id))id=`${id}-${i+1}`;
    seen.add(id);
    const size=Number(h.sizePercent), rot=Number(h.rotationDeg), pitch=Number(h.pitchDeg), pts=Number(h.points);
    return {
      id,scene,
      xPercent:round(clamp(xp,0,100)),yPercent:round(clamp(yp,0,100)),
      sizePercent:round(Number.isFinite(size)?clamp(size,2,27):9,2),
      rotationDeg:round(Number.isFinite(rot)?clamp(rot,-180,180):0,1),
      pitchDeg:round(Number.isFinite(pitch)?clamp(pitch,-85,85):0,1),
      points:Number.isFinite(pts)?Math.round(clamp(pts,1,9999)):100
    };
  }
  function parseLocations(raw){
    const list=Array.isArray(raw)?raw:raw?.heads;
    if(!Array.isArray(list))throw new Error('Expected an array of heads or an object containing "heads".');
    const seen=new Set();let skipped=0;
    const result=list.map((obj,i)=>{const h=normalizeHead(obj,i,seen);if(!h)skipped++;return h}).filter(Boolean);
    if(skipped)console.warn(`Skipped ${skipped} invalid locations.`);
    return result;
  }
  async function loadLocations(){
    try {
      const resp=await fetch('./skubert-locations.json',{cache:'no-cache'});
      if(resp.ok)heads=parseLocations(await resp.json());
    } catch(e) {console.info('Default placement file unavailable; starting empty.',e.message);}
    if(EDITOR_MODE){
      try {
        const draft=localStorage.getItem(DRAFT_KEY);
        if(draft)heads=parseLocations(JSON.parse(draft));
      } catch(e){console.warn('Could not read local draft',e);}
    }
    renderMarkers();
    if(EDITOR_MODE)toast('Placement Mode active — click the tapestry to add a head.');
  }

  function buildStrip(){
    ROWS.forEach((row,idx)=>{
      const p=document.createElement('section');p.className='scene';p.dataset.scene=idx+1;
      p.setAttribute('aria-label',`Tapestry section ${idx+1} of ${ROWS.length}`);
      for(let t=0;t<row.tiles.length;t++){
        const tileData=row.tiles[t];
        const tile=document.createElement('div');tile.className='tile';
        const img=document.createElement('img');img.alt='';img.draggable=false;
        img.width=tileData.width;img.height=row.height;img.decoding='async';
        img.dataset.src=`assets/${tileData.file}`;
        tile.appendChild(img);p.appendChild(tile);
        images.push({tile,img,rowHeight:row.height,nativeWidth:tileData.width});
      }
      const layer=document.createElement('div');layer.className='character-layer';p.appendChild(layer);
      strip.appendChild(p);panels.push({node:p,layer,source:row});
    });
  }
  function layoutTiles(){
    // Each image is shown at exactly the same height as the viewport, retaining
    // its own natural aspect ratio and all alpha-margin pixels, without cropping.
    const h=viewport.clientHeight, previousMax=totalScroll();
    const oldFraction=previousMax?viewport.scrollLeft/previousMax:0;
    for(const item of images)item.tile.style.width=`${h*item.nativeWidth/item.rowHeight}px`;
    viewport.scrollLeft=oldFraction*totalScroll();
    for(const h of heads)updateMarkerPlacement(h);
    updateProgress();scheduleImageWindow();
    if(three)three.refresh();
  }
  function updateImageWindow(){
    windowQueued=false;
    const rect=viewport.getBoundingClientRect();
    const preload=Math.max(1050,viewport.clientWidth*1.4);
    const unload=Math.max(3000,viewport.clientWidth*3.2);
    for(const item of images){
      const r=item.tile.getBoundingClientRect();
      const nearby=r.right>=rect.left-preload && r.left<=rect.right+preload;
      const distant=r.right<rect.left-unload || r.left>rect.right+unload;
      if(nearby && !item.img.hasAttribute('src'))item.img.src=item.img.dataset.src;
      else if(distant && item.img.hasAttribute('src'))item.img.removeAttribute('src');
    }
  }
  let windowQueued=false;
  function scheduleImageWindow(){
    if(!windowQueued){windowQueued=true;requestAnimationFrame(updateImageWindow);}
  }

  function markerHead(id){return heads.find(h=>h.id===id)}
  function updateMarkerPlacement(h){
    const marker=markers.get(h.id);if(!marker)return;
    const target=panels[h.scene-1];
    if(marker.parentElement!==target.layer)target.layer.appendChild(marker);
    marker.style.left=`${h.xPercent}%`;
    marker.style.top=`${h.yPercent}%`;
    const size=viewport.clientHeight*h.sizePercent/100;
    marker.style.width=`${size}px`;
    marker.style.height=`${size}px`;
    marker.style.setProperty('--marker-rotation',`${h.rotationDeg}deg`);
    marker.style.setProperty('--marker-pitch',`${h.pitchDeg||0}deg`);
    marker.classList.toggle('selected',EDITOR_MODE&&h.id===selectedId);
    marker.title=EDITOR_MODE?`${h.id} — drag to reposition`:'Skubert preview';
  }
  function renderMarkers(){
    for(const marker of markers.values())marker.remove();
    markers.clear();
    for(const h of heads){
      const marker=document.createElement('button');marker.className='skubert-marker';
      marker.type='button';marker.dataset.headId=h.id;
      marker.setAttribute('aria-label',`Skubert head at scene ${h.scene}, ${Math.round(h.xPercent)} percent`);
      const img=document.createElement('img');img.src=PLACEHOLDER;img.alt='';img.draggable=false;
      marker.appendChild(img);
      marker.addEventListener('pointerdown',e=>{
        e.stopPropagation();
        if(!EDITOR_MODE)return;
        setSelected(h.id);
        remember();
        draggingHead={id:h.id,startX:e.clientX,startY:e.clientY,startScene:h.scene,changed:false};
        setAuto(false);
        try{marker.setPointerCapture(e.pointerId);}catch(_){}
      });
      marker.addEventListener('pointermove',e=>{
        if(!draggingHead || draggingHead.id!==h.id || !EDITOR_MODE)return;
        const current=markerHead(h.id);if(!current)return;
        if(Math.hypot(e.clientX-draggingHead.startX,e.clientY-draggingHead.startY)>2)draggingHead.changed=true;
        const point=positionFromPointer(e.clientX,e.clientY);
        if(point && point.scene===current.scene){
          current.xPercent=point.xPercent;current.yPercent=point.yPercent;
          updateMarkerPlacement(current);
          updateSelectedDisplay();
        }
      });
      marker.addEventListener('pointerup',e=>{
        if(!draggingHead || draggingHead.id!==h.id)return;
        const current=markerHead(h.id);
        const point=positionFromPointer(e.clientX,e.clientY);
        if(current&&point&&draggingHead.changed){
          Object.assign(current,{scene:point.scene,xPercent:point.xPercent,yPercent:point.yPercent});
          updateMarkerPlacement(current);updateSelectedDisplay();saveDraft();
        }else{
          // Do not add undo history when merely selecting an existing marker.
          undoStack.pop();$('undo').disabled=undoStack.length===0;
        }
        draggingHead=null;
        e.stopPropagation();
      });
      marker.addEventListener('pointercancel',()=>{draggingHead=null;});
      marker.addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        if(EDITOR_MODE)setSelected(h.id);
      });
      markers.set(h.id,marker);
      updateMarkerPlacement(h);
    }
    updateSelectedDisplay();
    if(three)three.refresh();
  }
  function positionFromPointer(clientX,clientY){
    const box=viewport.getBoundingClientRect();
    if(clientY<box.top||clientY>box.bottom)return null;
    const worldX=viewport.scrollLeft+clientX-box.left;
    for(const item of panels){
      const p=item.node;
      if(worldX>=p.offsetLeft-0.5 && worldX<=p.offsetLeft+p.offsetWidth+0.5){
        return {
          scene:Number(p.dataset.scene),
          xPercent:round(clamp((worldX-p.offsetLeft)/p.offsetWidth*100,0,100)),
          yPercent:round(clamp((clientY-box.top)/box.height*100,0,100))
        };
      }
    }
    return null;
  }
  function setSelected(id){selectedId=id;updateSelectedDisplay();for(const h of heads)updateMarkerPlacement(h)}
  function updateSelectedDisplay(){
    $('headCount').textContent=`${heads.length} head${heads.length===1?'':'s'} placed`;
    const h=markerHead(selectedId);
    $('selectedControls').hidden=!h;
    $('selectedInfo').textContent=h?`${h.id} · scene ${h.scene} · x ${h.xPercent}% · y ${h.yPercent}%`:'Select a head or click the tapestry to add one.';
    if(!h)return;
    $('headSize').value=h.sizePercent;$('headSizeOut').textContent=h.sizePercent+'%';
    $('headYaw').value=h.rotationDeg;$('headYawOut').textContent=h.rotationDeg+'°';
    $('headPitch').value=h.pitchDeg||0;
    $('headPitchOut').textContent=h.pitchDeg<0?`${Math.abs(h.pitchDeg)}° · up`:h.pitchDeg>0?`${h.pitchDeg}° · down`:'0° · level';
    $('headPoints').value=h.points;
  }
  function addHead(position){
    if(!position)return;
    remember();
    let n=1;while(heads.some(h=>h.id===`skubert-${String(n).padStart(2,'0')}`))n++;
    const h={id:`skubert-${String(n).padStart(2,'0')}`,...position,sizePercent:9,rotationDeg:0,pitchDeg:0,points:100};
    heads.push(h);selectedId=h.id;renderMarkers();saveDraft();
  }
  function deleteSelected(){
    const i=heads.findIndex(h=>h.id===selectedId);if(i<0)return;
    remember();heads.splice(i,1);selectedId=null;renderMarkers();saveDraft();
  }
  function updateHeadSetting(key,val){
    const h=markerHead(selectedId);if(!h)return;
    h[key]=val;updateMarkerPlacement(h);updateSelectedDisplay();saveDraft();
    if(three)three.refresh();
  }
  function controlEvents(){
    $('headSize').addEventListener('pointerdown',remember);
    $('headYaw').addEventListener('pointerdown',remember);
    $('headPitch').addEventListener('pointerdown',remember);
    $('headPoints').addEventListener('focus',remember);
    $('headSize').addEventListener('input',e=>updateHeadSetting('sizePercent',Number(e.target.value)));
    $('headYaw').addEventListener('input',e=>updateHeadSetting('rotationDeg',Number(e.target.value)));
    $('headPitch').addEventListener('input',e=>updateHeadSetting('pitchDeg',Number(e.target.value)));
    $('headPoints').addEventListener('change',e=>updateHeadSetting('points',Math.round(clamp(Number(e.target.value)||100,1,9999))));
    $('deleteHead').addEventListener('click',deleteSelected);
    $('duplicateHead').addEventListener('click',()=>{
      const h=markerHead(selectedId);if(!h)return;
      addHead({scene:h.scene,xPercent:clamp(h.xPercent+0.7,0,100),yPercent:clamp(h.yPercent+2,0,100)});
      const copy=markerHead(selectedId);copy.sizePercent=h.sizePercent;copy.rotationDeg=h.rotationDeg;copy.pitchDeg=h.pitchDeg||0;copy.points=h.points;
      updateMarkerPlacement(copy);updateSelectedDisplay();saveDraft();
    });
    $('undo').addEventListener('click',()=>{
      const previous=undoStack.pop();if(!previous)return;
      heads=JSON.parse(previous);selectedId=null;renderMarkers();saveDraft();
      $('undo').disabled=undoStack.length===0;
    });
    $('undo').disabled=true;
    $('clearHeads').addEventListener('click',()=>{
      if(!heads.length)return;
      if(!confirm(`Delete all ${heads.length} placed heads from this draft?`))return;
      remember();heads=[];selectedId=null;renderMarkers();saveDraft();
    });
    $('downloadJson').addEventListener('click',()=>{
      const blob=new Blob([formattedJson()],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='skubert-locations.json';document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      toast(`Exported ${heads.length} head locations.`);
    });
    $('copyJson').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(formattedJson());toast('Locations copied to clipboard.');}
      catch(e){toast('Clipboard unavailable; use Download JSON.',true);}
    });
    $('importJson').addEventListener('click',()=>$('jsonInput').click());
    $('jsonInput').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{
        const incoming=parseLocations(JSON.parse(await file.text()));
        remember();heads=incoming;selectedId=null;renderMarkers();saveDraft();
        toast(`Imported ${heads.length} head locations.`);
      }catch(err){toast('Could not import JSON: '+err.message,true)}
      e.target.value='';
    });
    $('exitEditor').addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.delete('place');location.href=u.toString()});
    $('threePreview').addEventListener('click',toggleThree);
  }
  async function toggleThree(){
    if(threeBusy)return;
    if(three){three.dispose();three=null;gameEl.classList.remove('three-active');
      for(const m of markers.values())m.dataset.threeVisible='false';
      $('threePreview').textContent='Preview real 3D';toast('Switched to lightweight image previews.');return;
    }
    threeBusy=true;$('threePreview').disabled=true;$('threePreview').textContent='Loading 3D…';
    toast('Loading the existing Skubert GLB (about 24 MB)…');
    try{
      const module=await import('./skubert-preview-3d.js');
      three=await module.createThreePreview({
        gameEl, viewport, modelPath:MODEL_FILE,
        getHeads:()=>heads, getMarkers:()=>markers
      });
      gameEl.classList.add('three-active');
      three.refresh();$('threePreview').textContent='Use image previews';
      toast('3D previews loaded. Drag markers to move them.');
    }catch(err){
      console.warn(err);three?.dispose();three=null;gameEl.classList.remove('three-active');
      $('threePreview').textContent='Preview real 3D';toast('Could not load the 3D model; image previews still work.',true);
    }finally{threeBusy=false;$('threePreview').disabled=false;}
  }

  function updateProgress(){
    const max=totalScroll(),fraction=max?clamp(viewport.scrollLeft/max,0,1):0;
    const middle=viewport.getBoundingClientRect().left+viewport.clientWidth*.5;
    const found=panels.find(p=>p.node.getBoundingClientRect().left<=middle && p.node.getBoundingClientRect().right>middle);
    const scene=found?Number(found.node.dataset.scene):panels.length;
    $('positionLabel').textContent=`Scene ${scene} of ${panels.length} · ${Math.round(fraction*100)}%`;
    $('percent').textContent=`${Math.round(fraction*100)}%`;
    seek.value=Math.round(fraction*1000);
    seek.style.setProperty('--progress',`${fraction*100}%`);
    $('previous').disabled=viewport.scrollLeft<=1;
    $('next').disabled=viewport.scrollLeft>=max-1;
    if(auto && viewport.scrollLeft>=max-1)setAuto(false);
    if(three)three.refresh();
  }
  function setAuto(enabled){
    auto=Boolean(enabled);$('auto').textContent=auto?'Ⅱ':'▶';
    $('auto').setAttribute('aria-pressed',String(auto));
    $('auto').setAttribute('aria-label',auto?'Pause automatic scrolling':'Start automatic scrolling');
  }
  function dismissNote(){$('introNote').hidden=true;}
  function scrollByAmount(distance){setAuto(false);viewport.scrollBy({left:distance,behavior:'smooth'});}
  function attachNavigation(){
    viewport.addEventListener('scroll',()=>{updateProgress();scheduleImageWindow();if(viewport.scrollLeft>40)dismissNote()},{passive:true});
    window.addEventListener('resize',layoutTiles);
    viewport.addEventListener('wheel',e=>{
      e.preventDefault();setAuto(false);dismissNote();
      const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
      viewport.scrollLeft+=delta*(e.deltaMode===1?32:1.5);
    },{passive:false});
    viewport.addEventListener('pointerdown',e=>{
      if(e.target.closest('.skubert-marker'))return;
      setAuto(false);
      draggingPan={id:e.pointerId,x:e.clientX,y:e.clientY,scroll:viewport.scrollLeft,dist:0,type:e.pointerType};
      if(e.pointerType==='mouse'){
        viewport.classList.add('dragging');try{viewport.setPointerCapture(e.pointerId)}catch(_){}
      }
    });
    viewport.addEventListener('pointermove',e=>{
      const d=draggingPan;if(!d || d.id!==e.pointerId)return;
      d.dist=Math.max(d.dist,Math.hypot(e.clientX-d.x,e.clientY-d.y));
      if(d.type==='mouse')viewport.scrollLeft=d.scroll+d.x-e.clientX;
    });
    function finishPan(e){
      const d=draggingPan;if(!d || d.id!==e.pointerId)return;
      draggingPan=null;viewport.classList.remove('dragging');
      if(EDITOR_MODE && d.dist<8 && e.button===0 && !e.target.closest('.skubert-marker')){
        const position=positionFromPointer(e.clientX,e.clientY);
        addHead(position);
      }
    }
    viewport.addEventListener('pointerup',finishPan);
    viewport.addEventListener('pointercancel',()=>{draggingPan=null;viewport.classList.remove('dragging')});
    viewport.addEventListener('lostpointercapture',()=>{viewport.classList.remove('dragging')});
    $('previous').addEventListener('click',()=>scrollByAmount(-viewport.clientWidth*.8));
    $('next').addEventListener('click',()=>scrollByAmount(viewport.clientWidth*.8));
    seek.addEventListener('input',()=>{setAuto(false);dismissNote();viewport.scrollLeft=totalScroll()*Number(seek.value)/1000;});
    $('auto').addEventListener('click',()=>setAuto(!auto));
    document.addEventListener('keydown',e=>{
      if(isForm(document.activeElement))return;
      if(EDITOR_MODE && e.key==='Delete' && selectedId){e.preventDefault();deleteSelected();return;}
      if(EDITOR_MODE && e.key==='Escape'){setSelected(null);return;}
      let dx=0;
      if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')dx=viewport.clientWidth*.35;
      else if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')dx=-viewport.clientWidth*.35;
      else if(e.key==='PageDown'||e.key===' ')dx=viewport.clientWidth*.8;
      else if(e.key==='PageUp')dx=-viewport.clientWidth*.8;
      else if(e.key==='Home'){viewport.scrollLeft=0;e.preventDefault();return;}
      else if(e.key==='End'){viewport.scrollLeft=totalScroll();e.preventDefault();return;}
      if(dx){e.preventDefault();scrollByAmount(dx);}
    });
    let last=0;
    function tick(now){
      if(auto){const dt=Math.min(.05,Math.max(0,(now-last)/1000||0));viewport.scrollLeft+=SCROLL_SPEED*dt;}
      last=now;requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(dismissNote,7000);
  }
  async function init(){
    buildStrip();layoutTiles();attachNavigation();
    gameEl.classList.toggle('placement',EDITOR_MODE);
    panelEl.hidden=!EDITOR_MODE;$('modeBadge').hidden=!EDITOR_MODE;
    if(EDITOR_MODE)controlEvents();
    await loadLocations();
    updateProgress();scheduleImageWindow();
  }
  init().catch(err=>{console.error(err);toast('Game initialization failed: '+err.message,true)});
  if(EDITOR_MODE){
    window.skubertPlacementDebug={getHeads:()=>heads.map(h=>({...h})), getWorld:()=>({scrollLeft:viewport.scrollLeft,scrollWidth:viewport.scrollWidth,viewWidth:viewport.clientWidth})};
  }
})();
