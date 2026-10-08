/**
 * The athlete's skeleton and choreography, solved from a handful of pose parameters — no three.js here, so it can be
 * tested on its own and shared by every gym scene.
 *
 * Units are metres; the athlete stands on y = 0 facing +z, the bar runs along x. A pose names where the
 * hips are, how far the torso leans, the stance and grip, where the bar is (absolute, or relative to the
 * shoulders for lifts where the bar rides the body) and which way the elbows point. Knees and elbows come
 * from two-bone IK, so the hands always end on the bar and the feet stay planted.
 *
 * Motion is built the way a lift is coached, not tweened: keyframes are joined by a smooth spline (no velocity kinks
 * at the middle key), each lift has its own rep rhythm (a squat lowers under control and drives up; a pull breaks
 * slowly off the floor), reps slow and grind as a set wears on, and changing lift carries the bar through the
 * positions a lifter would actually pass through (hang, clean, rack, overhead, behind the neck) while the feet step —
 * never slide — to the new stance.
 */

export type V3 = [number, number, number];

/** The lifter's body (see public/models/README.md). Lives here, beside the proportions measured from it, so the page
 *  can start downloading it before the three.js chunks arrive. */
export const LIFTER_URL = "/models/lifter.glb";

/** Proportions of the rendered lifter (a skinned character scaled so it stands with hips at 0.98 m). The IK uses
 *  these exact lengths, so the mesh's hands close on the bar and its feet stay on the floor. `forearm` runs from the
 *  elbow to the middle of the grip, not the wrist. */
export const BODY = {
  ankle: 0.12,
  shin: 0.483,
  thigh: 0.378,
  hipHalf: 0.069,
  torso: 0.352,
  shoulderHalf: 0.107,
  upperArm: 0.253,
  forearm: 0.283,
  plateRadius: 0.225,
} as const;

/** Hip height for standing tall on straight legs (a lockout: 99.7% of the leg's length, the knee a few degrees off
 *  locked) at a given stance and hip offset. Hand-typed hip heights left every "standing" lift on 20–30° bent knees,
 *  crouched like a mannequin, with the thighs pushed forward into the bar. */
function stand(stance: number, hipZ = 0, ext = 0.997): number {
  const L = (BODY.thigh + BODY.shin) * ext, x = stance - BODY.hipHalf;
  return BODY.ankle + Math.sqrt(L * L - x * x - hipZ * hipZ);
}

/** One keyframe. `bar` is [z, y] absolute; with `barRel` it is measured from the shoulder centre in world axes (the
 *  bar hangs from the arms), with `barRel: "torso"` along the torso ([forward, up]: it rides the back or the chest). */
export type Key = {
  hipY: number;
  hipZ: number;
  lean: number; // torso angle from vertical, radians, + = forward
  stance: number; // half distance between ankles
  grip: number; // half distance between hands
  bar: [number, number];
  barRel?: boolean | "torso";
  elbow: V3; // pole for the right elbow; mirrored for the left
  toe?: number; // feet turned out, radians
  hand?: number; // +1 overhand … −1 underhand
};

/** One stretch of a rep: move to `to` (0 = start key, 1 = far key) over `d` of the rep, easing as `ease` says.
 *  `drive` is the concentric effort (fast, with a sticking point that deepens as the set wears on); `lower` is a
 *  controlled eccentric; a segment whose `to` equals where the bar already is, is a pause. */
export type Seg = { to: 0 | 1; d: number; ease?: "drive" | "lower" };
export type Lift = { id: string; name: string; keys: Key[]; tempo: number; rep: Seg[]; rest: NodeId; hold: NodeId };

// Keys are checked against the rendered body (scripts: the skinned-mesh clearance audit), not a stick figure: the
// bar clears the baggy trousers at the knees, the chest at the top of a curl, the face on the way up a press.
/** Set up over the bar: bar over the middle of the foot, shins touching it, hips above the knees. */
const DL_BOTTOM: Key = { hipY: 0.57, hipZ: -0.26, lean: 1.08, stance: 0.15, grip: 0.25, bar: [0.09, BODY.plateRadius], elbow: [0.3, 0, -1] };
/** Passing the knees: the hips have risen and the knees moved back out of the bar's way (it runs straight up). */
const DL_KNEE: Key = { hipY: 0.8, hipZ: -0.3, lean: 0.82, stance: 0.15, grip: 0.25, bar: [0.13, 0.56], elbow: [0.3, 0, -1] };
/** Bar at mid-thigh, hips driving through to meet it: the stretch where a pull drags the bar up the thighs. */
const DL_THIGH: Key = { hipY: 0.9, hipZ: -0.14, lean: 0.4, stance: 0.15, grip: 0.25, bar: [0.14, 0.7], elbow: [0.3, 0, -1] };
const DL_TOP: Key = { hipY: stand(0.15, 0.03), hipZ: 0.03, lean: -0.04, stance: 0.15, grip: 0.25, bar: [0.125, 0.83], elbow: [0.3, 0, -1] };

/** High-bar squat: the bar rides the traps (fixed in the torso's frame), and at the bottom it stays over the middle
 *  of the foot — hips back and chest forward only as far as balance allows, knees travelling over the toes. */
const SQ_TOP: Key = { hipY: stand(0.21, 0.02), hipZ: 0.02, lean: 0.12, stance: 0.21, grip: 0.42, bar: [-0.073, 0.021], barRel: "torso", elbow: [0.4, -1, -0.6], toe: 0.35 };
const SQ_BOTTOM: Key = { hipY: 0.5, hipZ: -0.19, lean: 0.84, stance: 0.21, grip: 0.42, bar: [-0.073, 0.021], barRel: "torso", elbow: [0.4, -1, -0.6], toe: 0.35 };

/** Strict press: from the front rack the bar travels up and slightly forward round the chin and face, then back over
 *  the crown into lockout ("through the window"), stacked over the shoulders and mid-foot. */
const PR_RACK: Key = { hipY: stand(0.15, 0.02), hipZ: 0.02, lean: -0.06, stance: 0.15, grip: 0.26, bar: [0.12, 0.03], barRel: true, elbow: [0.35, -1, 0.9] };
const PR_MID: Key = { hipY: stand(0.15, 0.02), hipZ: 0.02, lean: -0.1, stance: 0.15, grip: 0.26, bar: [0.15, 0.2], barRel: true, elbow: [0.9, -0.6, 0.5] };
const PR_HIGH: Key = { hipY: stand(0.15, 0.01), hipZ: 0.01, lean: -0.06, stance: 0.15, grip: 0.26, bar: [0.1, 0.38], barRel: true, elbow: [1, -0.2, 0.2] };
const PR_TOP: Key = { hipY: stand(0.15), hipZ: 0.0, lean: 0, stance: 0.15, grip: 0.26, bar: [0.0, 0.51], barRel: true, elbow: [1, 0, 0] };

