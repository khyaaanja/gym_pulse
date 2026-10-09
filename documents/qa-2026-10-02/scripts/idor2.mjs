const BASE=`http://${process.argv[2]}:3000`,H={origin:BASE,"content-type":"application/json"},PW="GymPulse!Demo2026";
const login=async id=>(await fetch(BASE+"/api/auth/login",{method:"POST",headers:H,body:JSON.stringify({identifier:id,password:PW})})).headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const yoga=await login("owner@yoganest.demo"),member=await login("member@pulsefitness.demo");
const c=async(k,m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{...H,cookie:k},body:JSON.stringify(b)});return r.status+" "+(await r.text()).slice(0,150)};
console.log("yoga POST valid note to pulse recovery:",await c(yoga,"POST","/api/gym/recovery/cmupwwo3r00bq0scp47iw00gw",{action:"note",note:"QA cross-tenant"}));
console.log("member pays foreign order (valid body):",await c(member,"POST","/api/me/orders/cmujlmv5p0clk59cpomph7x4y/pay",{provider:"sandbox"}));
