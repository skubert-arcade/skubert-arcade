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
  // Original cruise speed. Left/right arrows adjust it by +/- 50%, smoothly.
  const SCROLL_SPEED = 295;
  const SPEED_INERTIA_SECONDS = 1.0; // response time constant (~95% in 1.44 s)
  const RUN_SECONDS = 60;
  const BONUS_SECONDS = 2;
  const COUNTDOWN_SECONDS = 3;
  const COLLECT_ANIM_MS = 1500;
  const FULL_SCORE_WINDOW_MS = 2000; // On-screen for <2 seconds: 100% of base points.
  const MID_SCORE_WINDOW_MS = 3000;  // On-screen for 2 to <3 seconds: 75%.
  // Heads in the placement JSON default to 100 base points. Custom base
  // points are respected, so a 200-point head scores 200, 150, or 100.
  const HIGH_SCORE_KEY = 'skubert-find-best-v1';
  const panels = [], markers = new Map(), images = [];
  let heads = [], selectedId = null, auto = false, lastFrame = 0;
  let speedMultiplier = 1;
  const heldSpeedKeys = new Set();
  let draggingPan = null, draggingHead = null, three = null, threeBusy = false;
  let debounceSave = 0, timerMessage = 0;
  let phase = EDITOR_MODE ? 'editor' : 'ready';
  let score = 0, deadline = 0, secondsLeft = RUN_SECONDS, runToken = 0;
  let countdownEnd = 0, countdownShown = 0;
  const scoredIds = new Set(), completedIds = new Set(), collectionEffects = new Map();
  // Starts when the visible head first overlaps the viewport in actual play.
  // The timestamp is retained if the head later leaves the screen.
  const enteredScreenAt = new Map();
  const collectionTimers = new Set();
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
    locationsReady();
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
    marker.classList.toggle('collecting',collectionEffects.has(h.id));
    marker.classList.toggle('collected',completedIds.has(h.id));
    // Native HTML title tooltips can appear as a yellow rectangle after a
    // pointer click. Never show one on a gameplay head.
    if(EDITOR_MODE)marker.title=`${h.id} — drag to reposition`;
    else marker.removeAttribute('title');
  }
  function renderMarkers(){
    for(const marker of markers.values())marker.remove();
    markers.clear();
    for(const h of heads){
      const marker=document.createElement('button');marker.className='skubert-marker';
      marker.type='button';marker.dataset.headId=h.id;
      marker.setAttribute('aria-label',`Skubert head at scene ${h.scene}, ${Math.round(h.xPercent)} percent; ${h.points} points`);
      // Neither 3D model scale nor stored coordinates are changed by glow
      // modulation or the enlarged 195%-size gameplay hit target.
      const halo=document.createElement('span');halo.className='skubert-halo';halo.setAttribute('aria-hidden','true');
      const img=document.createElement('img');img.src=PLACEHOLDER;img.alt='';img.draggable=false;
      const hitbox=document.createElement('span');hitbox.className='skubert-hitbox';hitbox.setAttribute('aria-hidden','true');
      marker.append(halo,img,hitbox);
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
        else collectHead(h.id);
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
  function updateGameHud(){
    if(EDITOR_MODE)return;
    $('gameScore').textContent=score.toLocaleString();
    $('gameFound').textContent=`${scoredIds.size} / ${heads.length}`;
    $('gameTime').textContent=`${Math.floor(secondsLeft/60)}:${String(secondsLeft%60).padStart(2,'0')}`;
    $('timePill').classList.toggle('urgent',secondsLeft<=10 && phase==='playing');
  }
  function collectionState(id,now){
    const effect=collectionEffects.get(id);
    if(!effect)return null;
    const progress=clamp((now-effect.start)/COLLECT_ANIM_MS,0,1);
    // 3x size by 62% of the 1500ms sequence; then shrink to zero.
    const size=progress<=.62 ? 1+2*(progress/.62) : 3*(1-(progress-.62)/.38);
    return {scale:Math.max(0,size),spin:progress*Math.PI*12,active:true};
  }
  // Foreground sparkle burst. Coordinates are measured in game viewport space
  // (not tapestry-world space) so the burst is visible above the 3D canvas.
  // Every element is decorative and cannot intercept pointer clicks.
  function sparksAt(marker,awardedPoints){
    const rect=marker.getBoundingClientRect(),bounds=gameEl.getBoundingClientRect();
    const x=(rect.left+rect.right)/2-bounds.left;
    const y=(rect.top+rect.bottom)/2-bounds.top;
    const effects=$('effectLayer');
    const size=Math.max(28,Math.min(190,rect.width));
    for(let i=0;i<28;i++){
      const angle=2*Math.PI*i/28+(Math.random()-.5)*.20;
      const distance=size*(.8+Math.random()*1.35)+23;
      const spark=document.createElement('span');
      spark.className='capture-spark';
      spark.style.left=`${x}px`;spark.style.top=`${y}px`;
      spark.style.setProperty('--dx',`${Math.cos(angle)*distance}px`);
      spark.style.setProperty('--dy',`${Math.sin(angle)*distance}px`);
      spark.style.setProperty('--half-dx',`${Math.cos(angle)*distance*.5}px`);
      spark.style.setProperty('--half-dy',`${Math.sin(angle)*distance*.5}px`);
      spark.style.setProperty('--spark-size',`${14+Math.random()*18}px`);
      spark.style.setProperty('--spark-color',i%3===0?'#63ccff':i%3===1?'#ffd158':'#fff8d1');
      spark.style.setProperty('--spark-duration',`${950+Math.random()*320}ms`);
      spark.style.setProperty('--spark-delay',`${(i%3)*75}ms`);
      effects.append(spark);
      spark.addEventListener('animationend',()=>spark.remove(),{once:true});
    }
    const bonus=document.createElement('span');
    bonus.className='time-bonus-pop';bonus.textContent=`+${awardedPoints} pts · +${BONUS_SECONDS}s`;
    bonus.style.left=`${x}px`;bonus.style.top=`${y}px`;
    effects.append(bonus);
    bonus.addEventListener('animationend',()=>bonus.remove(),{once:true});
    // Concentric golden rings make the interaction legible even on busy imagery.
    for(let i=0;i<2;i++){
      const ring=document.createElement('span');ring.className='capture-ring';
      ring.style.left=`${x}px`;ring.style.top=`${y}px`;
      ring.style.setProperty('--ring-size',`${Math.max(54,size)}px`);
      ring.style.setProperty('--ring-delay',`${i*180}ms`);
      effects.append(ring);
      ring.addEventListener('animationend',()=>ring.remove(),{once:true});
    }
  }
  function pointsForHead(head,enteredAt,now){
    const age=Math.max(0,now-enteredAt);
    const fraction=age<FULL_SCORE_WINDOW_MS?1:age<MID_SCORE_WINDOW_MS?.75:.50;
    return Math.max(1,Math.round(head.points*fraction));
  }
  function collectHead(id){
    if(phase!=='playing'||scoredIds.has(id))return;
    const h=markerHead(id),marker=markers.get(id);
    if(!h||!marker)return;
    const now=performance.now();
    // If a click happens before the first animation-frame visibility sample,
    // this click itself establishes the first seen time.
    if(!enteredScreenAt.has(id))enteredScreenAt.set(id,now);
    const awardedPoints=pointsForHead(h,enteredScreenAt.get(id),now);
    scoredIds.add(id);score+=awardedPoints;
    // Extend the absolute deadline, not merely the displayed seconds, so the
    // countdown is accurate even when the bonus arrives between timer ticks.
    deadline+=BONUS_SECONDS*1000;
    secondsLeft=Math.max(0,Math.ceil((deadline-now)/1000));
    const token=runToken;
    collectionEffects.set(id,{start:now});
    marker.classList.add('collecting');marker.style.pointerEvents='none';
    // Clear the native button's focus so it cannot leave a yellow rectangle.
    if(document.activeElement===marker)marker.blur();
    sparksAt(marker,awardedPoints);updateGameHud();
    if(three)three.refresh();
    const timer=setTimeout(()=>{
      collectionTimers.delete(timer);
      if(token!==runToken)return;
      collectionEffects.delete(id);completedIds.add(id);
      marker.classList.remove('collecting');marker.classList.add('collected');
      if(three)three.refresh();
    },COLLECT_ANIM_MS);
    collectionTimers.add(timer);
  }
  function clearRun(){
    runToken++;
    for(const t of collectionTimers)clearTimeout(t);
    collectionTimers.clear();collectionEffects.clear();scoredIds.clear();completedIds.clear();enteredScreenAt.clear();
    $('effectLayer').replaceChildren();score=0;secondsLeft=RUN_SECONDS;deadline=0;
    countdownEnd=0;countdownShown=0;$('countdownOverlay').hidden=true;
    for(const marker of markers.values()){
      marker.classList.remove('collecting','collected');marker.style.pointerEvents='';
    }
    if(three)three.refresh();updateGameHud();
  }
  function showCountdownNumber(value){
    if(countdownShown===value)return;
    countdownShown=value;
    const number=$('countdownNumber');
    number.textContent=String(value);
    // Restart the entrance animation each second, without rebuilding the DOM.
    number.classList.remove('pulse');
    void number.offsetWidth;
    number.classList.add('pulse');
  }
  function startGame(){
    if(EDITOR_MODE||!heads.length)return;
    clearRun();phase='countdown';
    setAuto(false);viewport.scrollLeft=0;dismissNote();
    // Remove both the popup and its semi-transparent full-screen backdrop.
    $('endOverlay').hidden=true;$('startOverlay').hidden=true;
    $('countdownOverlay').hidden=false;
    countdownEnd=performance.now()+COUNTDOWN_SECONDS*1000;
    showCountdownNumber(COUNTDOWN_SECONDS);
    updateGameHud();
    viewport.focus({preventScroll:true});
  }
  function tickCountdown(now){
    if(phase!=='countdown')return;
    if(now>=countdownEnd){
      $('countdownOverlay').hidden=true;
      phase='playing';
      deadline=now+RUN_SECONDS*1000;
      secondsLeft=RUN_SECONDS;
      updateGameHud();
      setAuto(true);
    }else{
      showCountdownNumber(Math.max(1,Math.ceil((countdownEnd-now)/1000)));
    }
  }
  function finishGame(){
    if(phase!=='playing')return;
    phase='finished';secondsLeft=0;setAuto(false);updateGameHud();
    let best=0;
    try {best=Number(localStorage.getItem(HIGH_SCORE_KEY))||0;
      if(score>best){best=score;localStorage.setItem(HIGH_SCORE_KEY,String(best));}
    }catch(_){}
    $('endScore').textContent=score.toLocaleString();
    const earnedSeconds=scoredIds.size*BONUS_SECONDS;
    $('endSummary').textContent=`Found ${scoredIds.size} of ${heads.length} Skubert heads · +${earnedSeconds} seconds earned.`;
    $('endBest').textContent=`Personal best: ${best.toLocaleString()} points`;
    $('endOverlay').hidden=false;$('restartGame').focus({preventScroll:true});
  }
  function tickGameTimer(now){
    if(phase!=='playing')return;
    const remaining=Math.max(0,Math.ceil((deadline-now)/1000));
    if(remaining!==secondsLeft){secondsLeft=remaining;updateGameHud();}
    if(now>=deadline)finishGame();
  }
  function configureGameplay(){
    if(EDITOR_MODE)return;
    $('gameHud').hidden=false;$('startOverlay').hidden=false;
    $('beginGame').addEventListener('click',startGame);
    $('restartGame').addEventListener('click',startGame);
    updateGameHud();
  }
  function locationsReady(){
    if(EDITOR_MODE)return;
    $('beginGame').disabled=heads.length===0;
    $('gameReadyMessage').textContent=heads.length
      ? `${heads.length} Skubert head${heads.length===1?'':'s'} hidden. Find them before time runs out!`
      : 'No locations found. Add your skubert-locations.json using Placement Mode.';
    updateGameHud();
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
  async function enableThree(){
    if(threeBusy||three)return;
    threeBusy=true;
    if(EDITOR_MODE){$('threePreview').disabled=true;$('threePreview').textContent='Loading 3D…';}
    try{
      const module=await import('./skubert-preview-3d.js');
      three=await module.createThreePreview({
        gameEl,viewport,modelPath:MODEL_FILE,
        getHeads:()=>heads,getMarkers:()=>markers,
        getEffect:collectionState,isCompleted:id=>completedIds.has(id)
      });
      gameEl.classList.add('three-active');three.refresh();
      if(EDITOR_MODE){$('threePreview').textContent='Use image previews';toast('3D heads rendered. Drag markers to move them.');}
    }catch(err){
      console.warn('Skubert GLB could not load; keeping PNG fallback.',err);
      three?.dispose();three=null;gameEl.classList.remove('three-active');
      for(const m of markers.values())m.dataset.threeVisible='false';
      if(EDITOR_MODE){$('threePreview').textContent='Preview real 3D';toast('Could not render 3D; image previews still work.',true);}else toast('3D model unavailable — using PNG previews. See browser console for details.',true);
    }finally{threeBusy=false;if(EDITOR_MODE)$('threePreview').disabled=false;}
  }
  async function toggleThree(){
    if(threeBusy)return;
    if(three){
      three.dispose();three=null;gameEl.classList.remove('three-active');
      for(const m of markers.values())m.dataset.threeVisible='false';
      $('threePreview').textContent='Preview real 3D';toast('Switched to lightweight image previews.');return;
    }
    await enableThree();
  }

  function updateHeadScreenStates(now){
    if(EDITOR_MODE)return; // Placement Mode always has full-strength halos.
    const bounds=viewport.getBoundingClientRect();
    const width=Math.max(1,bounds.width);
    for(const [id,marker] of markers){
      if(completedIds.has(id))continue;
      const box=marker.getBoundingClientRect();
      const centerX=(box.left+box.right)*.5;
      // 0 at the RIGHT edge of the screen, 1 at the LEFT edge. This is
      // independent of scroll speed, canvas rendering and the 2-second pulse.
      const strength=clamp((bounds.right-centerX)/width,0,1);
      // Avoid unnecessary style invalidation in 60fps animation frames.
      const value=strength.toFixed(3);
      if(marker.style.getPropertyValue('--glow-strength')!==value)
        marker.style.setProperty('--glow-strength',value);
      const onscreen=box.right>bounds.left && box.left<bounds.right &&
        box.bottom>bounds.top && box.top<bounds.bottom;
      if(phase==='playing' && onscreen && !enteredScreenAt.has(id))
        enteredScreenAt.set(id,now);
    }
  }
  function updateSpeedReadout(){
    if(EDITOR_MODE)return;
    $('speedValue').textContent=`${speedMultiplier.toFixed(2)}×`;
  }
  function targetSpeedMultiplier(){
    const braking=heldSpeedKeys.has('ArrowLeft');
    const accelerating=heldSpeedKeys.has('ArrowRight');
    if(braking===accelerating)return 1; // neither or both held
    return braking?.5:2.0;
  }
  function clearSpeedKeys(){heldSpeedKeys.clear();}
  function updateProgress(){
    const max=totalScroll(),fraction=max?clamp(viewport.scrollLeft/max,0,1):0;
    $('percent').textContent=`${Math.round(fraction*100)}%`;
    seek.value=Math.round(fraction*1000);
    seek.style.setProperty('--progress',`${fraction*100}%`);
    $('previous').disabled=viewport.scrollLeft<=1;
    $('next').disabled=viewport.scrollLeft>=max-1;
    if(auto && viewport.scrollLeft>=max-1)setAuto(false);
    if(three)three.refresh();
  }
  function setAuto(enabled){
    auto=Boolean(enabled);
    if(!auto){clearSpeedKeys();speedMultiplier=1;updateSpeedReadout();}
    $('auto').textContent=auto?'Ⅱ':'▶';
    $('auto').setAttribute('aria-pressed',String(auto));
    $('auto').setAttribute('aria-label',auto?'Pause automatic scrolling':'Start automatic scrolling');
  }
  function dismissNote(){$('introNote').hidden=true;}
  function scrollByAmount(distance){
    if(!EDITOR_MODE)return; // no manual navigation in normal gameplay
    setAuto(false);viewport.scrollBy({left:distance,behavior:'smooth'});
  }
  function attachNavigation(){
    viewport.addEventListener('scroll',()=>{updateProgress();scheduleImageWindow();if(viewport.scrollLeft>40)dismissNote()},{passive:true});
    window.addEventListener('resize',layoutTiles);
    viewport.addEventListener('wheel',e=>{
      e.preventDefault();
      if(!EDITOR_MODE)return; // also block mouse/trackpad scroll in gameplay
      setAuto(false);dismissNote();
      const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
      viewport.scrollLeft+=delta*(e.deltaMode===1?32:1.5);
    },{passive:false});
    viewport.addEventListener('pointerdown',e=>{
      if(!EDITOR_MODE)return; // do not steal clicks from Skubert heads
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
    seek.addEventListener('input',()=>{
      if(!EDITOR_MODE)return;
      setAuto(false);dismissNote();viewport.scrollLeft=totalScroll()*Number(seek.value)/1000;
    });
    $('auto').addEventListener('click',()=>{if(EDITOR_MODE)setAuto(!auto)});
    document.addEventListener('keydown',e=>{
      if(!EDITOR_MODE){
        if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
          e.preventDefault();
          if(phase==='playing')heldSpeedKeys.add(e.key);
        }
        return; // no PageUp/Down, Space, Home/End, A/D manual seeking
      }
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
    document.addEventListener('keyup',e=>{
      if(!EDITOR_MODE && (e.key==='ArrowLeft'||e.key==='ArrowRight')){
        e.preventDefault();heldSpeedKeys.delete(e.key);
      }
    });
    window.addEventListener('blur',clearSpeedKeys);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clearSpeedKeys()});
    let last=0;
    function tick(now){
      tickCountdown(now);
      tickGameTimer(now);
      if(auto){
        const dt=Math.min(.05,Math.max(0,(now-last)/1000||0));
        if(!EDITOR_MODE && phase==='playing'){
          const target=targetSpeedMultiplier();
          // Exponential easing is time-step independent: no abrupt jumps when a
          // key is pressed or released, even at variable frame rates.
          speedMultiplier+=(target-speedMultiplier)*(1-Math.exp(-dt/SPEED_INERTIA_SECONDS));
          if(Math.abs(speedMultiplier-target)<0.002)speedMultiplier=target;
          updateSpeedReadout();
        }
        viewport.scrollLeft+=SCROLL_SPEED*(EDITOR_MODE?1:speedMultiplier)*dt;
      }
      updateHeadScreenStates(now);
      last=now;requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(dismissNote,7000);
  }
  async function init(){
    buildStrip();layoutTiles();attachNavigation();
    gameEl.classList.toggle('placement',EDITOR_MODE);
    panelEl.hidden=!EDITOR_MODE;$('modeBadge').hidden=!EDITOR_MODE;
    seek.disabled=!EDITOR_MODE;
    if(!EDITOR_MODE){
      seek.setAttribute('aria-label','Tapestry progress (view only)');
      $('speedGuide').hidden=false;$('speedReadout').hidden=false;
      updateSpeedReadout();
    }
    if(EDITOR_MODE)controlEvents();
    configureGameplay();
    await loadLocations();
    updateProgress();scheduleImageWindow();
    // In regular play, load the real GLB automatically. PNGs stay visible until ready.
    if(!EDITOR_MODE && heads.length)void enableThree();
  }
  init().catch(err=>{console.error(err);toast('Game initialization failed: '+err.message,true)});
  if(EDITOR_MODE){
    window.skubertPlacementDebug={getHeads:()=>heads.map(h=>({...h})), getWorld:()=>({scrollLeft:viewport.scrollLeft,scrollWidth:viewport.scrollWidth,viewWidth:viewport.clientWidth})};
  }
})();