/** Row: hips high enough that the knees sit back behind the hanging bar; the bar meets the upper belly, not inside it. */
const ROW_DOWN: Key = { hipY: 0.9, hipZ: -0.2, lean: 1.0, stance: 0.15, grip: 0.27, bar: [0.06, -0.49], barRel: true, elbow: [0.5, 0.3, -1] };
const ROW_UP: Key = { hipY: 0.9, hipZ: -0.2, lean: 1.0, stance: 0.15, grip: 0.27, bar: [-0.12, -0.215], barRel: true, elbow: [0.5, 0.6, -1] };

const CURL_DOWN: Key = { hipY: stand(0.15), hipZ: 0, lean: 0.02, stance: 0.15, grip: 0.22, bar: [0.1, -0.49], barRel: true, elbow: [0.1, -0.2, -1], hand: -1 };
const CURL_MID: Key = { hipY: stand(0.15), hipZ: 0, lean: -0.02, stance: 0.15, grip: 0.22, bar: [0.29, -0.24], barRel: true, elbow: [0.1, -1, -0.4], hand: -1 };
const CURL_UP: Key = { hipY: stand(0.15), hipZ: 0, lean: -0.05, stance: 0.15, grip: 0.22, bar: [0.16, -0.05], barRel: true, elbow: [0.1, -1, 0.1], hand: -1 };

const LOCK_A: Key = { hipY: stand(0.2), hipZ: 0, lean: 0, stance: 0.2, grip: 0.38, bar: [0.0, 0.46], barRel: true, elbow: [1, 0, 0], toe: 0.25 };
const LOCK_B: Key = { hipY: 0.88, hipZ: -0.04, lean: 0.06, stance: 0.2, grip: 0.38, bar: [0.0, 0.465], barRel: true, elbow: [1, 0, 0], toe: 0.25 };

// Carry positions a lifter passes through between lifts (see NODES).
/** Romanian hinge: hips back, bar sliding down the thighs to the knees, arms hanging. */
const RDL: Key = { hipY: 0.92, hipZ: -0.15, lean: 0.62, stance: 0.15, grip: 0.26, bar: [0.045, -0.5], barRel: true, elbow: [0.3, 0, -1] };
/** Halfway into a hinge from standing: hips going back, bar sliding down the front of the thighs. */
const RDL_HIGH: Key = { hipY: 0.95, hipZ: -0.06, lean: 0.3, stance: 0.15, grip: 0.26, bar: [0.05, -0.5], barRel: true, elbow: [0.3, 0, -1] };
/** The bar swinging up past the hips on the way to a clean: out in front of the belt, arms nearly straight. */
const HIP_PASS: Key = { hipY: stand(0.15, 0.02), hipZ: 0.02, lean: -0.05, stance: 0.15, grip: 0.26, bar: [0.19, 0.97], elbow: [0.3, -0.2, -1] };
/** Top of a clean's pull: bar at the lower chest, elbows high and out, about to whip under into the rack. */
const CLEAN_MID: Key = { hipY: stand(0.15, 0.01) - 0.015, hipZ: 0.01, lean: -0.04, stance: 0.15, grip: 0.26, bar: [0.14, -0.2], barRel: true, elbow: [1, 0.7, -0.4] };
/** Lowering from overhead to the back: bar above and behind the crown, elbows out and back. */
const BEHIND: Key = { hipY: stand(0.2, 0.05), hipZ: 0.05, lean: 0.1, stance: 0.2, grip: 0.4, bar: [-0.17, 0.38], barRel: true, elbow: [1, -0.2, -0.5], toe: 0.3 };
/** …then straight down behind the head to the nape, before it settles forward onto the traps. */
const NAPE: Key = { hipY: stand(0.2, 0.04), hipZ: 0.04, lean: 0.12, stance: 0.2, grip: 0.42, bar: [-0.15, 0.13], barRel: true, elbow: [1, -0.6, -0.6], toe: 0.3 };

/** The positions of the session, as a tree rooted at the hang (standing, bar at the thighs). Changing lift walks the
 *  tree from where the lifter is to where the next lift starts, so the bar only ever travels the way a real one can:
 *  pulled from the floor, hinged down to a row, cleaned to the rack, pressed overhead, lowered behind the neck. */
export const NODES = {
  hang: { key: DL_TOP, parent: null },
  dlThigh: { key: DL_THIGH, parent: "hang" },
  dlKnee: { key: DL_KNEE, parent: "dlThigh" },
  floor: { key: DL_BOTTOM, parent: "dlKnee" },
  rdlHigh: { key: RDL_HIGH, parent: "hang" },
  rdl: { key: RDL, parent: "rdlHigh" },
  rowDown: { key: ROW_DOWN, parent: "rdl" },
  rowUp: { key: ROW_UP, parent: "rowDown" },
  curlDown: { key: CURL_DOWN, parent: "hang" },
  hipPass: { key: HIP_PASS, parent: "hang" },
  cleanMid: { key: CLEAN_MID, parent: "hipPass" },
  rack: { key: PR_RACK, parent: "cleanMid" },
  curlUp: { key: CURL_UP, parent: "rack" },
  pressMid: { key: PR_MID, parent: "rack" },
  pressHigh: { key: PR_HIGH, parent: "pressMid" },
  overhead: { key: PR_TOP, parent: "pressHigh" },
  lockA: { key: LOCK_A, parent: "overhead" },
  lockB: { key: LOCK_B, parent: "lockA" },
  behind: { key: BEHIND, parent: "lockA" },
  nape: { key: NAPE, parent: "behind" },
  backRack: { key: SQ_TOP, parent: "nape" },
  squatBottom: { key: SQ_BOTTOM, parent: "backRack" },
} satisfies Record<string, { key: Key; parent: string | null }>;
export type NodeId = keyof typeof NODES;

