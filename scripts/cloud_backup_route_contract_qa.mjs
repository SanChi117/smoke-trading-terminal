// Read-only route contract QA against a frozen snapshot of deployed AppDeploy v47.
// This uses a simulated SDK/authenticated context and in-memory DB.
// It does NOT assert that real AppDeploy bearer-token verification was exercised.
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';

const snapshotPath=new URL('../docs/reference/appdeploy-v47-browser-paper-backups.ts.txt',import.meta.url);
const source=await readFile(snapshotPath,'utf8');
const appVersion='1792003179327';
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
assert.match(source,/EXACT READ-ONLY SNAPSHOT FROM AppDeploy v47/);
assert.match(source,/requireAuth\(\)/);
assert.match(source,/tableFor\(user!\.userId\)/);

const tables=new Map();
let sequence=0, failReadback=false, quota=false;
const db={
  async add(table,records){
    if(quota){const error=new Error('quota');error.code='AppDatabaseQuotaExceeded';throw error;}
    const id='backup_'+String(++sequence).padStart(6,'0');
    if(!tables.has(table))tables.set(table,new Map());
    for(const value of records)tables.get(table).set(id,structuredClone(value));
    return [id];
  },
  async get(table,ids){
    if(failReadback)return [];
    return ids.map(id=>tables.get(table)?.get(id)??null);
  },
  async list(table,{limit}){
    const entries=[...(tables.get(table)?.entries()??[])].slice(0,limit);
    return {items:entries.map(([id,row])=>({id,...structuredClone(row)})),nextToken:null};
  },
};
const sdk={
  db,
  requireAuth(){
    const middleware=()=>{};
    middleware.testAuthBoundary=true;
    return middleware;
  },
  json(data,statusCode=200){return {statusCode,body:JSON.stringify(data)};},
  error(message,statusCode=500){return {statusCode,body:JSON.stringify({error:message})};},
  isAppDatabaseError(error){return !!error && error.code==='AppDatabaseQuotaExceeded';},
};
globalThis.__smokeSdkRouteContract=sdk;
const mockSdkUrl='data:text/javascript,'+encodeURIComponent(
  'const sdk=globalThis.__smokeSdkRouteContract;'+
  'export const db=sdk.db;export const requireAuth=sdk.requireAuth;'+
  'export const json=sdk.json;export const error=sdk.error;'+
  'export const isAppDatabaseError=sdk.isAppDatabaseError;'
);
let output=ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.ESNext,
  removeComments:true,
}}).outputText;
assert.ok(output.includes("from '@appdeploy/sdk'"),'SDK_IMPORT_PATTERN_CHANGED');
assert.ok(output.includes("from '../core/paper/paper-backup'"),'PARSER_IMPORT_PATTERN_CHANGED');
output=output.replace("from '@appdeploy/sdk'","from '"+mockSdkUrl+"'");
output=output.replace("from '../core/paper/paper-backup'","from '"+new URL('../core/paper/paper-backup.ts',import.meta.url).href+"'");
const dir=await mkdtemp(join(tmpdir(),'smoke-cloud-qa-'));
try{
  const file=join(dir,'route.mjs');
  await writeFile(file,output);
  const {browserPaperBackupRoutes:routes}=await import(pathToFileURL(file).href);
  for(const route of [
    'POST /api/pilot/browser-backups',
    'GET /api/pilot/browser-backups',
    'GET /api/pilot/browser-backups/:id',
  ]){
    assert.equal(routes[route]?.length,2,'ROUTE_AUTH_CHAIN_MISSING '+route);
    assert.equal(routes[route][0].testAuthBoundary,true,'AUTH_GUARD_NOT_FIRST '+route);
  }
  const alice='11111111-1111-4111-8111-111111111111';
  const bob='22222222-2222-4222-8222-222222222222';
  const packet={
    format:'SMOKE_BROWSER_PAPER_BACKUP_V1',
    exportedAt:Date.now()-1000,
    paper:{
      version:1,
      records:Object.fromEntries(symbols.map(symbol=>[symbol,blankPilotPaperState(symbol)])),
      notes:[],
      receipts:[],
    },
  };
  // The test harness starts AFTER requireAuth. Identity is simulated by design.
  async function invoke(route,userId,params={},body=null){
    const result=await routes[route][1]({
      user:{userId,scope:'openid'},body,params,query:{},event:{},
    });
    return {status:result.statusCode,body:JSON.parse(result.body)};
  }
  const put='POST /api/pilot/browser-backups';
  const list='GET /api/pilot/browser-backups';
  const get='GET /api/pilot/browser-backups/:id';

  let response=await invoke(put,alice,{},packet);
  assert.equal(response.status,201);
  assert.equal(response.body.stored,true);
  const aliceId=response.body.id;
  assert.equal((await invoke(list,alice)).body.items.length,1);
  assert.equal((await invoke(list,bob)).body.items.length,0);
  assert.equal((await invoke(get,bob,{id:aliceId})).status,404,
    'CROSS_ACCOUNT_READ_MUST_BE_404');
  const aliceCopy=await invoke(get,alice,{id:aliceId});
  assert.equal(aliceCopy.status,200);
  assert.deepEqual(aliceCopy.body.backup,packet,'CLOUD_BACKUP_READBACK_CHANGED');

  response=await invoke(put,bob,{},packet);
  assert.equal(response.status,201);
  const bobId=response.body.id;
  assert.notEqual(bobId,aliceId);
  assert.equal((await invoke(list,bob)).body.items.length,1);
  assert.equal((await invoke(list,alice)).body.items.length,1);
  assert.equal((await invoke(get,alice,{id:bobId})).status,404);

  const forged=structuredClone(packet);
  forged.paper.records.BTCUSDT.executionAuthorized=true;
  assert.equal((await invoke(put,alice,{},forged)).status,400);
  const fakePnl=structuredClone(packet);
  fakePnl.paper.records.BTCUSDT.realizedNetUsdt=999;
  assert.equal((await invoke(put,alice,{},fakePnl)).status,400);
  assert.equal((await invoke(put,alice,{}, {junk:true})).status,400);
  assert.equal((await invoke(get,alice,{id:'invalid!'})).status,400);
  assert.equal((await invoke(list,alice)).body.items.length,1,
    'INVALID_BACKUPS_MUST_NOT_BE_PERSISTED');

  // Too-large payloads fail before the database is touched.
  const huge={...packet,padding:'x'.repeat(250_000)};
  assert.equal((await invoke(put,alice,{},huge)).status,413);
  failReadback=true;
  response=await invoke(put,alice,{},packet);
  assert.equal(response.status,503);
  assert.equal(response.body.error,'PAPER_CLOUD_SAVE_READBACK_FAILED');
  failReadback=false;
  quota=true;
  response=await invoke(put,alice,{},packet);
  assert.equal(response.status,429);
  assert.equal(response.body.error,'PAPER_CLOUD_DATABASE_QUOTA');
  quota=false;

  console.log(JSON.stringify({
    suite:'APPDEPLOY_V47_CLOUD_ROUTE_CONTRACT',result:'PASS',
    appVersion,authMiddlewarePresent:true,
    simulatedUsers:2,ownerScopedList:true,foreignIdRead404:true,
    independentRows:true,readback:true,forgedLiveRejected:true,
    forgedPnlRejected:true,malformedRejected:true,
    oversizedRejected:true,readbackFailure503:true,quota429:true,
    externalAuthVerified:false,productionDatabaseAccessed:false,
    realPaperJournalMutated:false,liveOrders:false,
  }));
}finally{
  delete globalThis.__smokeSdkRouteContract;
  await rm(dir,{recursive:true,force:true});
}
