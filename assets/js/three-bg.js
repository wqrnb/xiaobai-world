/* 小白超白的空间 v4 · 3D 星球展厅
 * 中央星球 + 五个分区节点，相机围绕星球旋转，点击/拖拽切换视角。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('webgl-stage');
  var wrap = document.getElementById('webgl-stage-wrap');
  var flashEl = document.getElementById('intro-flash');
  if (!canvas || !wrap || !window.THREE) return;

  var IS_MOBILE = window.matchMedia('(max-width: 820px)').matches || ('ontouchstart' in window);
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Q = {
    mobile: IS_MOBILE,
    reduced: REDUCED_MOTION,
    pixelRatio: IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    bloom: !IS_MOBILE && !REDUCED_MOTION,
    stars: IS_MOBILE ? 320 : 720,
    ambientParticles: IS_MOBILE ? 320 : 820,
    burstParticles: IS_MOBILE ? 500 : 1200,
    coreDetail: IS_MOBILE ? 3 : 5
  };

  var api = { supported: false, start: function(){}, goTo: function(){}, pulse: function(){}, setTheme: function(){} };
  window.XBW_BG = api;

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }
  if (!webglAvailable()) {
    wrap.style.display = 'none';
    document.body.classList.add('xwb-no3d');
    return;
  }

  var renderer, scene, camera, controls, composer, bloomPass;
  var skyMat, stars, starsMat, ambientPoints, ambientMat, burstPoints, burstMat;
  var coreMesh, coreUniforms, coreWire, coreGroup;
  var globeGroup, globeMat;
  var waveMeshes = [], waveStates = [];
  var anchors = {}, anchorMeshes = [], anchorLabelMats = [];
  var shake = 0, introPhase = 'idle', introT = 0, boomT = 0;
  var clock = new THREE.Clock();
  var theme = 'day';
  var burstVelocities = null;
  var flyAnim = null;
  var currentView = 'about';
  var viewChangeCooldown = 0;

  var VIEWS = {
    about:    { pos: new THREE.Vector3(0, 2.4, 15),   node: new THREE.Vector3(0, 1.8, 7.35) },
    featured: { pos: new THREE.Vector3(13.5, 3.2, 8.5), node: new THREE.Vector3(7.05, 1.7, 4.5) },
    xhs:      { pos: new THREE.Vector3(-14, 3.2, 7),  node: new THREE.Vector3(-7.3, 1.8, 3.7) },
    bili:     { pos: new THREE.Vector3(14, 3.2, -4),  node: new THREE.Vector3(7.5, 1.8, -2.1) },
    follow:   { pos: new THREE.Vector3(0, 1.6, -15), node: new THREE.Vector3(0, 0.8, -7.35) }
  };

  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Q.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
  } catch (e) {
    wrap.style.display = 'none';
    document.body.classList.add('xwb-no3d');
    return;
  }
  api.supported = true;

  function makeGlowTexture(size, stops) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    stops.forEach(function(s){ g.addColorStop(s[0],s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0,0,size,size);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }
  var glowTex = makeGlowTexture(128, [[0,'rgba(255,255,255,1)'],[0.25,'rgba(255,196,218,0.85)'],[0.55,'rgba(255,120,175,0.28)'],[1,'rgba(255,120,175,0)']]);

  var SECTION_PALETTES = {
    day: {
      about: { skyTop:'#ffc4da', skyBottom:'#f76d9e', deep:'#b01f5b', hot:'#ff4f93', white:'#fff6fa', rim:'#ff9cc6', bloom:0.4, threshold:0.9 },
      featured: { skyTop:'#ffd3e4', skyBottom:'#ff7bac', deep:'#a31355', hot:'#ff2f7e', white:'#fff1f6', rim:'#ff8fbd', bloom:0.42, threshold:0.88 },
      xhs: { skyTop:'#ffc9dc', skyBottom:'#f45197', deep:'#9c0f4d', hot:'#ff5c8d', white:'#fff5f8', rim:'#ff7bac', bloom:0.45, threshold:0.86 },
      bili: { skyTop:'#ffdcec', skyBottom:'#ff6b9d', deep:'#8f1550', hot:'#ff4f93', white:'#fff7fa', rim:'#ffa3c6', bloom:0.42, threshold:0.87 },
      follow: { skyTop:'#fff0f5', skyBottom:'#ff8fb8', deep:'#a31355', hot:'#ff7bac', white:'#ffffff', rim:'#ffc0d8', bloom:0.4, threshold:0.9 }
    },
    night: {
      about: { skyTop:'#1a0712', skyBottom:'#541131', deep:'#4d0d2c', hot:'#ff5fa8', white:'#fff0f6', rim:'#ff8fbd', bloom:0.58, threshold:0.62 },
      featured: { skyTop:'#180611', skyBottom:'#611438', deep:'#420a28', hot:'#ff3f86', white:'#ffe6f0', rim:'#ff7bac', bloom:0.6, threshold:0.6 },
      xhs: { skyTop:'#1c0713', skyBottom:'#6d153f', deep:'#3d0a24', hot:'#ff4f93', white:'#ffedf4', rim:'#ff6fa8', bloom:0.62, threshold:0.58 },
      bili: { skyTop:'#150610', skyBottom:'#5c1235', deep:'#360920', hot:'#ff5c8d', white:'#fff2f7', rim:'#ff8fbd', bloom:0.6, threshold:0.6 },
      follow: { skyTop:'#1d0813', skyBottom:'#6d1843', deep:'#4a0c2c', hot:'#ff7bac', white:'#fff6f9', rim:'#ffb1cf', bloom:0.56, threshold:0.62 }
    }
  };
  var COLOR_KEYS = ['skyTop','skyBottom','deep','hot','white','rim'];
  var sectionColors = {}, sectionTargets = {};

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(56, window.innerWidth/window.innerHeight, 0.1, 140);
    camera.position.copy(VIEWS.about.pos);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0,0,0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 10;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.enablePan = false;
    controls.rotateSpeed = 0.65;
    controls.update();

    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite:false,
      uniforms:{ uTop:{value:new THREE.Color('#ffc4da')}, uBottom:{value:new THREE.Color('#f76d9e')}, uTime:{value:0} },
      vertexShader:'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:'varying vec3 vPos; uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime; void main(){ float h=normalize(vPos).y*0.5+0.5; vec3 col=mix(uBottom,uTop,smoothstep(0.0,0.78,h)); col+=vec3(0.06,0.01,0.05)*sin(vPos.x*0.05+uTime*0.05)*sin(vPos.y*0.06); col=pow(clamp(col,0.0,1.0),vec3(0.4545)); gl_FragColor=vec4(col,1.0); }'
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(60,48,24), skyMat));

    // 星空
    var starCount = Q.stars, starPos = new Float32Array(starCount*3);
    for (var i=0;i<starCount;i++) {
      var theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1), r=32+Math.random()*22;
      starPos[i*3]=r*Math.sin(phi)*Math.cos(theta); starPos[i*3+1]=r*Math.cos(phi)*0.8; starPos[i*3+2]=r*Math.sin(phi)*Math.sin(theta);
    }
    var starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
    starsMat = new THREE.PointsMaterial({ size:IS_MOBILE?0.06:0.09, map:glowTex, color:0xffffff, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true });
    stars = new THREE.Points(starGeo, starsMat); scene.add(stars);

    // 星云
    for (var n=0;n<5;n++) {
      var nebTex = makeGlowTexture(256, [[0,'rgba(255,255,255,0.75)'],[0.32,n%2?'rgba(255,122,174,0.38)':'rgba(255,190,215,0.34)'],[1,'rgba(255,255,255,0)']]);
      var nebMat = new THREE.SpriteMaterial({ map:nebTex, color:n%2?0xff7bac:0xffc4da, transparent:true, opacity:0.34, blending:THREE.AdditiveBlending, depthWrite:false });
      var sprite = new THREE.Sprite(nebMat); var a=(n/5)*Math.PI*2;
      sprite.position.set(Math.cos(a)*13, Math.sin(a*2)*4, Math.sin(a)*9-2);
      sprite.scale.set(15+n*2, 9+n, 1); sprite.userData={isNebula:true,speed:0.02+n*0.006,phase:n*1.3,basePos:sprite.position.clone()};
      scene.add(sprite);
    }

    // 中心星球组
    globeGroup = new THREE.Group();
    var wireGeo = new THREE.SphereGeometry(7.3, 48, 30);
    var wireMat = new THREE.MeshBasicMaterial({ color:0xff9cc6, wireframe:true, transparent:true, opacity:0.16, blending:THREE.AdditiveBlending, depthWrite:false });
    globeGroup.add(new THREE.Mesh(wireGeo, wireMat));

    globeMat = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      uniforms:{ uTime:{value:0}, uColor:{value:new THREE.Color('#ff7bac')}, uRim:{value:new THREE.Color('#ffffff')}, uPulse:{value:0} },
      vertexShader:'varying vec3 vN; varying vec3 vV; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader:'varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform vec3 uRim; uniform float uTime; uniform float uPulse; void main(){ float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.4); float grid=smoothstep(0.65,0.95,0.5+0.5*sin(vN.x*28.0+uTime*0.6))*smoothstep(0.65,0.95,0.5+0.5*sin(vN.y*34.0-uTime*0.5)); vec3 col=uColor*(0.1+grid*0.45)+uRim*(fres*0.75+uPulse*0.35); col=pow(clamp(col,0.0,1.0),vec3(0.4545)); gl_FragColor=vec4(col,0.55+fres*0.4); }'
    });
    globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(7.32, 64, 40), globeMat));

    // 核心
    coreUniforms = {
      uTime:{value:0}, uDeep:{value:new THREE.Color('#b01f5b')}, uHot:{value:new THREE.Color('#ff4f93')},
      uWhite:{value:new THREE.Color('#fff6fa')}, uRim:{value:new THREE.Color('#ff9cc6')}, uIntensity:{value:1}, uRipple:{value:0}
    };
    var coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader:'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader:'varying vec3 vN; varying vec3 vV; varying vec2 vUv; uniform vec3 uDeep; uniform vec3 uHot; uniform vec3 uWhite; uniform vec3 uRim; uniform float uTime; uniform float uIntensity; uniform float uRipple; float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);} float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;} void main(){ vec3 n=normalize(vN); vec3 v=normalize(vV); float fres=pow(1.0-abs(dot(n,v)),2.0); float energy=fbm(n.xy*3.1+uTime*0.22)*0.75+0.25; float wave=0.5+0.5*sin(vUv.y*42.0-uTime*3.2); wave*=smoothstep(0.25,1.0,energy+uRipple); vec3 col=uDeep+uHot*energy*1.7+uWhite*wave*0.55; col+=uRim*fres*1.9; col*=uIntensity; col=pow(clamp(col,0.0,1.0),vec3(0.4545)); gl_FragColor=vec4(col,1.0); }'
    });
    coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05,Q.coreDetail), coreMat);
    coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42,1), new THREE.MeshBasicMaterial({color:0xffffff,wireframe:true,transparent:true,opacity:0.16,blending:THREE.AdditiveBlending,depthWrite:false}));
    coreGroup = new THREE.Group(); coreGroup.add(coreMesh); coreGroup.add(coreWire); coreGroup.scale.setScalar(0.001);
    globeGroup.add(coreGroup);
    scene.add(globeGroup);

    // 冲击波
    var ringGeo = new THREE.RingGeometry(0.86,0.94,96);
    for (var w=0;w<4;w++) {
      var ringMat = new THREE.MeshBasicMaterial({color:w%2?0xffffff:0xff9cc6,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
      var ring = new THREE.Mesh(ringGeo,ringMat); ring.visible=false; coreGroup.add(ring);
      waveMeshes.push(ring); waveStates.push({life:0,maxLife:1.6,speed:3.2+w*1.1,startOpacity:0.95-w*0.16});
    }

    // 环绕粒子
    var ambCount=Q.ambientParticles, ambPos=new Float32Array(ambCount*3);
    for (var a=0;a<ambCount;a++) {
      var ar=2.2+Math.pow(Math.random(),0.55)*8.5, aa=Math.random()*Math.PI*2, ay=(Math.random()-0.5)*4.2;
      ambPos[a*3]=Math.cos(aa)*ar; ambPos[a*3+1]=ay; ambPos[a*3+2]=Math.sin(aa)*ar*0.72;
    }
    var ambGeo=new THREE.BufferGeometry(); ambGeo.setAttribute('position',new THREE.BufferAttribute(ambPos,3));
    ambientMat = new THREE.PointsMaterial({size:IS_MOBILE?0.05:0.075,map:glowTex,color:0xffb6d2,transparent:true,opacity:0.6,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true});
    ambientPoints = new THREE.Points(ambGeo,ambientMat); scene.add(ambientPoints);

    // 爆发粒子
    var burstCount=Q.burstParticles, burstPos=new Float32Array(burstCount*3); burstVelocities=new Float32Array(burstCount*3);
    for (var b=0;b<burstCount;b++){ burstPos[b*3]=(Math.random()-0.5)*0.1; burstPos[b*3+1]=(Math.random()-0.5)*0.1; burstPos[b*3+2]=(Math.random()-0.5)*0.1; }
    var burstGeo=new THREE.BufferGeometry(); burstGeo.setAttribute('position',new THREE.BufferAttribute(burstPos,3));
    burstMat = new THREE.PointsMaterial({size:IS_MOBILE?0.09:0.12,map:glowTex,color:0xffd7e6,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true});
    burstPoints = new THREE.Points(burstGeo,burstMat); burstPoints.visible=false; scene.add(burstPoints);

    // 分区节点
    var labels = { about:'关于小白', featured:'精选', xhs:'小红书岛', bili:'B站视频墙', follow:'关注' };
    Object.keys(VIEWS).forEach(function(key){
      var pos = VIEWS[key].node;
      var node = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18,2), new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}));
      node.position.copy(pos); node.userData.view=key; globeGroup.add(node); anchorMeshes.push(node);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffb1d0,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false}));
      glow.position.copy(pos); glow.scale.set(1.2,1.2,1); globeGroup.add(glow);
      var c=document.createElement('canvas'); c.width=256; c.height=72; var ctx=c.getContext('2d');
      ctx.fillStyle='rgba(255,255,255,0.9)'; roundRect(ctx,12,10,232,50,20); ctx.fill(); ctx.strokeStyle='#ff7bac'; ctx.lineWidth=3; roundRect(ctx,12,10,232,50,20); ctx.stroke();
      ctx.fillStyle='#d84d8d'; ctx.font='bold 26px "Microsoft YaHei UI", sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(labels[key],128,36);
      var tex=new THREE.CanvasTexture(c); tex.encoding=THREE.sRGBEncoding; var lm=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});
      var label=new THREE.Sprite(lm); label.position.copy(pos).add(new THREE.Vector3(0,0.75,0)); label.scale.set(2.3,0.65,1); globeGroup.add(label); anchorLabelMats.push(lm);
      anchors[key]={node:node,label:label};
    });

    if (Q.bloom) {
      try {
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene,camera));
        bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),0.42,0.6,0.88);
        composer.addPass(bloomPass);
      } catch(e){ composer=null; bloomPass=null; }
    }
  }

  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  function initSectionColors(){ COLOR_KEYS.forEach(function(k){ sectionColors[k]=new THREE.Color('#ffc4da'); sectionTargets[k]=new THREE.Color('#ffc4da'); }); }
  function setSectionTarget(view){ var p=SECTION_PALETTES[theme][view]||SECTION_PALETTES[theme].about; sectionTargets.skyTop.set(p.skyTop); sectionTargets.skyBottom.set(p.skyBottom); sectionTargets.deep.set(p.deep); sectionTargets.hot.set(p.hot); sectionTargets.white.set(p.white); sectionTargets.rim.set(p.rim); if(bloomPass){ bloomPass.strength=p.bloom; bloomPass.threshold=p.threshold; } }
  function setTheme(next){ theme=next||'day'; setSectionTarget(currentView); starsMat.opacity=theme==='dark'?1:0.6; }

  function notifyBoom(){ var evt; try{ evt=new CustomEvent('xwb:boom'); }catch(e){ evt=document.createEvent('Event'); evt.initEvent('xwb:boom',true,true); } document.dispatchEvent(evt); }
  function resetBurst(){ var pos=burstPoints.geometry.attributes.position.array; for(var i=0;i<pos.length/3;i++){ pos[i*3]=(Math.random()-0.5)*0.12; pos[i*3+1]=(Math.random()-0.5)*0.12; pos[i*3+2]=(Math.random()-0.5)*0.12; var theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1),speed=5.5+Math.random()*11; burstVelocities[i*3]=Math.sin(phi)*Math.cos(theta)*speed; burstVelocities[i*3+1]=Math.cos(phi)*speed*0.72; burstVelocities[i*3+2]=Math.sin(phi)*Math.sin(theta)*speed; } burstPoints.geometry.attributes.position.needsUpdate=true; burstPoints.visible=true; burstMat.opacity=0.95; }
  function resetWaves(){ waveMeshes.forEach(function(ring,idx){ ring.visible=true; ring.scale.setScalar(0.001); ring.material.opacity=waveStates[idx].startOpacity; waveStates[idx].life=0; }); }
  function startWarp(){ shake=Math.max(shake,0.2); coreUniforms.uRipple.value=Math.max(coreUniforms.uRipple.value,0.55); if(flashEl){ flashEl.classList.remove('warp'); void flashEl.offsetWidth; flashEl.classList.add('warp'); } }
  function triggerBoom(){ introPhase='boom'; boomT=0; shake=0.9; coreUniforms.uRipple.value=1; resetBurst(); resetWaves(); if(flashEl){ flashEl.classList.remove('boom'); void flashEl.offsetWidth; flashEl.classList.add('boom'); } notifyBoom(); }

  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

  function updateBurst(dt){ var pos=burstPoints.geometry.attributes.position.array; for(var i=0;i<pos.length/3;i++){ pos[i*3]+=burstVelocities[i*3]*dt; pos[i*3+1]+=burstVelocities[i*3+1]*dt; pos[i*3+2]+=burstVelocities[i*3+2]*dt; burstVelocities[i*3]*=0.984; burstVelocities[i*3+1]*=0.984; burstVelocities[i*3+2]*=0.984; } burstPoints.geometry.attributes.position.needsUpdate=true; burstMat.opacity=Math.max(0,0.95*(1-boomT/2.8)); if(boomT>2.8)burstMat.opacity=0; }
  function updateWaves(dt){ waveMeshes.forEach(function(ring,idx){ var st=waveStates[idx]; if(st.life>=st.maxLife){ring.visible=false;return;} st.life+=dt; var k=st.life/st.maxLife; ring.scale.setScalar(0.001+easeInOutCubic(k)*(5.5+idx*1.7)); ring.material.opacity=st.startOpacity*(1-k); }); }

  function viewDirection(view){ return VIEWS[view].pos.clone().normalize(); }
  function nearestView(){ var dir=camera.position.clone().normalize(); var best='about', bestDot=-2; Object.keys(VIEWS).forEach(function(k){ var dot=dir.dot(viewDirection(k)); if(dot>bestDot){ bestDot=dot; best=k; } }); return best; }

  function flyTo(view){
    var target=VIEWS[view]||VIEWS.about;
    flyAnim={ t:0, dur:1.25, fromPos:camera.position.clone(), toPos:target.pos.clone() };
    controls.enabled=false;
    currentView=view;
    setSectionTarget(view);
    startWarp();
    var evt; try{ evt=new CustomEvent('xwb:view',{detail:{view:view}}); }catch(e){ evt=document.createEvent('Event'); evt.initEvent('xwb:view',true,true); }
    document.dispatchEvent(evt);
  }

  function animate(){
    requestAnimationFrame(animate);
    var dt=Math.min(clock.getDelta(),0.05), t=clock.elapsedTime;

    if (introPhase==='charge') {
      introT+=dt; var chargeK=Math.min(1,introT/0.9);
      coreGroup.scale.setScalar(0.06+chargeK*0.3+Math.sin(t*12)*0.025*chargeK);
      coreUniforms.uIntensity.value=0.7+chargeK*1.6;
      if(introT>=0.9) triggerBoom();
    } else if (introPhase==='boom') {
      boomT+=dt; var boomK=Math.min(1,boomT/1.05);
      coreGroup.scale.setScalar(0.3+easeInOutCubic(boomK)*1.0);
      coreUniforms.uIntensity.value=1.9-boomK*0.6;
      coreUniforms.uRipple.value=Math.max(0,1-boomT*1.6);
      updateBurst(dt); updateWaves(dt); shake=Math.max(0,shake-dt*1.4);
      if(boomT>2.6){ introPhase='ambient'; shake=0; }
    } else if (introPhase==='ambient') {
      coreGroup.scale.setScalar(1.18+Math.sin(t*1.5)*0.07);
      coreUniforms.uIntensity.value=1.25+Math.sin(t*1.3)*0.12;
      updateBurst(dt); updateWaves(dt);
    } else {
      coreUniforms.uIntensity.value=0.55;
    }

    // 相机飞行动画
    if (flyAnim) {
      flyAnim.t+=dt; var fk=Math.min(1,flyAnim.t/flyAnim.dur), fe=easeInOutCubic(fk);
      camera.position.lerpVectors(flyAnim.fromPos,flyAnim.toPos,fe);
      controls.target.set(0,0,0);
      controls.update();
      if(fk>=1){ flyAnim=null; controls.enabled=true; }
    } else if (controls.enabled) {
      controls.update();
      viewChangeCooldown-=dt;
      if (viewChangeCooldown<=0) {
        var nv=nearestView();
        if (nv!==currentView) {
          currentView=nv; setSectionTarget(nv);
          var evt; try{ evt=new CustomEvent('xwb:view',{detail:{view:nv}}); }catch(e){ evt=document.createEvent('Event'); evt.initEvent('xwb:view',true,true); }
          document.dispatchEvent(evt);
          viewChangeCooldown=0.8;
        }
      }
    }

    coreUniforms.uTime.value=t;
    globeMat.uniforms.uTime.value=t;
    globeMat.uniforms.uPulse.value=0.5+0.5*Math.sin(t*1.2);
    globeGroup.rotation.y+=dt*0.04;
    globeGroup.rotation.x=Math.sin(t*0.2)*0.08;
    coreMesh.rotation.y+=dt*0.32; coreMesh.rotation.x+=dt*0.12;
    coreWire.rotation.y-=dt*0.4; coreWire.rotation.z+=dt*0.16;
    stars.rotation.y+=dt*0.008;
    ambientPoints.rotation.y+=dt*0.06;

    anchorMeshes.forEach(function(node,idx){ var s=1+Math.sin(t*2.4+idx*1.3)*0.18; node.scale.setScalar(s); });
    scene.children.forEach(function(obj){ if(obj.userData&&obj.userData.isNebula){ var ud=obj.userData; obj.position.x=ud.basePos.x+Math.sin(t*ud.speed+ud.phase)*1.3; obj.position.y=ud.basePos.y+Math.cos(t*ud.speed*0.8+ud.phase)*0.8; } });

    if (sectionColors&&sectionTargets) {
      var ck=Math.min(1,dt*2.6);
      sectionColors.skyTop.lerp(sectionTargets.skyTop,ck); sectionColors.skyBottom.lerp(sectionTargets.skyBottom,ck);
      sectionColors.deep.lerp(sectionTargets.deep,ck); sectionColors.hot.lerp(sectionTargets.hot,ck);
      sectionColors.white.lerp(sectionTargets.white,ck); sectionColors.rim.lerp(sectionTargets.rim,ck);
      skyMat.uniforms.uTop.value.copy(sectionColors.skyTop); skyMat.uniforms.uBottom.value.copy(sectionColors.skyBottom);
      coreUniforms.uDeep.value.copy(sectionColors.deep); coreUniforms.uHot.value.copy(sectionColors.hot);
      coreUniforms.uWhite.value.copy(sectionColors.white); coreUniforms.uRim.value.copy(sectionColors.rim);
    }

    skyMat.uniforms.uTime.value=t;
    shake=Math.max(0,shake-dt*1.4);
    if (composer) composer.render(dt); else renderer.render(scene,camera);
  }

  function onResize(){ var w=window.innerWidth,h=window.innerHeight; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); renderer.setPixelRatio(Q.pixelRatio); if(composer)composer.setSize(w,h); }

  function handleClick(e){
    var rect=renderer.domElement.getBoundingClientRect();
    var ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    var ray=new THREE.Raycaster(); ray.setFromCamera(ndc,camera);
    var hits=ray.intersectObjects(anchorMeshes,false);
    if(hits.length){ var view=hits[0].object.userData.view; if(view) api.goTo(view); }
  }

  api.start=function(){ if(!api.supported)return; if(REDUCED_MOTION){ introPhase='ambient'; coreGroup.scale.setScalar(1.14); setTimeout(notifyBoom,80); return; } introPhase='charge'; introT=0; coreGroup.scale.setScalar(0.001); };
  api.goTo=function(view){ if(!api.supported||!VIEWS[view])return; flyTo(view); };
  api.pulse=function(){ if(!api.supported||introPhase!=='ambient')return; startWarp(); resetBurst(); };
  api.setTheme=setTheme;

  buildScene();
  initSectionColors();
  setTheme('day');
  setSectionTarget('about');
  api.debug={ renderer:renderer, scene:scene, camera:camera, coreUniforms:coreUniforms, controls:controls };
  window.addEventListener('resize',onResize);
  renderer.domElement.addEventListener('pointerup',function(e){ if(controls&&controls.enabled)handleClick(e); });
  animate();
})();