// Rep rhythms. Fractions of one rep; each sums to 1.
const PULL: Seg[] = [{ to: 1, d: 0.3, ease: "drive" }, { to: 1, d: 0.14 }, { to: 0, d: 0.32, ease: "lower" }, { to: 0, d: 0.24 }];
const PRESS: Seg[] = [{ to: 1, d: 0.3, ease: "drive" }, { to: 1, d: 0.14 }, { to: 0, d: 0.38, ease: "lower" }, { to: 0, d: 0.18 }];
/** Squat and dip: lower under control first, a brief pause in the hole, then drive up and stand tall. */
const SQUAT: Seg[] = [{ to: 1, d: 0.38, ease: "lower" }, { to: 1, d: 0.05 }, { to: 0, d: 0.3, ease: "drive" }, { to: 0, d: 0.27 }];

export const LIFTS: Record<string, Lift> = {
  deadlift: { id: "deadlift", name: "Deadlift", keys: [DL_BOTTOM, DL_KNEE, DL_THIGH, DL_TOP], tempo: 3.4, rep: PULL, rest: "floor", hold: "hang" },
  squat: { id: "squat", name: "Back squat", keys: [SQ_TOP, SQ_BOTTOM], tempo: 3.4, rep: SQUAT, rest: "backRack", hold: "squatBottom" },
  press: { id: "press", name: "Overhead press", keys: [PR_RACK, PR_MID, PR_HIGH, PR_TOP], tempo: 2.7, rep: PRESS, rest: "rack", hold: "overhead" },
  row: { id: "row", name: "Bent-over row", keys: [ROW_DOWN, ROW_UP], tempo: 2.1, rep: PRESS, rest: "rowDown", hold: "rowUp" },
  curl: { id: "curl", name: "Barbell curl", keys: [CURL_DOWN, CURL_MID, CURL_UP], tempo: 2.3, rep: PRESS, rest: "curlDown", hold: "curlUp" },
  lockout: { id: "lockout", name: "Overhead hold", keys: [LOCK_A, LOCK_B], tempo: 4.2, rep: SQUAT, rest: "lockA", hold: "lockB" },
};
/** Ordered so each change of lift is one a lifter would make: pull from the floor, row, curl up into the rack, press,
 *  hold it overhead, then lower it behind the neck into a squat. */
export const LIFT_ORDER = ["deadlift", "row", "curl", "press", "lockout", "squat"] as const;
export type LiftId = (typeof LIFT_ORDER)[number];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** Accelerate, cruise, settle: an S-curve velocity profile (smoothstep ramps over the first and last quarter). Moves
 *  like a person carrying a load — its peak speed is only 1.33× the average, where a single ease-in-out peaks at 1.5×
 *  and rushes the middle of a long carry. */
export function carry(t: number, a = 0.25): number {
  const x = clamp(t, 0, 1), v = 1 / (1 - a);
  const I = (u: number) => u * u * u - (u * u * u * u) / 2; // ∫ smoothstep
  if (x < a) return v * a * I(x / a);
  if (x > 1 - a) return 1 - v * a * I((1 - x) / a);
  return v * (a / 2 + (x - a));
}

/**
 * Where a rep is at time `phase` (0..1 of one rep), as progress along the keyframes (0 = rest, 1 = far end), with the
 * default pull rhythm: drive up, hold the lockout, lower under control, pause. Kept for callers that only need a
 * shape; the scene uses `repPlan` / `repAt`, which follow each lift's own rhythm and fatigue.
 */
export function repCurve(phase: number): number {
  const p = phase - Math.floor(phase);
  return repAt(LIFTS.deadlift!, repPlan(LIFTS.deadlift!, 0), p * LIFTS.deadlift!.tempo).u;
}

/** Reps in a set before the lifter racks the effort and breathes. */
export const SET_REPS = 5;

/** The timing of one rep, in seconds: each segment's duration, and how hard the sticking point grinds. Rep `n` of a
 *  set (0-based) drives a little slower than the one before; the last rep of a set rests longer. */
export type RepPlan = { durs: number[]; grind: number; total: number };
export function repPlan(lift: Lift, n: number): RepPlan {
  const k = n % SET_REPS;
  const durs = lift.rep.map((s, i) => {
    let d = s.d * lift.tempo;
    if (s.ease === "drive") d *= 1 + 0.1 * k; // fatigue: every rep's drive a tenth slower
    if (i === lift.rep.length - 1 && k === SET_REPS - 1) d *= 3.2; // end of set: a long breather before the next
    return d;
  });
  return { durs, grind: Math.min(0.62, 0.06 + 0.13 * k), total: durs.reduce((a, b) => a + b, 0) };
}

/** Where a set opens: part-way into the rest before the first rep, before the brace — the pose a change of lift
 *  ends in, so the set starts without a pop. */
export function setOpening(plan: RepPlan): number {
  return plan.total - plan.durs[plan.durs.length - 1]! * 0.6;
}

/** Where the rep is `t` seconds in: progress `u`, the segment, how far through it, and how hard the lifter is working
 *  (1 through the drive, easing off as the lockout is held). */
export type RepState = { u: number; seg: number; s: number; effort: number; brace: number; settle: number; still: boolean };
export function repAt(lift: Lift, plan: RepPlan, t: number): RepState {
  let acc = 0, seg = plan.durs.length - 1, s = 1;
  for (let i = 0; i < plan.durs.length; i++) {
    if (t < acc + plan.durs[i]! || i === plan.durs.length - 1) {
      seg = i;
      s = clamp((t - acc) / plan.durs[i]!, 0, 1);
      break;
    }
    acc += plan.durs[i]!;
  }
  const g = lift.rep[seg]!;
  const from = seg === 0 ? lift.rep[lift.rep.length - 1]!.to : lift.rep[seg - 1]!.to;
  let e: number;
  if (g.to === from) e = 0;
  else if (g.ease === "drive") {
    // Sticking point: the bar slows through the middle of the drive, more on every rep (a time warp, still monotone).
    const w = s + (plan.grind * Math.sin(2 * Math.PI * s)) / (2 * Math.PI);
    e = easeInOut(w);
  } else e = easeSine(s);
  const u = from + (g.to - from) * e;
  // Brace in the last stretch of the rest before the rep (breath held, hips set), let go as the bar starts moving.
  const last = lift.rep.length - 1;
  const brace = seg === last ? smooth(clamp((s - 0.55) / 0.45, 0, 1)) : seg === 0 ? 1 - smooth(clamp(s / 0.25, 0, 1)) : 0;
  // Catching the lockout: a tiny dip and recovery just after the drive ends (zero speed at both ends).
  const prevDrive = seg > 0 && lift.rep[seg - 1]!.ease === "drive" && g.to === from;
  const x = clamp(s * 2.5, 0, 1);
  const settle = prevDrive ? 16 * x * x * (1 - x) * (1 - x) : 0;
  const effort = g.ease === "drive" ? 1 : prevDrive ? 1 - s * 0.6 : 0;
  return { u, seg, s, effort, brace, settle, still: g.to === from };
}

