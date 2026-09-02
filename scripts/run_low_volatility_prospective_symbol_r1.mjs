import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DAY = 86_400_000;
const SOURCE = path.resolve("scripts/run_low_volatility_symbol_r1.mjs");
function previousMonthEnd(now=new Date()){return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)-1;}
function iso(t){return new Date(t).toISOString();}
const cutoff = process.env.LV_FUNDING_CUTOFF ? Date.parse(`${process.env.LV_FUNDING_CUTOFF}T23:59:59.999Z`) : previousMonthEnd();
if(!Number.isFinite(cutoff)) throw new Error("Invalid LV_FUNDING_CUTOFF");
// Engineering-only boundary fix: preserve the closed month-end record so the
// monthly formation can be frozen at that close. Load one extra kline only to
// populate nextTime/nextReturn in the source report; the aggregator refuses to
// score any next-day PnL whose funding date is beyond the archived cutoff.
const reportEnd=cutoff, loadEnd=cutoff+DAY;
const source=await fs.readFile(SOURCE,"utf8");
let patched=source;
patched=patched.replace(/const LOAD_END=Date\.parse\("[^"]+"\);/,`const LOAD_END=Date.parse("${iso(loadEnd)}");`);
patched=patched.replace(/const REPORT_END=Date\.parse\("[^"]+"\);/,`const REPORT_END=Date.parse("${iso(reportEnd)}");`);
patched=patched.replace(/const FUNDING_END=Date\.parse\("[^"]+"\);/,`const FUNDING_END=Date.parse("${iso(cutoff)}");`);
if(patched===source) throw new Error("Prospective date patch did not modify frozen low-vol runner");
const tmp=path.join(os.tmpdir(),`low-vol-prospective-${crypto.randomUUID()}.mjs`);
try{
  await fs.writeFile(tmp,patched);
  const r=spawnSync(process.execPath,[tmp],{cwd:process.cwd(),env:process.env,encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:64*1024*1024});
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.status!==0)process.exit(r.status??1);
}finally{await fs.rm(tmp,{force:true});}
