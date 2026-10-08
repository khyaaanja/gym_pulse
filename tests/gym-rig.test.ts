import { describe, expect, it } from "vitest";
import {
  BODY,
  LIFTS,
  LIFT_ORDER,
  MAX_REP_RATE,
  NODES,
  SET_REPS,
  SURFACE,
  carry,
  pathAt,
  planPath,
  poseOfKey,
  repAt,
  repPlan,
  repPose,
  route,
  setOpening,
  solve,
  sway,
  twoBone,
  type Lift,
  type NodeId,
  type Pose,
  type Skeleton,
  type V3,
} from "@/components/three/gym-rig";

// Properties of the landing-page lifter's motion, checked over whole simulated sessions rather than single frames:
// every change of lift the page can make (scrolling can skip chapters and go back up; panels wrap round), from both
// still moments of each lift, at a real frame rate. Collisions with the rendered body are checked separately on the
// skinned mesh in the browser (it needs the model); these are the rig's own guarantees.

const DT = 1 / 120;
const d3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const LEG = BODY.thigh + BODY.shin;

type Frame = { pose: Pose; s: Skeleton; at: string };

function* repFrames(lift: Lift, reps: number): Generator<Frame> {
  let n = 0, plan = repPlan(lift, 0), t = 0;
  while (n < reps) {
    t += DT;
    if (t >= plan.total) {
      t -= plan.total;
      plan = repPlan(lift, ++n);
    }
    const pose = repPose(lift, repAt(lift, plan, t));
    yield { pose, s: solve(pose), at: `${lift.id} rep ${n} t=${t.toFixed(2)}` };
  }
}

function* changeFrames(from: Lift, node: NodeId, to: Lift): Generator<Frame> {
  const path = planPath(poseOfKey(NODES[node].key), node, to);
  for (let t = 0; t <= path.total + 1e-9; t += DT) {
    const pose = pathAt(path, t);
    yield { pose, s: solve(pose), at: `${from.id}(${node})→${to.id} t=${(t / path.total).toFixed(2)}` };
  }
}

function* everything(): Generator<Frame[]> {
  for (const id of LIFT_ORDER) yield [...repFrames(LIFTS[id]!, SET_REPS)];
  for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
    if (a === b) continue;
    const A = LIFTS[a]!, B = LIFTS[b]!;
    for (const node of [A.rest, A.hold]) yield [...changeFrames(A, node, B)];
  }
}
const RUNS = [...everything()];

describe("gym rig: two-bone IK", () => {
  it("never overshoots its reach and eases (not snaps) into full extension", () => {
    let prev = 0;
    for (let r = 0.9; r <= 1.1; r += 0.001) {
      const [, end] = twoBone([0, 0, 0], [0, -r, 0], 0.5, 0.5, [0, 0, 1]);
      const d = Math.hypot(...end);
      expect(d).toBeLessThanOrEqual(1);
      if (r > 0.9) expect(d - prev).toBeLessThanOrEqual(0.0011); // monotone, no jumps
      prev = d;
    }
  });
});

describe("gym rig: changing lift", () => {
  it("routes run through the carry tree from where the lifter is to where the next lift starts", () => {
    for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
      const A = LIFTS[a]!, B = LIFTS[b]!;
      for (const node of [A.rest, A.hold]) {
        const r = route(node, B.rest);
        expect(r[0]).toBe(node);
        expect(r[r.length - 1]).toBe(B.rest);
        for (let i = 1; i < r.length; i++) {
          const x = NODES[r[i - 1]!], y = NODES[r[i]!];
          expect(x.parent === r[i] || y.parent === r[i - 1]).toBe(true); // every hop is an edge of the tree
        }
        expect(new Set(r).size).toBe(r.length); // never doubles back
      }
    }
  });

  it("ends exactly in the next lift's starting pose (no pop when the set begins)", () => {
    for (const a of LIFT_ORDER) for (const b of LIFT_ORDER) {
      if (a === b) continue;
      const A = LIFTS[a]!, B = LIFTS[b]!;
      const path = planPath(poseOfKey(NODES[A.rest].key), A.rest, B);
      const plan = repPlan(B, 0), end = solve(pathAt(path, path.total)), start = solve(repPose(B, repAt(B, plan, setOpening(plan))));
      for (const k of ["bar", "hipR", "shoulderR", "elbowR", "kneeR"] as const) expect(d3(end[k], start[k]), `${a}→${b} ${k}`).toBeLessThan(0.002);
      expect(Math.abs(pathAt(path, path.total).stance - B.keys[0]!.stance)).toBeLessThan(1e-6);
    }
  });

  it("eases with an S-curve that starts and ends at rest", () => {
    expect(carry(0)).toBe(0);
    expect(carry(1)).toBeCloseTo(1, 9);
    expect((carry(0.001) - carry(0)) / 0.001).toBeLessThan(0.01);
    expect((carry(1) - carry(0.999)) / 0.001).toBeLessThan(0.01);
  });
});

