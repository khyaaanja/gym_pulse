import { readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildLifter, type Lifter } from "@/components/three/gym-lifter";
import { BODY, LIFTS, LIFT_ORDER, NODES, pathAt, planPath, poseOf, poseOfKey, solve, type Pose } from "@/components/three/gym-rig";

// The skinned lifter driven by the rig, on the real model (textures stripped: node has no image decoder). The rig's
// own guarantees are in gym-rig.test.ts; these check that the mesh actually follows them.

async function loadLifter(): Promise<Lifter> {
  const buf = readFileSync(path.resolve(__dirname, "../public/models/lifter.glb"));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    for (const e of Object.values(m.extensions ?? {}) as Record<string, unknown>[]) for (const k of Object.keys(e)) if (k.endsWith("Texture")) delete e[k];
  }
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + bin.length, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  const glb = Buffer.concat([head, js, bin]);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, "");
  return buildLifter(THREE, gltf, { shadows: false });
}

let lifter: Lifter;
const at = (n: string) => lifter.bones[n]!.getWorldPosition(new THREE.Vector3());
const rot = (n: string) => lifter.bones[n]!.getWorldQuaternion(new THREE.Quaternion());
const show = (p: Pose) => lifter.pose(solve(p), { breath: 0.5, headPitch: 0.1, grip: p.hand, effort: 0 });

beforeAll(async () => {
  lifter = await loadLifter();
});

describe("gym lifter: the mesh follows the rig", () => {
  it("poses the same way every time it is given the same skeleton (nothing accumulates frame to frame)", () => {
    // The collarbone shrug was re-applied on top of last frame's, winding the shoulders round while the bar was overhead.
    for (const id of ["overhead", "lockB", "hang", "backRack"] as const) {
      show(poseOfKey(NODES[id].key));
      const first = ["LeftArm", "RightArm", "LeftHand", "RightHand"].map(at);
      for (let i = 0; i < 5; i++) show(poseOfKey(NODES[id].key));
      ["LeftArm", "RightArm", "LeftHand", "RightHand"].forEach((n, i) => expect(at(n).distanceTo(first[i]!), `${id} ${n}`).toBeLessThan(1e-5));
    }
  });

  it("lifts each foot off the floor and turns it on its own when the lifter steps into a new stance", () => {
    const p = planPath(poseOf(LIFTS.press!, 1), "overhead", LIFTS.lockout!);
    expect(p.step).not.toBeNull();
    show(pathAt(p, 0));
    const floor = at("LeftFoot").y;
    let lift = 0, toeSplit = 0;
    for (let i = 0; i <= 120; i++) {
      const pose = pathAt(p, (p.total * i) / 120), s = solve(pose);
      show(pose);
      // the mesh's foot height above the floor tracks the rig's ankle
      for (const [bone, ankle] of [["LeftFoot", s.ankleR], ["RightFoot", s.ankleL]] as const) expect(Math.abs(at(bone).y - floor - (ankle[1] - BODY.ankle)), `${bone} i=${i}`).toBeLessThan(0.002);
      lift = Math.max(lift, at("LeftFoot").y - floor, at("RightFoot").y - floor);
      // mid-step the feet point differently; the mesh must too
      const yaw = (n: string) => new THREE.Euler().setFromQuaternion(rot(n), "YXZ").y;
      toeSplit = Math.max(toeSplit, Math.abs(Math.abs(yaw("LeftFoot")) - Math.abs(yaw("RightFoot"))));
    }
    expect(lift).toBeGreaterThan(0.05);
    expect(toeSplit).toBeGreaterThan(0.05);
  });

  it("never flips a forearm or wrist between frames, across every change of lift", () => {
    // A palm normal taken across the bar degenerates when the forearm lies along it (elbows crossed): the wrist spun.
    let worst = 0, where = "";
    for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
      if (a === b) continue;
      for (const node of [LIFTS[a]!.rest, LIFTS[a]!.hold]) {
        const p = planPath(poseOfKey(NODES[node].key), node, LIFTS[b]!);
        let prev: THREE.Quaternion[] | null = null;
        for (let t = 0; t <= p.total; t += 1 / 60) {
          show(pathAt(p, t));
          const q = ["LeftForeArm", "RightForeArm", "LeftHand", "RightHand"].map(rot);
          if (prev) q.forEach((x, i) => {
            const d = x.angleTo(prev![i]!);
            if (d > worst) [worst, where] = [d, `${node}→${b} t=${t.toFixed(2)}`];
          });
          prev = q;
        }
      }
    }
    expect((worst * 180) / Math.PI, where).toBeLessThan(8); // degrees per 60 fps frame
  });
});

