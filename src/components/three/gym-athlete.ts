import type * as T from "three";
import { BODY, type Skeleton, type V3 } from "./gym-rig";

type Three = typeof T;

/**
 * The athlete and the barbell as meshes, posed every frame from a solved `Skeleton`.
 *
 * Limbs are lathed muscle profiles (quad and calf bellies, biceps, a V-tapered torso) authored at unit length along
 * +Y, then placed bone-to-bone — so a pose is only positions and one quaternion per bone, never a geometry rebuild.
 * The bar is built from short rigid parts that sag and tilt along a whip curve, so it bends under load at no cost.
 */

/** `body: false` builds only the barbell (the skinned lifter in gym-lifter.ts is the body). */
export type AthleteOpts = { segments: number; shadows: boolean; body?: boolean };

type Profile = [t: number, r: number][];

/** A radius profile, rounded shut at both ends so bones read as solid forms rather than open tubes. */
function lathe(THREE: Three, prof: Profile, seg: number, from = 0, to = 1) {
  const radius = (t: number) => {
    for (let i = 1; i < prof.length; i++) {
      const [t1, r1] = prof[i]!;
      const [t0, r0] = prof[i - 1]!;
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0 || 1);
        return r0 + (r1 - r0) * (k * k * (3 - 2 * k)); // smooth between control radii: muscle, not cone
      }
    }
    return prof[prof.length - 1]![1];
  };
  const pts: T.Vector2[] = [];
  const cap = 6;
  const r0 = radius(from), r1 = radius(to);
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r0, from - Math.cos(a) * r0 * 0.6));
  }
  const n = 22;
  for (let i = 1; i < n; i++) {
    const t = from + ((to - from) * i) / n;
    pts.push(new THREE.Vector2(radius(t), t));
  }
  for (let i = cap; i >= 0; i--) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r1, to + Math.cos(a) * r1 * 0.6));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

// Radii in metres, t along the bone from its root joint.
const THIGH: Profile = [[0, 0.088], [0.28, 0.094], [0.62, 0.074], [0.88, 0.056], [1, 0.05]];
const SHIN: Profile = [[0, 0.052], [0.24, 0.061], [0.5, 0.05], [0.82, 0.035], [1, 0.032]];
const UPPER_ARM: Profile = [[0, 0.056], [0.2, 0.058], [0.52, 0.056], [0.84, 0.043], [1, 0.039]];
const FOREARM: Profile = [[0, 0.042], [0.2, 0.05], [0.55, 0.039], [0.88, 0.029], [1, 0.027]];
const NECK: Profile = [[0, 0.068], [0.5, 0.058], [1, 0.054]];
// The torso runs from just below the hip centre to the base of the neck, wide across the lats and chest.
const TORSO: Profile = [[-0.1, 0.1], [-0.02, 0.152], [0.1, 0.148], [0.23, 0.132], [0.36, 0.158], [0.45, 0.186], [0.52, 0.192], [0.57, 0.16], [0.62, 0.075]];


type Vec = [number, number, number];
/** A cloth or skin run along the limb: from `s0` to `s1` metres along it, `rings` cross-sections, own material. */
type Run = { s0: number; s1: number; rings: number; pad: number; mat: number };

/**
 * One continuous limb (hip→knee→ankle or shoulder→elbow→wrist) swept every frame along a centreline whose joint is
 * a rounded curve, not a hinge: the knee and elbow bend like flesh instead of showing a doll's ball joint. Cross
 * sections are oriented by the limb's pole (knee forward, elbow back), so the surface never twists as the limb
 * straightens. A few thousand vertices a frame, all written in place.
 */