describe("gym rig: the bar against the body", () => {
  it("meets a leg softly: a bar pushed into the shins at speed eases onto them, no jolt at contact", () => {
    const pose = poseOfKey(NODES.dlKnee.key);
    const v = 0.6, frames: V3[] = [];
    // The target moves straight back through the shins at 0.6 m/s (below the knee, where only the leg can stop it).
    for (let z = 0.35; z > -0.1; z -= v * DT) frames.push(solve({ ...pose, bar: [0, 0.4, z] }).bar);
    let worst = 0;
    for (let i = 2; i < frames.length; i++) {
      const [a, b, c] = [frames[i - 2]!, frames[i - 1]!, frames[i]!];
      worst = Math.max(worst, Math.hypot(c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) / (DT * DT));
    }
    expect(worst).toBeLessThan(25);
  });

  it("never jumps round the legs: the bar moves at most a little further than its target does", () => {
    // Pure projection gives ≤ 1; rounding a joint close to its centre gives up to ~2.5 (surface over distance, still
    // continuous). A flip to the far side of a limb — the bug this guards — was ~60× in one step.
    // (Not the floor set-up: its bar line runs through the knees' centre, a pose no bar path passes through.)
    for (const id of ["dlKnee", "dlThigh", "rdl", "rowDown", "hang", "rack", "backRack"] as const) {
      const pose = poseOfKey(NODES[id].key);
      let prev: V3 | null = null;
      // Leg height only: the torso's contact is two-sided on purpose (a squat bar rides the back), and no bar path
      // crosses a torso — the whole-session tests cover it.
      for (let y = 0.2; y <= pose.hip[1] - 0.02; y += 0.002) {
        // Up and down the body 2 cm in front of the key's own bar line, where bars travel. (Straight through the
        // centre of a joint is a true singularity: no bar path crosses one, see the whole-session tests below.)
        const bar = solve({ ...pose, bar: [0, y, pose.bar[2] + 0.02] }).bar;
        if (prev) expect(Math.hypot(bar[1] - prev[1], bar[2] - prev[2]), `${id} y=${y.toFixed(3)}`).toBeLessThan(0.002 * 5);
        prev = bar;
      }
    }
  });
});

