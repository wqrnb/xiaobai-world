/* 小白超白的空间 v5 · 3D 星球展厅
 * 主角星球：程序化地表（粉色大陆光斑）+ 发光经纬网格 + 流动能量河流 + 云层 + 大气光晕
 *          + 粒子星环 + 漂浮水晶/光柱 + 粉白星云背景。
 * 球面轨道相机：始终在星球外球面上，导航时沿弧线飞行（倾角/FOV 变化/粒子拖尾/白色闪光），
 *          拖拽连续旋转带惯性，松手自动吸附最近分区，滚轮限制在近景-中景。
 */
(function () {
  'use strict';

  /* ---------- 环境 ---------- */
  var canvas = document.getElementById('webgl-stage');
  var wrap = document.getElementById('webgl-stage-wrap');
  var flashEl = document.getElementById('intro-flash');
  if (!canvas || !wrap || !window.THREE) return;

  var mqSmall = window.matchMedia('(max-width: 1023.98px)');
  var mqCoarse = window.matchMedia('(pointer: coarse)');
  var mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var IS_SMALL = mqSmall.matches;
  var IS_COARSE = mqCoarse.matches;
  var REDUCED = mqReduced.matches;

  var Q = {
    small: IS_SMALL,
    coarse: IS_COARSE,
    reduced: REDUCED,
    pixelRatio: IS_COARSE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    // r128 的 UnrealBloomPass 对自定义 ShaderMaterial 的 composer 管线会双重 tone mapping 压黑，
    // 场景已用大量加法发光元素（网格/河流/节点/光晕/星云）替代后处理 bloom。
    bloom: false,
    stars: IS_SMALL ? 260 : 560,
    ringParticles: IS_SMALL ? 460 : 1000,
    burstParticles: IS_SMALL ? 420 : 1200,
    trailN: 260,
    planetSeg: IS_SMALL ? 64 : 96
  };

  var api = { supported: false, start: function () {}, goTo: function () {}, pulse: function () {}, setTheme: function () {}, currentView: 'about' };
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

  /* ---------- 常量与状态 ---------- */
  var R = 8;                                  // 星球半径
  var GRID_R = R * 1.012;                     // 经纬网格半径（贴表面）
  var D2R = Math.PI / 180;
  var baseFov = IS_SMALL ? 56 : 50;           // 星球占屏比：桌面约 65%、移动端约 48%
  var MIN_R = IS_SMALL ? 26.5 : 23.5;         // 最近：近景特写
  var MAX_R = IS_SMALL ? 42 : 40;             // 最远：中景，绝不甩到太空
  var DEFAULT_R = IS_SMALL ? 34.5 : 29;

  // 五个分区：球坐标方位（theta 方位角 / phi 极角）+ 星球表面节点
  var VIEWS = {
    about:    { theta: 0,          phi: 76 * D2R, label: '关于小白',  sub: 'ABOUT · 正面' },
    featured: { theta: 90 * D2R,   phi: 79 * D2R, label: '精选',      sub: 'FEATURED · 右侧' },
    xhs:      { theta: -90 * D2R,  phi: 79 * D2R, label: '小红书岛',  sub: 'XHS ISLAND · 左侧' },
    bili:     { theta: 135 * D2R,  phi: 79 * D2R, label: 'B站视频墙', sub: 'BILIBILI · 右后方' },
    follow:   { theta: 180 * D2R,  phi: 76 * D2R, label: '关注',      sub: 'FOLLOW · 背面' }
  };

  var cam = { theta: 0, phi: VIEWS.about.phi, radius: 58, fov: baseFov };
  var radiusTarget = DEFAULT_R;
  var orbit = {
    dragging: false, moved: 0, lastX: 0, lastY: 0,
    vTheta: 0, vPhi: 0, snapTimer: 0,
    pointers: {}, pinchDist: 1, pinchR: DEFAULT_R
  };
  var fly = null;                             // 弧线飞行/吸附动画
  var currentView = 'about';
  var nearestLive = 'about';                  // 拖拽过程中的实时最近分区（仅节点高亮用）
  var theme = 'day';
  var intro = 'idle', introT = 0, boomT = 0;
  var pulseKick = 0, shake = 0, surfacePulse = 0;
  var clock = new THREE.Clock();
  var hoverKey = null, lastHoverAt = 0, lastFov = baseFov;
  var prevCamPos = new THREE.Vector3();
  var nodeEventAcc = 0;

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrapPI(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function dispatch(name, detail) {
    var evt;
    try { evt = new CustomEvent(name, { detail: detail }); }
    catch (e) { evt = document.createEvent('Event'); evt.initEvent(name, true, true); evt.detail = detail; }
    document.dispatchEvent(evt);
  }
  function notifyBoom() { dispatch('xwb:boom'); }
  function camPos(theta, phi, r, out) {
    var sp = Math.sin(phi), cp = Math.cos(phi);
    return out.set(sp * Math.sin(theta), cp, sp * Math.cos(theta)).multiplyScalar(r);
  }
  function dirVec(theta, phi) {
    var sp = Math.sin(phi), cp = Math.cos(phi);
    return new THREE.Vector3(sp * Math.sin(theta), cp, sp * Math.cos(theta));
  }
  function nearestView() {
    var best = null, bestD = Infinity;
    Object.keys(VIEWS).forEach(function (k) {
      var v = VIEWS[k];
      var d = Math.abs(wrapPI(cam.theta - v.theta)) + Math.abs(cam.phi - v.phi) * 0.35;
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }
  function makeGlowTexture(size, stops) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function C(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

  /* ---------- 配色（日/夜 × 分区） ---------- */
  var PALETTES = {
    day: {
      base: { skyTop: '#ffe4f1', skyBottom: '#f7a8c8', nebula: '#f7c6de', halo: '#f7c2d8',
        ocean: '#f7a5c8', land: '#ff5ca8', landEdge: '#ffb3d0', river: '#ffe4f0',
        grid: '#ff4f9b', cloud: '#ffd6e8', rim: '#ffe4f0', label: '#ff3f8e',
        exposure: 0.72, bloom: 0.3, threshold: 0.8, gridOp: 0.34, starsOp: 0.4, nebOp: 0.22, haloOp: 0.14, pillarOp: 0.12 },
      about:   {},
      featured: { grid: '#ff2e85', land: '#ff54a0' },
      xhs:     { grid: '#ff1f78', skyBottom: '#f29ac2', land: '#ff4396' },
      bili:    { grid: '#ff5c9b', skyTop: '#ffe0ee' },
      follow:  { grid: '#ff6fa8', skyTop: '#ffeaf4' }
    },
    night: {
      base: { skyTop: '#1c0614', skyBottom: '#64163f', nebula: '#5a1036', halo: '#f53f8b',
        ocean: '#3f0c29', land: '#ed3d82', landEdge: '#7e1443', river: '#ffaed0',
        grid: '#ff4f9b', cloud: '#ff7db4', rim: '#ff74ac', label: '#ff74ac',
        exposure: 0.95, bloom: 0.6, threshold: 0.62, gridOp: 0.48, starsOp: 0.75, nebOp: 0.55, haloOp: 0.45, pillarOp: 0.26 },
      about:   {},
      featured: { grid: '#ff5fa6' },
      xhs:     { grid: '#ff2e85', skyBottom: '#701843' },
      bili:    { grid: '#ff74ac', skyTop: '#200815' },
      follow:  { grid: '#ff82b4', skyTop: '#220a16' }
    }
  };
  var COLOR_KEYS = ['skyTop', 'skyBottom', 'nebula', 'halo', 'ocean', 'land', 'landEdge', 'river', 'grid', 'cloud', 'rim', 'label'];
  var NUM_KEYS = ['exposure', 'bloom', 'threshold', 'gridOp', 'starsOp', 'nebOp', 'haloOp', 'pillarOp'];
  var cur = {}, tgt = {};

  /* ---------- 场景对象 ---------- */
  var renderer, scene, camera, composer, bloomPass;
  var skyMat, stars, starsMat, haloMat, nebulas = [];
  var planetGroup, surfaceMesh, surfaceUniforms, cloudMesh, cloudUniforms;
  var atmoMesh, gridMat, equatorMat, ringMat, ringMesh, ringPoints, pillarMat, pillars = [];
  var crystals = [];
  var anchors = {}, hitMeshes = [];
  var burstPoints, burstMat, burstVelocities;
  var waveGroup, waveMeshes = [], waveStates = [];
  var trailGeo, trailState;
  var glowTex;
  var tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), upVec = new THREE.Vector3(0, 1, 0);

  /* ---------- 构建场景 ---------- */
  function buildScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !IS_SMALL, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Q.pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.16;
    } catch (e) {
      wrap.style.display = 'none';
      document.body.classList.add('xwb-no3d');
      return;
    }
    api.supported = true;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(baseFov, window.innerWidth / window.innerHeight, 0.1, 240);
    camPos(0, VIEWS.about.phi, cam.radius, camera.position);
    camera.lookAt(0, 0, 0);

    glowTex = makeGlowTexture(128, [
      [0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,196,218,0.85)'],
      [0.55, 'rgba(255,120,175,0.28)'], [1, 'rgba(255,120,175,0)']
    ]);

    buildSky();
    buildPlanet();
    buildRingAndOrbits();
    buildNodes();
    buildParticles();

    if (Q.bloom) {
      try {
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));
        bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 0.75);
        composer.addPass(bloomPass);
      } catch (e) { composer = null; bloomPass = null; }
    }

    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerup', onTap);
  }

  /* 背景：明亮粉白渐变天空 + 极光带 + 星云光团 + 星空 + 星球光晕 */
  function buildSky() {
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: cur.skyTop }, uBottom: { value: cur.skyBottom }, uAurora: { value: cur.nebula }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'varying vec3 vPos;',
        'uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uAurora; uniform float uTime;',
        'void main(){',
        '  vec3 d = normalize(vPos);',
        '  float h = d.y*0.5+0.5;',
        '  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 0.75, h));',
        '  float b1 = exp(-pow((h-0.50)/0.115, 2.0));',
        '  float b2 = exp(-pow((h-0.66)/0.13, 2.0))*0.75;',
        '  float b3 = exp(-pow((h-0.32)/0.16, 2.0))*0.5;',
        '  float w1 = 0.55+0.45*sin(vPos.x*0.045 + uTime*0.16 + sin(vPos.z*0.05+uTime*0.07)*1.6);',
        '  float w2 = 0.55+0.45*sin(-vPos.x*0.06 + uTime*0.11 + vPos.z*0.02);',
        '  float w3 = 0.5+0.5*sin(vPos.z*0.05 - uTime*0.09);',
        '  col += uAurora * (b1*w1*0.35 + b2*w2*0.4 + b3*w3*0.22);',
        '  col += uAurora * 0.08 * (0.5+0.5*sin(vPos.y*0.09 - uTime*0.05));',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), skyMat));

    // 星空（细密、低对比，保证整体明亮）
    var starPos = new Float32Array(Q.stars * 3);
    for (var i = 0; i < Q.stars; i++) {
      var theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1), r = 34 + Math.random() * 20;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) * 0.8;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starsMat = new THREE.PointsMaterial({
      size: IS_SMALL ? 0.05 : 0.08, map: glowTex, color: 0xffffff,
      transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    stars = new THREE.Points(starGeo, starsMat);
    scene.add(stars);

    // 粉白星云光团
    for (var n = 0; n < 6; n++) {
      var nebTex = makeGlowTexture(256, [
        [0, 'rgba(255,255,255,0.8)'],
        [0.3, n % 2 ? 'rgba(255,122,174,0.42)' : 'rgba(255,190,215,0.38)'],
        [1, 'rgba(255,255,255,0)']
      ]);
      var nebMat = new THREE.SpriteMaterial({
        map: nebTex, color: cur.nebula, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sprite = new THREE.Sprite(nebMat);
      var a = (n / 6) * Math.PI * 2;
      sprite.position.set(Math.cos(a) * 16, Math.sin(a * 2) * 4.5, Math.sin(a) * 9 - 9);
      sprite.scale.set(17 + n * 2.5, 10 + n * 1.6, 1);
      sprite.userData = { speed: 0.02 + n * 0.006, phase: n * 1.3, basePos: sprite.position.clone(), scaleK: 0.9 + n * 0.07 };
      scene.add(sprite);
      nebulas.push(sprite);
    }

    // 星球背后的大光晕
    haloMat = new THREE.SpriteMaterial({
      map: glowTex, color: cur.halo, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var halo = new THREE.Sprite(haloMat);
    halo.scale.set(34, 34, 1);
    scene.add(halo);
  }

  /* 主角星球：地表 + 网格 + 云层 + 大气 */
  function buildPlanet() {
    planetGroup = new THREE.Group();
    scene.add(planetGroup);

    // 大气外晕（BackSide，只在星球边缘发光）
    var atmoMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uRim: { value: cur.rim } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: [
        'varying vec3 vN; varying vec3 vV;',
        'uniform vec3 uRim;',
        'void main(){',
        '  float f=pow(clamp(0.72-abs(dot(normalize(vN),normalize(vV))),0.0,1.0),2.4);',
        '  gl_FragColor=vec4(uRim, f*0.6);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.24, 64, 40), atmoMat);
    atmoMesh.renderOrder = 3;
    planetGroup.add(atmoMesh);

    // 地表（不透明，程序化纹理）
    surfaceUniforms = {
      uOcean: { value: cur.ocean }, uLand: { value: cur.land }, uLandEdge: { value: cur.landEdge },
      uRiver: { value: cur.river }, uRim: { value: cur.rim }, uTime: { value: 0 }, uPulse: { value: 0 }
    };
    var surfaceMat = new THREE.ShaderMaterial({
      uniforms: surfaceUniforms,
      vertexShader: [
        'varying vec3 vN; varying vec3 vP; varying vec3 vV;',
        'void main(){',
        '  vN = normalize(normalMatrix*normal);',
        '  vP = position;',
        '  vec4 mv = modelViewMatrix*vec4(position,1.0);',
        '  vV = normalize(-mv.xyz);',
        '  gl_Position = projectionMatrix*mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vN; varying vec3 vP; varying vec3 vV;',
        'uniform vec3 uOcean; uniform vec3 uLand; uniform vec3 uLandEdge; uniform vec3 uRiver; uniform vec3 uRim;',
        'uniform float uTime; uniform float uPulse;',
        'float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)))*43758.5453); }',
        'float noise3(vec3 p){',
        '  vec3 i = floor(p); vec3 f = fract(p);',
        '  f = f*f*(3.0-2.0*f);',
        '  return mix(',
        '    mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),',
        '    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),',
        '    f.z);',
        '}',
        'float fbm(vec3 p){',
        '  float v = 0.0; float a = 0.5;',
        '  for (int i = 0; i < 5; i++){ v += a*noise3(p); p = p*2.03 + vec3(1.7, 9.2, 2.3); a *= 0.5; }',
        '  return v;',
        '}',
        'void main(){',
        '  vec3 n = normalize(vN);',
        '  vec3 p = normalize(vP);',
        '  float ca = cos(uTime*0.045), sa = sin(uTime*0.045);',
        '  vec3 q = vec3(p.x*ca + p.z*sa, p.y, -p.x*sa + p.z*ca);',   // 地表缓慢漂移 → 飞行视差
        '  float cont = fbm(q*2.35 + 1.7);',
        '  float land = smoothstep(0.50, 0.605, cont);',               // 粉色大陆光斑
        '  float edge = smoothstep(0.455, 0.50, cont) * (1.0 - smoothstep(0.50, 0.565, cont));',
        '  float warp = fbm(q*3.1 + vec3(0.0, uTime*0.12, 0.0));',
        '  float rn = fbm(q*4.4 - vec3(0.0, uTime*0.32, 0.0) + warp*1.5);',
        '  float rn2 = fbm(q*6.2 + vec3(uTime*0.09, 0.0, 0.0));',
        '  float rivers = max(smoothstep(0.56, 0.80, rn), smoothstep(0.64, 0.86, rn2)*0.65);',  // 能量河流
        '  rivers *= 0.6 + 0.4*sin(q.y*16.0 - uTime*0.9);',            // 河流流光
        '  vec3 col = mix(uOcean, uLand, land);',
        '  col = mix(col, uLandEdge, edge*0.85);',
        '  col += uRiver * rivers * (1.5 + uPulse*2.2);',
        '  float shade = 0.55 + 0.45*max(dot(n, normalize(vec3(0.35, 0.75, 0.56))), 0.0);',
        '  col *= shade;',
        '  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 2.3);',
        '  col += uRim * (fres*0.35 + uPulse*0.45);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    surfaceMesh = new THREE.Mesh(new THREE.SphereGeometry(R, Q.planetSeg, Math.round(Q.planetSeg * 0.66)), surfaceMat);
    planetGroup.add(surfaceMesh);

    // 发光经纬网格
    var gridPts = [];
    var latSeg = 96;
    for (var li = -4; li <= 4; li++) {          // 纬度圈（每 18°）
      var lat = li * 18 * D2R;
      var y = Math.sin(lat) * GRID_R, c = Math.cos(lat) * GRID_R;
      for (var i = 0; i < latSeg; i++) {
        var a1 = (i / latSeg) * Math.PI * 2, a2 = ((i + 1) / latSeg) * Math.PI * 2;
        gridPts.push(Math.cos(a1) * c, y, Math.sin(a1) * c);
        gridPts.push(Math.cos(a2) * c, y, Math.sin(a2) * c);
      }
    }
    for (var m = 0; m < 12; m++) {              // 经线（每 30°）
      var az = m * 30 * D2R;
      var sax = Math.sin(az), caz = Math.cos(az);
      for (var j = 0; j < 48; j++) {
        var l1 = -80 * D2R + (j / 48) * 160 * D2R, l2 = -80 * D2R + ((j + 1) / 48) * 160 * D2R;
        gridPts.push(Math.cos(l1) * sax * GRID_R, Math.sin(l1) * GRID_R, Math.cos(l1) * caz * GRID_R);
        gridPts.push(Math.cos(l2) * sax * GRID_R, Math.sin(l2) * GRID_R, Math.cos(l2) * caz * GRID_R);
      }
    }
    var gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridPts), 3));
    gridMat = new THREE.LineBasicMaterial({
      color: cur.grid, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    planetGroup.add(new THREE.LineSegments(gridGeo, gridMat));

    // 加亮赤道线
    var eqPts = [];
    for (var e = 0; e < 128; e++) {
      var ea = (e / 128) * Math.PI * 2;
      eqPts.push(Math.cos(ea) * GRID_R * 1.001, 0, Math.sin(ea) * GRID_R * 1.001);
    }
    var eqGeo = new THREE.BufferGeometry();
    eqGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(eqPts), 3));
    equatorMat = new THREE.LineBasicMaterial({
      color: cur.river, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    planetGroup.add(new THREE.Line(eqGeo, equatorMat));

    // 云层 / 光雾
    cloudUniforms = { uCloud: { value: cur.cloud }, uTime: { value: 0 } };
    var cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: cloudUniforms,
      vertexShader: 'varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN=normalize(normalMatrix*normal); vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: [
        'varying vec3 vN; varying vec3 vP; varying vec3 vV;',
        'uniform vec3 uCloud; uniform float uTime;',
        'float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)))*43758.5453); }',
        'float noise3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);',
        '  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),',
        '  mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }',
        'float fbm(vec3 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p=p*2.03+vec2(1.7,9.2).xyx; a*=0.5; } return v; }',
        'void main(){',
        '  vec3 p = normalize(vP);',
        '  float t = uTime*0.05; float ca=cos(t), sa=sin(t);',
        '  vec3 q = vec3(p.x*ca + p.z*sa, p.y, -p.x*sa + p.z*ca);',
        '  float c = fbm(q*3.0 + vec3(0.0, uTime*0.02, 0.0));',
        '  c = smoothstep(0.5, 0.78, c);',
        '  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);',
        '  float a = c*0.07 + fres*0.04;',
        '  gl_FragColor = vec4(uCloud, a);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, IS_SMALL ? 40 : 56, IS_SMALL ? 26 : 36), cloudMat);
    cloudMesh.renderOrder = 2;
    planetGroup.add(cloudMesh);
  }

  /* 粒子星环 + 漂浮水晶 + 光柱 */
  function buildRingAndOrbits() {
    var ringGroup = new THREE.Group();
    ringGroup.rotation.x = -0.30;               // 轻微倾斜，像行星环
    planetGroup.add(ringGroup);

    ringMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: cur.rim }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'varying vec2 vUv; uniform vec3 uColor; uniform float uTime;',
        'void main(){',
        '  float r = mix(11.8, 15.6, vUv.y);',
        '  float a = smoothstep(11.9, 12.6, r) * (1.0 - smoothstep(15.0, 15.55, r));',
        '  float ang = vUv.x*6.28318;',
        '  float clump = 0.6 + 0.4*sin(ang*7.0 + uTime*0.05)*sin(ang*3.0 - uTime*0.03);',
        '  a *= 0.55 + 0.45*clump;',
        '  gl_FragColor = vec4(uColor, a*0.5);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(11.8, 15.6, 128, 4), ringMat);
    ringMesh.renderOrder = 4;
    ringGroup.add(ringMesh);

    var rp = new Float32Array(Q.ringParticles * 3);
    for (var i = 0; i < Q.ringParticles; i++) {
      var r = 11.7 + Math.random() * 4.0;
      var a = Math.random() * Math.PI * 2;
      rp[i * 3] = Math.cos(a) * r;
      rp[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      rp[i * 3 + 2] = Math.sin(a) * r;
    }
    var rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    var rMat = new THREE.PointsMaterial({
      size: IS_SMALL ? 0.09 : 0.11, map: glowTex, color: 0xffd9e9,
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    ringPoints = new THREE.Points(rGeo, rMat);
    ringGroup.add(ringPoints);

    // 漂浮水晶（少量，不遮挡内容）
    var crystalAz = [0.9, 2.35, 3.5, 4.4, 5.35, 6.1];
    var crystalR = [10.8, 12.4, 11.2, 13.0, 10.6, 12.0];
    var crystalY = [2.4, -1.8, 1.2, -2.4, 3.0, -0.6];
    for (var cIdx = 0; cIdx < 6; cIdx++) {
      var cMat = new THREE.MeshBasicMaterial({
        color: cIdx % 2 ? 0xffffff : 0xffb9d6, transparent: true, opacity: 0.92,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.34 + (cIdx % 3) * 0.07, 0), cMat);
      crystal.position.set(
        Math.sin(crystalAz[cIdx]) * crystalR[cIdx],
        crystalY[cIdx],
        Math.cos(crystalAz[cIdx]) * crystalR[cIdx]
      );
      crystal.userData = { phase: cIdx * 1.7, baseY: crystalY[cIdx], spin: 0.3 + cIdx * 0.05 };
      planetGroup.add(crystal);
      crystals.push(crystal);
    }

    // 光柱
    pillarMat = new THREE.MeshBasicMaterial({
      color: cur.cloud, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    var pillarSpecs = [
      { x: -12.8, y: 2.2, z: -3.4, h: 6.0 },
      { x: 13.4, y: 0.6, z: -2.2, h: 7.6 },
      { x: 12.8, y: -1.6, z: 6.2, h: 6.6 }
    ];
    pillarSpecs.forEach(function (s) {
      var pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 7, 10, 1, true), pillarMat);
      pillar.position.set(s.x, s.y, s.z);
      pillar.scale.y = s.h / 7;
      planetGroup.add(pillar);
      pillars.push(pillar);
    });
  }

  /* 五个分区：发光节点 + 光晕 + 表面定位环 + 文字标识 */
  function makeLabelTexture(title, sub) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.shadowColor = 'rgba(255,60,150,0.75)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(255,242,248,0.9)';
    roundRect(ctx, 20, 14, 472, 100, 50);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff5c9b';
    ctx.lineWidth = 4;
    roundRect(ctx, 20, 14, 472, 100, 50);
    ctx.stroke();
    ctx.fillStyle = '#c22f70';
    ctx.font = '700 44px "Microsoft YaHei UI", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 58);
    ctx.fillStyle = 'rgba(180,60,120,0.85)';
    ctx.font = '700 21px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(sub, 256, 96);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function buildNodes() {
    var white = C('#ffffff');
    Object.keys(VIEWS).forEach(function (key, idx) {
      var v = VIEWS[key];
      var dir = dirVec(v.theta, v.phi);
      var pos = dir.clone().multiplyScalar(R * 1.01);
      var group = new THREE.Group();

      // 表面定位环（贴合球面）
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.82, 48),
        new THREE.MeshBasicMaterial({
          color: cur.grid, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        })
      );
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      group.add(ring);

      // 发光节点
      var orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.4, 2),
        new THREE.MeshBasicMaterial({ color: cur.label, transparent: true, opacity: 0.9 })
      );
      orb.position.copy(pos);
      group.add(orb);

      // 光晕
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: cur.label, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      glow.position.copy(pos);
      glow.scale.set(1.7, 1.7, 1);
      group.add(glow);

      // 文字标识
      var label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(v.label, v.sub), transparent: true, depthWrite: false
      }));
      label.position.copy(pos).add(dir.clone().multiplyScalar(0.9));
      label.scale.set(4.6, 1.15, 1);
      group.add(label);

      // 隐形点击球（colorWrite 关闭，只用于拾取）
      var hit = new THREE.Mesh(
        new THREE.SphereGeometry(2.1, 10, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false, colorWrite: false })
      );
      hit.position.copy(pos);
      hit.userData.view = key;
      group.add(hit);
      hitMeshes.push(hit);

      planetGroup.add(group);
      anchors[key] = {
        group: group, orb: orb, glow: glow, ring: ring, label: label, hit: hit,
        pos: pos, dir: dir, scaleK: 1, phase: idx * 1.3
      };
    });
  }

  /* 爆发粒子 + 飞行拖尾 + 冲击波环 */
  function buildParticles() {
    // 爆发粒子（脉冲跃迁 / 开场 boom）
    var burstPos = new Float32Array(Q.burstParticles * 3);
    burstVelocities = new Float32Array(Q.burstParticles * 3);
    for (var b = 0; b < Q.burstParticles; b++) {
      burstPos[b * 3] = (Math.random() - 0.5) * 0.1;
      burstPos[b * 3 + 1] = (Math.random() - 0.5) * 0.1;
      burstPos[b * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    var burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
    burstMat = new THREE.PointsMaterial({
      size: IS_SMALL ? 0.1 : 0.13, map: glowTex, color: 0xffd7e6,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    burstPoints = new THREE.Points(burstGeo, burstMat);
    burstPoints.visible = false;
    scene.add(burstPoints);

    // 飞行拖尾（环形缓冲）
    trailState = {
      pos: new Float32Array(Q.trailN * 3),
      vel: new Float32Array(Q.trailN * 3),
      life: new Float32Array(Q.trailN),
      head: 0
    };
    trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Q.trailN * 3), 3));
    trailGeo.setDrawRange(0, 0);
    var trailMat = new THREE.PointsMaterial({
      size: IS_SMALL ? 0.16 : 0.22, map: glowTex, color: 0xffffff,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    scene.add(new THREE.Points(trailGeo, trailMat));

    // 冲击波环（面向相机的 billboard 环，跃迁时扫过星球）
    waveGroup = new THREE.Group();
    scene.add(waveGroup);
    for (var w = 0; w < 3; w++) {
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1.0, 96),
        new THREE.MeshBasicMaterial({
          color: w % 2 ? 0xffffff : 0xff9cc6, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        })
      );
      ring.visible = false;
      waveGroup.add(ring);
      waveMeshes.push(ring);
      waveStates.push({ life: 0, maxLife: 1.5, speed: 3.4 + w * 1.2, startOpacity: 0.9 - w * 0.15 });
    }
  }

  /* ---------- 配色应用 ---------- */
  function initColors() {
    COLOR_KEYS.forEach(function (k) {
      cur[k] = C('#ffd0e4');
      tgt[k] = C('#ffd0e4');
    });
    NUM_KEYS.forEach(function (k) { cur[k] = 0; tgt[k] = 0; });
  }
  function setSectionTarget(view) {
    var p = PALETTES[theme];
    var base = p.base, over = p[view] || {};
    COLOR_KEYS.forEach(function (k) { tgt[k].set(over[k] || base[k]); });
    NUM_KEYS.forEach(function (k) { tgt[k] = over[k] !== undefined ? over[k] : base[k]; });
  }
  function setTheme(next) {
    theme = next === 'night' ? 'night' : 'day';
    setSectionTarget(currentView);
  }

  /* ---------- 特效 ---------- */
  function resetBurst() {
    var pos = burstPoints.geometry.attributes.position.array;
    for (var i = 0; i < pos.length / 3; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
      var theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1), speed = 5.5 + Math.random() * 11;
      burstVelocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      burstVelocities[i * 3 + 1] = Math.cos(phi) * speed * 0.72;
      burstVelocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    burstPoints.geometry.attributes.position.needsUpdate = true;
    burstPoints.visible = true;
    burstMat.opacity = 0.95;
  }
  function fireWaves(big) {
    waveGroup.lookAt(camera.position);
    waveMeshes.forEach(function (ring, idx) {
      ring.visible = true;
      ring.scale.setScalar(0.04);
      ring.material.opacity = waveStates[idx].startOpacity;
      waveStates[idx].life = 0;
      waveStates[idx].maxScale = big ? 6.0 + idx * 2.2 : 3.4 + idx * 1.3;
    });
  }
  function startWarp() {
    shake = Math.max(shake, 0.22);
    surfacePulse = Math.max(surfacePulse, 0.6);
    if (flashEl) { flashEl.classList.remove('warp'); void flashEl.offsetWidth; flashEl.classList.add('warp'); }
  }
  function fireBoom() {
    intro = 'boom';
    boomT = 0;
    shake = 0.9;
    surfacePulse = 1;
    resetBurst();
    fireWaves(true);
    if (flashEl) { flashEl.classList.remove('boom'); void flashEl.offsetWidth; flashEl.classList.add('boom'); }
    notifyBoom();
  }
  function spawnTrail(n, pos, vel) {
    for (var i = 0; i < n; i++) {
      var idx = trailState.head;
      trailState.head = (trailState.head + 1) % Q.trailN;
      trailState.pos[idx * 3] = pos.x + (Math.random() - 0.5) * 0.5;
      trailState.pos[idx * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.5;
      trailState.pos[idx * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.5;
      trailState.vel[idx * 3] = vel.x * (0.45 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.4;
      trailState.vel[idx * 3 + 1] = vel.y * (0.45 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.4;
      trailState.vel[idx * 3 + 2] = vel.z * (0.45 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.4;
      trailState.life[idx] = 0.7 + Math.random() * 0.35;
    }
  }
  function updateTrail(dt) {
    var out = trailGeo.attributes.position.array;
    var count = 0;
    for (var i = 0; i < Q.trailN; i++) {
      if (trailState.life[i] <= 0) continue;
      trailState.life[i] -= dt;
      if (trailState.life[i] <= 0) continue;
      trailState.pos[i * 3] += trailState.vel[i * 3] * dt;
      trailState.pos[i * 3 + 1] += trailState.vel[i * 3 + 1] * dt;
      trailState.pos[i * 3 + 2] += trailState.vel[i * 3 + 2] * dt;
      trailState.vel[i * 3] *= (1 - dt * 1.4);
      trailState.vel[i * 3 + 1] *= (1 - dt * 1.4);
      trailState.vel[i * 3 + 2] *= (1 - dt * 1.4);
      out[count * 3] = trailState.pos[i * 3];
      out[count * 3 + 1] = trailState.pos[i * 3 + 1];
      out[count * 3 + 2] = trailState.pos[i * 3 + 2];
      count++;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.setDrawRange(0, count);
  }
  function updateBurst(dt) {
    var pos = burstPoints.geometry.attributes.position.array;
    for (var i = 0; i < pos.length / 3; i++) {
      pos[i * 3] += burstVelocities[i * 3] * dt;
      pos[i * 3 + 1] += burstVelocities[i * 3 + 1] * dt;
      pos[i * 3 + 2] += burstVelocities[i * 3 + 2] * dt;
      burstVelocities[i * 3] *= 0.984;
      burstVelocities[i * 3 + 1] *= 0.984;
      burstVelocities[i * 3 + 2] *= 0.984;
    }
    burstPoints.geometry.attributes.position.needsUpdate = true;
    burstMat.opacity = Math.max(0, 0.95 * (1 - boomT / 2.8));
    if (boomT > 2.8) { burstMat.opacity = 0; burstPoints.visible = false; }
  }
  function updateWaves(dt) {
    waveMeshes.forEach(function (ring, idx) {
      var st = waveStates[idx];
      if (st.life >= st.maxLife) { ring.visible = false; return; }
      st.life += dt;
      var k = st.life / st.maxLife;
      ring.scale.setScalar(0.04 + easeInOutCubic(k) * st.maxScale);
      ring.material.opacity = st.startOpacity * (1 - k);
    });
  }

  /* ---------- 弧线飞行 / 吸附 ---------- */
  /* 展示飞行三段：绕行俯冲（放大）→ 定格展示 → 回拉到常规距离；吸附飞行仅绕行 */
  var SHOW_K = 0.78;

  function flyTo(view, isSnap) {
    var v = VIEWS[view];
    var dTheta = wrapPI(v.theta - cam.theta);
    var toR = clamp(radiusTarget, MIN_R, MAX_R);
    var swingDur = REDUCED ? 0.01 : (isSnap
      ? Math.min(1.5, 0.75 + Math.abs(dTheta) * 0.55)
      : Math.min(2.0, 0.95 + Math.abs(dTheta) * 0.42));
    var holdDur = (!isSnap && !REDUCED) ? 0.65 : 0;
    var returnDur = (!isSnap && !REDUCED) ? 0.55 : 0;
    fly = {
      t: 0, dur: swingDur + holdDur + returnDur,
      swingDur: swingDur, holdDur: holdDur, returnDur: returnDur,
      fromTheta: cam.theta, dTheta: dTheta,
      fromPhi: cam.phi, dPhi: v.phi - cam.phi,
      fromR: cam.radius, toR: toR,
      showR: isSnap ? cam.radius : Math.max(MIN_R, toR * SHOW_K),
      view: view, snap: !!isSnap,
      dirSign: dTheta >= 0 ? 1 : -1,
      sparkled: false
    };
    orbit.vTheta = 0;
    orbit.vPhi = 0;
    orbit.snapTimer = 0;
    currentView = view;
    api.currentView = view;
    setSectionTarget(view);
    if (!isSnap && !REDUCED) startWarp();
    dispatch('xwb:view', { view: view });
  }

  /* 在节点处绽放一小簇星尘（定格展示时刻） */
  function sparkleAt(pos, dir, n) {
    for (var i = 0; i < n; i++) {
      var idx = trailState.head;
      trailState.head = (trailState.head + 1) % Q.trailN;
      var az = Math.random() * Math.PI * 2, el = (Math.random() - 0.5) * Math.PI;
      var sp = 0.9 + Math.random() * 1.6;
      trailState.pos[idx * 3] = pos.x;
      trailState.pos[idx * 3 + 1] = pos.y;
      trailState.pos[idx * 3 + 2] = pos.z;
      trailState.vel[idx * 3] = dir.x * 0.5 + Math.cos(az) * Math.cos(el) * sp;
      trailState.vel[idx * 3 + 1] = dir.y * 0.5 + Math.sin(el) * sp;
      trailState.vel[idx * 3 + 2] = dir.z * 0.5 + Math.sin(az) * Math.cos(el) * sp;
      trailState.life[idx] = 0.6 + Math.random() * 0.5;
    }
  }

  /* ---------- 输入 ---------- */
  function pinchDistNow() {
    var ids = Object.keys(orbit.pointers);
    if (ids.length < 2) return 0;
    var a = orbit.pointers[ids[0]], b = orbit.pointers[ids[1]];
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    orbit.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(orbit.pointers);
    if (ids.length === 2) {
      orbit.pinchDist = pinchDistNow() || 1;
      orbit.pinchR = cam.radius;
      orbit.dragging = false;
    } else {
      orbit.dragging = true;
      orbit.moved = 0;
      orbit.lastX = e.clientX;
      orbit.lastY = e.clientY;
      orbit.vTheta = 0;
      orbit.vPhi = 0;
      orbit.snapTimer = 0;
      if (fly) fly = null;                    // 打断飞行，交给手势
      canvas.style.cursor = 'grabbing';
    }
  }
  function onPointerMove(e) {
    if (!orbit.pointers[e.pointerId]) return;
    orbit.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(orbit.pointers);
    if (ids.length === 2) {
      var d = pinchDistNow();
      if (d > 1) radiusTarget = clamp(orbit.pinchR * orbit.pinchDist / d, MIN_R, MAX_R);
      return;
    }
    if (!orbit.dragging) {
      // 悬停检测（桌面端节点高亮 + 手型光标）
      if (!IS_COARSE) {
        var now = performance.now();
        if (now - lastHoverAt > 110) {
          lastHoverAt = now;
          var key = pickNode(e);
          if (key !== hoverKey) { hoverKey = key; canvas.style.cursor = key ? 'pointer' : 'grab'; }
        }
      }
      return;
    }
    var dx = e.clientX - orbit.lastX, dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    var k = 0.0046;
    orbit.vTheta = -dx * k;
    orbit.vPhi = -dy * k;
    cam.theta -= dx * k;
    cam.phi = clamp(cam.phi - dy * k, 0.7, 2.05);
    orbit.moved += Math.abs(dx) + Math.abs(dy);
    nearestLive = nearestView();
    spawnTrail(1, camera.position, tmpA.copy(camera.position).sub(prevCamPos).multiplyScalar(40));
  }
  function onPointerUp(e) {
    delete orbit.pointers[e.pointerId];
    var ids = Object.keys(orbit.pointers);
    if (ids.length === 0) {
      orbit.dragging = false;
      canvas.style.cursor = hoverKey ? 'pointer' : 'grab';
      if (orbit.moved > 10 || Math.abs(orbit.vTheta) > 0.0035 || Math.abs(orbit.vPhi) > 0.0035) {
        orbit.snapTimer = REDUCED ? 0.01 : 0.85;   // 松手后惯性滑行 → 自动吸附
      }
    } else if (ids.length === 1) {
      var p = orbit.pointers[ids[0]];
      orbit.dragging = true;
      orbit.lastX = p.x;
      orbit.lastY = p.y;
      orbit.moved = 0;
      orbit.pinchDist = 1;
    }
  }
  function onWheel(e) {
    e.preventDefault();
    radiusTarget = clamp(radiusTarget * Math.exp(e.deltaY * 0.0011), MIN_R, MAX_R);
    if (fly) fly = null;
  }
  function pickNode(e) {
    var rect = canvas.getBoundingClientRect();
    var ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    var ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(hitMeshes, false);
    if (!hits.length) return null;
    var blocked = ray.intersectObject(surfaceMesh, false);
    if (blocked.length && blocked[0].distance < hits[0].distance) return null;
    return hits[0].object.userData.view;
  }
  function onTap(e) {
    if (orbit.moved > 8) return;               // 拖拽不算点击
    var view = pickNode(e);
    if (view) api.goTo(view);
  }

  /* ---------- 帧循环 ---------- */
  function applyCamera() {
    camPos(cam.theta, cam.phi, cam.radius, tmpA);
    camera.position.copy(tmpA);
    var fwd = tmpB.copy(tmpA).normalize().negate();
    var bank = 0, sway = 0;
    if (fly) {
      var swingK = fly.snap ? Math.min(1, fly.t / fly.dur) : Math.min(1, fly.t / fly.swingDur);
      var s = Math.sin(Math.PI * swingK);
      bank = fly.dirSign * 0.11 * s;           // 绕行时向星球倾斜（侧倾）
      sway = 1.1 * s;
    }
    upVec.set(0, 1, 0);
    if (Math.abs(bank) > 0.001) upVec.applyAxisAngle(fwd, bank);
    camera.up.copy(upVec);
    var look = tmpC.set(0, 0, 0);
    if (fly && sway > 0.01) {                  // 视线朝飞行方向前探 → 视差
      camPos(cam.theta + fly.dirSign * 0.05, cam.phi, cam.radius, tmpA);
      camPos(cam.theta - fly.dirSign * 0.05, cam.phi, cam.radius, tmpB);
      var tang = tmpA.sub(tmpB).normalize();
      look.copy(tang).multiplyScalar(sway * 0.85);
    }
    camera.lookAt(look);
    if (shake > 0.001) {
      camera.position.x += (Math.random() * 2 - 1) * shake * 0.22;
      camera.position.y += (Math.random() * 2 - 1) * shake * 0.22;
    }
  }

  function dispatchNodePos() {
    var a = anchors[currentView];
    if (!a) return;
    var p = a.pos.clone().add(a.dir.clone().multiplyScalar(0.7));
    p.project(camera);
    var camDir = camera.position.clone().normalize();
    var visible = p.z < 1 && p.z > -1 && a.dir.dot(camDir) > 0.06;
    dispatch('xwb:node', {
      x: (p.x * 0.5 + 0.5) * window.innerWidth,
      y: (-p.y * 0.5 + 0.5) * window.innerHeight,
      visible: visible,
      view: currentView
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    var rawDt = Math.min(clock.getDelta(), 0.25);
    var dt = Math.min(rawDt, 0.05);     // 物理步长封顶，保证慢设备稳定
    var t = clock.elapsedTime;

    /* 开场：远空滑入 → 汇聚 → boom */
    if (intro === 'charge') {
      introT += rawDt;
      var ck = Math.min(1, introT / 1.7);
      var ce = easeInOutCubic(ck);
      cam.radius = 58 - (58 - DEFAULT_R) * ce;
      cam.theta = (1 - ce) * 1.15;
      cam.phi = VIEWS.about.phi;
      planetGroup.scale.setScalar(0.5 + 0.5 * ce);
      if (ck >= 1) fireBoom();
    } else if (intro === 'boom') {
      boomT += rawDt;
      updateBurst(dt);
      updateWaves(dt);
      shake = Math.max(0, shake - dt * 1.4);
      surfacePulse = Math.max(0, surfacePulse - dt * 0.8);
      if (boomT > 1.35) { intro = 'ambient'; shake = 0; }
    } else if (intro === 'ambient') {
      planetGroup.scale.setScalar(1);
      if (boomT < 3) { boomT += rawDt; updateBurst(dt); }
      updateWaves(dt);
    } else {
      planetGroup.scale.setScalar(0.5);
    }

    /* 球面轨道：飞行（绕行俯冲→定格展示→回拉）/ 惯性 / 吸附 */
    if (fly) {
      fly.t += rawDt;
      var swingK = fly.snap ? Math.min(1, fly.t / fly.dur) : Math.min(1, fly.t / fly.swingDur);
      var se = easeInOutCubic(swingK);
      var inHold = !fly.snap && fly.t >= fly.swingDur && fly.t < fly.swingDur + fly.holdDur;
      var inReturn = !fly.snap && fly.t >= fly.swingDur + fly.holdDur;
      cam.theta = fly.fromTheta + fly.dTheta * se;
      cam.phi = fly.fromPhi + fly.dPhi * se;
      if (fly.snap) {
        cam.radius = fly.fromR * (1 - 0.05 * Math.sin(Math.PI * Math.min(1, fly.t / fly.dur)));
      } else if (inReturn) {
        var re = easeInOutCubic(Math.min(1, (fly.t - fly.swingDur - fly.holdDur) / fly.returnDur));
        cam.radius = fly.showR + (fly.toR - fly.showR) * re;       // 回拉到常规距离
      } else if (inHold) {
        cam.radius = fly.showR;                                    // 定格展示特写
      } else {
        cam.radius = fly.fromR + (fly.showR - fly.fromR) * se;     // 沿轨道绕行 + 俯冲放大
      }
      if (inHold && !fly.sparkled) {
        fly.sparkled = true;
        surfacePulse = Math.max(surfacePulse, 0.55);               // 展示瞬间地表能量亮起
        var na = anchors[fly.view];
        if (na) sparkleAt(na.pos, na.dir, 18);
      }
      var camVel = tmpA.copy(camera.position).sub(prevCamPos).multiplyScalar(30);
      spawnTrail(fly.snap ? 1 : (inHold ? 0 : (inReturn ? 2 : 3)), camera.position, camVel);
      if (fly.t >= fly.dur) {
        cam.theta = wrapPI(fly.fromTheta + fly.dTheta);
        cam.phi = fly.fromPhi + fly.dPhi;
        cam.radius = fly.snap ? cam.radius : fly.toR;
        fly = null;
        orbit.vTheta = 0;
        orbit.vPhi = 0;
      }
    } else if (orbit.snapTimer > 0 && !orbit.dragging) {
      cam.theta += orbit.vTheta;
      cam.phi = clamp(cam.phi + orbit.vPhi, 0.7, 2.05);
      var decay = Math.exp(-dt * 3.6);
      orbit.vTheta *= decay;
      orbit.vPhi *= decay;
      orbit.snapTimer -= rawDt;
      if (orbit.snapTimer <= 0 || (Math.abs(orbit.vTheta) < 0.0008 && Math.abs(orbit.vPhi) < 0.0008)) {
        orbit.snapTimer = 0;
        var nv = nearestView();
        if (nv !== currentView || Math.abs(wrapPI(cam.theta - VIEWS[nv].theta)) > 0.03) {
          flyTo(nv, true);                     // 自动吸附到最近分区正面
        } else {
          orbit.vTheta = 0;
          orbit.vPhi = 0;
        }
      }
    } else if (!fly && !orbit.dragging && intro !== 'charge') {
      cam.radius += (radiusTarget - cam.radius) * Math.min(1, dt * 4.5);   // 滚轮平滑缩放
    }

    /* FOV：绕行俯冲收缩 / 定格展示轻微推镜 / 脉冲扩张 */
    var desired = baseFov;
    if (fly) {
      var swingK2 = fly.snap ? Math.min(1, fly.t / fly.dur) : Math.min(1, fly.t / fly.swingDur);
      var holdNow = !fly.snap && fly.t >= fly.swingDur && fly.t < fly.swingDur + fly.holdDur;
      if (holdNow) desired += 2.5;
      else desired -= 4.5 * Math.sin(Math.PI * swingK2);
    }
    if (intro === 'charge') desired -= 3 * Math.sin(Math.PI * Math.min(1, introT / 1.7));
    desired += pulseKick * 3;
    cam.fov += (desired - cam.fov) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - lastFov) > 0.02) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
      lastFov = cam.fov;
    }

    pulseKick = Math.max(0, pulseKick - dt * 2.2);
    surfacePulse = Math.max(0, surfacePulse - dt * 0.5);
    shake = Math.max(0, shake - dt * 1.4);

    applyCamera();

    /* 时间制服 */
    var cloudT = t;
    surfaceUniforms.uTime.value = t;
    surfaceUniforms.uPulse.value = surfacePulse;
    cloudUniforms.uTime.value = cloudT;
    ringMat.uniforms.uTime.value = t;
    cloudMesh.rotation.y += dt * 0.008;
    ringMesh.rotation.z += dt * 0.06;
    ringPoints.rotation.z -= dt * 0.02;
    stars.rotation.y += dt * 0.008;

    /* 水晶与光柱 */
    crystals.forEach(function (c) {
      c.position.y = c.userData.baseY + Math.sin(t * 0.9 + c.userData.phase) * 0.3;
      c.rotation.y += dt * c.userData.spin;
      c.rotation.x += dt * 0.18;
    });

    /* 星云漂移 */
    nebulas.forEach(function (obj) {
      var ud = obj.userData;
      obj.position.x = ud.basePos.x + Math.sin(t * ud.speed + ud.phase) * 1.4;
      obj.position.y = ud.basePos.y + Math.cos(t * ud.speed * 0.8 + ud.phase) * 0.9;
    });

    /* 节点动画：激活分区放大 + 脉冲 */
    Object.keys(anchors).forEach(function (key) {
      var a = anchors[key];
      var isActive = key === currentView;
      var isNear = key === nearestLive;
      var target = isActive ? 1.3 : (hoverKey === key ? 1.14 : 1);
      a.scaleK += (target - a.scaleK) * Math.min(1, dt * 6);
      var pulse = 1 + 0.22 * Math.sin(t * 2.6 + a.phase);
      a.orb.scale.setScalar(pulse * a.scaleK);
      var gs = (1.7 + 0.3 * Math.sin(t * 2.2 + a.phase)) * a.scaleK;
      a.glow.scale.set(gs, gs, 1);
      a.ring.scale.setScalar((1 + 0.3 * Math.sin(t * 1.8 + a.phase)) * (isActive || isNear ? 1.35 : 1));
      a.ring.rotation.z += dt * 0.4;
      var ls = isActive ? 1.12 : 1;
      a.label.scale.set(4.6 * ls, 1.15 * ls, 1);
      a.orb.material.color.copy(cur.label).multiplyScalar(2.0);
      a.glow.material.color.copy(cur.label).multiplyScalar(1.6);
    });

    /* 配色过渡 */
    var lk = Math.min(1, dt * 2.8);
    COLOR_KEYS.forEach(function (k) { cur[k].lerp(tgt[k], lk); });
    NUM_KEYS.forEach(function (k) { cur[k] += (tgt[k] - cur[k]) * lk; });
    gridMat.opacity = cur.gridOp * (0.85 + 0.15 * Math.sin(t * 1.3));
    gridMat.color.copy(cur.grid).multiplyScalar(1.8);
    equatorMat.opacity = cur.gridOp * 1.1;
    equatorMat.color.copy(cur.river).multiplyScalar(1.8);
    ringMat.uniforms.uColor.value.copy(cur.rim).multiplyScalar(1.5);
    starsMat.opacity = cur.starsOp;
    haloMat.opacity = cur.haloOp;
    pillarMat.opacity = cur.pillarOp;
    nebulas.forEach(function (s, i) { s.material.opacity = cur.nebOp * s.userData.scaleK; });
    renderer.toneMappingExposure = cur.exposure;
    if (bloomPass) {
      bloomPass.strength = cur.bloom;
      bloomPass.threshold = cur.threshold;
    }

    /* 连接光束：投影当前分区节点到屏幕坐标 */
    nodeEventAcc += dt;
    if (nodeEventAcc > 0.05) {
      nodeEventAcc = 0;
      dispatchNodePos();
    }

    prevCamPos.copy(camera.position);
    updateTrail(dt);
    skyMat.uniforms.uTime.value = t;
    if (composer) composer.render(dt); else renderer.render(scene, camera);
  }

  /* ---------- 布局（星球构图偏移：桌面避开右侧面板，移动端让出底部面板） ---------- */
  function applyViewOffset() {
    var w = window.innerWidth, h = window.innerHeight;
    if (mqSmall.matches) {
      camera.setViewOffset(w, h, 0, Math.round(h * 0.21), w, h);
    } else {
      var panel = document.getElementById('view-panel');
      var pw = panel ? panel.getBoundingClientRect().width : 0;
      camera.setViewOffset(w, h, Math.round(pw * 0.42), 0, w, h);
    }
  }
  function onResize() {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    applyViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Q.pixelRatio);
    if (composer) composer.setSize(w, h);
  }

  /* ---------- API ---------- */
  api.start = function () {
    if (!api.supported) return;
    if (REDUCED) {
      intro = 'ambient';
      planetGroup.scale.setScalar(1);
      cam.radius = DEFAULT_R;
      radiusTarget = DEFAULT_R;
      prevCamPos.copy(camera.position);
      setTimeout(notifyBoom, 60);
      return;
    }
    intro = 'charge';
    introT = 0;
    planetGroup.scale.setScalar(0.5);
    cam.radius = 58;
    radiusTarget = DEFAULT_R;
    prevCamPos.copy(camera.position);
  };
  api.goTo = function (view) {
    if (!api.supported || !VIEWS[view]) return;
    flyTo(view, false);
  };
  api.pulse = function () {
    if (!api.supported || intro !== 'ambient') return;
    startWarp();
    resetBurst();
    fireWaves(false);
    boomT = 0;
    pulseKick = 1;
    surfacePulse = 0.7;
    cam.radius = Math.max(MIN_R, cam.radius - 0.6);
  };
  api.setTheme = setTheme;

  /* ---------- 启动 ---------- */
  initColors();
  setTheme('day');
  buildScene();
  if (!api.supported) return;
  api.debug = {
    renderer: renderer, scene: scene, camera: camera, anchors: anchors,
    get planetScale() { return planetGroup ? Math.round(planetGroup.scale.x * 1000) / 1000 : 0; },
    get theme() { return theme; },
    get radius() { return Math.round(cam.radius * 10) / 10; },
    get intro() { return intro; }
  };
  setSectionTarget('about');
  prevCamPos.copy(camera.position);
  window.addEventListener('resize', onResize);
  applyViewOffset();
  camera.updateProjectionMatrix();
  animate();
})();