/** A resolved pose: everything the renderer needs, all absolute. `feet` overrides the stance while stepping. */
export type Pose = {
  hip: V3;
  lean: number;
  stance: number;
  grip: number;
  bar: V3; // target bar centre
  /** Right elbow's swivel about the shoulder→grip axis, radians (0 = the point of the elbow faces down and back,
   *  + = out to the side); the left mirrors it. An angle, not a pole vector: blending two poles can pass straight
   *  along the arm, where the IK has no idea which way to bend and the elbow flips over in a single frame. */
  swivel: number;
  toe: number;
  hand: number; // +1 overhand … −1 underhand
  feet?: { l: number; r: number; liftL: number; liftR: number; toeL: number; toeR: number };
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Uniform Catmull-Rom: passes through p1 at t = 0 and p2 at t = 1 with a continuous velocity across keys. */
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Monotone cubic (Fritsch–Carlson): like Catmull-Rom, but never overshoots its keys. For the hips' height, where an
 *  overshoot would try to stand taller than the legs are long. */
const mono = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const d = p2 - p1;
  let m1 = (p2 - p0) / 2, m2 = (p3 - p1) / 2;
  if (Math.abs(d) < 1e-9) m1 = m2 = 0;
  else {
    if (m1 * d <= 0) m1 = 0;
    if (m2 * d <= 0) m2 = 0;
    const a = m1 / d, b = m2 / d, h = a * a + b * b;
    if (h > 9) {
      m1 = (3 * a * d) / Math.sqrt(h);
      m2 = (3 * b * d) / Math.sqrt(h);
    }
  }
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
};

function shoulderOf(hipY: number, hipZ: number, lean: number): [number, number] {
  return [hipZ + BODY.torso * Math.sin(lean), hipY + BODY.torso * Math.cos(lean)];
}

/** Shoulder blades ride up as the bar goes overhead (the shrug that locks a press out), up to 3.5 cm. */
const shrugOf = (barY: number, shoulderY: number) => clamp((barY - shoulderY - 0.2) / 0.4, 0, 1) * 0.035;
const SWIVEL_REF: V3 = [0, -0.35, -1];
/** The right arm's axis (shoulder → grip) and a frame around it: `ref` is swivel 0, `side` is swivel +π/2. */
function armFrame(hipY: number, hipZ: number, lean: number, grip: number, barZ: number, barY: number) {
  const [sz, sy0] = shoulderOf(hipY, hipZ, lean);
  const sy = sy0 + shrugOf(barY, sy0);
  const ax = norm([grip - BODY.shoulderHalf, barY - sy, barZ - sz]);
  const ref = norm(sub(SWIVEL_REF, mul(ax, dot(SWIVEL_REF, ax))));
  const side: V3 = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  return { ax, ref, side };
}
const swivelOf = (fr: ReturnType<typeof armFrame>, pole: V3) => Math.atan2(dot(pole, fr.side), dot(pole, fr.ref));
/** Pick the turn of `a` nearest `to`, so a blend of angles goes the short way round. */
const near = (a: number, to: number) => a + Math.round((to - a) / (2 * Math.PI)) * 2 * Math.PI;

/** A key's bar in absolute [z, y], given where the shoulders are and how the torso leans. */
function barOf(k: { bar: [number, number]; barRel?: boolean | "torso" }, bar: [number, number], sz: number, sy: number, lean: number): [number, number] {
  if (!k.barRel) return bar;
  if (k.barRel === "torso") return [sz + bar[0] * Math.cos(lean) + bar[1] * Math.sin(lean), sy - bar[0] * Math.sin(lean) + bar[1] * Math.cos(lean)];
  return [sz + bar[0], sy + bar[1]];
}

function keyAt(keys: Key[], u: number): Pose {
  const n = keys.length - 1;
  const x = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const t = x - i;
  const k0 = keys[Math.max(0, i - 1)]!, k1 = keys[i]!, k2 = keys[i + 1]!, k3 = keys[Math.min(n, i + 2)]!;
  const f = (g: (k: Key) => number) => cr(g(k0), g(k1), g(k2), g(k3), t);
  const v = {
    hipY: mono(k0.hipY, k1.hipY, k2.hipY, k3.hipY, t), hipZ: f((k) => k.hipZ), lean: f((k) => k.lean), stance: f((k) => k.stance), grip: f((k) => k.grip),
    toe: f((k) => k.toe ?? 0.15), hand: f((k) => k.hand ?? 1),
  };
  // Each key's elbow direction as a swivel about that key's own arm, blended the short way round.
  const sw = (k: Key) => {
    const [kz, ky] = shoulderOf(k.hipY, k.hipZ, k.lean);
    const [bz, by] = barOf(k, k.bar, kz, ky, k.lean);
    return swivelOf(armFrame(k.hipY, k.hipZ, k.lean, k.grip, bz, by), k.elbow);
  };
  const w1 = sw(k1), w0 = near(sw(k0), w1), w2 = near(sw(k2), w1), w3 = near(sw(k3), w2);
  const [sz, sy] = shoulderOf(v.hipY, v.hipZ, v.lean);
  // Within a lift every key measures the bar the same way, so blend the measurement, then resolve it on this frame's body.
  const bar = barOf(k1, [f((k) => k.bar[0]), f((k) => k.bar[1])], sz, sy, v.lean);
  return {
    hip: [0, v.hipY, v.hipZ],
    lean: v.lean,
    stance: v.stance,
    grip: v.grip,
    bar: [0, bar[1], bar[0]],
    swivel: cr(w0, w1, w2, w3, t),
    toe: v.toe,
    hand: clamp(v.hand, -1, 1),
  };
}

export function poseOf(lift: Lift, u: number): Pose {
  return keyAt(lift.keys, u);
}

/** A single key as a pose. */
export function poseOfKey(k: Key): Pose {
  return keyAt([k, k], 0);
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    hip: lerp3(a.hip, b.hip, t),
    lean: lerp(a.lean, b.lean, t),
    stance: lerp(a.stance, b.stance, t),
    grip: lerp(a.grip, b.grip, t),
    bar: lerp3(a.bar, b.bar, t),
    swivel: lerp(a.swivel, near(b.swivel, a.swivel), t),
    toe: lerp(a.toe, b.toe, t),
    hand: lerp(a.hand, b.hand, t),
  };
}

