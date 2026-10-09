import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true }); const p = await (await b.newContext()).newPage();
await p.goto("http://localhost:3000/login"); await p.fill('input[name=identifier]', "owner@pulsefitness.demo"); await p.fill('input[name=password]', "GymPulse!Demo2026"); await p.click('button[type=submit]'); await p.waitForURL(/\/app/);
await p.goto("http://localhost:3000/app/renew", { waitUntil: "load" }); await p.getByRole("button", { name: "Record payment" }).first().waitFor();
console.log("tables:", await p.locator("table").count(), "| Rohit in DUE table:", await p.locator("table").first().getByText("Rohit Ghimire").count(), "| Rohit anywhere:", await p.getByText("Rohit Ghimire").count(), "| due header:", await p.getByText(/\d+ members/).first().innerText());
await b.close();