describe("gym rig: every frame of every rep and every change of lift", () => {
  it("starts and ends every change of lift at rest (never starts or stops a moving bar dead)", () => {
    for (const frames of RUNS.slice(LIFT_ORDER.length)) {
      const n = frames.length;
      for (const [i, j] of [[0, 1], [n - 2, n - 1]] as const) {
        const v = d3(frames[i]!.s.bar, frames[j]!.s.bar) / DT;
        expect(v, frames[j]!.at).toBeLessThan(0.05);
      }
    }
  });

  it("never lifts the hips past standing height between keyframes (splines that overshoot would)", () => {
    for (const frames of RUNS) for (const { pose, at } of frames) {
      const top = Math.max(...Object.values(NODES).map((n) => n.key.hipY));
      if (pose.hip[1] > top + 0.002) throw new Error(`hips at ${pose.hip[1].toFixed(3)} above standing at ${at}`);
    }
  });

  it("keeps the feet planted: never over-reached, and never sliding while on the floor", () => {
    for (const frames of RUNS) {
      for (let i = 0; i < frames.length; i++) {
        const { s, pose, at } = frames[i]!;
        for (const [h, a] of [[s.hipL, s.ankleL], [s.hipR, s.ankleR]] as const) {
          if (d3(h, a) / LEG > 0.9999) throw new Error(`leg over-reach at ${at}`);
        }
        if (i === 0) continue;
        const p = frames[i - 1]!.s;
        const liftL = pose.feet?.liftL ?? 0, liftR = pose.feet?.liftR ?? 0;
        // Feet slide only while lifted (a step), never while bearing weight.
        if (liftL < 1e-4) expect(Math.hypot(s.ankleL[0] - p.ankleL[0], s.ankleL[2] - p.ankleL[2]) / DT, at).toBeLessThan(0.05);
        if (liftR < 1e-4) expect(Math.hypot(s.ankleR[0] - p.ankleR[0], s.ankleR[2] - p.ankleR[2]) / DT, at).toBeLessThan(0.05);
      }
    }
  });

  it("never teleports: no joint and no bar moves faster than a human can move it", () => {
    for (const frames of RUNS) {
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1]!.s, b = frames[i]!.s;
        for (const k of ["bar", "handR", "handL", "elbowR", "elbowL", "kneeR", "kneeL", "shoulderR", "head"] as const) {
          const v = d3(a[k], b[k]) / DT;
          if (v > 4) throw new Error(`${k} at ${v.toFixed(1)} m/s at ${frames[i]!.at}`);
        }
      }
    }
  });

  it("moves like a body under load: no joint or bar is ever jolted (bounded acceleration, frame to frame)", () => {
    // m/s². The clean's elbow whip round the bar into the rack is genuinely fast; nothing else comes close.
    const LIMIT = { bar: 100, hipR: 40, shoulderR: 40, kneeR: 90, kneeL: 90, elbowR: 160 } as const;
    for (const frames of RUNS) {
      for (let i = 2; i < frames.length; i++) {
        for (const k of Object.keys(LIMIT) as (keyof typeof LIMIT)[]) {
          const a = frames[i - 2]!.s[k], b = frames[i - 1]!.s[k], c = frames[i]!.s[k];
          const acc = Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) / (DT * DT);
          if (acc > LIMIT[k]) throw new Error(`${k} ${acc.toFixed(0)} m/s² at ${frames[i]!.at}`);
        }
      }
    }
  });

  it("keeps the bar out of the legs: never more than 1 cm inside the kit's measured surface", () => {
    const at = (tab: number[], t: number) => {
      const x = Math.min(1, Math.max(0, t)) * (tab.length - 1), i = Math.min(tab.length - 2, Math.floor(x));
      return tab[i]! + (tab[i + 1]! - tab[i]!) * (x - i);
    };
    for (const frames of RUNS) for (const { s, at: where } of frames) {
      if (s.bar[1] > s.hipR[1]) continue; // legs only meet a bar at leg height
      for (const [a, b, tab] of [[s.hipR, s.kneeR, SURFACE.thigh], [s.kneeR, s.ankleR, SURFACE.shin]] as const) {
        const dz = b[2] - a[2], dy = b[1] - a[1], L2 = dz * dz + dy * dy;
        const t = Math.min(1, Math.max(0, ((s.bar[2] - a[2]) * dz + (s.bar[1] - a[1]) * dy) / L2));
        const d = Math.hypot(s.bar[2] - (a[2] + dz * t), s.bar[1] - (a[1] + dy * t));
        if (d < at(tab, t) + 0.0145 - 0.01) throw new Error(`bar ${((at(tab, t) + 0.0145 - d) * 100).toFixed(1)} cm into the leg at ${where}`);
      }
    }
  });

  it("keeps the hands on the bar (the bar never floats away from the grip)", () => {
    for (const frames of RUNS) for (const { s, at } of frames) {
      const mid: V3 = [(s.handL[0] + s.handR[0]) / 2, (s.handL[1] + s.handR[1]) / 2, (s.handL[2] + s.handR[2]) / 2];
      if (d3(mid, s.bar) > 1e-6) throw new Error(`bar off the hands at ${at}`);
    }
  });

  it("keeps the knees tracking over the toes (never caving in)", () => {
    for (const frames of RUNS) for (const { s, at } of frames) {
      for (const [h, k, a, sg] of [[s.hipL, s.kneeL, s.ankleL, -1], [s.hipR, s.kneeR, s.ankleR, 1]] as const) {
        const t = Math.min(1, Math.max(0, (h[1] - k[1]) / Math.max(1e-6, h[1] - a[1])));
        const lineX = h[0] + (a[0] - h[0]) * t;
        if ((k[0] - lineX) * sg < -0.01) throw new Error(`knee caves in at ${at}`);
      }
    }
  });
});

