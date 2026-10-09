// CI gate over `npm audit --omit=dev`: fails on any high/critical advisory that is not accepted in
// .github/audit-allowlist.json, and on any accepted entry whose `until` date has passed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FAIL_ON = new Set(["high", "critical"]);
const allow = JSON.parse(readFileSync(new URL("../../.github/audit-allowlist.json", import.meta.url), "utf8")).advisories;
const today = new Date().toISOString().slice(0, 10);
for (const entry of allow) {
  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(entry.id ?? "")) throw new Error(`allowlist: bad id ${entry.id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.until ?? "") || Number.isNaN(Date.parse(entry.until))) {
    throw new Error(`allowlist: ${entry.id} needs an "until" date as YYYY-MM-DD`);
  }
  if (!entry.reason) throw new Error(`allowlist: ${entry.id} needs a reason`);
}

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = e.stdout;
}
const report = JSON.parse(raw);
if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
// Refuse to pass on a report shape this script doesn't understand.
if (report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
  throw new Error(`unexpected npm audit report format (auditReportVersion ${report.auditReportVersion})`);
}

const found = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === "string" || !FAIL_ON.has(via.severity)) continue;
    const id = via.url?.split("/").pop();
    found.set(id, { id, package: via.name, severity: via.severity, title: via.title });
  }
}

const problems = [];
const counted = report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical;
if (counted > 0 && found.size === 0) problems.push(`npm reports ${counted} high/critical packages but none were parsed`);
for (const a of found.values()) {
  const entry = allow.find((x) => x.id === a.id);
  if (!entry) problems.push(`NOT ACCEPTED  ${a.severity}  ${a.id}  ${a.package}: ${a.title}`);
  else if (entry.until < today) problems.push(`EXPIRED ${entry.until}  ${a.id}  ${a.package}: re-review or remove`);
  else console.log(`accepted until ${entry.until}  ${a.id}  ${a.package}`);
}
for (const entry of allow) {
  if (!found.has(entry.id)) console.log(`note: ${entry.id} (${entry.package}) no longer reported; remove it from the allowlist`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`npm audit gate passed (${found.size} high/critical advisories, all accepted)`);