/** The pose of one frame of a rep: progress along the lift, plus the brace before the drive and the catch after it. */
export function repPose(lift: Lift, r: RepState): Pose {
  const pose = poseOf(lift, r.u);
  const rel = lift.keys[0]!.barRel;
  // Where the bar sits on the body before the brace: from the shoulders (it hangs from the arms), or in the torso's
  // frame (it rides the back). A bar that rides the body moves with it as the hips sink and the chest tips.
  const [sz0, sy0] = shoulderOf(pose.hip[1], pose.hip[2], pose.lean);
  const dz = pose.bar[2] - sz0, dh = pose.bar[1] - sy0, c = Math.cos(pose.lean), s = Math.sin(pose.lean);
  const dy = -r.brace * 0.016 - r.settle * 0.008;
  pose.hip = [pose.hip[0], pose.hip[1] + dy, pose.hip[2]];
  pose.lean += r.brace * 0.035;
  if (rel) {
    const [sz, sy] = shoulderOf(pose.hip[1], pose.hip[2], pose.lean);
    const [bz, by] = rel === "torso" ? barOf({ bar: [dz * c - dh * s, dz * s + dh * c], barRel: "torso" }, [dz * c - dh * s, dz * s + dh * c], sz, sy, pose.lean) : [sz + dz, sy + dh];
    pose.bar = [pose.bar[0], by, bz];
  }
  return pose;
}

/** Fastest a rep may be played (scroll pumping × hurrying to a change of lift): every joint stays under a human's
 *  ~4 m/s. The curl's bar already moves at ~2.3 m/s at 1×; uncapped (5.7×) it reached 12 m/s. */
export const MAX_REP_RATE = 1.75;

/** Idle life on top of a pose: the hips drift `dx` sideways and `dy` up. A bar off the floor is carried by the body (on
 *  the back, in the rack, in the hands), so it drifts with them; one resting on the plates stays put — blended over the
 *  first few centimetres off the floor, so nothing pops as it leaves. */
export function sway(p: Pose, dx: number, dy: number): Pose {
  const c = clamp((p.bar[1] - BODY.plateRadius - 0.005) / 0.075, 0, 1), carried = smooth(c);
  return { ...p, hip: [p.hip[0] + dx, p.hip[1] + dy, p.hip[2]], bar: [p.bar[0] + dx * carried, p.bar[1] + dy * carried, p.bar[2]] };
}

// ─────────────────────────────── changing lift ───────────────────────────────

/** Nodes from `a` to `b` through the tree (both ends included). */
export function route(a: NodeId, b: NodeId): NodeId[] {
  const up = (n: NodeId) => {
    const out: NodeId[] = [n];
    for (let p = NODES[n].parent as NodeId | null; p; p = NODES[p].parent as NodeId | null) out.push(p);
    return out;
  };
  const ua = up(a), ub = up(b);
  const meet = ua.find((n) => ub.includes(n))!;
  return [...ua.slice(0, ua.indexOf(meet) + 1), ...ub.slice(0, ub.indexOf(meet)).reverse()];
}

/** A change of lift in progress: the carry positions to pass through, with a time for each leg of the journey. */
/** `step.at` is the stretch of the change (fractions of `total`) the two steps and their weight shifts take up. */
export type Path = { poses: Pose[]; times: number[]; total: number; step: { from: [number, number, number, number]; to: [number, number, number, number]; at: [number, number] } | null };

/** Two unhurried steps and their weight shifts never take longer than this, however long the carry. */
const STEP_TIME = 2.4;

/** Elbows closer to the body's midline than this (metres) are crossing in front of the chest. */
const ELBOW_CLEAR = 0.07;
/** How close to the midline the elbows come moving from `a` to `b` with the elbows turning to swivel `w`. */
function elbowClearance(a: Pose, b: Pose, w: number): number {
  let m = Infinity;
  for (let k = 1; k < 12; k++) {
    const t = k / 12, s = solve({ ...blendPose(a, b, t), swivel: lerp(a.swivel, w, t) });
    m = Math.min(m, -s.elbowL[0], s.elbowR[0]);
  }
  return m;
}

/** Plan the change from the lifter's current (still) pose at node `from` to the start of `to`. Each leg takes longer
 *  the further the bar travels; the feet step to the new stance if it changes. */
export function planPath(current: Pose, from: NodeId, to: Lift): Path {
  const ids = route(from, to.rest);
  const poses = ids.map((id, i) => (i === 0 ? current : poseOfKey(NODES[id].key)));
  if (poses.length === 1) poses.push(poseOfKey(NODES[to.rest].key));
  // Unwrap the elbows' swivel leg by leg, so `pathAt` can spline it as it stands. Each turn goes the short way round
  // unless that sweeps the elbows in across the chest (out of the front rack toward a clean's high elbows, the short
  // way crosses them over each other): then it goes round the outside, the way arms actually move.
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!, b = poses[i]!;
    const short = near(b.swivel, a.swivel), long = short + (short > a.swivel ? -2 : 2) * Math.PI;
    const inboard = elbowClearance(a, b, short);
    poses[i] = { ...b, swivel: inboard < ELBOW_CLEAR && elbowClearance(a, b, long) > inboard ? long : short };
  }
  const times = [0];
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!, b = poses[i]!;
    // Time for the bar's travel, the body's, the elbows turning round the bar (the whip of a clean into the rack), and
    // a change of grip (turning the palms over for a curl is a regrip, not a flick of the wrists).
    const travel = Math.hypot(a.bar[1] - b.bar[1], a.bar[2] - b.bar[2]) + Math.abs(a.hip[1] - b.hip[1]) + Math.abs(a.lean - b.lean) * 0.35 + Math.abs(b.swivel - a.swivel) * 0.26 + Math.abs(a.hand - b.hand) * 0.3;
    times.push(times[i - 1]! + 0.3 + travel * 1.1);
  }
  const end = poses[poses.length - 1]!;
  const moved = Math.abs(end.stance - current.stance) > 0.004 || Math.abs(end.toe - current.toe) > 0.02;
  const path: Path = {
    poses,
    times,
    // Stepping into a new stance takes its own time (two unhurried steps), however short the bar's journey.
    total: Math.max(moved ? 2 : 0.9, times[times.length - 1]!),
    step: null,
  };
  if (!moved) return path;
  // Step while standing tall, never bent over a bar hanging at the knees (a knee lifting to step would drive into it)
  // nor with the weight shifted onto a leg still bent from a dip: the window goes where the hips are highest
  // throughout, and as early as that allows. A short change that starts low is given the time to stand up first.
  const profile = () => Array.from({ length: 81 }, (_, k) => pathAt(path, (path.total * k) / 80).hip[1]);
  let hipY = profile();
  const top = Math.max(...hipY), tall = Math.min(0.6, hipY.findIndex((y) => y >= top - 0.01) / 80);
  if ((1 - tall) * path.total < STEP_TIME) {
    path.total = STEP_TIME / (1 - tall);
    hipY = profile();
  }
  const len = Math.min(1, STEP_TIME / path.total);
  let best = -Infinity, at: [number, number] = [0, len];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * (1 - len), lo = Math.floor(a * 80), hi = Math.ceil((a + len) * 80);
    const score = Math.min(...hipY.slice(lo, hi + 1));
    if (score > best + 0.005) [best, at] = [score, [a, a + len]];
  }
  path.step = { from: [current.stance, current.toe, 0, 0], to: [end.stance, end.toe, 0, 0], at };
  return path;
}

