/* 小白超白的空间 v3 · 3D 大爆炸星云背景
 * 纯程序化 WebGL：粉白星云、能量核心、粒子爆发、冲击波、bloom。
 * 不加载任何图片纹理，因此 file:// 双击也可正常运行。
 * 暴露 window.XBW_BG = { start, setTheme, supported }
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
    stars: IS_MOBILE ? 280 : 680,
    ambientParticles: IS_MOBILE ? 300 : 850,
    burstParticles: IS_MOBILE ? 500 : 1300,
    coreDetail: IS_MOBILE ? 3 : 5
  };

  var api = {
    supported: false,
    start: function () {},
    setTheme: function () {}
  };
  window.XBW_BG = api;

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  if (!webglAvailable()) {
    wrap.style.display = 'none';
    document.body.classList.add('xwb-no3d');
    return;
  }

  var renderer, scene, camera, composer, bloomPass;
  var skyMat, stars, starsMat, ambientPoints, ambientMat, burstPoints, burstMat;
  var coreMesh, coreUniforms, coreWire, coreGroup, waveMeshes = [], waveStates = [];
  var flashTimer = 0, shake = 0, introPhase = 'idle', introT = 0, boomT = 0;
  var clock = new THREE.Clock();
  var scrollP = 0;
  var theme = 'day';
  var burstVelocities = null;
  var sectionKeys = ['about', 'featured', 'xhs', 'bili', 'follow'];
  var currentSection = 'about';
  var sectionColors = null;
  var sectionTargets = null;
  var pointerTarget = { x: 0, y: 0 };
  var pointer = { x: 0, y: 0 };
  var lastScrollY = 0;
  var scrollVel = 0;
  var warpT = 0;
  var warpDuration = 1.05;
  var warpActive = false;
  var warpBaseZ = 0;
  var baseFov = 58;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !IS_MOBILE,
      powerPreference: 'high-performance'
    });
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

  var glowTex = makeGlowTexture(128, [
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,196,218,0.85)'],
    [0.55, 'rgba(255,120,175,0.28)'],
    [1, 'rgba(255,120,175,0)']
  ]);

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 120);
    camera.position.set(0, 0, 11);

    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color('#ffc4da') },
        uBottom: { value: new THREE.Color('#f76d9e') },
        uTime: { value: 0 }
      },
      vertexShader: [
        'varying vec3 vPos;',
        'void main(){',
        '  vPos = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vPos;',
        'uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime;',
        'void main(){',
        '  float h = normalize(vPos).y * 0.5 + 0.5;',
        '  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 0.78, h));',
        '  col += vec3(0.06, 0.01, 0.05) * sin(vPos.x * 0.05 + uTime * 0.05) * sin(vPos.y * 0.06);',
        '  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(55, 48, 24), skyMat);
    sky.renderOrder = -20;
    sky.frustumCulled = false;
    scene.add(sky);

    // 星空
    var starCount = Q.stars;
    var starPos = new Float32Array(starCount * 3);
    for (var i = 0; i < starCount; i++) {
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos(2 * Math.random() - 1);
      var r = 32 + Math.random() * 18;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) * 0.8;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starsMat = new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.06 : 0.09,
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    stars = new THREE.Points(starGeo, starsMat);
    scene.add(stars);

    // 星云光晕
    for (var n = 0; n < 5; n++) {
      var nebTex = makeGlowTexture(256, [
        [0, 'rgba(255,255,255,0.75)'],
        [0.32, n % 2 ? 'rgba(255,122,174,0.38)' : 'rgba(255,190,215,0.34)'],
        [1, 'rgba(255,255,255,0)']
      ]);
      var nebMat = new THREE.SpriteMaterial({
        map: nebTex,
        color: n % 2 ? 0xff7bac : 0xffc4da,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      var sprite = new THREE.Sprite(nebMat);
      var a = (n / 5) * Math.PI * 2;
      sprite.position.set(Math.cos(a) * 12, Math.sin(a * 2) * 4, Math.sin(a) * 8 - 3);
      sprite.scale.set(14 + n * 2, 8 + n, 1);
      sprite.userData = { speed: 0.02 + n * 0.006, phase: n * 1.3, basePos: sprite.position.clone() };
      scene.add(sprite);
      sprite.userData.isNebula = true;
    }

    // 中心能量核心
    coreUniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#b01f5b') },
      uHot: { value: new THREE.Color('#ff4f93') },
      uWhite: { value: new THREE.Color('#fff6fa') },
      uRim: { value: new THREE.Color('#ff9cc6') },
      uIntensity: { value: 1.0 },
      uRipple: { value: 0.0 }
    };
    var coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader: [
        'varying vec3 vN; varying vec3 vV; varying vec2 vUv;',
        'void main(){',
        '  vUv = uv;',
        '  vN = normalize(normalMatrix * normal);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  vV = normalize(-mv.xyz);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vN; varying vec3 vV; varying vec2 vUv;',
        'uniform vec3 uDeep; uniform vec3 uHot; uniform vec3 uWhite; uniform vec3 uRim;',
        'uniform float uTime; uniform float uIntensity; uniform float uRipple;',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float noise(vec2 p){',
        '  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);',
        '}',
        'float fbm(vec2 p){',
        '  float v = 0.0; float a = 0.5;',
        '  for(int i=0;i<4;i++){ v += a*noise(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; }',
        '  return v;',
        '}',
        'void main(){',
        '  vec3 n = normalize(vN); vec3 v = normalize(vV);',
        '  float fres = pow(1.0 - abs(dot(n, v)), 2.0);',
        '  float energy = fbm(n.xy * 3.1 + uTime * 0.22) * 0.75 + 0.25;',
        '  float wave = 0.5 + 0.5 * sin(vUv.y * 42.0 - uTime * 3.2);',
        '  wave *= smoothstep(0.25, 1.0, energy + uRipple);',
        '  vec3 col = uDeep + uHot * energy * 1.7 + uWhite * wave * 0.55;',
        '  col += uRim * fres * 1.9;',
        '  col *= uIntensity;',
        '  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var coreGeo = new THREE.IcosahedronGeometry(1, Q.coreDetail);
    coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreGroup = new THREE.Group();
    coreGroup.add(coreMesh);

    var wireGeo = new THREE.IcosahedronGeometry(1.35, 1);
    var wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    coreWire = new THREE.Mesh(wireGeo, wireMat);
    coreGroup.add(coreWire);
    coreGroup.position.set(0, 0.1, 0);
    coreGroup.scale.setScalar(0.001);
    scene.add(coreGroup);

    // 冲击波环
    var ringGeo = new THREE.RingGeometry(0.86, 0.94, 96);
    for (var w = 0; w < 4; w++) {
      var ringMat = new THREE.MeshBasicMaterial({
        color: w % 2 ? 0xffffff : 0xff9cc6,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.z = -0.1 - w * 0.02;
      ring.scale.setScalar(0.001);
      ring.visible = false;
      coreGroup.add(ring);
      waveMeshes.push(ring);
      waveStates.push({ life: 0, maxLife: 1.6, speed: 3.2 + w * 1.1, startOpacity: 0.95 - w * 0.16 });
    }

    // 环绕星尘
    var ambientCount = Q.ambientParticles;
    var ambPos = new Float32Array(ambientCount * 3);
    for (var a = 0; a < ambientCount; a++) {
      var ar = 2.2 + Math.pow(Math.random(), 0.55) * 8.5;
      var aa = Math.random() * Math.PI * 2;
      var ay = (Math.random() - 0.5) * 4.2;
      ambPos[a * 3] = Math.cos(aa) * ar;
      ambPos[a * 3 + 1] = ay;
      ambPos[a * 3 + 2] = Math.sin(aa) * ar * 0.72;
    }
    var ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute('position', new THREE.BufferAttribute(ambPos, 3));
    ambientMat = new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.05 : 0.075,
      map: glowTex,
      color: 0xffb6d2,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    ambientPoints = new THREE.Points(ambGeo, ambientMat);
    scene.add(ambientPoints);

    // 爆发粒子
    var burstCount = Q.burstParticles;
    var burstPos = new Float32Array(burstCount * 3);
    burstVelocities = new Float32Array(burstCount * 3);
    for (var b = 0; b < burstCount; b++) {
      burstPos[b * 3] = (Math.random() - 0.5) * 0.1;
      burstPos[b * 3 + 1] = (Math.random() - 0.5) * 0.1;
      burstPos[b * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    var burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
    burstMat = new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.09 : 0.12,
      map: glowTex,
      color: 0xffd7e6,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    burstPoints = new THREE.Points(burstGeo, burstMat);
    burstPoints.visible = false;
    scene.add(burstPoints);

    // 后处理 bloom
    if (Q.bloom) {
      try {
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));
        bloomPass = new THREE.UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          0.4, 0.6, 0.9
        );
        composer.addPass(bloomPass);
      } catch (e) {
        composer = null;
        bloomPass = null;
      }
    }
  }

  function resetBurst() {
    var pos = burstPoints.geometry.attributes.position.array;
    for (var i = 0; i < pos.length / 3; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos(2 * Math.random() - 1);
      var speed = 5.5 + Math.random() * 11;
      burstVelocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      burstVelocities[i * 3 + 1] = Math.cos(phi) * speed * 0.72;
      burstVelocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    burstPoints.geometry.attributes.position.needsUpdate = true;
    burstPoints.visible = true;
    burstMat.opacity = 0.95;
  }

  function resetWaves() {
    waveMeshes.forEach(function (ring, idx) {
      ring.visible = true;
      ring.scale.setScalar(0.001);
      ring.material.opacity = waveStates[idx].startOpacity;
      waveStates[idx].life = 0;
    });
  }

  function notifyBoom() {
    var evt;
    try {
      evt = new CustomEvent('xwb:boom');
    } catch (e) {
      evt = document.createEvent('Event');
      evt.initEvent('xwb:boom', true, true);
    }
    document.dispatchEvent(evt);
  }

  function triggerBoom() {
    introPhase = 'boom';
    boomT = 0;
    shake = 0.9;
    coreUniforms.uRipple.value = 1.0;
    resetBurst();
    resetWaves();
    if (flashEl) {
      flashEl.classList.remove('boom');
      void flashEl.offsetWidth;
      flashEl.classList.add('boom');
    }
    notifyBoom();
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
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
    if (boomT > 2.8) burstMat.opacity = 0;
  }

  function updateWaves(dt) {
    waveMeshes.forEach(function (ring, idx) {
      var st = waveStates[idx];
      if (st.life >= st.maxLife) {
        ring.visible = false;
        return;
      }
      st.life += dt;
      var k = st.life / st.maxLife;
      ring.scale.setScalar(0.001 + easeOutCubic(k) * (5.5 + idx * 1.7));
      ring.material.opacity = st.startOpacity * (1 - k);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;
    var rawY = window.scrollY || 0;
    var rawVel = (rawY - lastScrollY) / Math.max(dt, 0.001);
    lastScrollY = rawY;
    scrollVel += (rawVel - scrollVel) * Math.min(1, dt * 5);
    scrollP = Math.min(1, Math.max(0,
      rawY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    ));
    var speedK = Math.min(1, Math.abs(scrollVel) / 320);
    pointer.x += (pointerTarget.x - pointer.x) * Math.min(1, dt * 3.4);
    pointer.y += (pointerTarget.y - pointer.y) * Math.min(1, dt * 3.4);

    if (warpActive) {
      warpT += dt;
      if (warpT >= warpDuration) warpActive = false;
    }
    var warpK = warpActive ? Math.min(1, warpT / warpDuration) : 1;
    var warpPulse = warpActive ? Math.sin(warpK * Math.PI) : 0;

    if (introPhase === 'charge') {
      introT += dt;
      var chargeK = Math.min(1, introT / 0.9);
      coreGroup.scale.setScalar(0.06 + chargeK * 0.3 + Math.sin(t * 12) * 0.025 * chargeK);
      coreUniforms.uIntensity.value = 0.7 + chargeK * 1.6;
      if (introT >= 0.9) triggerBoom();
    } else if (introPhase === 'boom') {
      boomT += dt;
      var boomK = Math.min(1, boomT / 1.05);
      coreGroup.scale.setScalar(0.3 + easeOutCubic(boomK) * 1.0);
      coreUniforms.uIntensity.value = 1.9 - boomK * 0.6;
      coreUniforms.uRipple.value = Math.max(0, 1.0 - boomT * 1.6);
      updateBurst(dt);
      updateWaves(dt);
      shake = Math.max(0, shake - dt * 1.4);
      if (boomT > 2.6) {
        introPhase = 'ambient';
        shake = 0;
      }
    } else if (introPhase === 'ambient') {
      coreGroup.scale.setScalar(1.22 + Math.sin(t * 1.5) * 0.07 + warpPulse * 0.42 + speedK * 0.08);
      coreUniforms.uIntensity.value = 1.25 + Math.sin(t * 1.3) * 0.12 + speedK * 0.35 + warpPulse * 0.65;
      updateBurst(dt);
      updateWaves(dt);
    } else {
      // idle：等待 app 调用 start
      coreUniforms.uIntensity.value = 0.55;
    }

    coreUniforms.uTime.value = t;
    coreMesh.rotation.y += dt * (0.28 + scrollP * 0.45 + speedK * 0.55);
    coreMesh.rotation.x += dt * (0.12 + speedK * 0.25);
    coreWire.rotation.y -= dt * (0.35 + speedK * 0.6);
    coreWire.rotation.z += dt * 0.16;
    coreGroup.position.y = 0.15 - scrollP * 2.2 + pointer.y * 0.45;
    coreGroup.position.x = Math.sin(scrollP * Math.PI * 1.5) * 1.1 + pointer.x * 0.7;

    stars.rotation.y += dt * (0.008 + scrollP * 0.02 + speedK * 0.16);
    stars.rotation.x += dt * speedK * 0.08;
    var starStretch = 1 + speedK * 0.35 + warpPulse * 0.5;
    stars.scale.set(starStretch, starStretch, 1 + speedK * 3.5 + warpPulse * 2.2);
    ambientPoints.rotation.y += dt * (0.06 + scrollP * 0.12 + speedK * 0.5);
    ambientPoints.position.y = -scrollP * 1.4 + pointer.y * 0.3;

    scene.children.forEach(function (obj) {
      if (obj.userData && obj.userData.isNebula) {
        var ud = obj.userData;
        obj.position.x = ud.basePos.x + Math.sin(t * ud.speed + ud.phase) * 1.3;
        obj.position.y = ud.basePos.y + Math.cos(t * ud.speed * 0.8 + ud.phase) * 0.8;
      }
    });

    // 分幕色彩渐变
    if (sectionColors && sectionTargets) {
      var colorK = Math.min(1, dt * 2.6);
      sectionColors.skyTop.lerp(sectionTargets.skyTop, colorK);
      sectionColors.skyBottom.lerp(sectionTargets.skyBottom, colorK);
      sectionColors.deep.lerp(sectionTargets.deep, colorK);
      sectionColors.hot.lerp(sectionTargets.hot, colorK);
      sectionColors.white.lerp(sectionTargets.white, colorK);
      sectionColors.rim.lerp(sectionTargets.rim, colorK);
      skyMat.uniforms.uTop.value.copy(sectionColors.skyTop);
      skyMat.uniforms.uBottom.value.copy(sectionColors.skyBottom);
      coreUniforms.uDeep.value.copy(sectionColors.deep);
      coreUniforms.uHot.value.copy(sectionColors.hot);
      coreUniforms.uWhite.value.copy(sectionColors.white);
      coreUniforms.uRim.value.copy(sectionColors.rim);
    }

    // 相机：滚动后拉 + 分幕跃迁 + 指针视差 + 爆炸震动
    var camZ = 11 + scrollP * 1.8 + warpPulse * 6.2;
    var camY = -scrollP * 1.2 + pointer.y * 0.55;
    var camX = pointer.x * 0.65;
    var fov = baseFov + speedK * 5 - warpPulse * 7;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 7);
    camera.updateProjectionMatrix();
    var sx = camX + (shake > 0 ? (Math.random() - 0.5) * shake * 0.35 : 0);
    var sy = camY + (shake > 0 ? (Math.random() - 0.5) * shake * 0.35 : 0);
    camera.position.set(sx, sy, camZ);
    camera.lookAt(pointer.x * 0.3, 0.1 - scrollP * 2.4 + pointer.y * 0.2, 0);

    skyMat.uniforms.uTime.value = t;

    if (composer) {
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
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

  var SECTION_PALETTES = {
    day: {
      about: { skyTop: '#ffc4da', skyBottom: '#f76d9e', deep: '#b01f5b', hot: '#ff4f93', white: '#fff6fa', rim: '#ff9cc6', bloom: 0.4, threshold: 0.9 },
      featured: { skyTop: '#ffd3e4', skyBottom: '#ff7bac', deep: '#a31355', hot: '#ff2f7e', white: '#fff1f6', rim: '#ff8fbd', bloom: 0.42, threshold: 0.88 },
      xhs: { skyTop: '#ffc9dc', skyBottom: '#f45197', deep: '#9c0f4d', hot: '#ff5c8d', white: '#fff5f8', rim: '#ff7bac', bloom: 0.45, threshold: 0.86 },
      bili: { skyTop: '#ffdcec', skyBottom: '#ff6b9d', deep: '#8f1550', hot: '#ff4f93', white: '#fff7fa', rim: '#ffa3c6', bloom: 0.42, threshold: 0.87 },
      follow: { skyTop: '#fff0f5', skyBottom: '#ff8fb8', deep: '#a31355', hot: '#ff7bac', white: '#ffffff', rim: '#ffc0d8', bloom: 0.4, threshold: 0.9 }
    },
    night: {
      about: { skyTop: '#1a0712', skyBottom: '#541131', deep: '#4d0d2c', hot: '#ff5fa8', white: '#fff0f6', rim: '#ff8fbd', bloom: 0.58, threshold: 0.62 },
      featured: { skyTop: '#180611', skyBottom: '#611438', deep: '#420a28', hot: '#ff3f86', white: '#ffe6f0', rim: '#ff7bac', bloom: 0.6, threshold: 0.6 },
      xhs: { skyTop: '#1c0713', skyBottom: '#6d153f', deep: '#3d0a24', hot: '#ff4f93', white: '#ffedf4', rim: '#ff6fa8', bloom: 0.62, threshold: 0.58 },
      bili: { skyTop: '#150610', skyBottom: '#5c1235', deep: '#360920', hot: '#ff5c8d', white: '#fff2f7', rim: '#ff8fbd', bloom: 0.6, threshold: 0.6 },
      follow: { skyTop: '#1d0813', skyBottom: '#6d1843', deep: '#4a0c2c', hot: '#ff7bac', white: '#fff6f9', rim: '#ffb1cf', bloom: 0.56, threshold: 0.62 }
    }
  };
  var COLOR_KEYS = ['skyTop', 'skyBottom', 'deep', 'hot', 'white', 'rim'];

  function initSectionColors() {
    sectionColors = {};
    sectionTargets = {};
    COLOR_KEYS.forEach(function (key) {
      sectionColors[key] = new THREE.Color('#ffc4da');
      sectionTargets[key] = new THREE.Color('#ffc4da');
    });
  }

  function getCurrentSection() {
    var current = 'about';
    for (var i = 0; i < sectionKeys.length; i++) {
      var el = document.getElementById(sectionKeys[i]);
      if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.5) {
        current = sectionKeys[i];
      }
    }
    return current;
  }

  function setSectionTarget(section) {
    var palette = SECTION_PALETTES[theme][section] || SECTION_PALETTES[theme].about;
    sectionTargets.skyTop.set(palette.skyTop);
    sectionTargets.skyBottom.set(palette.skyBottom);
    sectionTargets.deep.set(palette.deep);
    sectionTargets.hot.set(palette.hot);
    sectionTargets.white.set(palette.white);
    sectionTargets.rim.set(palette.rim);
    if (bloomPass) {
      bloomPass.strength = palette.bloom;
      bloomPass.threshold = palette.threshold;
    }
  }

  function updateSectionState(force) {
    var section = getCurrentSection();
    if (section === currentSection && !force) return;
    currentSection = section;
    setSectionTarget(section);
    if (force) return;
    if (introPhase === 'ambient') startWarp();
  }

  function startWarp() {
    warpActive = true;
    warpT = 0;
    warpBaseZ = 11 + scrollP * 1.8;
    shake = Math.max(shake, 0.24);
    coreUniforms.uRipple.value = Math.max(coreUniforms.uRipple.value, 0.55);
    if (flashEl) {
      flashEl.classList.remove('warp');
      void flashEl.offsetWidth;
      flashEl.classList.add('warp');
    }
  }

  function setTheme(next) {
    theme = next || 'day';
    setSectionTarget(currentSection);
    starsMat.opacity = theme === 'dark' ? 1.0 : 0.55;
  }

  api.start = function () {
    if (!api.supported) return;
    if (REDUCED_MOTION) {
      introPhase = 'ambient';
      coreGroup.scale.setScalar(1.18);
      coreUniforms.uIntensity.value = 1.25;
      setTimeout(notifyBoom, 80);
      return;
    }
    introPhase = 'charge';
    introT = 0;
    coreGroup.scale.setScalar(0.001);
  };

  api.setTheme = setTheme;
  api.pulse = function () {
    if (!api.supported || introPhase !== 'ambient') return;
    startWarp();
    resetBurst();
  };

  buildScene();
  initSectionColors();
  setTheme('day');
  updateSectionState(true);
  api.debug = {
    renderer: renderer,
    scene: scene,
    camera: camera,
    coreUniforms: coreUniforms
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', function () {
    scrollP = Math.min(1, Math.max(0,
      (window.scrollY || 0) / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    ));
      updateSectionState();
  }, { passive: true });
    window.addEventListener('pointermove', function (e) {
      pointerTarget.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      pointerTarget.y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    }, { passive: true });
  animate();
})();
