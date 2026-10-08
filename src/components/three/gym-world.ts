import type * as T from "three";

type Three = typeof T;

/**
 * The room: a strength gym at night. Rubber floor, a lifting platform under one hard key light, a concrete back wall
 * carrying the GYMPULSE neon and a live heartbeat trace, a power rack, a dumbbell rack, kettlebells and a bench.
 * Colour comes from light, not paint — warm key, magenta and amber rims — so the athlete always separates from the
 * dark. Every texture is drawn on a canvas at load, nothing is fetched.
 */

export type WorldOpts = { shadows: boolean; shadowSize: number; dust: number; fontFamily: string };

/** Deterministic PRNG so the room is identical on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(THREE: Three, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildWorld(THREE: Three, RoundedBox: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry, opts: WorldOpts) {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x);
  const R = rng(20260930);
  const add = <M extends T.Object3D>(m: M, cast = false, receive = true) => {
    m.traverse((o) => {
      if ((o as T.Mesh).isMesh) {
        o.castShadow = cast && opts.shadows;
        o.receiveShadow = receive && opts.shadows;
      }
    });
    root.add(m);
    return m;
  };

  // ─── floor: 1 m interlocking rubber tiles with EPDM flecks ───
  const floorTex = keep(
    canvasTex(THREE, 512, 512, (g) => {
      g.fillStyle = "#141117";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 5200; i++) {
        const v = R();
        g.fillStyle = v < 0.08 ? "rgba(255,90,150,0.35)" : v < 0.16 ? "rgba(120,110,160,0.35)" : `rgba(255,255,255,${0.02 + R() * 0.05})`;
        g.fillRect(R() * 512, R() * 512, 1 + R() * 2, 1 + R() * 2);
      }
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.lineWidth = 3;
      g.strokeRect(0, 0, 512, 512);
      g.strokeStyle = "rgba(255,255,255,0.04)";
      g.lineWidth = 1;
      g.strokeRect(3, 3, 506, 506);
    }),
  );
  floorTex.repeat.set(40, 40);
  const floorRough = keep(
    canvasTex(THREE, 256, 256, (g) => {
      g.fillStyle = "#e6e6e6";
      g.fillRect(0, 0, 256, 256);
      // Worn, chalky patches read as slightly glossier where feet land most.
      for (let i = 0; i < 40; i++) {
        const x = R() * 256, y = R() * 256, r = 10 + R() * 40;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, "rgba(120,120,120,0.35)");
        grd.addColorStop(1, "rgba(120,120,120,0)");
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }, false),
  );
  floorRough.repeat.set(9, 9);
  const floorMat = keep(new THREE.MeshStandardMaterial({ map: floorTex, roughnessMap: floorRough, roughness: 0.92, metalness: 0 }));
  const floorGeo = keep(new THREE.PlaneGeometry(40, 40));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  add(floor);

  // ─── platform: oak centre, rubber inserts either side, chalk dusted ───
  const woodTex = keep(
    canvasTex(THREE, 512, 1024, (g) => {
      const planks = 6;
      for (let p = 0; p < planks; p++) {
        const x0 = (p / planks) * 512;
        const tone = 58 + R() * 16;
        g.fillStyle = `hsl(28 ${38 + R() * 10}% ${tone * 0.55}%)`;
        g.fillRect(x0, 0, 512 / planks, 1024);
        for (let i = 0; i < 70; i++) {
          g.strokeStyle = `rgba(40,20,8,${0.06 + R() * 0.12})`;
          g.lineWidth = 0.6 + R() * 1.4;
          g.beginPath();
          const x = x0 + R() * (512 / planks);
          g.moveTo(x, 0);
          for (let y = 0; y <= 1024; y += 64) g.lineTo(x + Math.sin(y * 0.01 + i) * 3 + (R() - 0.5) * 2, y);
          g.stroke();
        }
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(x0, 0, 2, 1024);
      }
      // Chalk haze where the bar lands.
      const grd = g.createRadialGradient(256, 512, 20, 256, 512, 380);
      grd.addColorStop(0, "rgba(255,255,255,0.16)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 1024);
    }),
  );
  const woodMat = keep(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62, metalness: 0 }));
  const insertMat = keep(new THREE.MeshStandardMaterial({ color: 0x0f0d12, roughness: 0.95 }));
  const frameMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a2730, roughness: 0.4, metalness: 0.85 }));
  const pfWood = keep(new THREE.BoxGeometry(1.2, 0.04, 2.4));
  const pfInsert = keep(new THREE.BoxGeometry(0.9, 0.04, 2.4));
  const pfFrame = keep(new THREE.BoxGeometry(3.06, 0.036, 2.46));
  const wood = new THREE.Mesh(pfWood, woodMat);
  wood.position.y = 0.02;
  add(wood);
  for (const s of [-1, 1]) {
    const ins = new THREE.Mesh(pfInsert, insertMat);
    ins.position.set(s * 1.05, 0.02, 0);
    add(ins);
  }
  const frame = new THREE.Mesh(pfFrame, frameMat);
  frame.position.y = 0.017;
  add(frame);

  // ─── walls ───
  const concreteTex = keep(
    canvasTex(THREE, 1024, 512, (g) => {
      g.fillStyle = "#23202b";
      g.fillRect(0, 0, 1024, 512);
      for (let i = 0; i < 900; i++) {
        const x = R() * 1024, y = R() * 512, r = 4 + R() * 60;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        const l = R() < 0.5 ? "255,255,255" : "0,0,0";
        grd.addColorStop(0, `rgba(${l},${0.03 + R() * 0.04})`);
        grd.addColorStop(1, `rgba(${l},0)`);
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Formwork seams and tie holes.
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 2;
      for (let x = 0; x <= 1024; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
      for (let y = 0; y <= 512; y += 256) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
      g.fillStyle = "rgba(0,0,0,0.45)";
      for (let x = 64; x < 1024; x += 128) for (let y = 64; y < 512; y += 128) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    }),
  );
  concreteTex.repeat.set(3, 1.6);
  const wallMat = keep(new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }));
  const backGeo = keep(new THREE.PlaneGeometry(18, 7));
  const back = new THREE.Mesh(backGeo, wallMat);
  back.position.set(0, 3.5, -5);
  add(back);
  const sideGeo = keep(new THREE.PlaneGeometry(16, 7));
  const left = new THREE.Mesh(sideGeo, wallMat);
  left.position.set(-6, 3.5, 2);
  left.rotation.y = Math.PI / 2;
  add(left);
  const ceilMat = keep(new THREE.MeshStandardMaterial({ color: 0x0b0a0f, roughness: 1 }));
  const ceilGeo = keep(new THREE.PlaneGeometry(20, 20));
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.position.y = 4.6;
  ceil.rotation.x = Math.PI / 2;
  add(ceil, false, false);
  const beamGeo = keep(new THREE.BoxGeometry(20, 0.3, 0.22));
  for (let z = -4; z <= 6; z += 2.5) {
    const b = new THREE.Mesh(beamGeo, frameMat);
    b.position.set(0, 4.4, z);
    add(b, false, false);
  }

  // ─── neon: GYMPULSE and a heartbeat that runs along the wall ───
  // Letters are drawn filled (a thin outline blurs into mush under bloom and at distance). The texture carries two
  // masks: red = the tube itself, green = a soft halo baked around it, so the glow reads even where bloom is weak
  // and the letterforms stay crisp where it is strong.
  const neonTex = keep(
    canvasTex(
      THREE,
      2048,
      400,
      (g) => {
        g.fillStyle = "#000";
        g.fillRect(0, 0, 2048, 400);
        g.font = `900 230px ${opts.fontFamily}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineJoin = "round";
        g.globalCompositeOperation = "lighter";
        g.shadowColor = "rgb(0,255,0)";
        g.shadowBlur = 46;
        g.fillStyle = "rgb(0,200,0)";
        g.fillText("GYMPULSE", 1024, 205);
        g.shadowBlur = 0;
        g.fillStyle = "rgb(255,0,0)";
        g.fillText("GYMPULSE", 1024, 205);
      },
      false,
    ),
  );
  neonTex.wrapS = neonTex.wrapT = THREE.ClampToEdgeWrapping;
  const neonUniforms = { uOn: { value: 0 }, uTime: { value: 0 }, uFlare: { value: 0 } };
  const neonMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { map: { value: neonTex }, uColor: { value: new THREE.Color(0xff3d8f) }, ...neonUniforms },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 uColor; uniform float uOn, uTime, uFlare; varying vec2 vUv;
        void main(){
          vec2 m = texture2D(map, vUv).rg;
          float tube = m.r, halo = m.g * (1.0 - tube);
          // Pink glass with a paler core. Kept just over the bloom threshold: enough to glow, never a white blob.
          float hum = 0.97 + 0.03 * sin(uTime * 314.0);
          vec3 core = mix(uColor, vec3(1.0, 0.82, 0.9), 0.45) * 1.7;
          vec3 c = core * tube + uColor * 0.9 * halo;
          // Unlit, the tubes are dim pink glass, still legible as letters.
          // Each rep's heartbeat flares the tubes for a moment, the halo more than the core.
          float on = mix(0.18, 1.0, uOn) * hum * (1.0 + uFlare * 0.35);
          c += uColor * halo * uFlare * 0.9;
          gl_FragColor = vec4(c * on, clamp(tube + halo * 0.8, 0.0, 1.0) * mix(0.6, 1.0, uOn));
        }`,
    }),
  );
  // A black backing board: the sign reads against it instead of against a wall the key light is washing.
  const boardMat = keep(new THREE.MeshStandardMaterial({ color: 0x07060a, roughness: 0.35, metalness: 0.2 }));
  const board = new THREE.Mesh(keep(new RoundedBox(4.9, 1.05, 0.04, 2, 0.02)), boardMat);
  board.position.z = -0.035;
  board.receiveShadow = true;
  const neonGeo = keep(new THREE.PlaneGeometry(4.6, 0.9));
  const neon = new THREE.Mesh(neonGeo, neonMat);
  // Left of centre and not too wide: the opening shot looks across the wall from the right, and a centred sign ran
  // off the edge of the frame there. Here it reads whole in the opening shot and still hangs over the closing one.
  const sign = new THREE.Group();
  sign.add(board, neon);
  sign.position.set(-1.6, 3.05, -4.94);
  sign.scale.setScalar(0.61);
  root.add(sign);

  // The trace: flat baseline with a PQRST complex every beat, drawn as a tube with a travelling bright head.
  const ecgPts: T.Vector3[] = [];
  for (let x = -7.5; x <= 7.5; x += 0.025) {
    let y = 0;
    for (const b of [-5.5, -1.8, 1.9, 5.6]) {
      const d = x - b;
      y += Math.exp(-((d / 0.06) ** 2)) * 0.62 - Math.exp(-(((d + 0.13) / 0.05) ** 2)) * 0.16 - Math.exp(-(((d - 0.14) / 0.05) ** 2)) * 0.24 + Math.exp(-(((d - 0.5) / 0.16) ** 2)) * 0.12 + Math.exp(-(((d + 0.45) / 0.12) ** 2)) * 0.06;
    }
    ecgPts.push(new THREE.Vector3(x, 2.1 + y, -4.96));
  }
  const ecgCurve = new THREE.CatmullRomCurve3(ecgPts);
  const ecgGeo = keep(new THREE.TubeGeometry(ecgCurve, 1400, 0.014, 6, false));
  const ecgUniforms = { uHead: { value: 0 } };
  const ecgMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { ...ecgUniforms, uOn: neonUniforms.uOn },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying float vU; void main(){ vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform float uHead, uOn; varying float vU;
        void main(){
          float d = uHead - vU;
          float trail = d >= 0.0 ? exp(-d * 4.0) : 0.0;
          float head = exp(-pow(d * 140.0, 2.0));
          vec3 amber = vec3(1.0, 0.62, 0.24), rose = vec3(1.0, 0.25, 0.56);
          vec3 c = mix(rose, amber, head) * (0.35 + 2.2 * trail + 6.0 * head);
          gl_FragColor = vec4(c * uOn, (0.18 + trail + head) * uOn);
        }`,
    }),
  );
  const ecg = new THREE.Mesh(ecgGeo, ecgMat);
  root.add(ecg);

  // ─── power rack, back right, with a spare bar racked ───
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x17151c, roughness: 0.45, metalness: 0.7 }));
  const accent = keep(new THREE.MeshStandardMaterial({ color: 0xff4f98, roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(0x30061a) }));
  const upGeo = keep(new THREE.BoxGeometry(0.075, 2.35, 0.075));
  const crossGeo = keep(new THREE.BoxGeometry(1.22, 0.075, 0.075));
  const sideBarGeo = keep(new THREE.BoxGeometry(0.075, 0.075, 1.22));
  const rack = new THREE.Group();
  for (const x of [-0.61, 0.61]) for (const z of [-0.61, 0.61]) {
    const u = new THREE.Mesh(upGeo, steel);
    u.position.set(x, 1.175, z);
    rack.add(u);
  }
  for (const z of [-0.61, 0.61]) for (const y of [0.1, 2.31]) {
    const c = new THREE.Mesh(crossGeo, steel);
    c.position.set(0, y, z);
    rack.add(c);
  }
  for (const x of [-0.61, 0.61]) for (const y of [0.1, 2.31]) {
    const c = new THREE.Mesh(sideBarGeo, steel);
    c.position.set(x, y, 0);
    rack.add(c);
  }
  const hookGeo = keep(new THREE.BoxGeometry(0.09, 0.05, 0.12));
  for (const x of [-0.61, 0.61]) {
    const h = new THREE.Mesh(hookGeo, accent);
    h.position.set(x, 1.38, 0.66);
    rack.add(h);
  }
  const spareGeo = keep(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 12));
  const chromeMat = keep(new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 1, roughness: 0.25 }));
  const spare = new THREE.Mesh(spareGeo, chromeMat);
  spare.rotation.z = Math.PI / 2;
  spare.position.set(0, 1.43, 0.66);
  rack.add(spare);
  rack.position.set(3.1, 0, -2.6);
  rack.rotation.y = -0.35;
  add(rack, true, true);

  // ─── dumbbell rack, left wall: two tiers of hex dumbbells, instanced ───
  const rackGeo = keep(new THREE.BoxGeometry(0.55, 0.05, 3.6));
  const legGeo = keep(new THREE.BoxGeometry(0.05, 0.85, 0.05));
  const dbRack = new THREE.Group();
  for (const [y, z] of [[0.45, 0.14], [0.8, -0.1]] as const) {
    const shelf = new THREE.Mesh(rackGeo, steel);
    shelf.position.set(z, y, 0);
    dbRack.add(shelf);
  }
  for (const z of [-1.75, 0, 1.75]) for (const x of [-0.22, 0.3]) {
    const l = new THREE.Mesh(legGeo, steel);
    l.position.set(x, 0.42, z);
    dbRack.add(l);
  }
  const pairs = 9;
  const headGeo = keep(new THREE.CylinderGeometry(1, 1, 1, 6));
  const handleGeo = keep(new THREE.CylinderGeometry(0.016, 0.016, 1, 10));
  const headMat = keep(new THREE.MeshStandardMaterial({ color: 0x1c1a20, roughness: 0.7, metalness: 0.2 }));
  const heads = new THREE.InstancedMesh(headGeo, headMat, pairs * 2 * 2);
  const handles = new THREE.InstancedMesh(handleGeo, chromeMat, pairs * 2);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const alongX = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  let hi = 0, ha = 0;
  for (let tier = 0; tier < 2; tier++) {
    for (let i = 0; i < pairs; i++) {
      const w = 0.055 + (tier * pairs + i) * 0.0042; // heavier toward the end of each tier
      const len = 0.1 + w * 0.8;
      const y = tier === 0 ? 0.52 : 0.87;
      const x = tier === 0 ? 0.14 : -0.1;
      const z = -1.6 + (i / (pairs - 1)) * 3.2;
      for (const s of [-1, 1]) {
        p.set(x + s * (0.07 + len / 2), y + w, z);
        sc.set(w, len, w);
        m4.compose(p, alongX, sc);
        heads.setMatrixAt(hi++, m4);
      }
      p.set(x, y + w, z);
      sc.set(1, 0.14, 1);
      m4.compose(p, alongX, sc);
      handles.setMatrixAt(ha++, m4);
    }
  }
  dbRack.add(heads, handles);
  dbRack.position.set(-5.35, 0, -0.6);
  add(dbRack, true, true);

  // ─── kettlebells lined up by the wall, a flat bench front right ───
  const kbBody = keep(new THREE.SphereGeometry(1, 24, 18));
  const kbHandle = keep(new THREE.TorusGeometry(0.62, 0.11, 10, 24, Math.PI));
  const kbMats = [0xff4f98, 0xffb454, 0x6a5acd, 0x1c1a20].map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35 })));
  for (let i = 0; i < 5; i++) {
    const r = 0.1 + i * 0.012;
    const kb = new THREE.Group();
    const b = new THREE.Mesh(kbBody, kbMats[i % kbMats.length]!);
    b.scale.setScalar(r);
    b.position.y = r * 0.95;
    const h = new THREE.Mesh(kbHandle, kbMats[3]!);
    h.scale.setScalar(r);
    h.position.y = r * 1.55;
    kb.add(b, h);
    kb.position.set(-2.2 + i * 0.42, 0, -4.4);
    kb.rotation.y = (R() - 0.5) * 0.6;
    add(kb, true, true);
  }
  const padMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.55 }));
  const bench = new THREE.Group();
  const pad = new THREE.Mesh(keep(new RoundedBox(0.3, 0.08, 1.2, 3, 0.03)), padMat);
  pad.position.y = 0.44;
  const benchLegGeo = keep(new THREE.BoxGeometry(0.06, 0.4, 0.06));
  for (const z of [-0.5, 0.5]) {
    const l = new THREE.Mesh(benchLegGeo, steel);
    l.position.set(0, 0.2, z);
    bench.add(l);
  }
  const footGeo = keep(new THREE.BoxGeometry(0.42, 0.04, 0.07));
  for (const z of [-0.5, 0.5]) {
    const f = new THREE.Mesh(footGeo, accent);
    f.position.set(0, 0.02, z);
    bench.add(f);
  }
  bench.add(pad);
  bench.position.set(2.7, 0, 1.4);
  bench.rotation.y = 0.5;
  add(bench, true, true);

  // Plates leaning on the back wall: stacked bumpers a lifter would grab next.
  const lean = keep(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 40));
  const leanMat = keep(new THREE.MeshStandardMaterial({ color: 0x141217, roughness: 0.8 }));
  for (let i = 0; i < 4; i++) {
    const pl = new THREE.Mesh(lean, leanMat);
    pl.rotation.x = Math.PI / 2 - 0.16;
    pl.position.set(1.2 + i * 0.075, 0.23, -4.82 + i * 0.075);
    add(pl, true, true);
  }

  // ─── lights ───
  const lamps: { key: T.SpotLight }[] = [];
  const key = new THREE.SpotLight(0xffe0bd, 0, 0, 0.62, 0.55, 2);
  key.position.set(0.4, 4.1, 0.9);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = opts.shadows;
  key.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 8;
  key.shadow.radius = 4;
  root.add(key, key.target);
  lamps.push({ key });
  const rimRose = new THREE.SpotLight(0xff3d8f, 0, 0, 0.5, 0.8, 2);
  rimRose.position.set(-3, 2.9, -3.4);
  rimRose.target.position.set(0, 1.1, 0);
  const rimAmber = new THREE.SpotLight(0xffa24a, 0, 0, 0.5, 0.8, 2);
  rimAmber.position.set(3.2, 2.4, -2.8);
  rimAmber.target.position.set(0, 1.0, 0);
  root.add(rimRose, rimRose.target, rimAmber, rimAmber.target);
  const hemi = new THREE.HemisphereLight(0x5c4c8c, 0x08070c, 0);
  root.add(hemi);
  const neonGlow = new THREE.PointLight(0xff3d8f, 0, 9, 2);
  neonGlow.position.set(-1.6, 2.95, -4.4);
  root.add(neonGlow);

  // Hanging industrial shades with a glowing bulb face.
  const shadeGeo = keep(new THREE.ConeGeometry(0.36, 0.3, 32, 1, true));
  const shadeMat = keep(new THREE.MeshStandardMaterial({ color: 0x121016, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }));
  const bulbGeo = keep(new THREE.CircleGeometry(0.3, 32));
  const bulbMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0dc).multiplyScalar(0), toneMapped: false }));
  const cordGeo = keep(new THREE.CylinderGeometry(0.006, 0.006, 1, 6));
  const lampSpots: [number, number][] = [[0.4, 0.9], [-3.2, -2.4], [3.4, -1.2], [-2.4, 3.4], [2.6, 4.2]];
  for (const [x, z] of lampSpots) {
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(x, 4.25, z);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(x, 4.1, z);
    const cord = new THREE.Mesh(cordGeo, shadeMat);
    cord.position.set(x, 4.5, z);
    cord.scale.y = 0.4;
    root.add(shade, bulb, cord);
  }

  // Light shaft under the key: a soft additive cone, brightest near the lamp, fading toward the floor and its edges.
  const shaftGeo = keep(new THREE.ConeGeometry(1.75, 4.05, 48, 1, true));
  shaftGeo.translate(0, -2.025, 0);
  const shaftUniforms = { uOn: { value: 0 } };
  const shaftMat = keep(
    new THREE.ShaderMaterial({
      uniforms: shaftUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying float vH; varying vec3 vN; varying vec3 vV;
        void main(){
          vH = -position.y / 4.05;
          vec4 mv = modelViewMatrix * vec4(position,1.);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; varying float vH; varying vec3 vN; varying vec3 vV;
        void main(){
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float fall = (1.0 - vH) * smoothstep(0.0, 0.08, vH) * smoothstep(1.0, 0.7, vH);
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.7) * 0.075 * edge * fall * uOn, 1.0);
        }`,
    }),
  );
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(0.4, 4.08, 0.9);
  shaft.rotation.z = 0.02;
  root.add(shaft);

  // Dust hanging in the light: points drift on slow curl-ish noise and only glow inside the shaft.
  const dustN = opts.dust;
  const dustGeo = keep(new THREE.BufferGeometry());
  const dp = new Float32Array(dustN * 3), ds = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 2.2;
    dp[i * 3] = 0.4 + Math.cos(a) * r;
    dp[i * 3 + 1] = R() * 3.9;
    dp[i * 3 + 2] = 0.9 + Math.sin(a) * r;
    ds[i] = R();
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  dustGeo.setAttribute("seed", new THREE.BufferAttribute(ds, 1));
  const dustUniforms = { uTime: { value: 0 }, uOn: { value: 0 }, uScale: { value: 1 } };
  const dustMat = keep(
    new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime, uScale; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.05 + seed * 0.05);
          p.x += sin(t * 2.1 + seed * 40.0) * 0.25;
          p.z += cos(t * 1.7 + seed * 23.0) * 0.25;
          p.y = mod(p.y + t * 0.6, 3.9);
          // Lit only inside the key light's cone (apex at the lamp, radius grows toward the floor).
          vec2 axis = p.xz - vec2(0.4, 0.9);
          float coneR = mix(0.05, 1.75, clamp((4.08 - p.y) / 4.05, 0.0, 1.0));
          vA = smoothstep(coneR, coneR * 0.45, length(axis)) * (0.35 + 0.65 * fract(seed * 13.7));
          vec4 mv = modelViewMatrix * vec4(p,1.);
          // Never a snowflake in front of the lens: capped size, and faded out close to the camera.
          gl_PointSize = min(uScale * (2.0 + seed * 3.0) / -mv.z, 5.0);
          vA *= smoothstep(0.8, 2.4, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * uOn;
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.82) * a * 0.9, a);
        }`,
    }),
  );
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  root.add(dust);

  // ─── light-up: the room switches on like a gym at 5 a.m. — key light stutters on, neon buzzes, then rims ───
  const flicker = (t: number, start: number, pattern: number[]) => {
    const k = t - start;
    if (k < 0) return 0;
    const i = Math.floor(k / 0.07);
    return i < pattern.length ? pattern[i]! : 1;
  };
  const KEY_PAT = [0.6, 0, 0, 0.9, 0.2, 0, 1, 0.4, 1];
  const NEON_PAT = [0.3, 0, 0.7, 0.1, 0, 0, 0.8, 0.3, 1, 0.6, 1];

  // Heartbeats: every lockout sends one pulse down the wall trace and flares the neon (see `pulse`). Before the
  // first rep, and between sets, the trace idles with a slow ambient beat.
  let beatAt = -1e9;
  const pulse = (t: number) => {
    beatAt = t;
  };
  const update = (t: number, lightT: number) => {
    const k = flicker(lightT, 0.15, KEY_PAT);
    const n = flicker(lightT, 0.55, NEON_PAT);
    const rim = THREE.MathUtils.smoothstep(lightT, 0.9, 1.8);
    key.intensity = 95 * k;
    bulbMat.color.setRGB(1, 0.94, 0.86).multiplyScalar(3.2 * k);
    shaftUniforms.uOn.value = k;
    neonUniforms.uOn.value = n;
    neonUniforms.uTime.value = t;
    const since = t - beatAt;
    const flare = since >= 0 ? Math.exp(-since * 3.2) : 0;
    neonUniforms.uFlare.value = flare * n;
    neonGlow.intensity = (3 + flare * 5) * n;
    rimRose.intensity = 70 * rim;
    rimAmber.intensity = 55 * rim;
    hemi.intensity = 0.55 * THREE.MathUtils.smoothstep(lightT, 0, 1.2);
    dustUniforms.uTime.value = t;
    dustUniforms.uOn.value = k;
    // A rep's beat runs the full wall in ~1.4 s; otherwise the slow ambient sweep (runs off the end, pauses).
    ecgUniforms.uHead.value = since < 1.5 ? since * 0.8 - 0.05 : ((t * 0.11) % 1.25) - 0.05;
  };

  return {
    root,
    update,
    pulse,
    dustUniforms,
    lamps,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export type World = ReturnType<typeof buildWorld>;