/** The pose `t` seconds into a change of lift: a spline through the carry positions, eased in and out as one move. */
export function pathAt(p: Path, t: number): Pose {
  const w = carry(t / p.total) * p.times[p.times.length - 1]!;
  const n = p.poses.length - 1;
  let i = 0;
  while (i < n - 1 && w > p.times[i + 1]!) i++;
  const span = p.times[i + 1]! - p.times[i]!;
  const s = span > 0 ? clamp((w - p.times[i]!) / span, 0, 1) : 1;
  const P = (j: number) => p.poses[clamp(j, 0, n)]!;
  const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
  const f = (g: (q: Pose) => number) => cr(g(a), g(b), g(c), g(d), s);
  const pose: Pose = {
    hip: [f((q) => q.hip[0]), mono(a.hip[1], b.hip[1], c.hip[1], d.hip[1], s), f((q) => q.hip[2])],
    lean: f((q) => q.lean),
    stance: f((q) => q.stance),
    grip: f((q) => q.grip),
    bar: [f((q) => q.bar[0]), f((q) => q.bar[1]), f((q) => q.bar[2])],
    swivel: f((q) => q.swivel), // unwrapped by planPath, which chose each leg's way round
    toe: f((q) => q.toe),
    hand: clamp(f((q) => q.hand), -1, 1),
  };
  // The feet never follow the spline: carry positions in between may stand a touch wider or narrower, and blending
  // through them would skate the feet across the platform. They stay put, or step (below).
  pose.stance = p.poses[0]!.stance;
  pose.toe = p.poses[0]!.toe;
  if (p.step) {
    // Step, don't skate: the left foot lifts and sets down at the new stance, then the right, each with the weight
    // shifted over the planted foot first.
    // The schedule below is laid out over [0.04, 0.88] of the step's own window.
    const [w0, w1] = p.step.at, tt = 0.04 + ((clamp(t / p.total, 0, 1) - w0) / (w1 - w0)) * 0.84;
    const [s0, t0] = p.step.from, [s1, t1] = p.step.to;
    const leg = (a0: number, a1: number) => clamp((tt - a0) / (a1 - a0), 0, 1);
    const L = leg(0.12, 0.42), R = leg(0.5, 0.8);
    const eL = smooth(L), eR = smooth(R);
    pose.feet = {
      l: lerp(s0, s1, eL), r: lerp(s0, s1, eR),
      liftL: Math.sin(Math.PI * L) ** 2 * 0.07, liftR: Math.sin(Math.PI * R) ** 2 * 0.07, // lifts off and sets down gently
      toeL: lerp(t0, t1, eL), toeR: lerp(t0, t1, eR),
    };
    // Weight onto the standing foot while the other is in the air (bell-shaped, so it starts and ends at rest).
    const shift = Math.sin(Math.PI * leg(0.04, 0.5)) ** 2 * 0.045 - Math.sin(Math.PI * leg(0.42, 0.88)) ** 2 * 0.045;
    // The hips drop just what the far leg needs to keep reaching its foot as they travel (~¼ of the shift for a
    // straight-legged stance) — smoothly, with the shift, so `solve`'s reach limit is only ever a backstop.
    pose.hip = [pose.hip[0] + shift, pose.hip[1] - Math.abs(shift) * 0.25, pose.hip[2]];
    pose.stance = lerp(s0, s1, (eL + eR) / 2);
    pose.toe = lerp(t0, t1, (eL + eR) / 2);
  }
  return pose;
}

// ─────────────────────────────── IK ───────────────────────────────

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Two-bone IK: root → joint → end, reaching for `target`, bending toward `pole`. Returns [joint, end]. */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3, softFrom = 0.96): [V3, V3] {
  const v = sub(target, root);
  // Soft IK: over the last stretch of the reach (from `softFrom`) the limb eases into full extension instead of
  // hitting a hard stop, so a knee or elbow locking out decelerates like a real joint rather than snapping straight.
  const L = l1 + l2, soft = L * softFrom, raw = len(v);
  const reach = raw > soft ? soft + (L * 0.9995 - soft) * (1 - Math.exp(-(raw - soft) / (L * 0.9995 - soft))) : raw;
  const d = clamp(reach, Math.abs(l1 - l2) + 1e-4, L * 0.9995);
  const u = norm(v);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  let p = sub(pole, mul(u, dot(pole, u)));
  if (len(p) < 1e-5) p = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  p = norm(p);
  const joint = add(root, add(mul(u, l1 * cosA), mul(p, l1 * sinA)));
  const end = add(joint, mul(norm(sub(add(root, mul(u, d)), joint)), l2));
  return [joint, end];
}

/** Legs ease into lockout only in the last 0.15% of their reach, so a standing lifter's knees can straighten. */
export const LEG_SOFT = 0.9985;

export type Skeleton = {
  hipL: V3; hipR: V3; kneeL: V3; kneeR: V3; ankleL: V3; ankleR: V3;
  pelvis: V3; chest: V3; up: V3;
  shoulderL: V3; shoulderR: V3; elbowL: V3; elbowR: V3; handL: V3; handR: V3;
  neck: V3; head: V3;
  bar: V3; // actual bar centre (between the hands)
  toe: number;
  toeL: number;
  toeR: number;
};

// ─────────────────────────────── contact ───────────────────────────────