describe("gym rig: the lifts themselves", () => {
  it("stands tall on straight legs at every standing lockout", () => {
    for (const id of ["hang", "rack", "overhead", "lockA", "backRack", "curlDown"] as const) {
      const s = solve(poseOfKey(NODES[id].key));
      expect(d3(s.hipR, s.ankleR) / LEG, id).toBeGreaterThan(0.99);
    }
  });

  it("squats with the bar over the middle of the foot, controlled down and driven up", () => {
    const sq = LIFTS.squat!;
    const bottom = solve(poseOfKey(NODES.squatBottom.key));
    expect(bottom.bar[2]).toBeGreaterThan(-0.03);
    expect(bottom.bar[2]).toBeLessThan(0.12);
    const down = sq.rep.find((s) => s.ease === "lower")!, up = sq.rep.find((s) => s.ease === "drive")!;
    expect(sq.rep.indexOf(down)).toBeLessThan(sq.rep.indexOf(up)); // eccentric first
    expect(down.d).toBeGreaterThan(up.d); // lowering is slower than the drive
  });

  it("slows the drive as a set wears on, and rests after the last rep", () => {
    const L = LIFTS.deadlift!;
    const drive = (n: number) => repPlan(L, n).durs[L.rep.findIndex((s) => s.ease === "drive")]!;
    for (let n = 1; n < SET_REPS; n++) expect(drive(n)).toBeGreaterThan(drive(n - 1));
    expect(repPlan(L, SET_REPS - 1).total).toBeGreaterThan(repPlan(L, 0).total * 1.4);
  });
});

describe("gym rig: arms and grip", () => {
  it("keeps each elbow on its own side of the body, never crossing in front of the chest", () => {
    // Out of the front rack toward a clean's high elbows, the short way round swept both elbows across the midline.
    let worst = Infinity, at = "";
    for (const run of RUNS) for (const f of run) {
      const m = Math.min(-f.s.elbowL[0], f.s.elbowR[0]);
      if (m < worst) [worst, at] = [m, f.at];
    }
    expect(worst, at).toBeGreaterThan(0.07);
  });

  it("gives a change of grip time: the palms turn over as a regrip, not a flick", () => {
    let worst = 0, at = "";
    for (const run of RUNS) for (let i = 1; i < run.length; i++) {
      const r = Math.abs(run[i]!.pose.hand - run[i - 1]!.pose.hand) / DT;
      if (r > worst) [worst, at] = [r, run[i]!.at];
    }
    expect(worst, at).toBeLessThan(4); // a full turn (+1 → −1) takes well over half a second
  });

  it("carries a bar that rides the body with it through the brace", () => {
    for (const id of LIFT_ORDER) {
      const L = LIFTS[id]!, rel = L.keys[0]!.barRel;
      if (!rel) continue; // a bar on the floor stays on the floor
      const still = { u: 0, seg: L.rep.length - 1, s: 1, effort: 0, settle: 0, still: true };
      const a = repPose(L, { ...still, brace: 0 }), b = repPose(L, { ...still, brace: 1 });
      // The bar in the frame it is keyed in: the torso's (on the back) or the shoulders' (hanging from the arms).
      const local = (p: Pose): [number, number] => {
        const dz = p.bar[2] - (p.hip[2] + BODY.torso * Math.sin(p.lean)), dy = p.bar[1] - (p.hip[1] + BODY.torso * Math.cos(p.lean));
        return rel === "torso" ? [dz * Math.cos(p.lean) - dy * Math.sin(p.lean), dz * Math.sin(p.lean) + dy * Math.cos(p.lean)] : [dz, dy];
      };
      const [az, ay] = local(a), [bz, by] = local(b);
      expect(Math.hypot(az - bz, ay - by), id).toBeLessThan(1e-4);
    }
  });
});

