const BASE = "http://192.168.100.77:3000", ACC = "qa-IPx263r@qa.demo";
const tryLogin = async (xff) => { const h = { origin: BASE, "content-type": "application/json" }; if (xff) h["x-forwarded-for"] = xff; const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: h, body: JSON.stringify({ identifier: ACC, password: "wrong-" + Math.random() }) }); return r.status; };
const fixed = []; for (let i = 0; i < 7; i++) fixed.push(await tryLogin("10.9.9.9"));
console.log("same spoofed XFF x7:", fixed.join(","));
const rot = []; for (let i = 0; i < 12; i++) rot.push(await tryLogin(`10.7.${i}.${i + 1}`));
console.log("rotating spoofed XFF x12:", rot.join(","));
const none = []; for (let i = 0; i < 7; i++) none.push(await tryLogin(null));
console.log("no XFF x7:", none.join(","));
