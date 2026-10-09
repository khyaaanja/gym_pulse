const HOST=process.argv[2]??"localhost", BASE=`http://${HOST}:3000`;
const H={origin:BASE,"content-type":"application/json"};
const lr=await fetch(BASE+"/api/auth/login",{method:"POST",headers:H,body:JSON.stringify({identifier:"owner@pulsefitness.demo",password:"GymPulse!Demo2026"})});
const cookie=lr.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const j=async(m,p,b)=>{const t=Date.now();const r=await fetch(BASE+p,{method:m,headers:{...H,cookie},body:b?JSON.stringify(b):undefined});return {s:r.status,ms:Date.now()-t,b:(await r.text()).slice(0,220)}};
const plans=JSON.parse((await j("GET","/api/gym/plans")).b.length?(await (await fetch(BASE+"/api/gym/plans",{headers:{cookie}})).text()):"{}");
const planList=plans.plans??plans.items??plans.data??plans; const plan=Array.isArray(planList)?planList.find(p=>p.active!==false):null;
console.log("plan",plan?.id,plan?.name,plan?.pricePaisa);
const ms=JSON.parse(await (await fetch(BASE+"/api/gym/members?q=QA%20Member&pageSize=20",{headers:{cookie}})).text());
const list=(ms.items??ms.members??ms.data??ms).filter(m=>/^QA Member/.test(m.fullName));
console.log("QA members:",list.map(m=>m.fullName+":"+m.id).join(", "));
const [a,b]=list;
// 1. single payment timing
console.log("single:",JSON.stringify(await j("POST","/api/gym/payments/manual",{memberId:a.id,planId:plan.id,method:"CASH",idempotencyKey:"qa-single-"+Date.now()})));
// 2. same idempotency key fired 3x concurrently → exactly one payment
const key="qa-idem-"+Date.now();
const r2=await Promise.all([1,2,3].map(()=>j("POST","/api/gym/payments/manual",{memberId:b.id,planId:plan.id,method:"CASH",idempotencyKey:key})));
console.log("same-key x3:",r2.map(r=>`${r.s} ${r.ms}ms ${r.b.slice(0,90)}`).join(" || "));
// 3. different keys, concurrently, same member+plan → second must be duplicate_payment 409
const r3=await Promise.all([1,2].map(i=>j("POST","/api/gym/payments/manual",{memberId:b.id,planId:plan.id,method:"CASH",idempotencyKey:"qa-diff-"+i+"-"+Date.now()})));
console.log("diff-key x2:",r3.map(r=>`${r.s} ${r.ms}ms ${r.b.slice(0,120)}`).join(" || "));
// 4. amount over plan price / negative / string
for (const amt of [ (plan.pricePaisa/100)+1, -1, "100" ]) console.log("amount",amt,JSON.stringify(await j("POST","/api/gym/payments/manual",{memberId:a.id,planId:plan.id,method:"CASH",amountRupees:amt,idempotencyKey:"qa-amt-"+Math.random()})));
console.log(JSON.stringify({memberA:a.id,memberB:b.id}));