describe("gym rig: stepping", () => {
  it("steps standing tall, so a lifted knee never strikes the bar and flings it (bar speed stays a carry's)", () => {
    // A step planned at fixed fractions of a long carry lifted a knee into a bar hanging at knee height (1.7 m/s).
    let worst = 0, at = "";
    for (const run of RUNS) for (let i = 1; i < run.length; i++) {
      if (!run[i]!.at.includes("→")) continue; // changes of lift only: the lifts' own drives are fast on purpose
      const v = d3(run[i]!.s.bar, run[i - 1]!.s.bar) / DT;
      if (v > worst) [worst, at] = [v, run[i]!.at];
    }
    expect(worst, at).toBeLessThan(1.1);
  });
});

describe("gym rig: tempo and idle life", () => {
  it("plays reps no faster than a lifter can move them, even at the scene's fastest tempo", () => {
    // Scrolling pumps the tempo; uncapped (5.7×) the curl's bar reached 12 m/s.
    let worst = 0, at = "";
    for (const id of LIFT_ORDER) {
      const L = LIFTS[id]!;
      let prev: Skeleton | null = null;
      for (let n = 0; n < SET_REPS; n++) {
        const plan = repPlan(L, n);
        for (let t = 0; t < plan.total; t += DT * MAX_REP_RATE) {
          const s = solve(repPose(L, repAt(L, plan, t)));
          if (prev) for (const k of ["bar", "handR", "elbowR", "kneeR", "shoulderR", "head"] as const) {
            const v = d3(s[k], prev[k]) / DT;
            if (v > worst) [worst, at] = [v, `${id} ${k}`];
          }
          prev = s;
        }
      }
    }
    expect(worst, at).toBeLessThan(4);
  });

  it("sways a carried bar with the body, and leaves a bar on the floor where it lies", () => {
    const up = poseOfKey(NODES.backRack.key), down = poseOfKey(NODES.floor.key);
    const a = sway(up, 0.006, 0.002), b = sway(down, 0.006, 0.002);
    expect(a.bar[0] - up.bar[0]).toBeCloseTo(0.006, 6);
    expect(a.bar[1] - up.bar[1]).toBeCloseTo(0.002, 6);
    expect(b.bar).toEqual(down.bar);
    expect(b.hip[0] - down.hip[0]).toBeCloseTo(0.006, 6);
    // continuous as the bar leaves the floor
    let prev = sway({ ...down, bar: [0, BODY.plateRadius, 0.1] }, 0.006, 0).bar[0];
    for (let y = BODY.plateRadius; y < BODY.plateRadius + 0.12; y += 0.001) {
      const x = sway({ ...down, bar: [0, y, 0.1] }, 0.006, 0).bar[0];
      expect(Math.abs(x - prev)).toBeLessThan(2e-4);
      prev = x;
    }
  });
});

describe("gym rig: knees", () => {
  // A fixed pole aimed the knees ~20° wider than the feet at the floor and in the hole, driving them into the arms.
  const heading = (k: V3, a: V3) => Math.atan2(Math.abs(k[0]) - Math.abs(a[0]), k[2] - a[2]);

  it("never flares a planted, bent knee past the toes, and never caves it in", () => {
    let flare = -Infinity, cave = Infinity;
    const at = ["", ""];
    for (const run of RUNS) for (const f of run) for (const [h, k, a, toe] of [[f.s.hipR, f.s.kneeR, f.s.ankleR, f.s.toeR], [f.s.hipL, f.s.kneeL, f.s.ankleL, f.s.toeL]] as const) {
      if (a[1] > BODY.ankle + 0.002) continue; // a foot in the air swings however it steps
      // The bend: the knee's offset from its hip–ankle line (4.4 cm locked out). Judge only a clearly bent knee.
      const ax = [a[0] - h[0], a[1] - h[1], a[2] - h[2]], v = [k[0] - h[0], k[1] - h[1], k[2] - h[2]];
      const t = (v[0]! * ax[0]! + v[1]! * ax[1]! + v[2]! * ax[2]!) / (ax[0]! ** 2 + ax[1]! ** 2 + ax[2]! ** 2);
      const bend = [v[0]! - ax[0]! * t, v[1]! - ax[1]! * t, v[2]! - ax[2]! * t];
      if (Math.hypot(bend[0]!, bend[1]!, bend[2]!) < 0.08) continue;
      const over = heading(k, a) - toe;
      if (over > flare) [flare, at[0]] = [over, f.at];
      const out = (Math.sign(k[0]) * bend[0]!) / Math.hypot(bend[0]!, bend[2]!); // + = the bend points outward
      if (out < cave) [cave, at[1]] = [out, f.at];
    }
    expect((flare * 180) / Math.PI, at[0]).toBeLessThan(3);
    expect(cave, at[1]).toBeGreaterThan(-0.05);
  });

  it("puts the knees right over the toes at the bottom of a pull, a squat and a dip", () => {
    for (const id of ["floor", "squatBottom", "lockB", "dlThigh"] as const) {
      const s = solve(poseOfKey(NODES[id].key));
      for (const [k, a, toe] of [[s.kneeR, s.ankleR, s.toeR], [s.kneeL, s.ankleL, s.toeL]] as const) expect(Math.abs(heading(k, a) - toe) * (180 / Math.PI), id).toBeLessThan(3);
    }
  });
});