/** How far the rendered body's surface stands out in front of each bone (metres, measured on the lifter's mesh at
 *  quarter points from the upper joint down: the kit is loose, so the shins stand out further than the knees), and
 *  behind the torso. Keyframes only fix the bar at a few moments; these keep it on the body's surface in between. */
export const SURFACE = {
  thigh: [0.085, 0.085, 0.084, 0.084, 0.086], // measured standing; flexed hips only add belly the bar never meets
  shin: [0.089, 0.095, 0.111, 0.1, 0.062], // the fuller of the two legs (the bar meets both); the right runs ~3 mm proud
  chestFront: [0.098, 0.11, 0.155, 0.16, 0.105],
  back: [0.065, 0.045, 0.06, 0.06, 0.06],
};
const BAR_SKIN = 0.0145 + 0.003; // bar radius plus a hair of air
const CONTACT_SOFT = 0.025; // the bar eases onto the body over 2.5 cm instead of glancing off it
/** Surface stand-off at `t` along a segment: smooth between samples and flat at each one (C1), so a bar sliding
 *  along a limb is never jolted by a kink in its outline. */
const profile = (tab: number[], t: number) => {
  const x = clamp(t, 0, 1) * (tab.length - 1), i = Math.min(tab.length - 2, Math.floor(x)), f = x - i;
  return lerp(tab[i]!, tab[i + 1]!, f * f * (3 - 2 * f));
};
/** A soft (C1) push: nothing until the bar comes within CONTACT_SOFT of the surface, then it rides on it. */
const softPush = (pen: number, k = CONTACT_SOFT) => (pen <= -k ? 0 : pen >= k ? pen : ((pen + k) ** 2) / (4 * k));

/** Legs: round capsules around the thigh and shin (tapered to the kit's measured stand-off), so the bar is pushed
 *  away from the nearest point of the bone — correct at any angle, continuous round the knee where the two overlap.
 *  Only a bar sitting right on the bone (no direction to push it) is sent out the front. */
function pushLeg(bar: [number, number], a: [number, number], b: [number, number], front: number[], weight: number): [number, number] {
  if (weight <= 0) return bar;
  const dz = b[0] - a[0], dy = b[1] - a[1], L2 = dz * dz + dy * dy;
  if (L2 < 1e-9) return bar;
  const tr = ((bar[0] - a[0]) * dz + (bar[1] - a[1]) * dy) / L2, t = clamp(tr, 0, 1);
  const cz = a[0] + dz * t, cy = a[1] + dy * t, vz = bar[0] - cz, vy = bar[1] - cy, d = Math.hypot(vz, vy);
  const R = profile(front, t) + BAR_SKIN;
  const L = Math.sqrt(L2);
  // The limb's anatomical front: forward for a hanging leg, up for a thigh flexed to horizontal. (Taking "whichever
  // perpendicular faces forward" flipped between up and down as a deep thigh passed horizontal, hurling the bar.)
  const nz = -dy / L, ny = dz / L;
  const f = vz * nz + vy * ny; // signed: + in front of the bone, − behind it
  if (tr > 0 && tr < 1 && f < 0) {
    // Behind the bone, inside the limb: a bar never passes behind the legs, so it belongs on the front surface —
    // carried straight through, continuous as it crosses the bone rather than flipping to the far side. A bar well
    // clear behind (below a deep thigh, in front of the shins) is not this limb's to move: the rule fades out there.
    const reach = 1 - smooth(clamp((-f - R) / 0.03, 0, 1));
    const push = (R - f) * weight * reach;
    if (push > 0) return [bar[0] + nz * push, bar[1] + ny * push];
    return bar;
  }
  const push = softPush(R - d) * weight;
  if (push <= 0) return bar;
  // In front, or round a joint at either end: straight away from the nearest point of the bone (a projection, so
  // the bar never moves faster than its target).
  const uz = d > 1e-6 ? vz / d : nz, uy = d > 1e-6 ? vy / d : ny;
  return [bar[0] + uz * push, bar[1] + uy * push];
}

/** Keep the bar (a line along x) outside a segment of the body, in the side (z, y) plane. `front`/`back` are the
 *  surface's standing-off along the segment (`back` omitted = the same all round). Returns the corrected [z, y]. */
function pushOff(bar: [number, number], a: [number, number], b: [number, number], front: number[], back?: number[]): [number, number] {
  const dz = b[0] - a[0], dy = b[1] - a[1], L2 = dz * dz + dy * dy;
  if (L2 < 1e-9) return bar;
  const t = ((bar[0] - a[0]) * dz + (bar[1] - a[1]) * dy) / L2;
  // Past either end the contact fades out over 15% of the segment rather than stopping dead.
  const e = clamp(Math.min(t + 0.15, 1.15 - t) / 0.15, 0, 1), fade = e * e * (3 - 2 * e);
  if (fade <= 0) return bar;
  const L = Math.sqrt(L2), nz = dy / L, ny = -dz / L; // perpendicular, pointing forward (+z) for an upright segment
  const f = (bar[0] - a[0]) * nz + (bar[1] - a[1]) * ny; // signed distance from the axis, + in front
  const F = profile(front, t) + BAR_SKIN, Bk = profile(back ?? front, t) + BAR_SKIN;
  if (f >= 0 || !back) {
    const side = f >= 0 || !back ? Math.sign(f) || 1 : -1;
    const pen = (side > 0 ? F : Bk) - Math.abs(f);
    const push = softPush(pen) * fade;
    return push > 0 ? [bar[0] + nz * push * side, bar[1] + ny * push * side] : bar;
  }
  const push = softPush(Bk + f) * fade; // behind the axis: push further back
  return push > 0 ? [bar[0] - nz * push, bar[1] - ny * push] : bar;
}

/** The bar target after contact with the legs and trunk: it slides up the shins and thighs on a pull, over the belly
 *  on a row, along the chest into the rack — on the surface, never through it — whatever path a lift or a change of
 *  lift takes between its keyframes. */
