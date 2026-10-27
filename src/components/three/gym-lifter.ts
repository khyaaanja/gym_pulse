import type * as T from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BODY, LEG_SOFT, twoBone, type Skeleton, type V3 } from "./gym-rig";

type Three = typeof T;

/**
 * The lifter as a real skinned character (a Mixamo-rigged body prepared by scripts/prepare-lifter-model.py; see
 * public/models/README.md), driven every frame by the solved `Skeleton` from gym-rig.
 *
 * The rig's BODY proportions are this model's own (scaled so the hips stand at 0.98 m), so retargeting is exact:
 * the pelvis sits on the rig's hip centre and tilts with the lean, each leg reaches the rig's ankle and each arm the
 * rig's grip point with two-bone IK over the model's real bone lengths, bending toward the rig's knee and elbow.
 * Bones are oriented by two axes (along the bone, plus a knee/elbow/palm direction), so limbs never corkscrew.
 * Fingers close round the bar; the palm faces the bar the way the grip demands (overhand, or underhand for curls).
 */

export { LIFTER_URL } from "./gym-rig";
/** Model units → metres: puts the hip joints at 0.98 m, matching BODY. */
const SCALE = 1.045;

type Bones = Record<string, T.Bone>;
type Rest = { q: T.Quaternion; p: T.Vector3 };

export type LifterExtra = { breath: number; headPitch: number; grip: number; effort: number };