describe("gym lifter: grip and the fallback figure", () => {
  it("keeps the palms on the bar through every change of lift", () => {
    // The palm point (between the wrist and the middle knuckle) sits ~1.9 cm off the grip centre by construction.
    let worst = 0, where = "";
    for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
      if (a === b) continue;
      for (const node of [LIFTS[a]!.rest, LIFTS[a]!.hold]) {
        const p = planPath(poseOfKey(NODES[node].key), node, LIFTS[b]!);
        for (let t = 0; t <= p.total; t += 0.1) {
          const pose = pathAt(p, t), s = solve(pose);
          show(pose);
          for (const [side, h] of [["Left", s.handR], ["Right", s.handL]] as const) {
            const d = at(`${side}Hand`).add(at(`${side}HandMiddle1`)).multiplyScalar(0.5).distanceTo(new THREE.Vector3(h[0], h[1], h[2]));
            if (d > worst) [worst, where] = [d, `${node}→${b} t=${t.toFixed(1)} ${side}`];
          }
        }
      }
    }
    expect(worst, where).toBeLessThan(0.032);
  });

  it("lifts and turns the built-in figure's shoes with the rig's steps too", async () => {
    const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
    const { buildAthlete } = await import("@/components/three/gym-athlete");
    const fig = buildAthlete(THREE, RoundedBoxGeometry, { segments: 8, shadows: false, body: true });
    const p = planPath(poseOf(LIFTS.press!, 1), "overhead", LIFTS.lockout!);
    let lift = 0, split = 0;
    for (let i = 0; i <= 120; i++) {
      const s = solve(pathAt(p, (p.total * i) / 120));
      fig.pose(s, { breath: 0.5, bend: 0, headPitch: 0.1 });
      const [l, r] = fig.shoes;
      expect(l.position.y - 0.05, `i=${i}`).toBeCloseTo(s.ankleL[1] - BODY.ankle, 6);
      expect(r.position.y - 0.05, `i=${i}`).toBeCloseTo(s.ankleR[1] - BODY.ankle, 6);
      lift = Math.max(lift, l.position.y - 0.05, r.position.y - 0.05);
      split = Math.max(split, Math.abs(Math.abs(l.rotation.y) - Math.abs(r.rotation.y)));
    }
    expect(lift).toBeGreaterThan(0.05);
    expect(split).toBeGreaterThan(0.05);
    fig.dispose();
  });
});

describe("gym lifter: the bar and the body's surface", () => {
  it("never sinks the bar into the skinned body (hands excepted) through the lifts and every change of lift", () => {
    // CPU-skinned vertices against the bar's axis. The rig's shin stand-off was measured ~3 cm short of the mesh, so
    // the bar sank ~1 cm into the shins leaving the floor.
    let mesh!: THREE.SkinnedMesh;
    lifter.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const pos = mesh.geometry.attributes.position!, si = mesh.geometry.attributes.skinIndex!, sw = mesh.geometry.attributes.skinWeight!;
    const names = mesh.skeleton.bones.map((b) => b.name.replace(/^mixamorig:?/, ""));
    const verts: number[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      let bi = 0, bw = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) [bw, bi] = [sw.getComponent(i, k), si.getComponent(i, k)];
      if (!/Hand/.test(names[bi]!)) verts.push(i);
    }
    const v = new THREE.Vector3();
    let worst = Infinity, where = "";
    const check = (pose: Pose, label: string) => {
      const s = solve(pose);
      show(pose);
      mesh.skeleton.update();
      for (const i of verts) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x) > 0.6) continue;
        const d = Math.hypot(v.y - s.bar[1], v.z - s.bar[2]) - 0.0145;
        if (d < worst) [worst, where] = [d, label];
      }
    };
    for (const id of LIFT_ORDER) for (let u = 0; u <= 1.0001; u += 0.1) check(poseOf(LIFTS[id]!, u), `${id} u=${u.toFixed(1)}`);
    for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
      if (a === b) continue;
      for (const node of [LIFTS[a]!.rest, LIFTS[a]!.hold]) {
        const p = planPath(poseOfKey(NODES[node].key), node, LIFTS[b]!);
        for (let t = 0; t <= p.total; t += 0.2) check(pathAt(p, t), `${node}→${b} t=${t.toFixed(1)}`);
      }
    }
    expect(worst, where).toBeGreaterThan(0);
  }, 120_000);
});