function contactBar(bar: V3, hip: V3, up: V3, knees: V3[], ankles: V3[], hipsJ: V3[]): V3 {
  let zy: [number, number] = [bar[2], bar[1]];
  const top = add(hip, mul(up, BODY.torso + 0.07));
  for (let pass = 0; pass < 2; pass++) {
    // The legs only meet a bar at leg height (a pull, a row, a hang); a bar on the back or overhead is not theirs,
    // and handing over gradually keeps the contact continuous.
    const legs = 1 - clamp((zy[1] - hip[1] + 0.02) / 0.1, 0, 1);
    const w = legs * legs * (3 - 2 * legs);
    for (let i = 0; i < knees.length; i++) {
      zy = pushLeg(zy, [hipsJ[i]![2], hipsJ[i]![1]], [knees[i]![2], knees[i]![1]], SURFACE.thigh, w);
      zy = pushLeg(zy, [knees[i]![2], knees[i]![1]], [ankles[i]![2], ankles[i]![1]], SURFACE.shin, w);
    }
    zy = pushOff(zy, [hip[2], hip[1]], [top[2], top[1]], SURFACE.chestFront, SURFACE.back);
  }
  return [bar[0], zy[1], zy[0]];
}

/** The knee of a leg from `hip` to `ankle`, tracking out over the toes (never caving in, never flaring past them), the
 *  way a coach cues every squat and pull. No fixed pole does that in every pose — where the knee ends up depends on how
 *  the leg's axis slants — so the pole's outward lean is found each frame: the one that points the knee (seen from
 *  above, from the ankle) along the foot, or as near as the leg's bend allows without flaring it wider. A fixed pole flared the knees ~20° past the toes at the floor, into the
 *  arms. A near-straight leg has no heading to speak of; it keeps a gentle fixed pole, blended in as the knee
 *  straightens, so nothing snaps. `side` is −1 for the left leg, +1 for the right. */
function kneeOver(hip: V3, ankle: V3, toe: number, side: number): V3 {
  const knee = (c: number) => twoBone(hip, ankle, BODY.thigh, BODY.shin, [side * c, 0, 1], LEG_SOFT)[0];
  const heading = (k: V3) => Math.atan2(side * (k[0] - ankle[0]), k[2] - ankle[2]);
  const rest = Math.sin(toe) * 1.7 + 0.12, k0 = knee(rest);
  // How bent the leg is: the knee's distance off the hip–ankle line (4.4 cm locked out; 13 cm and more in a hinge, a
  // dip or a squat). A straight leg leaning over a weight shift has its knee "inside the toes" only because it leans.
  const ax = sub(ankle, hip), v = sub(k0, hip), off = len(sub(v, mul(ax, dot(v, ax) / dot(ax, ax))));
  const bent = clamp((off - 0.05) / 0.05, 0, 1);
  if (bent <= 0) return k0;
  let lo = -0.3, hi = 1.5;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (heading(knee(mid)) < toe) lo = mid;
    else hi = mid;
  }
  // A barely bent knee is only ever pulled in from the fixed pole's flare, never pushed out past it: early in a wide
  // squat's descent the toe line is out of its reach, and chasing it splayed the knee sideways. A deeply bent knee (a
  // dip, the hole) turns out as far as the toes; the two blend with the bend, so the knee never jolts between them.
  const c = (lo + hi) / 2, deep = smooth(clamp((off - 0.12) / 0.1, 0, 1));
  return knee(lerp(rest, lerp(Math.min(c, rest), c, deep), smooth(bent)));
}

export function solve(p: Pose): Skeleton {
  const B = BODY;
  const up: V3 = [0, Math.cos(p.lean), Math.sin(p.lean)];
  const f = p.feet;
  const ankleL: V3 = [-(f?.l ?? p.stance), B.ankle + (f?.liftL ?? 0), 0], ankleR: V3 = [f?.r ?? p.stance, B.ankle + (f?.liftR ?? 0), 0];
  // Feet stay where they are put: the hips may never rise past what both legs can reach (a sway, a weight shift or a
  // wider stance lowers them instead, softly), or the IK would have to lift a planted foot off the floor.
  const reachY = (ank: V3, hx: number) => {
    const L = (B.thigh + B.shin) * 0.9998, dx = hx - ank[0], dz = p.hip[2] - ank[2];
    return ank[1] + Math.sqrt(Math.max(0, L * L - dx * dx - dz * dz));
  };
  const yMax = Math.min(reachY(ankleL, p.hip[0] - B.hipHalf), reachY(ankleR, p.hip[0] + B.hipHalf));
  const HIP_SOFT = 0.004; // a straight standing leg barely moves (~2 mm); rising past it decelerates, not snaps
  const hip: V3 = [p.hip[0], p.hip[1] - softPush(p.hip[1] - yMax + HIP_SOFT, HIP_SOFT), p.hip[2]];
  const hipL: V3 = [-B.hipHalf + hip[0], hip[1], hip[2]], hipR: V3 = [B.hipHalf + hip[0], hip[1], hip[2]];
  const toeL = f?.toeL ?? p.toe, toeR = f?.toeR ?? p.toe;
  const kneeL = kneeOver(hipL, ankleL, toeL, -1), kneeR = kneeOver(hipR, ankleR, toeR, 1);
  const sc0 = add(hip, mul(up, B.torso));
  const sc: V3 = [sc0[0], sc0[1] + shrugOf(p.bar[1], sc0[1]), sc0[2]];
  const shoulderL: V3 = [-B.shoulderHalf, sc[1], sc[2]], shoulderR: V3 = [B.shoulderHalf, sc[1], sc[2]];
  const bar = contactBar(p.bar, hip, up, [kneeL, kneeR], [ankleL, ankleR], [hipL, hipR]);
  const fr = armFrame(hip[1], hip[2], p.lean, p.grip, bar[2], bar[1]);
  const pole = add(mul(fr.ref, Math.cos(p.swivel)), mul(fr.side, Math.sin(p.swivel)));
  const [elbowL, handL] = twoBone(shoulderL, [-p.grip, bar[1], bar[2]], B.upperArm, B.forearm, [-pole[0], pole[1], pole[2]]);
  const [elbowR, handR] = twoBone(shoulderR, [p.grip, bar[1], bar[2]], B.upperArm, B.forearm, pole);
  const neck = add(sc, mul(up, 0.07));
  // The head stays level-ish: it follows the torso but looks up toward the horizon on deep leans.
  const head = add(add(sc, mul(up, 0.2)), [0, 0.02 * p.lean, 0.03]);
  return {
    hipL, hipR, kneeL, kneeR, ankleL, ankleR,
    pelvis: add(hip, mul(up, 0.06)), chest: add(hip, mul(up, 0.34)), up,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR, neck, head,
    bar: [0, (handL[1] + handR[1]) / 2, (handL[2] + handR[2]) / 2],
    toe: p.toe,
    toeL,
    toeR,
  };
}

export const dist = (a: V3, b: V3) => len(sub(a, b));
