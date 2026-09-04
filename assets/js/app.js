/* 小白大世界 — 全站 3D 大世界主程序
 * 运行方式：纯静态 + 本地文件，file:// 双击可用。
 * 依赖：data.js -> three.min.js -> OrbitControls.js -> postprocessing/*.js -> 本文件
 */
(function () {
  'use strict';

  var DATA = window.SITE_DATA;
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ============================================================
   * 0. 状态 / DOM / 能力检测
   * ============================================================ */
  var IS_TOUCH = ('ontouchstart' in window) && window.matchMedia('(max-width: 1024px)').matches;
  var IS_MOBILE = window.matchMedia('(max-width: 820px)').matches || IS_TOUCH;
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Q = {
    mobile: IS_MOBILE,
    reducedMotion: REDUCED_MOTION,
    pixelRatio: IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    bloom: !IS_MOBILE && !REDUCED_MOTION,
    bloomStrength: 0.55,
    bloomRadius: 0.42,
    bloomThreshold: 0.62,
    particles: IS_MOBILE ? 360 : 1050,
    stars: IS_MOBILE ? 260 : 620,
    sphereSegments: IS_MOBILE ? 64 : 128,
    sphereRows: IS_MOBILE ? 30 : 48,
    atlasTile: IS_MOBILE ? 128 : 192,
    frameScale: IS_MOBILE ? 0.5 : 1,
    scrollSpeed: REDUCED_MOTION ? 0.004 : 0.018,
    spinSpeed: REDUCED_MOTION ? 0.005 : 0.03
  };

  var mode = 'day';
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2(999, 999);
  var pointerDown = null;
  var hoveredMesh = null;
  var clock = new THREE.Clock();
  var frameMeshes = [];
  var itemFrameMap = {};
  var islandRegistry = {};
  var islandAnimations = [];
  var themeMaterials = {
    platform: [],
    glow: [],
    sky: null,
    sphere: null,
    stars: null,
    particles: null,
    nebula: []
  };
  var sphereUniforms = null;
  var sphereMesh = null;
  var sphereItemList = [];
  var sphereAtlasPromise = null;
  var composer = null;
  var bloomPass = null;
  var renderer = null;
  var scene = null;
  var camera = null;
  var controls = null;
  var highlightRing = null;
  var highlightTimer = 0;
  var camAnim = null;
  var activeSlot = 'home';
  var loadingHidden = false;
  var firstFrameDone = false;
  var textureJobQueue = [];
  var idleTimer = null;

  /* ============================================================
   * 1. 数据工具
   * ============================================================ */
  var CATEGORY_META = {};
  DATA.categories.forEach(function (c) { CATEGORY_META[c.key] = c; });

  function categoryOf(item) {
    return (item && CATEGORY_META[item.category]) ? CATEGORY_META[item.category] : CATEGORY_META['日常'];
  }

  function numberLabel(n) {
    if (n == null) return '0';
    var s = String(n);
    if (/万/.test(s)) return s;
    var v = parseFloat(s);
    if (!isFinite(v)) return s;
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return s;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败: ' + url)); };
      // WebGL 在 file:// 下不能直接采样本地图片文件，因此优先使用构建期内嵌 data URI。
      var src = (window.EMBEDDED_IMAGES && window.EMBEDDED_IMAGES[url]) || url;
      img.src = src;
    });
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function canvasTexture(canvas, opts) {
    opts = opts || {};
    var tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = opts.linear ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = opts.mipmaps !== false;
    tex.anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
    return tex;
  }

  function makeRadialSpriteTexture(size, inner, outer, colorStops) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    colorStops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvasTexture(c, { linear: true, mipmaps: false });
  }

  var glowSpriteTex = null;
  function getGlowSprite() {
    if (!glowSpriteTex) {
      glowSpriteTex = makeRadialSpriteTexture(128, 0, 64, [
        [0, 'rgba(255,255,255,1)'],
        [0.22, 'rgba(255,190,218,0.85)'],
        [0.55, 'rgba(255,140,185,0.28)'],
        [1, 'rgba(255,140,185,0)']
      ]);
    }
    return glowSpriteTex;
  }

  function pseudoRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ============================================================
   * 2. UI 基础绑定 / 2D 降级页
   * ============================================================ */
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el.__timer);
    el.__timer = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
  }

  function buildFallback() {
    var meta = DATA.meta;
    var stats = DATA.stats;
    $('#fallback-avatar').src = meta.avatar;
    $('#fallback-bio').textContent = meta.desc + ' ' + meta.sign;
    $('#fallback-bili').href = meta.biliUrl;
    $('#fallback-xhs').href = meta.xhsUrl;
    $('#fallback-xhs-count').textContent = '（' + DATA.xhs.items.length + ' 件）';
    $('#fallback-bili-count').textContent = '（' + DATA.bili.items.length + ' 支视频）';

    var statHtml = [
      ['B站粉丝', stats.bili.fans], ['B站播放', stats.bili.plays],
      ['小红书粉丝', stats.xhs.followers], ['获赞与收藏', stats.xhs.likesAndCollects]
    ].map(function (s) { return '<div><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('');
    $('#fallback-stats').innerHTML = statHtml;

    function cardHtml(item, kind) {
      var cat = categoryOf(item);
      var link = item.url || 'javascript:void(0)';
      var label = kind === 'xhs' ? ('👍 ' + numberLabel(item.likes)) : ('▶ ' + numberLabel(item.play) + ' · 💬 ' + numberLabel(item.danmu));
      return '<a class="fallback-card" href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' +
        '<img loading="lazy" src="' + escapeHtml(item.cover) + '" alt="">' +
        '<b>' + escapeHtml(item.title) + '</b><span>' + cat.emoji + ' ' + escapeHtml(item.category) + ' · ' + label + '</span></a>';
    }
    $('#fallback-xhs-grid').innerHTML = DATA.xhs.items.map(function (it) { return cardHtml(it, 'xhs'); }).join('');
    $('#fallback-bili-grid').innerHTML = DATA.bili.items.map(function (it) { return cardHtml(it, 'bili'); }).join('');
  }

  function showFallback() {
    var loading = $('#loading');
    if (loading) loading.classList.add('hide');
    ['#topbar', '#world-chip', '#stats-strip', '#camera-dock', '#search-panel', '#detail-modal'].forEach(function (s) {
      var el = $(s);
      if (el) el.style.display = 'none';
    });
    var fb = $('#fallback');
    fb.hidden = false;
    buildFallback();
  }

  function isWebGLAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
   * 3. 球体贴图图集
   * ============================================================ */
  function drawCoverCrop(ctx, img, dx, dy, dw, dh) {
    if (!img || !img.width || !img.height) return;
    var ir = img.width / img.height;
    var tr = dw / dh;
    var sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (ir > tr) {
      sw = img.height * tr;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / tr;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function makeFallbackTile(ctx, dx, dy, dw, dh, item, index) {
    var g = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
    g.addColorStop(0, index % 2 ? '#ffd3e4' : '#ffe4ef');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = 'rgba(244,81,151,0.8)';
    ctx.font = 'bold ' + Math.max(14, dh * 0.18) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((item && item.title ? item.title.slice(0, 8) : '小白作品 💗'), dx + dw / 2, dy + dh / 2, dw * 0.9);
  }

  function makeSphereAtlas(items, tileW) {
    var tileH = Math.round(tileW * 0.75);
    var maxTex = renderer ? renderer.capabilities.maxTextureSize : 4096;
    if (tileW * items.length > maxTex) tileW = Math.max(64, Math.floor(maxTex / items.length));
    tileH = Math.round(tileW * 0.75);
    var canvas = document.createElement('canvas');
    canvas.width = tileW * items.length;
    canvas.height = tileH;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var draws = items.map(function (item, i) {
      var dx = i * tileW;
      return loadImage(item.cover).then(function (img) {
        drawCoverCrop(ctx, img, dx, 0, tileW, tileH);
      }).catch(function () {
        makeFallbackTile(ctx, dx, 0, tileW, tileH, item, i);
      });
    });

    return Promise.all(draws).then(function () {
      var tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    });
  }

  /* ============================================================
   * 4. 天空 / 光效 / 粒子 / 中央 LED 大球
   * ============================================================ */
  function makeSky() {
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color('#ffffff') },
        uMid: { value: new THREE.Color('#ffc2da') },
        uBottom: { value: new THREE.Color('#fff1f6') },
        uHorizon: { value: new THREE.Color('#ffe3ee') },
        uTime: { value: 0 }
      },
      vertexShader: [
        'varying vec3 vWorldPos;',
        'void main(){',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = wp.xyz;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vWorldPos;',
        'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uHorizon; uniform float uTime;',
        'void main(){',
        '  vec3 d = normalize(vWorldPos);',
        '  float h = d.y * 0.5 + 0.5;',
        '  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 0.75, h));',
        '  col = mix(col, uMid, sin(h * 3.14159) * 0.35);',
        '  float glow = pow(1.0 - abs(d.y), 3.0) * 0.28;',
        '  col += uHorizon * glow;',
        '  float tw = 0.5 + 0.5 * sin(vWorldPos.x * 0.035 + vWorldPos.y * 0.02 + uTime * 0.012);',
        '  col += uMid * tw * 0.04;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(190, 48, 24), mat);
    mesh.renderOrder = -20;
    mesh.frustumCulled = false;
    scene.add(mesh);
    themeMaterials.sky = mat;
    return mat;
  }

  function makeStars() {
    var rand = pseudoRandom(12345);
    var count = Q.stars;
    var positions = new Float32Array(count * 3);
    var radius = 120 + Math.random() * 45;
    for (var i = 0; i < count; i++) {
      var theta = rand() * Math.PI * 2;
      var phi = Math.acos(2 * rand() - 1);
      var r = 115 + rand() * 55;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.75 + 8;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.55 : 0.75,
      map: getGlowSprite(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    var points = new THREE.Points(geo, mat);
    scene.add(points);
    themeMaterials.stars = mat;
    return points;
  }

  function makeParticles() {
    var rand = pseudoRandom(20260905);
    var count = Q.particles;
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (rand() - 0.5) * 80;
      positions[i * 3 + 1] = -4 + rand() * 30;
      positions[i * 3 + 2] = (rand() - 0.5) * 70;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.32 : 0.4,
      map: getGlowSprite(),
      color: 0xffc5dd,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    var points = new THREE.Points(geo, mat);
    scene.add(points);
    themeMaterials.particles = mat;
    return points;
  }

  function makeNebula(x, y, z, scale, color) {
    var tex = makeRadialSpriteTexture(256, 0, 128, [
      [0, 'rgba(255,255,255,0.85)'],
      [0.3, color],
      [1, 'rgba(255,255,255,0)']
    ]);
    var mat = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(color), transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale * 0.65, 1);
    scene.add(sprite);
    themeMaterials.nebula.push(mat);
    return sprite;
  }

  function makeLightBeams() {
    var group = new THREE.Group();
    var beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb6d4, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    themeMaterials.glow.push(beamMat);
    var geo = new THREE.CylinderGeometry(0.22, 2.4, 36, 24, 1, true);
    for (var i = 0; i < 8; i++) {
      var beam = new THREE.Mesh(geo, beamMat);
      var a = (i / 8) * Math.PI * 2;
      beam.position.set(Math.cos(a) * 16, -14, Math.sin(a) * 16);
      beam.rotation.z = Math.cos(a) * 0.22;
      beam.rotation.x = Math.sin(a) * 0.22;
      group.add(beam);
    }
    scene.add(group);
    group.userData.isBeams = true;
    return group;
  }

  function makeCentralSphere() {
    sphereItemList = DATA.xhs.items.slice();
    var placeholder = document.createElement('canvas');
    placeholder.width = 64; placeholder.height = 48;
    var pctx = placeholder.getContext('2d');
    pctx.fillStyle = '#fff';
    pctx.fillRect(0, 0, 64, 48);
    var placeTex = new THREE.CanvasTexture(placeholder);
    placeTex.encoding = THREE.sRGBEncoding;

    sphereUniforms = {
      uAtlas: { value: placeTex },
      uCount: { value: sphereItemList.length },
      uScroll: { value: 0 },
      uActive: { value: -1 },
      uTime: { value: 0 },
      uBandY0: { value: 0.30 },
      uBandY1: { value: 0.70 },
      uBandSoft: { value: 0.025 },
      uBaseA: { value: new THREE.Color('#ff8fbc') },
      uBaseB: { value: new THREE.Color('#fff4f8') },
      uGridA: { value: new THREE.Color('#ffb7d2') },
      uGridB: { value: new THREE.Color('#ffffff') },
      uRim: { value: new THREE.Color('#ff5fa8') },
      uCoverBoost: { value: 0.72 }
    };

    var mat = new THREE.ShaderMaterial({
      uniforms: sphereUniforms,
      vertexShader: [
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'varying vec3 vViewDir;',
        'void main(){',
        '  vUv = uv;',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  vViewDir = normalize(-mv.xyz);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'varying vec3 vViewDir;',
        'uniform sampler2D uAtlas;',
        'uniform float uCount; uniform float uScroll; uniform float uActive; uniform float uTime;',
        'uniform float uBandY0; uniform float uBandY1; uniform float uBandSoft;',
        'uniform vec3 uBaseA; uniform vec3 uBaseB; uniform vec3 uGridA; uniform vec3 uGridB; uniform vec3 uRim; uniform float uCoverBoost;',
        'void main(){',
        '  vec3 n = normalize(vNormal);',
        '  vec3 vd = normalize(vViewDir);',
        '  float fres = pow(1.0 - abs(dot(n, vd)), 2.2);',
        '  vec3 base = mix(uBaseA, uBaseB, smoothstep(-0.65, 0.7, n.y));',
        '  float gx = 0.5 + 0.5 * sin(vUv.x * 6.28318 * 82.0 + uTime * 0.7);',
        '  float gy = 0.5 + 0.5 * sin(vUv.y * 6.28318 * 30.0 - uTime * 0.5);',
        '  float led = smoothstep(0.68, 0.93, gx) * smoothstep(0.68, 0.93, gy);',
        '  vec3 ledCol = mix(uGridA, uGridB, led);',
        '  float band = smoothstep(uBandY0, uBandY0 + uBandSoft, vUv.y) * (1.0 - smoothstep(uBandY1 - uBandSoft, uBandY1, vUv.y));',
        '  float scrolled = fract(vUv.x + uScroll);',
        '  float tileF = scrolled * uCount;',
        '  float tile = floor(tileF);',
        '  float localU = fract(tileF);',
        '  float localV = clamp((vUv.y - uBandY0) / (uBandY1 - uBandY0), 0.0, 1.0);',
        '  vec2 atlasUv = vec2((tile + localU) / uCount, localV);',
        '  vec4 cover = texture2D(uAtlas, atlasUv);',
        '  float isActive = step(abs(tile - uActive), 0.5);',
        '  vec3 panel = cover.rgb * (0.78 + led * 0.22);',
        '  panel = mix(panel, panel + vec3(0.10, 0.03, 0.08), isActive * 0.75);',
        '  panel += isActive * vec3(0.10, 0.02, 0.08) * (0.5 + 0.5 * sin(uTime * 4.0));',
        '  vec3 col = base * (0.18 + led * 0.52) + ledCol * (0.06 + led * 0.22);',
        '  col += panel * band * uCoverBoost;',
        '  col += uRim * fres * (0.18 + led * 0.28);',
        '  col += uGridB * pow(max(led, 0.0), 4.0) * 0.06;',
        '  col = clamp(col, 0.0, 1.0);',
        '  col = pow(col, vec3(0.4545));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });

    var geo = new THREE.SphereGeometry(8.6, Q.sphereSegments, Q.sphereRows);
    sphereMesh = new THREE.Mesh(geo, mat);
    sphereMesh.position.set(0, 3, 0);
    sphereMesh.userData.isSphere = true;
    sphereMesh.userData.slot = 'home';
    scene.add(sphereMesh);
    themeMaterials.sphere = mat;

    // 球体周围的分类星环
    var ringGroup = new THREE.Group();
    ringGroup.position.set(0, 3, 0);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(10.8, 0.035, 6, 120),
      new THREE.MeshBasicMaterial({ color: 0xffb1d0, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2.15;
    ringGroup.add(ring);
    var ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(11.6, 0.02, 6, 120),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring2.rotation.x = Math.PI / 2.45;
    ringGroup.add(ring2);

    DATA.categories.slice(0, 4).forEach(function (cat, i) {
      var canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 128;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.0)';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      roundedRectPath(ctx, 14, 20, 292, 84, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = cat.color || '#ff7bac';
      ctx.stroke();
      ctx.font = '44px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e0448c';
      ctx.fillText(cat.emoji + ' ' + cat.key, 160, 64);
      var tex = canvasTexture(canvas, { linear: true, mipmaps: true });
      var spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 });
      var sprite = new THREE.Sprite(spriteMat);
      var a = (i / 4) * Math.PI * 2 + 0.4;
      sprite.position.set(Math.cos(a) * 13.6, Math.sin(a * 2) * 1.2, Math.sin(a) * 13.6);
      sprite.scale.set(3.4, 1.36, 1);
      ringGroup.add(sprite);
      themeMaterials.glow.push(spriteMat);
    });
    scene.add(ringGroup);
    ringGroup.userData.isCategoryRing = true;
    return ringGroup;
  }

  /* ============================================================
   * 5. 漂浮岛与发光画框
   * ============================================================ */
  function makePlatformMaterial(color, emissive) {
    var m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.72,
      metalness: 0.04,
      emissive: new THREE.Color(emissive),
      emissiveIntensity: 0.25
    });
    themeMaterials.platform.push(m);
    return m;
  }

  function makeGlowMaterial(color, opacity) {
    var m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: opacity || 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    themeMaterials.glow.push(m);
    return m;
  }

  function createIslandBase(config) {
    var group = new THREE.Group();
    group.position.copy(config.center);
    group.userData = { islandId: config.id, baseY: config.center.y, bobPhase: pseudoRandom(config.center.x * 17 + config.center.z * 31)() * Math.PI * 2 };
    var topMat = makePlatformMaterial('#fff5f9', '#ffc2d8');
    var underMat = makePlatformMaterial('#ffd6e7', '#f7a6c5');
    var top = new THREE.Mesh(new THREE.CylinderGeometry(config.radius * 0.92, config.radius, 0.7, 48), topMat);
    top.position.y = 0.45;
    group.add(top);
    var under = new THREE.Mesh(new THREE.ConeGeometry(config.radius * 1.02, 1.9, 48), underMat);
    under.position.y = -0.55;
    under.rotation.x = Math.PI;
    group.add(under);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(config.radius * 0.96, 0.07, 8, 72), makeGlowMaterial('#ff9cc6', 0.8));
    rim.position.y = 0.8;
    rim.rotation.x = Math.PI / 2;
    group.add(rim);
    var rim2 = new THREE.Mesh(new THREE.TorusGeometry(config.radius * 0.96, 0.025, 6, 72), makeGlowMaterial('#ffffff', 0.7));
    rim2.position.y = 0.84;
    rim2.rotation.x = Math.PI / 2;
    group.add(rim2);

    var rand = pseudoRandom(config.id.length * 99 + config.radius);
    for (var i = 0; i < 5; i++) {
      var rockGeo = new THREE.DodecahedronGeometry(0.25 + rand() * 0.45, 0);
      var rock = new THREE.Mesh(rockGeo, makePlatformMaterial(i % 2 ? '#ffd3e4' : '#ffffff', '#ffb6d4'));
      var a = rand() * Math.PI * 2;
      var r = config.radius * (0.7 + rand() * 0.55);
      rock.position.set(Math.cos(a) * r, -0.8 - rand() * 0.8, Math.sin(a) * r);
      rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      group.add(rock);
    }

    scene.add(group);
    islandRegistry[config.id] = group;
    islandAnimations.push({ group: group, phase: group.userData.bobPhase, speed: 0.4 + rand() * 0.3, amp: 0.22 });
    return group;
  }

  var placeholderTextures = {};
  function getPlaceholderTexture(kind) {
    if (placeholderTextures[kind]) return placeholderTextures[kind];
    var w = kind === 'bili' ? 560 : 512;
    var h = kind === 'bili' ? 315 : 384;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#fff4f8');
    g.addColorStop(0.5, '#ffd8e8');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e84f92';
    ctx.font = 'bold ' + Math.round(h * 0.14) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💗 小白作品加载中', w / 2, h / 2);
    placeholderTextures[kind] = canvasTexture(c, { mipmaps: false, linear: true });
    return placeholderTextures[kind];
  }

  function drawRoundedCover(ctx, img, x, y, w, h, r) {
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    drawCoverCrop(ctx, img, x, y, w, h);
    ctx.restore();
    var grad = ctx.createLinearGradient(0, y + h * 0.72, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(74,14,50,0.55)');
    ctx.fillStyle = grad;
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.lineWidth = Math.max(4, w * 0.012);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    roundedRectPath(ctx, x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, Math.max(4, r - ctx.lineWidth / 2));
    ctx.stroke();
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text || '').split('');
    var lines = [];
    var line = '';
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = chars[i];
        if (lines.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length > 1 && lines.length === maxLines && i < chars.length - 1) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    lines.forEach(function (l, idx) {
      ctx.fillText(l, x, y + idx * lineHeight);
    });
    return lines;
  }

  function makeFrameTexture(item, kind) {
    var w = Q.frameScale < 1 ? (kind === 'bili' ? 420 : 384) : (kind === 'bili' ? 840 : 768);
    var h = kind === 'bili' ? Math.round(w * 9 / 16) : Math.round(w * 0.75);
    if (kind === 'image') { w = 640; h = 720; }
    return loadImage(item.cover).then(function (img) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var cat = categoryOf(item);
      // 白色毛玻璃画框
      ctx.fillStyle = 'rgba(255,255,255,0.0)';
      ctx.clearRect(0, 0, w, h);
      roundedRectPath(ctx, 8, 8, w - 16, h - 16, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = 'rgba(244,81,151,0.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      drawRoundedCover(ctx, img, 22, 20, w - 44, h - 74, 18);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      var badgeW = kind === 'bili' ? 112 : 116;
      ctx.font = 'bold ' + Math.round(w * 0.042) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var bx = 34, by = 32, bw = badgeW, bh = Math.round(w * 0.075);
      roundedRectPath(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = kind === 'bili' ? 'rgba(255,126,173,0.92)' : 'rgba(244,81,151,0.92)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(kind === 'bili' ? '📺 B站视频' : (kind === 'image' ? '🎀 图文' : '📕 小红书'), bx + bw / 2, by + bh / 2 + 1);

      // 底部标题区
      var title = item.title || (item.placeholder ? '图文作品整理中' : '小白作品');
      var ty = h - 44;
      ctx.fillStyle = '#5b2244';
      ctx.font = 'bold ' + Math.round(w * 0.052) + 'px "Microsoft YaHei UI", sans-serif';
      wrapCanvasText(ctx, title, 28, ty, w - 56, Math.round(w * 0.065), 2);

      var meta = kind === 'bili' ? ('▶ ' + numberLabel(item.play) + ' · 💬 ' + numberLabel(item.danmu) + ' · ' + (item.date || '')) : ('👍 ' + numberLabel(item.likes) + ' · ' + cat.emoji + ' ' + item.category);
      ctx.fillStyle = '#a06480';
      ctx.font = Math.round(w * 0.036) + 'px sans-serif';
      ctx.fillText(meta, 28, h - 16);

      var tex = canvasTexture(c, { mipmaps: false, linear: true });
      tex.needsUpdate = true;
      return tex;
    }).catch(function () {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#fff4f8'); g.addColorStop(1, '#ffd4e5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e84f92';
      ctx.font = 'bold ' + Math.round(w * 0.07) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💗 作品封面整理中', w / 2, h / 2);
      var tex = canvasTexture(c, { mipmaps: false, linear: true });
      tex.needsUpdate = true;
      return tex;
    });
  }

  var frameGeos = {};
  function getFrameGeo(kind) {
    if (frameGeos[kind]) return frameGeos[kind];
    var w = kind === 'bili' ? 2.05 : (kind === 'image' ? 1.4 : 1.78);
    var h = kind === 'bili' ? 1.16 : (kind === 'image' ? 1.56 : 1.34);
    frameGeos[kind] = new THREE.PlaneGeometry(w, h);
    return frameGeos[kind];
  }

  function addFrameToIsland(islandGroup, item, kind, localPos, faceYaw) {
    var geo = getFrameGeo(kind);
    var mat = new THREE.MeshBasicMaterial({
      map: getPlaceholderTexture(kind),
      toneMapped: false,
      transparent: false
    });
    var frame = new THREE.Mesh(geo, mat);
    frame.position.copy(localPos);
    frame.rotation.y = faceYaw;
    frame.userData = {
      item: item,
      kind: kind,
      islandId: islandGroup.userData.islandId,
      basePos: localPos.clone(),
      baseYaw: faceYaw,
      phase: pseudoRandom(localPos.x * 131 + localPos.z * 71 + localPos.y * 47)() * Math.PI * 2,
      loaded: false,
      highlight: 0
    };
    islandGroup.add(frame);
    frameMeshes.push(frame);
    itemFrameMap[item.id] = frame;
    return frame;
  }

  function makeIslandSign(group, text, y, color) {
    var canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 144;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 144);
    roundedRectPath(ctx, 20, 22, 472, 96, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = color || '#ff7bac';
    ctx.stroke();
    ctx.fillStyle = '#d84d8d';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 72);
    var tex = canvasTexture(canvas, { linear: true });
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var sprite = new THREE.Sprite(mat);
    sprite.position.set(0, y, 0);
    sprite.scale.set(5.4, 1.52, 1);
    group.add(sprite);
    themeMaterials.glow.push(mat);
    return sprite;
  }

  function createXhsIsland() {
    var center = new THREE.Vector3(-17, 0.6, 2);
    var group = createIslandBase({ id: 'xhs', center: center, radius: 8.4 });
    makeIslandSign(group, '📕 小红书岛 · 32件', 4.7, '#ff5c8d');
    var items = DATA.xhs.items;
    items.forEach(function (item, i) {
      var ring = i < 18 ? 0 : 1;
      var idx = ring === 0 ? i : i - 18;
      var count = ring === 0 ? 18 : 14;
      var r = ring === 0 ? 7.1 : 5.2;
      var y = ring === 0 ? 2.5 : 3.9;
      var a = (idx / count) * Math.PI * 2 + (ring * 0.3);
      var x = Math.sin(a) * r;
      var z = Math.cos(a) * r;
      addFrameToIsland(group, item, 'xhs', new THREE.Vector3(x, y + (ring ? 0.15 : 0), z), Math.atan2(x, z));
    });
    return group;
  }

  function createBiliIsland() {
    var center = new THREE.Vector3(18, 0.8, -1);
    var group = createIslandBase({ id: 'bili', center: center, radius: 10.2 });
    makeIslandSign(group, '📺 B站视频墙 · 42支', 6.6, '#ff4f9a');
    var items = DATA.bili.items;
    items.forEach(function (item, i) {
      var ring = Math.floor(i / 14);
      var idx = i % 14;
      var count = 14;
      var r = 8.7 - ring * 1.5;
      var y = 2.8 + ring * 1.85;
      var a = (idx / count) * Math.PI * 2 + ring * 0.18;
      var x = Math.sin(a) * r;
      var z = Math.cos(a) * r;
      addFrameToIsland(group, item, 'bili', new THREE.Vector3(x, y, z), Math.atan2(x, z));
    });
    return group;
  }

  function createImageIsland() {
    var center = new THREE.Vector3(15, 0.7, 12.5);
    var group = createIslandBase({ id: 'images', center: center, radius: 7.4 });
    makeIslandSign(group, '🎀 B站图文 · 整理中', 4.2, '#ff8fb7');
    DATA.bili.imagePlaceholders.forEach(function (item, i) {
      var ring = i < 10 ? 0 : 1;
      var idx = ring === 0 ? i : i - 10;
      var count = 10;
      var r = ring === 0 ? 5.8 : 4.6;
      var y = ring === 0 ? 2.4 : 3.5;
      var a = (idx / count) * Math.PI * 2 + ring * 0.32;
      var x = Math.sin(a) * r;
      var z = Math.cos(a) * r;
      var frame = addFrameToIsland(group, item, 'image', new THREE.Vector3(x, y, z), Math.atan2(x, z));
      frame.userData.palette = item.palette;
      // 图文占位直接使用专用画框，不请求网络图片
      makeImagePlaceholderTexture(item, frame);
    });
    return group;
  }

  function makeImagePlaceholderTexture(item, frame) {
    var c = document.createElement('canvas');
    c.width = 480; c.height = 540;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 540);
    g.addColorStop(0, item.palette[0]);
    g.addColorStop(1, item.palette[1]);
    ctx.fillStyle = g;
    roundedRectPath(ctx, 16, 16, 448, 508, 28);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎀', 240, 205);
    ctx.fillStyle = '#d84d8d';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('图文作品整理中', 240, 288);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 25px sans-serif';
    ctx.fillText('NO.' + String(item.index + 1).padStart(2, '0'), 240, 350);
    var tex = canvasTexture(c, { linear: true, mipmaps: false });
    frame.material.map = tex;
    frame.material.needsUpdate = true;
    frame.userData.loaded = true;
  }

  function createFeaturedIsland() {
    var center = new THREE.Vector3(0, 0.5, -15);
    var group = createIslandBase({ id: 'featured', center: center, radius: 7.2 });
    makeIslandSign(group, '✨ 精选焦点', 3.4, '#ff5c8d');
    var featured = [];
    var byLikes = DATA.xhs.items.slice().sort(function (a, b) { return parseFloat(b.likes) - parseFloat(a.likes); });
    var byPlay = DATA.bili.items.slice().sort(function (a, b) { return parseFloat(b.play) - parseFloat(a.play); });
    featured.push(byLikes[0], byLikes[1], byPlay[0], byPlay[1]);
    [DATA.xhs.items[0], DATA.bili.items[0]].forEach(function (it) { if (featured.indexOf(it) < 0) featured.push(it); });
    featured.slice(0, 6).forEach(function (item, i) {
      var count = 6;
      var r = 5.7;
      var a = (i / count) * Math.PI * 2;
      var kind = item.url.indexOf('bilibili') >= 0 ? 'bili' : 'xhs';
      addFrameToIsland(group, item, kind, new THREE.Vector3(Math.sin(a) * r, 2.5 + (i % 2) * 0.22, Math.cos(a) * r), Math.atan2(Math.sin(a), Math.cos(a)));
    });
    return group;
  }

  /* ============================================================
   * 6. 关于小白 / 关注卡片
   * ============================================================ */
  function drawInfoCardBase(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    roundedRectPath(ctx, 8, 8, w - 16, h - 16, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,123,172,0.55)';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  function makeAboutCardTexture() {
    var w = 900, h = 640;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    drawInfoCardBase(ctx, w, h);
    ctx.font = 'bold 48px "Microsoft YaHei UI", sans-serif';
    ctx.fillStyle = '#d84d8d';
    ctx.textAlign = 'center';
    ctx.fillText('🐰 关于小白', w / 2, 88);
    return loadImage(DATA.meta.avatar).then(function (img) {
      ctx.save();
      roundedRectPath(ctx, w / 2 - 110, 130, 220, 220, 62);
      ctx.clip();
      drawCoverCrop(ctx, img, w / 2 - 110, 130, 220, 220);
      ctx.restore();
      ctx.strokeStyle = '#ff8fbd';
      ctx.lineWidth = 8;
      roundedRectPath(ctx, w / 2 - 110, 130, 220, 220, 62);
      ctx.stroke();
      ctx.fillStyle = '#5b2244';
      ctx.font = 'bold 42px "Microsoft YaHei UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(DATA.meta.name, w / 2, 405);
      ctx.fillStyle = '#a06480';
      ctx.font = '28px "Microsoft YaHei UI", sans-serif';
      wrapCanvasText(ctx, DATA.meta.desc, w / 2, 458, w - 120, 42, 3);
      ctx.fillStyle = '#ff7bac';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText(DATA.meta.sign + ' · 📍' + DATA.meta.ip, w / 2, 584);
      return canvasTexture(c, { linear: true });
    }).catch(function () {
      ctx.fillStyle = '#ffc4da';
      ctx.beginPath();
      ctx.arc(w / 2, 240, 105, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d84d8d';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('💗', w / 2, 265);
      return canvasTexture(c, { linear: true });
    });
  }

  function makeFollowCardTexture(kind) {
    var w = 760, h = 430;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    drawInfoCardBase(ctx, w, h);
    var isBili = kind === 'bili';
    var avatarUrl = isBili ? DATA.meta.biliAvatar : DATA.meta.avatar;
    var title = isBili ? 'B站 · 小白超白的-' : '小红书 · 小白超白的';
    var stats = isBili ? [
      '粉丝 ' + DATA.stats.bili.fans,
      '获赞 ' + DATA.stats.bili.likes,
      '播放 ' + DATA.stats.bili.plays
    ] : [
      '粉丝 ' + DATA.stats.xhs.followers,
      '获赞与收藏 ' + DATA.stats.xhs.likesAndCollects,
      '小红书号 ' + DATA.stats.xhs.redId
    ];
    ctx.fillStyle = isBili ? '#ff7bac' : '#ff5c8d';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(isBili ? '📺' : '📕', 52, 64);
    return loadImage(avatarUrl).then(function (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(126, 130, 74, 0, Math.PI * 2);
      ctx.clip();
      drawCoverCrop(ctx, img, 52, 56, 148, 148);
      ctx.restore();
      ctx.strokeStyle = '#ff8fbd';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(126, 130, 74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#5b2244';
      ctx.font = 'bold 40px "Microsoft YaHei UI", sans-serif';
      ctx.fillText(title, 244, 118);
      ctx.fillStyle = '#a06480';
      ctx.font = '26px sans-serif';
      stats.forEach(function (s, i) {
        ctx.fillText('· ' + s, 248, 180 + i * 46);
      });
      ctx.fillStyle = '#ffffff';
      roundedRectPath(ctx, 48, 310, w - 96, 66, 22);
      var g = ctx.createLinearGradient(48, 310, w - 48, 310);
      g.addColorStop(0, '#ff7bac'); g.addColorStop(1, '#ffa3c7');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击关注 ↗', w / 2, 352);
      return canvasTexture(c, { linear: true });
    });
  }

  function addInfoArea() {
    var aboutCenter = new THREE.Vector3(-12, 1.4, -8.5);
    var followCenter = new THREE.Vector3(12, 1.4, -8.5);
    var aboutBase = createIslandBase({ id: 'about', center: aboutCenter, radius: 4.2 });
    var followBase = createIslandBase({ id: 'follow', center: followCenter, radius: 4.6 });
    makeIslandSign(aboutBase, '🐰 关于小白', 3.2, '#ff7bac');
    makeIslandSign(followBase, '💌 关注小白', 3.2, '#ff5c8d');

    var aboutMat = new THREE.MeshBasicMaterial({ map: getPlaceholderTexture('xhs'), transparent: false, toneMapped: false });
    var aboutCard = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4), aboutMat);
    aboutCard.position.set(0, 2.9, 0);
    aboutCard.userData = { link: DATA.meta.xhsUrl, aboutCard: true, islandId: 'about' };
    aboutBase.add(aboutCard);
    makeAboutCardTexture().then(function (tex) {
      aboutCard.material.map = tex;
      aboutCard.material.needsUpdate = true;
    }).catch(function () {});

    var biliMat = new THREE.MeshBasicMaterial({ map: getPlaceholderTexture('bili'), transparent: false, toneMapped: false });
    var biliCard = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7), biliMat);
    biliCard.position.set(-2.65, 3, 0);
    biliCard.rotation.y = -0.35;
    biliCard.userData = { link: DATA.meta.biliUrl, followCard: true, islandId: 'follow' };
    followBase.add(biliCard);
    makeFollowCardTexture('bili').then(function (tex) {
      biliCard.material.map = tex;
      biliCard.material.needsUpdate = true;
    }).catch(function () {});

    var xhsMat = new THREE.MeshBasicMaterial({ map: getPlaceholderTexture('xhs'), transparent: false, toneMapped: false });
    var xhsCard = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7), xhsMat);
    xhsCard.position.set(2.65, 3, 0);
    xhsCard.rotation.y = 0.35;
    xhsCard.userData = { link: DATA.meta.xhsUrl, followCard: true, islandId: 'follow' };
    followBase.add(xhsCard);
    makeFollowCardTexture('xhs').then(function (tex) {
      xhsCard.material.map = tex;
      xhsCard.material.needsUpdate = true;
    }).catch(function () {});

    return [aboutCard, biliCard, xhsCard];
  }

  /* ============================================================
   * 7. 纹理懒加载
   * ============================================================ */
  function buildTextureQueue() {
    textureJobQueue = [];
    // 先加载精选岛，再加载小红书岛和B站岛
    ['featured', 'xhs', 'bili'].forEach(function (islandId) {
      frameMeshes.forEach(function (frame) {
        if (frame.userData.islandId === islandId && !frame.userData.loaded && frame.userData.item && frame.userData.item.cover) {
          textureJobQueue.push(frame);
        }
      });
    });
  }

  function processTextureJobs(budget) {
    var start = performance.now();
    var did = 0;
    while (textureJobQueue.length && did < 2 && performance.now() - start < (budget || 12)) {
      var frame = textureJobQueue.shift();
      if (!frame || frame.userData.loaded) continue;
      var item = frame.userData.item;
      if (!item || !item.cover) continue;
      frame.userData.loaded = true; // 防止重复排队
      makeFrameTexture(item, frame.userData.kind).then(function (tex) {
        if (frame.material && frame.material.map !== tex) {
          frame.material.map = tex;
          frame.material.needsUpdate = true;
        }
      }).catch(function () {});
      did++;
    }
    if (textureJobQueue.length) scheduleIdleJobs();
  }

  function scheduleIdleJobs() {
    if (idleTimer) return;
    if ('requestIdleCallback' in window) {
      idleTimer = window.requestIdleCallback(function () { idleTimer = null; processTextureJobs(14); }, { timeout: 240 });
    } else {
      idleTimer = setTimeout(function () { idleTimer = null; processTextureJobs(14); }, 120);
    }
  }

  function bumpIslandToQueueFront(islandId) {
    var front = [];
    var rest = [];
    textureJobQueue.forEach(function (f) {
      if (f.userData.islandId === islandId) front.push(f); else rest.push(f);
    });
    textureJobQueue = front.concat(rest);
  }

  /* ============================================================
   * 8. 相机预设与飞行
   * ============================================================ */
  var CAMERA_SLOTS = {
    home: { pos: new THREE.Vector3(0, 5.5, 23.5), target: new THREE.Vector3(0, 3, 0), label: '首页' },
    works: { pos: new THREE.Vector3(-27, 9, 15), target: new THREE.Vector3(-16, 2.4, 2), label: '作品' },
    videos: { pos: new THREE.Vector3(28, 11, 11), target: new THREE.Vector3(17, 3.5, -1), label: '视频墙' },
    images: { pos: new THREE.Vector3(24, 9, 22), target: new THREE.Vector3(15, 2.6, 12.5), label: '图文' },
    about: { pos: new THREE.Vector3(-19, 6, -2), target: new THREE.Vector3(-12, 2, -8.5), label: '关于小白' },
    follow: { pos: new THREE.Vector3(19, 6, -2), target: new THREE.Vector3(12, 2, -8.5), label: '关注' }
  };

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function flyToCustom(pos, target, duration, slotName) {
    camAnim = {
      t: 0,
      dur: duration || 1.25,
      fromPos: camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      slot: slotName || null,
      done: false
    };
    controls.enabled = false;
  }

  function flyTo(slotName) {
    var slot = CAMERA_SLOTS[slotName] || CAMERA_SLOTS.home;
    if (slotName === 'works') bumpIslandToQueueFront('xhs');
    if (slotName === 'videos') bumpIslandToQueueFront('bili');
    if (slotName === 'images') bumpIslandToQueueFront('images');
    flyToCustom(slot.pos, slot.target, 1.35, slotName);
    setActiveSlot(slotName);
  }

  function setActiveSlot(slotName) {
    activeSlot = slotName;
    $$('[data-slot]').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-slot') === slotName);
    });
  }

  function updateCamAnim(dt) {
    if (!camAnim) return;
    camAnim.t += dt;
    var k = easeInOutCubic(Math.min(1, camAnim.t / camAnim.dur));
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
    controls.update();
    if (camAnim.t >= camAnim.dur) {
      camAnim = null;
      controls.enabled = true;
    }
  }

  /* ============================================================
   * 9. 高亮 / 搜索 / 详情
   * ============================================================ */
  function ensureHighlightRing() {
    if (highlightRing) return;
    highlightRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.06, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffe4f1, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    highlightRing.visible = false;
    scene.add(highlightRing);
  }

  function highlightFrame(frame) {
    ensureHighlightRing();
    if (!frame) return;
    frame.userData.highlight = 1.5;
    var pos = new THREE.Vector3();
    frame.getWorldPosition(pos);
    highlightRing.position.copy(pos);
    var dir = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.getWorldQuaternion(new THREE.Quaternion()));
    highlightRing.quaternion.copy(frame.getWorldQuaternion(new THREE.Quaternion()));
    highlightRing.position.addScaledVector(dir, 0.06);
    var s = frame.userData.kind === 'bili' ? 2.35 : (frame.userData.kind === 'image' ? 1.65 : 2.05);
    highlightRing.scale.set(s, s, 1);
    highlightRing.visible = true;
    highlightTimer = 1.5;
    toast('已定位：' + (frame.userData.item ? frame.userData.item.title : '作品'), 2000);
  }

  function locateItem(item) {
    if (!item) return;
    var frame = itemFrameMap[item.id];
    if (!frame) {
      toast('这件作品正在整理中 💗');
      return;
    }
    bumpIslandToQueueFront(frame.userData.islandId);
    frame.userData.loaded = false;
    textureJobQueue.unshift(frame);
    var worldPos = new THREE.Vector3();
    frame.getWorldPosition(worldPos);
    var dir = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.getWorldQuaternion(new THREE.Quaternion()));
    var camPos = worldPos.clone().addScaledVector(dir, 7.5);
    camPos.y = Math.max(camPos.y + 0.8, worldPos.y + 1.2);
    flyToCustom(camPos, worldPos, 1.3, activeSlot);
    setTimeout(function () { highlightFrame(frame); }, 1350);
  }

  var allSearchItems = DATA.xhs.items.map(function (it) {
    return { item: it, kind: 'xhs', platform: '小红书' };
  }).concat(DATA.bili.items.map(function (it) {
    return { item: it, kind: 'bili', platform: 'B站' };
  }));

  function searchItems(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    return allSearchItems.filter(function (entry) {
      var it = entry.item;
      return (it.title || '').toLowerCase().indexOf(q) >= 0 || (it.category || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 18);
  }

  function renderSearchResults(q) {
    var list = $('#search-results');
    var results = searchItems(q);
    if (!results.length) {
      list.innerHTML = '<li class="search-empty">没找到对应作品，换个关键词试试：开箱 / GBC / chiikawa 💗</li>';
      return;
    }
    list.innerHTML = results.map(function (entry) {
      var cat = categoryOf(entry.item);
      var meta = entry.kind === 'bili'
        ? '▶ ' + numberLabel(entry.item.play) + ' · 💬 ' + numberLabel(entry.item.danmu)
        : '👍 ' + numberLabel(entry.item.likes);
      return '<li data-id="' + escapeHtml(entry.item.id) + '">' +
        '<img loading="lazy" src="' + escapeHtml(entry.item.cover) + '" alt="">' +
        '<div class="search-result-main"><b>' + escapeHtml(entry.item.title) + '</b>' +
        '<span>' + entry.platform + ' · ' + cat.emoji + ' ' + escapeHtml(entry.item.category) + ' · ' + meta + '</span></div></li>';
    }).join('');
    $$('#search-results li[data-id]').forEach(function (li) {
      li.addEventListener('click', function () {
        var id = li.getAttribute('data-id');
        var found = null;
        allSearchItems.some(function (entry) { if (entry.item.id === id) { found = entry.item; return true; } return false; });
        closeSearch();
        if (found) locateItem(found);
      });
    });
  }

  function openSearch() {
    $('#search-panel').classList.add('open');
    $('#search-panel').setAttribute('aria-hidden', 'false');
    setTimeout(function () { $('#search-input').focus(); }, 60);
    renderSearchResults($('#search-input').value);
  }

  function closeSearch() {
    $('#search-panel').classList.remove('open');
    $('#search-panel').setAttribute('aria-hidden', 'true');
  }

  function openDetail(item, kind) {
    if (!item) return;
    var modal = $('#detail-modal');
    var cat = categoryOf(item);
    $('#detail-cover').src = item.cover || '';
    $('#detail-cover').alt = item.title || '作品封面';
    $('#detail-type').textContent = kind === 'bili' ? 'B站视频' : (kind === 'image' ? 'B站图文' : '小红书');
    $('#detail-cat').textContent = cat.emoji + ' ' + item.category;
    $('#detail-title').textContent = item.title || '小白作品';
    var statsHtml = '';
    if (kind === 'bili') {
      statsHtml = '<span class="detail-stat">▶ 播放 ' + escapeHtml(numberLabel(item.play)) + '</span>' +
        '<span class="detail-stat">💬 弹幕 ' + escapeHtml(numberLabel(item.danmu)) + '</span>' +
        (item.date ? '<span class="detail-stat">🗓️ ' + escapeHtml(item.date) + '</span>' : '');
    } else if (kind === 'image') {
      statsHtml = '<span class="detail-stat">🎀 图文作品整理中</span>';
    } else {
      statsHtml = '<span class="detail-stat">👍 点赞 ' + escapeHtml(numberLabel(item.likes)) + '</span>' +
        '<span class="detail-stat">📕 小红书 · ' + escapeHtml(DATA.stats.xhs.redId) + '</span>';
    }
    $('#detail-stats').innerHTML = statsHtml;
    $('#detail-note').textContent = kind === 'image'
      ? '这 20 个画框是B站图文作品的占位，数据与封面整理后会自动挂载到这里。'
      : '数据来自小白超白的的真实公开主页。点击下方按钮可前往原作品。';
    var link = $('#detail-link');
    if (item.url) {
      link.href = item.url;
      link.classList.remove('disabled');
      link.textContent = '打开原作品 ↗';
    } else {
      link.href = '#';
      link.classList.add('disabled');
      link.textContent = '整理中，敬请期待 💗';
    }
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeDetail() {
    var modal = $('#detail-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function showItemForFrame(frame) {
    var item = frame.userData.item;
    if (!item) return;
    if (item.placeholder) {
      openDetail(item, 'image');
    } else if (frame.userData.kind === 'bili') {
      openDetail(item, 'bili');
    } else {
      openDetail(item, 'xhs');
    }
  }

  /* ============================================================
   * 10. 日夜双氛围
   * ============================================================ */
  var DAY_PALETTE = {
    skyTop: '#ffffff', skyMid: '#ffc2da', skyBottom: '#fff1f6', skyHorizon: '#ffe3ee',
    fog: 0xffe8f1, fogDensity: 0.011,
    sphereBaseA: '#ff8fbc', sphereBaseB: '#fff5f9', gridA: '#ffb7d2', gridB: '#ffffff', rim: '#ff5fa8',
    hemiSky: 0xffffff, hemiGround: 0xffc8dc, hemiIntensity: 1.0,
    dir: 0xffffff, dirIntensity: 1.0,
    point: 0xff8fbc, pointIntensity: 1.5,
    starOpacity: 0.35, particleColor: '#ffc5dd', particleOpacity: 0.6,
    nebulaOpacity: 0.25, bloomStrength: 0.16, bloomThreshold: 0.88
  };
  var NIGHT_PALETTE = {
    skyTop: '#1b0a16', skyMid: '#5d1736', skyBottom: '#2a0d25', skyHorizon: '#ff8fbc',
    fog: 0x260a1d, fogDensity: 0.014,
    sphereBaseA: '#d63b78', sphereBaseB: '#fff0f6', gridA: '#ff8fbc', gridB: '#fff6fa', rim: '#ff5fa8',
    hemiSky: 0xffc4da, hemiGround: 0x4d0f2e, hemiIntensity: 0.55,
    dir: 0xffc4da, dirIntensity: 0.75,
    point: 0xff5fa8, pointIntensity: 2.0,
    starOpacity: 1.0, particleColor: '#ffb3d1', particleOpacity: 0.85,
    nebulaOpacity: 0.42, bloomStrength: 0.45, bloomThreshold: 0.72
  };

  function applyPalette(p) {
    if (themeMaterials.sky) {
      themeMaterials.sky.uniforms.uTop.value.set(p.skyTop);
      themeMaterials.sky.uniforms.uMid.value.set(p.skyMid);
      themeMaterials.sky.uniforms.uBottom.value.set(p.skyBottom);
      themeMaterials.sky.uniforms.uHorizon.value.set(p.skyHorizon);
    }
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    if (sphereUniforms) {
      sphereUniforms.uBaseA.value.set(p.sphereBaseA);
      sphereUniforms.uBaseB.value.set(p.sphereBaseB);
      sphereUniforms.uGridA.value.set(p.gridA);
      sphereUniforms.uGridB.value.set(p.gridB);
      sphereUniforms.uRim.value.set(p.rim);
    }
    if (themeMaterials.stars) themeMaterials.stars.opacity = p.starOpacity;
    if (themeMaterials.particles) {
      themeMaterials.particles.color.set(p.particleColor);
      themeMaterials.particles.opacity = p.particleOpacity;
    }
    themeMaterials.nebula.forEach(function (m, i) { m.opacity = p.nebulaOpacity * (0.7 + (i % 3) * 0.2); });
    themeMaterials.platform.forEach(function (m) {
      if (mode === 'day') {
        m.color.set('#fff5f9'); m.emissive.set('#ffc2d8'); m.emissiveIntensity = 0.25;
      } else {
        m.color.set('#5b1738'); m.emissive.set('#b02d5e'); m.emissiveIntensity = 0.45;
      }
    });
    themeMaterials.glow.forEach(function (m) {
      if (m.color) {
        if (mode === 'day') m.color.set('#ff9cc6');
        else m.color.set('#ff6ba5');
      }
      if (m.uniforms && m.uniforms.uRim) m.uniforms.uRim.value.set(p.rim);
    });
    if (bloomPass) {
      bloomPass.strength = p.bloomStrength;
      if (p.bloomThreshold != null) bloomPass.threshold = p.bloomThreshold;
    }
  }

  function toggleTheme() {
    mode = mode === 'day' ? 'night' : 'day';
    document.documentElement.setAttribute('data-theme', mode === 'night' ? 'dark' : '');
    $('#theme-btn').textContent = mode === 'day' ? '🌙' : '☀️';
    $('#world-chip-emoji').textContent = mode === 'day' ? '☀️' : '🌙';
    $('#world-chip-text').textContent = mode === 'day' ? '粉白日间泡泡园' : '深粉夜间霓虹秀';
    applyPalette(mode === 'day' ? DAY_PALETTE : NIGHT_PALETTE);
    applyLightPalette(mode === 'day' ? DAY_PALETTE : NIGHT_PALETTE);
    toast(mode === 'day' ? '☀️ 已切换到粉白日间泡泡园' : '🌙 已切换到深粉夜间霓虹秀');
  }

  /* ============================================================
   * 11. 背景音乐（原创程序化八音盒，默认关闭）
   * ============================================================ */
  var MusicBox = {
    ctx: null,
    master: null,
    playing: false,
    timer: null,
    nextTime: 0,
    step: 0,
    melody: [72, 74, 76, 79, 81, 79, 76, 74, 72, 74, 76, 81, 79, 76, 74, 72,
      67, 69, 71, 74, 76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 74, 72],
    ensure: function () {
      if (this.ctx) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.14;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
      }
    },
    note: function (freq, t, dur, vol) {
      if (!this.ctx || !this.master) return;
      var osc = this.ctx.createOscillator();
      var osc2 = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = 'sine';
      osc2.type = 'triangle';
      osc.frequency.value = freq;
      osc2.frequency.value = freq * 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      osc2.connect(g);
      var g2 = this.ctx.createGain();
      g2.gain.value = 0.22;
      g.connect(g2);
      g2.connect(this.master);
      osc.start(t);
      osc2.start(t);
      osc.stop(t + dur + 0.05);
      osc2.stop(t + dur + 0.05);
    },
    schedule: function () {
      while (this.nextTime < this.ctx.currentTime + 0.35) {
        var midi = this.melody[this.step % this.melody.length];
        var freq = 440 * Math.pow(2, (midi - 69) / 12);
        var dur = this.step % 4 === 3 ? 0.42 : 0.28;
        this.note(freq, this.nextTime, dur, this.step % 2 === 0 ? 0.5 : 0.3);
        if (this.step % 2 === 0) this.note(midi - 12, this.nextTime, dur, 0.14);
        this.nextTime += 0.24;
        this.step++;
      }
    },
    start: function () {
      this.ensure();
      if (!this.ctx) {
        toast('当前设备无法播放音乐，已静默跳过 🎵');
        return false;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.06;
      this.timer = setInterval(this.schedule.bind(this), 90);
      return true;
    },
    stop: function () {
      this.playing = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
  };

  function toggleMusic() {
    var btn = $('#music-btn');
    if (!MusicBox.playing) {
      var ok = MusicBox.start();
      if (ok) {
        btn.classList.add('playing');
        btn.textContent = '🎶';
        toast('🎶 八音盒已响起');
      }
    } else {
      MusicBox.stop();
      btn.classList.remove('playing');
      btn.textContent = '🎵';
      toast('已暂停音乐');
    }
  }

  /* ============================================================
   * 12. 交互：点击 / 悬停
   * ============================================================ */
  var interactiveMeshes = [];

  function buildInteractiveList(extra) {
    interactiveMeshes = frameMeshes.slice();
    if (sphereMesh) interactiveMeshes.push(sphereMesh);
    (extra || []).forEach(function (m) { interactiveMeshes.push(m); });
  }

  function sphereItemFromUv(uv) {
    if (!uv || !sphereItemList.length || !sphereUniforms) return null;
    var inBand = uv.y >= sphereUniforms.uBandY0.value - sphereUniforms.uBandSoft.value * 0.5 &&
      uv.y <= sphereUniforms.uBandY1.value + sphereUniforms.uBandSoft.value * 0.5;
    if (!inBand) return null;
    var scroll = sphereUniforms.uScroll.value;
    var x = (uv.x + scroll) % 1;
    if (x < 0) x += 1;
    var index = Math.floor(x * sphereItemList.length) % sphereItemList.length;
    return sphereItemList[index];
  }

  function handleClick(clientX, clientY) {
    var rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    var hits = raycaster.intersectObjects(interactiveMeshes, false);
    if (!hits.length) return;
    var hit = hits[0];
    var obj = hit.object;
    var ud = obj.userData;
    if (ud.link && (ud.followCard || ud.aboutCard)) {
      window.open(ud.link, '_blank', 'noopener');
      toast(ud.followCard ? '💌 已前往关注页' : '🐰 已打开小白主页');
      return;
    }
    if (ud.isSphere) {
      var item = sphereItemFromUv(hit.uv);
      if (item) {
        openDetail(item, 'xhs');
        if (sphereUniforms) {
          var scroll = sphereUniforms.uScroll.value;
          var x = (hit.uv.x + scroll) % 1; if (x < 0) x += 1;
          sphereUniforms.uActive.value = Math.floor(x * sphereItemList.length) % sphereItemList.length;
          setTimeout(function () { sphereUniforms.uActive.value = -1; }, 3200);
        }
      }
      return;
    }
    if (ud.item) {
      showItemForFrame(obj);
    }
  }

  function updateHover(clientX, clientY) {
    if (!renderer) return;
    var rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    var hits = raycaster.intersectObjects(interactiveMeshes, false);
    var next = hits.length ? hits[0].object : null;
    if (next !== hoveredMesh) {
      if (hoveredMesh && !hoveredMesh.userData.isSphere) {
        hoveredMesh.userData.hover = 0;
      }
      hoveredMesh = next;
      if (hoveredMesh && !hoveredMesh.userData.isSphere) {
        hoveredMesh.userData.hover = 1;
      }
      document.body.style.cursor = hoveredMesh ? 'pointer' : 'default';
    }
  }

  var hoverPending = false;
  function onPointerMove(e) {
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(function () {
      hoverPending = false;
      updateHover(e.clientX, e.clientY);
    });
  }

  function bindInteraction() {
    var stage = renderer.domElement;
    stage.addEventListener('pointerdown', function (e) {
      pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (camAnim) {
        camAnim = null;
        controls.enabled = true;
      }
    });
    stage.addEventListener('pointerup', function (e) {
      if (!pointerDown) return;
      var dx = e.clientX - pointerDown.x;
      var dy = e.clientY - pointerDown.y;
      var dt = performance.now() - pointerDown.t;
      pointerDown = null;
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7 && dt < 600) {
        handleClick(e.clientX, e.clientY);
      }
    });
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerleave', function () {
      if (hoveredMesh && !hoveredMesh.userData.isSphere) hoveredMesh.userData.hover = 0;
      hoveredMesh = null;
      document.body.style.cursor = 'default';
    });
  }

  /* ============================================================
   * 13. 渲染循环
   * ============================================================ */
  var lights = {};

  function initLights() {
    lights.hemi = new THREE.HemisphereLight(DAY_PALETTE.hemiSky, DAY_PALETTE.hemiGround, DAY_PALETTE.hemiIntensity);
    scene.add(lights.hemi);
    lights.dir = new THREE.DirectionalLight(DAY_PALETTE.dir, DAY_PALETTE.dirIntensity);
    lights.dir.position.set(8, 20, 10);
    scene.add(lights.dir);
    lights.point = new THREE.PointLight(DAY_PALETTE.point, DAY_PALETTE.pointIntensity, 45);
    lights.point.position.set(0, 3, 0);
    scene.add(lights.point);
  }

  function applyLightPalette(p) {
    if (!lights.hemi) return;
    lights.hemi.color.set(p.hemiSky);
    lights.hemi.groundColor.set(p.hemiGround);
    lights.hemi.intensity = p.hemiIntensity;
    lights.dir.color.set(p.dir);
    lights.dir.intensity = p.dirIntensity;
    lights.point.color.set(p.point);
    lights.point.intensity = p.pointIntensity;
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;

    if (sphereUniforms) {
      sphereUniforms.uTime.value = t;
      sphereUniforms.uScroll.value += dt * Q.scrollSpeed;
    }
    if (sphereMesh) sphereMesh.rotation.y += dt * Q.spinSpeed;

    // 分类星环
    scene.children.forEach(function (obj) {
      if (obj.userData && obj.userData.isCategoryRing) obj.rotation.y += dt * 0.055;
      if (obj.userData && obj.userData.isBeams) obj.rotation.y += dt * 0.018;
    });

    // 岛屿漂浮
    islandAnimations.forEach(function (a) {
      a.group.position.y = a.group.userData.baseY + Math.sin(t * a.speed + a.phase) * a.amp;
    });

    // 画框呼吸感
    frameMeshes.forEach(function (frame) {
      var ud = frame.userData;
      if (ud.highlight > 0) ud.highlight -= dt;
      var pulse = 1 + Math.sin(t * 0.9 + ud.phase) * 0.012 + (ud.hover ? 0.04 : 0) + (ud.highlight > 0 ? 0.07 + Math.sin(t * 7) * 0.03 : 0);
      frame.position.y = ud.basePos.y + Math.sin(t * 0.7 + ud.phase) * 0.1;
      frame.scale.setScalar(pulse);
    });

    if (highlightRing && highlightRing.visible) {
      highlightTimer -= dt;
      highlightRing.material.opacity = 0.35 + 0.55 * Math.abs(Math.sin(t * 5));
      var sc = highlightRing.scale.x * (1 + dt * 0.03);
      highlightRing.scale.set(sc, sc, 1);
      if (highlightTimer <= 0) highlightRing.visible = false;
    }

    if (themeMaterials.sky) themeMaterials.sky.uniforms.uTime.value = t;
    if (themeMaterials.stars && themeMaterials.stars.__points) themeMaterials.stars.__points.rotation.y += dt * 0.006;
    if (themeMaterials.particles && themeMaterials.particles.__points) {
      themeMaterials.particles.__points.rotation.y += dt * 0.012;
      themeMaterials.particles.__points.position.y = Math.sin(t * 0.2) * 0.35;
    }

    updateCamAnim(dt);
    controls.update();

    if (composer) {
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }

    if (!firstFrameDone) {
      firstFrameDone = true;
      scheduleIdleJobs();
      requestAnimationFrame(function () {
        if (!loadingHidden) setTimeout(hideLoadingIfReady, 500);
      });
    }
  }

  var atlasReady = false;
  function hideLoadingIfReady() {
    if (loadingHidden) return;
    if (firstFrameDone && (atlasReady || !sphereAtlasPromise)) {
      loadingHidden = true;
      var loading = $('#loading');
      if (loading) loading.classList.add('hide');
    } else {
      setTimeout(hideLoadingIfReady, 250);
    }
  }

  function onResize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Q.pixelRatio);
    if (composer) composer.setSize(w, h);
  }

  /* ============================================================
   * 14. 初始化
   * ============================================================ */
  function bindUI() {
    $$('[data-slot]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var slot = el.getAttribute('data-slot');
        closeSearch();
        closeDetail();
        flyTo(slot);
      });
    });

    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#music-btn').addEventListener('click', toggleMusic);
    $('#search-btn').addEventListener('click', function () {
      if ($('#search-panel').classList.contains('open')) closeSearch(); else openSearch();
    });
    $('#search-close').addEventListener('click', closeSearch);
    $('#search-input').addEventListener('input', function () {
      renderSearchResults(this.value);
    });
    $('#search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch();
    });
    $$('#search-hints button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('#search-input').value = btn.getAttribute('data-q');
        renderSearchResults(btn.getAttribute('data-q'));
        $('#search-input').focus();
      });
    });
    $$('[data-close-detail]').forEach(function (el) {
      el.addEventListener('click', closeDetail);
    });
    $('#detail-link').addEventListener('click', function (e) {
      if (this.classList.contains('disabled')) e.preventDefault();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeSearch();
        closeDetail();
      }
    });
  }

  function initThree() {
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !IS_MOBILE,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      renderer = null;
    }
    if (!renderer) {
      showFallback();
      return false;
    }
    renderer.setPixelRatio(Q.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    document.getElementById('stage').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(DAY_PALETTE.fog, DAY_PALETTE.fogDensity);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 420);
    camera.position.set(0, 5.5, 23.5);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 9;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI * 0.58;
    controls.enablePan = false;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.9;
    controls.update();

    initLights();
    makeSky();
    var stars = makeStars();
    themeMaterials.stars.__points = stars;
    var particles = makeParticles();
    themeMaterials.particles.__points = particles;
    makeNebula(-32, 8, -28, 52, 'rgba(255,143,188,0.8)');
    makeNebula(30, 4, -26, 46, 'rgba(255,190,214,0.8)');
    makeNebula(0, 16, -40, 60, 'rgba(255,225,235,0.9)');
    makeLightBeams();

    var categoryRing = makeCentralSphere();
    categoryRing.userData.categoryRing = true;

    createXhsIsland();
    createBiliIsland();
    createImageIsland();
    createFeaturedIsland();
    var infoCards = addInfoArea();
    buildTextureQueue();
    buildInteractiveList(infoCards);
    bindInteraction();

    // 球体封面图集：32 张小红书封面全部贴入 LED 球巡游带
    sphereAtlasPromise = makeSphereAtlas(sphereItemList, Q.atlasTile).then(function (tex) {
      if (sphereUniforms) {
        sphereUniforms.uAtlas.value = tex;
      }
      atlasReady = true;
      hideLoadingIfReady();
    }).catch(function () {
      atlasReady = true;
      hideLoadingIfReady();
    });

    if (Q.bloom) {
      try {
        composer = new THREE.EffectComposer(renderer);
        var renderPass = new THREE.RenderPass(scene, camera);
        composer.addPass(renderPass);
        bloomPass = new THREE.UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          Q.bloomStrength, Q.bloomRadius, Q.bloomThreshold
        );
        composer.addPass(bloomPass);
      } catch (e) {
        composer = null;
        bloomPass = null;
      }
    }

    window.addEventListener('resize', onResize);
    // 轻量诊断钩子（不参与 UI，便于自动化验收与排障）
    window.__XBW_DEBUG = {
      renderer: renderer,
      scene: scene,
      camera: camera,
      controls: controls,
      sphereMesh: sphereMesh,
      sphereUniforms: sphereUniforms,
      frameMeshes: frameMeshes,
      flyTo: flyTo
    };
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && MusicBox.playing) {
        MusicBox.stop();
        var btn = $('#music-btn');
        btn.classList.remove('playing');
        btn.textContent = '🎵';
      }
    });

    applyPalette(DAY_PALETTE);
    applyLightPalette(DAY_PALETTE);
    return true;
  }

  function start() {
    if (!DATA) {
      showFallback();
      return;
    }
    // 先填充数据条与降级页
    $('#stat-bili-fans').textContent = DATA.stats.bili.fans;
    $('#stat-bili-play').textContent = DATA.stats.bili.plays;
    $('#stat-xhs-fans').textContent = DATA.stats.xhs.followers;
    $('#stat-xhs-like').textContent = DATA.stats.xhs.likesAndCollects;
    buildFallback();

    if (!isWebGLAvailable()) {
      showFallback();
      return;
    }

    bindUI();
    if (initThree()) {
      animate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