function sweptLimb(THREE: Three, seg: number, runs: Run[], radius: (s: number) => number, L1: number, L2: number) {
  const total = runs.reduce((n, r) => n + r.rings, 0);
  const pos = new Float32Array(total * seg * 3), nor = new Float32Array(total * seg * 3);
  const idx: number[] = [];
  const g = new THREE.BufferGeometry();
  let ring0 = 0;
  runs.forEach((r) => {
    const start = idx.length;
    for (let i = 0; i < r.rings - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = (ring0 + i) * seg + j, b = (ring0 + i) * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
        idx.push(a, b, c, b, d, c); // counter-clockwise seen from outside
      }
    g.addGroup(start, idx.length - start, r.mat);
    ring0 += r.rings;
  });
  g.setIndex(idx);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  const update = (a: Vec, j: Vec, b: Vec, pole: Vec) => {
    const d1 = nrm(sub(j, a)), d2 = nrm(sub(b, j));
    const bend = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2])));
    const k = 0.035 + bend * 0.035; // tighter joints round off more
    const kA = Math.min(k, L1 * 0.4), kB = Math.min(k, L2 * 0.4);
    const P0: Vec = [j[0] - d1[0] * kA, j[1] - d1[1] * kA, j[2] - d1[2] * kA];
    const P2: Vec = [j[0] + d2[0] * kB, j[1] + d2[1] * kB, j[2] + d2[2] * kB];
    let v = 0;
    for (const r of runs) {
      for (let i = 0; i < r.rings; i++) {
        const sv = r.s0 + ((r.s1 - r.s0) * i) / (r.rings - 1);
        let p: Vec, t: Vec;
        if (sv < L1 - kA) { p = [a[0] + d1[0] * sv, a[1] + d1[1] * sv, a[2] + d1[2] * sv]; t = d1; }
        else if (sv > L1 + kB) { const q = sv - L1; p = [j[0] + d2[0] * q, j[1] + d2[1] * q, j[2] + d2[2] * q]; t = d2; }
        else {
          const u = (sv - (L1 - kA)) / (kA + kB), w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
          p = [P0[0] * w0 + j[0] * w1 + P2[0] * w2, P0[1] * w0 + j[1] * w1 + P2[1] * w2, P0[2] * w0 + j[2] * w1 + P2[2] * w2];
          t = nrm([(j[0] - P0[0]) * (1 - u) + (P2[0] - j[0]) * u, (j[1] - P0[1]) * (1 - u) + (P2[1] - j[1]) * u, (j[2] - P0[2]) * (1 - u) + (P2[2] - j[2]) * u]);
        }
        const pd = pole[0] * t[0] + pole[1] * t[1] + pole[2] * t[2];
        let n = nrm([pole[0] - t[0] * pd, pole[1] - t[1] * pd, pole[2] - t[2] * pd]);
        if (!Number.isFinite(n[0])) n = [0, 0, 1];
        const bb = cross(t, n);
        const rad = radius(sv) + r.pad;
        for (let q = 0; q < seg; q++) {
          const th = (q / seg) * Math.PI * 2, c = Math.cos(th), s2 = Math.sin(th);
          const nx = n[0] * c + bb[0] * s2, ny = n[1] * c + bb[1] * s2, nz = n[2] * c + bb[2] * s2;
          pos[v * 3] = p[0] + nx * rad; pos[v * 3 + 1] = p[1] + ny * rad; pos[v * 3 + 2] = p[2] + nz * rad;
          nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
          v++;
        }
      }
    }
    (g.attributes.position as T.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as T.BufferAttribute).needsUpdate = true;
  };
  return { geometry: g, update };
}

/** Sample a bone profile at `t` (0..1) with the same smooth interpolation the lathe uses. */
function profileAt(prof: Profile, t: number) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < prof.length; i++) {
    const [t1, r1] = prof[i]!, [t0, r0] = prof[i - 1]!;
    if (x <= t1) { const k = (x - t0) / (t1 - t0 || 1); return r0 + (r1 - r0) * (k * k * (3 - 2 * k)); }
  }
  return prof[prof.length - 1]![1];
}