describe("gym rig: bends, steps and contact", () => {
  const bendOf = (h: V3, k: V3, a: V3): V3 => {
    const ax: V3 = [a[0] - h[0], a[1] - h[1], a[2] - h[2]], v: V3 = [k[0] - h[0], k[1] - h[1], k[2] - h[2]];
    const t = (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / (ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2);
    return [v[0] - ax[0] * t, v[1] - ax[1] * t, v[2] - ax[2] * t];
  };

  it("never splays a knee out sideways: a planted knee bends no wider than its toes point, give or take", () => {
    // Chasing the toe line with a barely bent knee (early in a wide squat) bent it ~55° out to the side.
    let worst = -Infinity, at = "";
    for (const run of RUNS) for (const f of run) for (const [h, k, a, toe] of [[f.s.hipR, f.s.kneeR, f.s.ankleR, f.s.toeR], [f.s.hipL, f.s.kneeL, f.s.ankleL, f.s.toeL]] as const) {
      if (a[1] > BODY.ankle + 0.002) continue;
      const b = bendOf(h, k, a);
      if (Math.hypot(b[0], b[1], b[2]) < 0.06) continue;
      const out = Math.atan2(Math.sign(k[0]) * b[0], b[2]) - toe; // the bend's direction, seen from above, past the toes
      if (out > worst) [worst, at] = [out, f.at];
    }
    expect((worst * 180) / Math.PI, at).toBeLessThan(25);
  });

  it("steps only once standing: no foot leaves the floor while the other knee is still bent", () => {
    // Out of a dip straight into a step, the lifter shifted the weight onto a leg still bent under the bar.
    let worst = 0, at = "";
    for (const run of RUNS) for (const f of run) {
      const s = f.s;
      for (const [a, h, k, other] of [[s.ankleR, s.hipL, s.kneeL, s.ankleL], [s.ankleL, s.hipR, s.kneeR, s.ankleR]] as const) {
        if (a[1] <= BODY.ankle + 0.005) continue; // this foot is on the floor
        const b = bendOf(h, k, other), d = Math.hypot(b[0], b[1], b[2]);
        if (d > worst) [worst, at] = [d, f.at];
      }
    }
    expect(worst, at).toBeLessThan(0.1); // a locked-out leg sits at 4.4 cm; a dip is 19 cm
  });

  it("slides the bar over a deep thigh continuously, whichever way the thigh tips past horizontal", () => {
    // The limb's "front" was whichever perpendicular faced forward, so it flipped between up and down as a deep
    // thigh passed horizontal, hurling a bar in front of the shins up over the thigh.
    const base = poseOfKey(NODES.floor.key);
    let prev: V3 | null = null, worst = 0;
    for (let y = base.hip[1] - 0.04; y <= base.hip[1] + 0.06; y += 0.0005) {
      const s = solve({ ...base, hip: [base.hip[0], y, base.hip[2]] });
      if (prev) worst = Math.max(worst, d3(s.bar, prev));
      prev = s.bar;
    }
    expect(worst).toBeLessThan(0.005);
  });
});