export function buildLifter(THREE: Three, gltf: GLTF, opts: { shadows: boolean }) {
  const root = new THREE.Group();
  const holder = gltf.scene;
  holder.scale.setScalar(SCALE);
  root.add(holder);

  const bones: Bones = {};
  const disposables: { dispose(): void }[] = [];
  let skin: T.MeshPhysicalMaterial | null = null;
  holder.traverse((o) => {
    if ((o as T.Bone).isBone) {
      // Handle various bone naming conventions: Mixamo, custom, etc.
      let name = o.name;
      // Remove common prefixes
      name = name.replace(/^mixamorig:?/i, "");
      name = name.replace(/^armature_/i, "");
      name = name.replace(/^rig_/i, "");
      name = name.replace(/^bone_/i, "");
      bones[name] = o as T.Bone;
      // Also store with original name as fallback
      if (name !== o.name) bones[o.name] = o as T.Bone;
    }
    const m = o as T.SkinnedMesh;
    if (m.isSkinnedMesh) {
      m.castShadow = m.receiveShadow = opts.shadows;
      m.frustumCulled = false; // bounds come from the bind pose, not the lift; never cull the lifter mid-rep
      // The renderer still wants a sphere to sort the lifter by depth, and computes a skinned mesh's by skinning every
      // vertex on the CPU (~65 ms, inside the film's first frame). The bind pose's is all a depth sort needs.
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.boundingSphere = m.geometry.boundingSphere!.clone();
      const mat = m.material as T.MeshPhysicalMaterial;
      // The source packs a glossiness map where glTF expects metal/roughness: drop it and author the surface here.
      mat.metalness = 0;
      mat.metalnessMap = null;
      mat.roughnessMap = null;
      mat.roughness = 0.62;
      if ("specularIntensity" in mat) mat.specularIntensity = 0.6;
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
      skin = mat;
      disposables.push(m.geometry, mat);
      if (mat.map) disposables.push(mat.map);
      if (mat.normalMap) disposables.push(mat.normalMap);
    }
  });
  const need = ["Hips", "Neck", "Head", "Spine2"] as const;
  const missing = need.filter((n) => !bones[n]);
  if (missing.length > 0) {
    // Try common alternative names
    const alternatives: Record<string, string[]> = {
      Hips: ["Hip", "Pelvis", "hip", "pelvis"],
      Neck: ["Neck1", "neck"],
      Head: ["HeadTop", "head", "Skull"],
      Spine2: ["Spine1", "Spine", "Chest", "chest", "spine1", "spine"],
    };
    for (const n of missing) {
      for (const alt of alternatives[n] ?? []) {
        if (bones[alt]) {
          bones[n] = bones[alt];
          break;
        }
      }
    }
    // Final check
    const stillMissing = need.filter((n) => !bones[n]);
    if (stillMissing.length > 0) {
      console.warn(`[Lifter] Missing bones (will use fallback): ${stillMissing.join(", ")}`);
      // Don't throw - create dummy bones for critical ones to prevent crash
      for (const n of stillMissing) {
        const dummy = new THREE.Bone();
        dummy.name = n;
        holder.add(dummy);
        bones[n] = dummy;
      }
    }
  }

  // ─── rest pose, in root space (the root sits where the athlete does) ───
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4();
  const toRoot = (v: T.Vector3) => v.applyMatrix4(rootInv.copy(root.matrixWorld).invert());
  const rest: Record<string, Rest> = {};
  const rq = new THREE.Quaternion();
  for (const [n, b] of Object.entries(bones)) {
    const p = toRoot(b.getWorldPosition(new THREE.Vector3()));
    b.getWorldQuaternion(rq);
    // Root-space rotation: the root carries no rotation of its own, so world == root for orientation.
    rest[n] = { q: rq.clone(), p };
  }
  const restLocal: Record<string, T.Quaternion> = {};
  for (const [n, b] of Object.entries(bones)) restLocal[n] = b.quaternion.clone();
  const R = (n: string) => rest[n]!;
  const hipMid = R("LeftUpLeg").p.clone().add(R("RightUpLeg").p).multiplyScalar(0.5);
  const hipsOffset = hipMid.clone().sub(R("Hips").p); // Hips bone → centre between the hip joints
  const footY = (R("LeftFoot").p.y + R("RightFoot").p.y) / 2;

  // Rest palm normal and finger direction for each hand, from the finger roots (works whatever way the palms face).
  const palmRest = (s: "Left" | "Right") => {
    // Check if all required bones exist
    const handBone = bones[`${s}Hand`];
    const indexBone = bones[`${s}HandIndex1`];
    const pinkyBone = bones[`${s}HandPinky1`];
    const middleBone = bones[`${s}HandMiddle1`];
    if (!handBone || !indexBone || !pinkyBone || !middleBone) {
      // Fallback: use default palm orientation
      const along = new THREE.Vector3(0, 0, -1); // fingers point forward
      const n = new THREE.Vector3(s === "Left" ? -1 : 1, 0, 0); // palm faces sideways
      return { along, n };
    }
    const h = R(`${s}Hand`).p, i = R(`${s}HandIndex1`).p, k = R(`${s}HandPinky1`).p, m = R(`${s}HandMiddle1`).p;
    const along = m.clone().sub(h).normalize();
    const across = i.clone().sub(k).normalize();
    // across × along is the back of the right hand and the palm of the left… mirrored: flip the left.
    const n = new THREE.Vector3().crossVectors(across, along).normalize();
    if (s === "Left") n.negate();
    return { along, n };
  };
  const palm = { Left: palmRest("Left"), Right: palmRest("Right") };

  // ─── helpers ───
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qp = new THREE.Quaternion();
  const ma = new THREE.Matrix4(), mb = new THREE.Matrix4();
  const x1 = new THREE.Vector3(), y1 = new THREE.Vector3(), z1 = new THREE.Vector3();
  const tv = new THREE.Vector3(), tw = new THREE.Vector3();
  const v = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
  const basis = (primary: T.Vector3, secondary: T.Vector3, out: T.Matrix4) => {
    x1.copy(primary).normalize();
    z1.crossVectors(x1, secondary);
    if (z1.lengthSq() < 1e-10) z1.set(0, 0, 1).cross(x1);
    z1.normalize();
    y1.crossVectors(z1, x1);
    return out.makeBasis(x1, y1, z1);
  };
  /** World rotation that carries the bone's rest (primary, secondary) frame onto the target one. */
  const aim = (n: string, restP: T.Vector3, restS: T.Vector3, tgtP: T.Vector3, tgtS: T.Vector3) => {
    basis(tgtP, tgtS, ma);
    basis(restP, restS, mb);
    qa.setFromRotationMatrix(ma.multiply(mb.transpose()));
    setWorld(n, qa.multiply(R(n).q));
  };
  const rootQ = new THREE.Quaternion();
  const setWorld = (n: string, q: T.Quaternion) => {
    const b = bones[n];
    if (!b) return;
    b.parent!.getWorldQuaternion(qp);
    b.quaternion.copy(qp.invert().multiply(rootQ).multiply(q));
    b.updateMatrixWorld(true);
  };
  const posOf = (n: string, out: T.Vector3) => toRoot(bones[n]!.getWorldPosition(out));

  const FWD = new THREE.Vector3(0, 0, 1), BACK = new THREE.Vector3(0, 0, -1), X = new THREE.Vector3(1, 0, 0);
  const qLean = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  const knee = new THREE.Vector3(), foot = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const hipJ = new THREE.Vector3(), shJ = new THREE.Vector3(), grip = new THREE.Vector3();
  const L = {
    thigh: R("LeftLeg").p.distanceTo(R("LeftUpLeg").p),
    shin: R("LeftFoot").p.distanceTo(R("LeftLeg").p),
    upper: R("LeftForeArm").p.distanceTo(R("LeftArm").p),
    fore: R("LeftHand").p.distanceTo(R("LeftForeArm").p),
  };
  // Match rig's forearm length (elbow → grip center) so IK targets the same point.
  // Mesh forearm bone (L.fore) is elbow → wrist; hand bone adds ~3 cm to palm center.
  // We target BODY.forearm (0.283) for consistency with the rig.
  const gripReach = BODY.forearm;
  const FINGERS = ["Index", "Middle", "Ring", "Pinky"] as const;
  // How far each finger joint closes round a 29 mm bar, radians (knuckle, middle, tip).
  const CURL = [1.05, 1.25, 0.75];

  /** Pose the model from the rig. `grip` +1 overhand … −1 underhand; `headPitch` chin lift; `effort` 0..1 brace. */
  const pose = (s: Skeleton, x: LifterExtra) => {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(rootQ);

    // Pelvis and spine: one rigid tilt about the hip axis, the neutral spine every pull and squat is coached to.
    const lean = Math.atan2(s.up[2], s.up[1]);
    qLean.setFromAxisAngle(X, lean);
    setWorld("Hips", qTmp.copy(qLean).multiply(R("Hips").q));
    const hc = v([(s.hipL[0] + s.hipR[0]) / 2, s.hipL[1], s.hipL[2]]);
    const hipsAt = hc.sub(tv.copy(hipsOffset).applyQuaternion(qLean));
    const hips = bones.Hips!;
    const hw = hipsAt.applyMatrix4(root.matrixWorld);
    hips.parent!.worldToLocal(hw);
    hips.position.copy(hw);
    hips.updateMatrixWorld(true);
    // Breathing lifts the chest; effort braces it.
    const chest = (x.breath - 0.5) * 0.03 - x.effort * 0.04;
    setWorld("Spine2", qTmp.setFromAxisAngle(X, lean + chest).multiply(R("Spine2").q));
    // Neck and head: follow the torso, but the eyes drift toward the horizon on deep hinges. This skull sits a little
    // back at rest, so a small nod keeps the gaze level rather than up at the lights.
    const headLean = lean * 0.55 - x.headPitch * 0.5 + 0.12;
    setWorld("Neck", qTmp.setFromAxisAngle(X, (lean + headLean) / 2).multiply(R("Neck").q));
    setWorld("Head", qTmp.setFromAxisAngle(X, headLean).multiply(R("Head").q));

    for (const side of ["Left", "Right"] as const) {
      // The model's left is +x; the rig names its −x side L.
      const sx = side === "Left" ? 1 : -1;
      const rigHip = sx > 0 ? s.hipR : s.hipL, rigKnee = sx > 0 ? s.kneeR : s.kneeL, rigAnkle = sx > 0 ? s.ankleR : s.ankleL;
      const rigSh = sx > 0 ? s.shoulderR : s.shoulderL, rigEl = sx > 0 ? s.elbowR : s.elbowL, rigHand = sx > 0 ? s.handR : s.handL;

      // ─── leg ───
      posOf(`${side}UpLeg`, hipJ);
      // The rig raises a stepping foot off the floor; the mesh's foot must rise with it, or it skates.
      const target: V3 = [rigAnkle[0], footY + rigAnkle[1] - BODY.ankle, rigAnkle[2]];
      const pole: V3 = [rigKnee[0] - rigHip[0], rigKnee[1] - rigHip[1], rigKnee[2] - rigHip[2]];
      const [k, f] = twoBone([hipJ.x, hipJ.y, hipJ.z], target, L.thigh, L.shin, pole, LEG_SOFT);
      knee.set(k[0], k[1], k[2]);
      foot.set(f[0], f[1], f[2]);
      // Kneecap faces where the toes point. Each foot has its own turn-out: mid-step one foot has already turned
      // and the planted one has not.
      const toe = sx * (sx > 0 ? s.toeR : s.toeL);
      const kneeFwd = tw.set(Math.sin(toe), 0, Math.cos(toe));
      aim(`${side}UpLeg`, tv.copy(R(`${side}Leg`).p).sub(R(`${side}UpLeg`).p), FWD, knee.clone().sub(hipJ), kneeFwd);
      aim(`${side}Leg`, tv.copy(R(`${side}Foot`).p).sub(R(`${side}Leg`).p), FWD, foot.clone().sub(knee), kneeFwd);
      // Foot flat on the floor, turned out by the stance.
      qYaw.setFromAxisAngle(y1.set(0, 1, 0), toe);
      setWorld(`${side}Foot`, qTmp.copy(qYaw).multiply(R(`${side}Foot`).q));

      // ─── arm ───
      // The collarbone rides up as the hands go overhead.
      const up = Math.min(1, Math.max(0, (rigHand[1] - rigSh[1]) / 0.45));
      const shrugAxis = tv.set(0, 0, 1).applyQuaternion(qLean);
      // From the collarbone's rest orientation under this frame's spine, never its current one: that still carries
      // last frame's shrug, and re-applying it every frame winds the shoulder round further on each one.
      const clav = bones[`${side}Shoulder`]!;
      clav.parent!.getWorldQuaternion(qb).multiply(restLocal[`${side}Shoulder`]!);
      setWorld(`${side}Shoulder`, qTmp.setFromAxisAngle(shrugAxis, sx * up * 0.32).multiply(qb.premultiply(qa.copy(rootQ).invert())));
      posOf(`${side}Arm`, shJ);
      grip.set(rigHand[0], rigHand[1], rigHand[2]);
      const aPole: V3 = [rigEl[0] - (rigSh[0] + rigHand[0]) / 2, rigEl[1] - (rigSh[1] + rigHand[1]) / 2, rigEl[2] - (rigSh[2] + rigHand[2]) / 2];
      // The rig's grip already eases into lockout (its own soft IK); softening again from this shoulder would stop
      // the palm short of the bar at full reach overhead, so the mesh only eases in over the last sliver.
      const [e, g] = twoBone([shJ.x, shJ.y, shJ.z], [grip.x, grip.y, grip.z], L.upper, gripReach, aPole, LEG_SOFT);
      elbow.set(e[0], e[1], e[2]);
      const foreDir = new THREE.Vector3(g[0] - e[0], g[1] - e[1], g[2] - e[2]).normalize();
      wrist.copy(elbow).addScaledVector(foreDir, L.fore);
      // Elbow point: the side the joint sticks out (away from the bend).
      const upperDir = elbow.clone().sub(shJ).normalize();
      const out = new THREE.Vector3(aPole[0], aPole[1], aPole[2]);
      out.addScaledVector(upperDir, -out.dot(upperDir));
      if (out.lengthSq() < 1e-8) out.copy(BACK);
      // Palm: perpendicular to the bar and the forearm; overhand faces it back along the bend, underhand flips it.
      const palmN = new THREE.Vector3().crossVectors(X, foreDir);
      if (palmN.lengthSq() < 1e-6) palmN.copy(BACK);
      palmN.normalize().applyAxisAngle(foreDir, ((1 - x.grip) / 2) * Math.PI);
      const pr = palm[side];
      // Safety checks for required rest data
      const hasForeArmRest = !!rest[`${side}ForeArm`];
      const hasArmRest = !!rest[`${side}Arm`];
      const hasHandRest = !!rest[`${side}Hand`];
      if (hasArmRest && hasForeArmRest) {
        const restUpper = tv.copy(R(`${side}ForeArm`).p).sub(R(`${side}Arm`).p);
        // T-pose: the elbow hinge flexes forward, so the point of the elbow faces back whatever the palm does.
        aim(`${side}Arm`, restUpper, BACK, upperDir, out);
      }
      if (hasForeArmRest && hasHandRest) {
        // The forearm carries most of the palm's twist; the wrist stays straight.
        aim(`${side}ForeArm`, tw.copy(R(`${side}Hand`).p).sub(R(`${side}ForeArm`).p), pr.n, foreDir, palmN);
      }
      if (hasHandRest) {
        aim(`${side}Hand`, pr.along, pr.n, foreDir, palmN);
      }

      // Fingers wrap the bar; the thumb closes over them.
      for (const fn of FINGERS) {
        for (let j = 1; j <= 3; j++) {
          const n = `${side}Hand${fn}${j}`;
          const b = bones[n];
          if (!b || !restLocal[n]) continue;
          // Curl axis: across the palm, in the bone's own rest frame.
          const axis = tv.crossVectors(pr.along, pr.n).normalize().applyQuaternion(qb.copy(R(n).q).invert());
          b.quaternion.copy(restLocal[n]!).multiply(qTmp.setFromAxisAngle(axis, CURL[j - 1]! * (fn === "Index" ? 0.92 : 1)));
        }
      }
      for (let j = 1; j <= 3; j++) {
        const n = `${side}HandThumb${j}`;
        const b = bones[n];
        if (!b || !restLocal[n]) continue;
        const axis = tv.copy(pr.along).applyQuaternion(qb.copy(R(n).q).invert()).normalize();
        b.quaternion.copy(restLocal[n]!).multiply(qTmp.setFromAxisAngle(axis, sx * [0.35, 0.45, 0.4][j - 1]!));
      }
      if (bones[`${side}Hand`]) bones[`${side}Hand`]!.updateMatrixWorld(true);
    }
  };

  /** Sweat builds over a set: skin gets glossier. */
  const setSweat = (w: number) => {
    if (!skin) return;
    skin.roughness = 0.62 - w * 0.2;
    if ("clearcoat" in skin) {
      // Never quite 0: clearcoat 0 → >0 switches the skin to another shader, compiled mid-film (a ~100 ms freeze at the
      // first lockout). Kept on, the program precompiled before the film shows is the one it keeps using.
      skin.clearcoat = Math.max(0.001, w * 0.35);
      skin.clearcoatRoughness = 0.45;
    }
  };

  return { root, pose, setSweat, bones, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export type Lifter = ReturnType<typeof buildLifter>;

