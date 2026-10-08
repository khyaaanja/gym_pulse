"use client";
import { useEffect, useRef } from "react";
import type * as THREE_NS from "three";

/**
 * A member's milestone medal in 3D: it spins in once when the page opens (the member app's
 * celebratory moment), then idles; members can drag to spin it. Locked tiers render as a
 * frosted, unlit coin. Reduced motion → a still, face-on medal. No WebGL → the fallback shows.
 */
export function Medal3D({ tier, caption, color, locked = false, className, fallback }: { tier: string; caption: string; color: string; locked?: boolean; className?: string; fallback?: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const fb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    void import("three").then((THREE) => {
      if (disposed) return;
      const c = mount(THREE, el, { tier, caption, color, locked });
      if (c) {
        cleanup = c;
        if (fb.current) fb.current.style.display = "none";
      }
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [tier, caption, color, locked]);

  return (
    <div className={className} role="img" aria-label={`${tier} medal${locked ? " (not yet unlocked)" : ""}: ${caption}`}>
      <div ref={host} className="size-full touch-pan-y" />
      {fallback && <div ref={fb} className="absolute inset-0 grid place-items-center">{fallback}</div>}
    </div>
  );
}

function faceTexture(THREE: typeof THREE_NS, tier: string, caption: string, color: string, locked: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const base = new THREE.Color(color);
  const light = base.clone().lerp(new THREE.Color("#ffffff"), 0.45).getStyle();
  const dark = base.clone().lerp(new THREE.Color("#000000"), 0.18).getStyle();
  const grad = g.createRadialGradient(200, 170, 30, 256, 256, 280);
  grad.addColorStop(0, locked ? "#d9d5e3" : light);
  grad.addColorStop(1, locked ? "#9e98b0" : dark);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // Engraved rings
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(256, 256, 226, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(256, 256, 206, 0, Math.PI * 2);
  g.stroke();
  // Summit + pulse emblem (the GymPulse mark)
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 16;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(120, 250);
  g.lineTo(190, 250);
  g.lineTo(218, 210);
  g.lineTo(252, 120);
  g.lineTo(292, 280);
  g.lineTo(318, 232);
  g.lineTo(336, 250);
  g.lineTo(392, 250);
  g.stroke();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.font = "800 58px Archivo, system-ui, sans-serif";
  g.fillText(tier.toUpperCase(), 256, 350);
  g.font = "600 30px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillText(caption, 256, 398);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // Cylinder caps map UVs a quarter-turn off; turn the artwork upright.
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

function mount(THREE: typeof THREE_NS, el: HTMLDivElement, o: { tier: string; caption: string; color: string; locked: boolean }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: "block", width: "100%", height: "100%" });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 6.2);

  // Lights: warm key from the upper left, magenta rim from behind, soft fill.
  scene.add(new THREE.HemisphereLight(0xfff1f7, 0x2a2150, 1.1));
  const key = new THREE.DirectionalLight(0xffe2c4, 2.6);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.PointLight(0xff4f98, 30, 12);
  rim.position.set(2.5, -1.5, -2.5);
  scene.add(rim);

  const metal = new THREE.Color(o.locked ? "#b9b4c8" : o.color);
  const face = faceTexture(THREE, o.tier, o.caption, o.color, o.locked);
  const edgeMat = new THREE.MeshStandardMaterial({ color: metal, metalness: o.locked ? 0.2 : 0.9, roughness: o.locked ? 0.7 : 0.28 });
  const faceMat = new THREE.MeshStandardMaterial({ map: face, metalness: o.locked ? 0.1 : 0.55, roughness: o.locked ? 0.8 : 0.35 });

  const group = new THREE.Group();
  const coinGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.22, 96, 1);
  coinGeo.rotateX(Math.PI / 2);
  // Cylinder groups: 0 = side, 1 = top (+z after rotation), 2 = bottom
  const coin = new THREE.Mesh(coinGeo, [edgeMat, faceMat, faceMat]);
  group.add(coin);
  const rimGeo = new THREE.TorusGeometry(1.5, 0.08, 16, 96);
  const rimMesh = new THREE.Mesh(rimGeo, edgeMat);
  group.add(rimMesh);
  // Ribbon behind the medal, in the brand magenta.
  const ribbonGeo = new THREE.PlaneGeometry(0.9, 2.2);
  const ribbonMat = new THREE.MeshStandardMaterial({ color: o.locked ? 0x8c86a0 : 0xb3135f, roughness: 0.6, side: THREE.DoubleSide });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.position.set(0, 2.0, -0.2);
  group.add(ribbon);
  group.position.y = -0.35;
  scene.add(group);

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // Drag to spin, with inertia.
  let vel = 0, dragging = false, lastX = 0;
  const down = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    vel = (e.clientX - lastX) * 0.012;
    group.rotation.y += vel;
    lastX = e.clientX;
  };
  const up = () => (dragging = false);
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  const clock = new THREE.Clock();
  const intro = 1.8;
  let raf = 0;
  let visible = true;
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
  const frame = () => {
    const t = clock.getElapsedTime();
    if (!dragging) {
      if (t < intro) {
        const k = easeOut(t / intro);
        group.rotation.y = (1 - k) * Math.PI * 4; // two full turns, settling face-on
        group.scale.setScalar(0.6 + 0.4 * k);
      } else {
        vel *= 0.94;
        group.rotation.y += vel;
        // drift back towards face-on with a gentle sway
        const rest = Math.sin((t - intro) * 0.6) * 0.25;
        const nearest = Math.round(group.rotation.y / (Math.PI * 2)) * Math.PI * 2;
        if (Math.abs(vel) < 0.002) group.rotation.y += (nearest + rest - group.rotation.y) * 0.03;
      }
    }
    group.position.y = -0.35 + Math.sin(t * 1.3) * 0.05;
    renderer.render(scene, camera);
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (visible && !document.hidden) frame();
  };
  let io: IntersectionObserver | null = null;
  if (reduced) {
    renderer.render(scene, camera);
  } else {
    io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(el);
    loop();
  }

  return () => {
    cancelAnimationFrame(raf);
    io?.disconnect();
    ro.disconnect();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    [coinGeo, rimGeo, ribbonGeo].forEach((g) => g.dispose());
    [edgeMat, faceMat, ribbonMat].forEach((m) => m.dispose());
    face.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