export function buildAthlete(THREE: Three, RoundedBox: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry, opts: AthleteOpts) {
  const seg = opts.segments;
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x);

  // Skin carries a faint clearcoat: sweat catching the key light is most of what makes a body read as working.
  const skin = keep(new THREE.MeshPhysicalMaterial({ color: 0x8f5d43, roughness: 0.52, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff9f7a), clearcoat: 0.22, clearcoatRoughness: 0.4 }));
  const top = keep(new THREE.MeshPhysicalMaterial({ color: 0xb3135f, roughness: 0.78, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xff7fb4) }));
  const shorts = keep(new THREE.MeshPhysicalMaterial({ color: 0x16121f, roughness: 0.82, sheen: 0.5, sheenColor: new THREE.Color(0x5b4a8c) }));
  const shoeMat = keep(new THREE.MeshStandardMaterial({ color: 0xc9c4d4, roughness: 0.72 }));
  const soleMat = keep(new THREE.MeshStandardMaterial({ color: 0xff4f98, roughness: 0.6 }));
  const hairMat = keep(new THREE.MeshStandardMaterial({ color: 0x120e16, roughness: 0.95 }));
  const eyeMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x0c0a0e, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const bandMat = keep(new THREE.MeshStandardMaterial({ color: 0xd98a2e, roughness: 0.7 }));

  const mesh = (g: T.BufferGeometry, m: T.Material) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = opts.shadows;
    x.receiveShadow = opts.shadows;
    root.add(x);
    return x;
  };

  const gNeck = keep(lathe(THREE, NECK, seg));
  // The tank top stops at a neckline; skin carries on over the traps into the neck.
  const gTorso = keep(lathe(THREE, TORSO, seg + 8, -0.1, 0.49));
  const gUpperChest = keep(lathe(THREE, TORSO.map(([t, r]) => [t, r - 0.006] as [number, number]), seg + 8, 0.4, 0.625));
  const gShortsTorso = keep(lathe(THREE, TORSO.map(([t, r]) => [t, r + 0.008] as [number, number]), seg + 8, -0.05, 0.13));
  const gBall = keep(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)));
  const gShoe = keep(new RoundedBox(0.105, 0.085, 0.27, 3, 0.035));
  const gSole = keep(new RoundedBox(0.112, 0.022, 0.278, 2, 0.01));
  const gHair = keep(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.6), 0, Math.PI * 2, 0, Math.PI * 0.52));
  const gBand = keep(new THREE.TorusGeometry(1, 0.11, 8, seg + 8));

  const torso = mesh(gTorso, top);
  torso.scale.set(1, 1, 0.64);
  const shortsTorso = mesh(gShortsTorso, shorts);
  shortsTorso.scale.set(1, 1, 0.67);
  const traps = mesh(gBall, skin);
  // Chest rig: follows the torso's frame and breath; the lats flare the tank under the arms.
  const chestRig = new THREE.Group();
  root.add(chestRig);
  const rigPart = (g: T.BufferGeometry, m: T.Material, sc: V3, p: V3) => {
    const x = new THREE.Mesh(g, m);
    x.scale.set(sc[0], sc[1], sc[2]);
    x.position.set(p[0], p[1], p[2]);
    x.castShadow = x.receiveShadow = opts.shadows;
    chestRig.add(x);
    return x;
  };
  rigPart(gUpperChest, skin, [1, 1, 0.62], [0, 0, 0]);
  for (const sx of [-1, 1]) {
    rigPart(gBall, top, [0.038, 0.12, 0.07], [sx * 0.142, 0.37, -0.015]); // lat
  }
  const neck = mesh(gNeck, skin);
  const head = new THREE.Group();
  root.add(head);
  const skull = new THREE.Mesh(gBall, skin);
  skull.scale.set(0.085, 0.103, 0.097);
  skull.castShadow = opts.shadows;
  // Face at a glance: a jaw that sits inside the skull line, nose, ears, brows and eyes that catch the key light.
  const feature = (m: T.Material, sc: V3, p: V3, rx = 0) => {
    const f = new THREE.Mesh(gBall, m);
    f.scale.set(sc[0], sc[1], sc[2]);
    f.position.set(p[0], p[1], p[2]);
    f.rotation.x = rx;
    return f;
  };
  const jaw = feature(skin, [0.066, 0.05, 0.07], [0, -0.052, 0.01]);
  jaw.castShadow = opts.shadows;
  const face = [
    feature(skin, [0.013, 0.022, 0.016], [0, -0.014, 0.093], -0.35),
    ...[-1, 1].flatMap((sx) => [
      feature(skin, [0.011, 0.025, 0.017], [sx * 0.085, -0.012, -0.004]),
      feature(hairMat, [0.022, 0.0055, 0.01], [sx * 0.031, 0.022, 0.089], 0.2),
      feature(eyeMat, [0.0105, 0.0068, 0.006], [sx * 0.03, 0.006, 0.09]),
    ]),
  ];
  const hair = new THREE.Mesh(gHair, hairMat);
  hair.scale.set(0.093, 0.112, 0.104);
  hair.rotation.x = -0.28;
  hair.position.set(0, 0.006, -0.008);
  const band = new THREE.Mesh(gBand, bandMat);
  band.scale.set(0.094, 0.106, 0.09);
  band.rotation.x = Math.PI / 2 - 0.2;
  band.position.y = 0.035;
  head.add(skull, jaw, hair, band, ...face);

  const limb = (runs: [number, number, number, number, number][], mats: T.Material[], p1: Profile, p2: Profile, L1: number, L2: number, flexes = false) => {
    // `flex` 0..1 swells the first bone's belly (the biceps as the elbow closes).
    const state = { flex: 0 };
    const r = (sv: number) => {
      if (sv >= L1) return profileAt(p2, (sv - L1) / L2);
      const t = sv / L1;
      const belly = flexes ? state.flex * 0.22 * Math.exp(-(((t - 0.55) / 0.2) ** 2)) : 0;
      return profileAt(p1, t) * (1 + belly);
    };
    const l = sweptLimb(THREE, seg, runs.map(([s0, s1, rings, pad, mat]) => ({ s0, s1, rings, pad, mat })), r, L1, L2);
    keep(l.geometry);
    const m = new THREE.Mesh(l.geometry, mats);
    m.castShadow = m.receiveShadow = opts.shadows;
    m.frustumCulled = false; // the geometry moves every frame; its bounds are never stale this way
    root.add(m);
    return Object.assign(l, { state });
  };
  const side = (s: 1 | -1) => ({
    leg: limb([[-0.04, BODY.thigh * 0.4, 5, 0.007, 0], [BODY.thigh * 0.4, BODY.thigh + BODY.shin + 0.02, 30, 0, 1]], [shorts, skin], THIGH, SHIN, BODY.thigh, BODY.shin),
    arm: limb([[-0.02, BODY.upperArm + BODY.forearm, 28, 0, 0]], [skin], UPPER_ARM, FOREARM, BODY.upperArm, BODY.forearm, true),
    delt: mesh(gBall, skin),
    hand: mesh(gBall, skin),
    shoe: mesh(gShoe, shoeMat),
    sole: mesh(gSole, soleMat),
    s,
  });
  const L = side(-1), R = side(1);
  for (const x of [L, R]) {
    x.delt.scale.set(0.064, 0.092, 0.062); // a cap along the upper arm, not a ball on the shoulder
    x.hand.scale.set(0.031, 0.05, 0.037); // a closed fist, long axis along the forearm
  }

  // ─── barbell ───
  const bar = new THREE.Group();
  root.add(bar);
  const chrome = keep(new THREE.MeshStandardMaterial({ color: 0x8e929a, metalness: 1, roughness: 0.62 })); // satin steel: a mirror sleeve blooms into a light-sabre streak under the key // brushed, not mirror: a mirror sleeve blooms into a streak
  const knurl = keep(new THREE.MeshStandardMaterial({ color: 0x8f949e, metalness: 1, roughness: 0.55 }));
  const rubber = keep(new THREE.MeshStandardMaterial({ color: 0x141217, roughness: 0.78, metalness: 0 }));
  const hub = keep(new THREE.MeshStandardMaterial({ color: 0xa9acb4, metalness: 1, roughness: 0.5 }));
  const plateColors = [0xd6263b, 0x2463d6]; // competition colours: red 25 kg outside, blue 20 kg inside
  const stripes = plateColors.map((c) => keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.7), roughness: 0.86 }))); // matte rubber

  // Bar parts are laid out along +x in bar space; each is rigid and sags with the bend curve y = -uBend·x².
  type Part = { m: T.Mesh; x: number };
  const parts: Part[] = [];
  const part = (g: T.BufferGeometry, m: T.Material, x: number) => {
    const p = new THREE.Mesh(g, m);
    p.castShadow = opts.shadows;
    p.rotation.z = Math.PI / 2;
    p.position.x = x;
    bar.add(p);
    parts.push({ m: p, x });
    return p;
  };
  const gShaftSeg = keep(new THREE.CylinderGeometry(0.0145, 0.0145, 0.26, 18));
  const gSleeve = keep(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 20));
  const gCollar = keep(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 24));
  for (let i = 0; i < 5; i++) {
    const x = -0.52 + i * 0.26;
    part(gShaftSeg, i === 2 ? chrome : knurl, x); // knurled grips either side of a smooth centre
  }
  for (const s of [-1, 1]) {
    part(gCollar, chrome, s * 0.665);
    part(gSleeve, chrome, s * 0.9);
  }
  // Bumper plates: rubber body, a coloured face ring, a steel hub. Rebuilt only when the load changes.
  const gPlate = keep(new THREE.CylinderGeometry(1, 1, 1, 48));
  const plates: { body: T.Mesh; ring: T.Mesh; hubM: T.Mesh; side: number; slot: number }[] = [];
  for (const s of [-1, 1]) {
    for (let slot = 0; slot < 2; slot++) {
      const body = part(gPlate, rubber, 0);
      const ring = part(gPlate, stripes[slot]!, 0);
      const hubM = part(gPlate, hub, 0);
      plates.push({ body, ring, hubM, side: s, slot });
    }
  }
  const setLoad = (radius: number) => {
    // Lighter lifts (curls) swap to thin change plates; heavy lifts carry two full bumpers a side.
    const heavy = THREE.MathUtils.smoothstep(radius, 0.14, 0.2);
    for (const p of plates) {
      const w = p.slot === 0 ? 0.062 : 0.052 * heavy + 0.0001;
      const r = p.slot === 0 ? radius : radius * (0.55 + 0.45 * heavy);
      const x = p.side * (0.7 + (p.slot === 0 ? w / 2 : 0.062 + w / 2));
      p.body.scale.set(r, w, r);
      p.ring.scale.set(r * 0.72, w * 1.04, r * 0.72);
      p.hubM.scale.set(0.05, w * 1.08, 0.05);
      for (const m of [p.body, p.ring, p.hubM]) {
        m.position.x = x;
        m.visible = p.slot === 0 || heavy > 0.02;
        const rec = parts.find((q) => q.m === m)!;
        rec.x = x;
      }
    }
  };
  setLoad(BODY.plateRadius);

  // ─── posing ───
  const Y = new THREE.Vector3(0, 1, 0);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), dir = new THREE.Vector3();
  const bone = (m: T.Object3D, a: V3, b: V3) => {
    va.set(a[0], a[1], a[2]);
    vb.set(b[0], b[1], b[2]);
    dir.subVectors(vb, va);
    const l = dir.length();
    m.position.copy(va);
    m.quaternion.setFromUnitVectors(Y, dir.divideScalar(l || 1));
    m.scale.y = l;
  };
  const at = (m: T.Object3D, p: V3) => m.position.set(p[0], p[1], p[2]);
  /** Orient `m` along a→b (keeping its own scale) and place it `along` metres from a. */
  const align = (m: T.Object3D, a: V3, b: V3, along: number) => {
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    m.quaternion.setFromUnitVectors(Y, dir);
    m.position.set(a[0] + dir.x * along, a[1] + dir.y * along, a[2] + dir.z * along);
  };
  const torsoQ = new THREE.Quaternion();
  const upV = new THREE.Vector3();

  /** Pose everything from the skeleton. `breath` 0..1 swells the chest; `bend` is bar sag at the sleeves in metres. */
  const body = opts.body !== false;
  if (!body) for (const c of root.children) if (c !== bar) c.visible = false;
  const pose = (s: Skeleton, extra: { breath: number; bend: number; headPitch: number }) => {
    if (body) poseBody(s, extra);
    bar.position.set(s.bar[0], s.bar[1], s.bar[2]);
    // Sag: the load hangs off the sleeves, so parts drop by bend·(x/0.9)² and tilt with the curve's slope.
    for (const p of parts) {
      const k = p.x / 0.9;
      p.m.position.y = -extra.bend * k * k;
      p.m.rotation.x = 0;
      p.m.rotation.y = 0;
      p.m.rotation.z = Math.PI / 2 - (2 * extra.bend * p.x) / 0.81;
    }
  };
  const poseBody = (s: Skeleton, extra: { breath: number; headPitch: number }) => {
    upV.set(s.up[0], s.up[1], s.up[2]);
    torsoQ.setFromUnitVectors(Y, upV);
    const hip: V3 = [(s.hipL[0] + s.hipR[0]) / 2, s.hipL[1], s.hipL[2]];
    torso.position.set(hip[0], hip[1], hip[2]);
    torso.quaternion.copy(torsoQ);
    const chest = 1 + extra.breath * 0.035;
    torso.scale.set(chest, 1, 0.64 * (1 + extra.breath * 0.06));
    chestRig.position.copy(torso.position);
    chestRig.quaternion.copy(torsoQ);
    chestRig.scale.set(chest, 1, 1 + extra.breath * 0.06);
    shortsTorso.position.copy(torso.position);
    shortsTorso.quaternion.copy(torsoQ);
    const sc: V3 = [(s.shoulderL[0] + s.shoulderR[0]) / 2, s.shoulderL[1], s.shoulderL[2]];
    traps.position.set(sc[0], sc[1] + 0.02 * s.up[1], sc[2] + 0.02 * s.up[2]);
    traps.quaternion.copy(torsoQ);
    traps.scale.set(0.16, 0.055, 0.09);
    const headBase: V3 = [s.head[0], s.head[1] - 0.09, s.head[2] - 0.01];
    bone(neck, [sc[0], sc[1] - 0.02, sc[2]], headBase);
    neck.scale.x = neck.scale.z = 1;
    at(head, s.head);
    // Neutral spine: the head follows the torso, eyes drift toward the horizon on deep hinges.
    head.rotation.set(Math.atan2(s.up[2], s.up[1]) * 0.55 - extra.headPitch, 0, 0);

    for (const x of [L, R]) {
      const left = x.s < 0;
      const hipJ = left ? s.hipL : s.hipR, knee = left ? s.kneeL : s.kneeR, ankle = left ? s.ankleL : s.ankleR;
      const sh = left ? s.shoulderL : s.shoulderR, el = left ? s.elbowL : s.elbowR, hand = left ? s.handL : s.handR;
      // Each foot has its own turn-out (mid-step one has turned and the other not yet).
      const toe = x.s * (left ? s.toeL : s.toeR);
      // Poles: knees point forward over the toes, elbows point away from the bend.
      x.leg.update(hipJ, knee, ankle, [Math.sin(toe) * 0.6, 0, 1]);
      const mid: V3 = [(sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2, (sh[2] + hand[2]) / 2];
      // Elbow flexion from the shoulder–hand chord: 0 straight, 1 fully curled.
      const chord = Math.hypot(hand[0] - sh[0], hand[1] - sh[1], hand[2] - sh[2]);
      x.arm.state.flex = Math.max(0, Math.min(1, 1 - (chord - 0.16) / (BODY.upperArm + BODY.forearm - 0.16)));
      x.arm.update(sh, el, hand, [el[0] - mid[0] + x.s * 1e-3, el[1] - mid[1], el[2] - mid[2] - 1e-3]);
      align(x.delt, sh, el, 0.03);
      x.delt.position.x += x.s * 0.012;
      align(x.hand, el, hand, BODY.forearm);
      // Feet planted, toes out by the stance angle; the shoe sits forward of the ankle joint like a real foot, and
      // rises with it when the rig lifts the foot to step.
      const fx = ankle[0] + Math.sin(toe) * 0.07, fz = ankle[2] + Math.cos(toe) * 0.07, lift = ankle[1] - BODY.ankle;
      x.shoe.position.set(fx, 0.05 + lift, fz);
      x.shoe.rotation.set(0, toe, 0);
      x.sole.position.set(fx, 0.011 + lift, fz);
      x.sole.rotation.set(0, toe, 0);
    }
  };

  /** Sweat builds over a set: 0 dry → 1 glistening (clearcoat and a slightly darker, glossier skin). */
  const setSweat = (w: number) => {
    skin.clearcoat = 0.22 + w * 0.6;
    skin.clearcoatRoughness = 0.4 - w * 0.25;
    skin.roughness = 0.52 - w * 0.12;
  };
  return {
    root,
    pose,
    /** The rig's left and right shoes (for checks that the feet follow the rig's steps). */
    shoes: [L.shoe, R.shoe] as const,
    setLoad,
    setSweat,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export type Athlete = ReturnType<typeof buildAthlete>;
