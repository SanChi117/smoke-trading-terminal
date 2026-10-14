// Public AppDeploy release probe. Never submits trades or includes credentials.
// An HTTP probe is NOT a trading/market-data end-to-end test.
import assert from 'node:assert/strict';

const ORIGIN = 'https://smoke-trading-terminal-0kl792.v2.appdeploy.ai';
const PATHS = [
  {path:'/',kind:'html'},
  {path:'/api/pilot/browser-backups',kind:'private'},
  {path:'/api/pilot/paper',kind:'private'},
];

async function probe({path,kind}) {
  const url = ORIGIN + path;
  const started = Date.now();
  let response;
  try {
    response = await fetch(url,{
      method:'GET',redirect:'manual',
      headers:{'accept':kind==='html'?'text/html':'application/json'},
      signal:AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new Error('PUBLIC_PROBE_NETWORK_FAILURE '+path+': '+
      (cause instanceof Error?cause.name:'UNKNOWN'));
  }
  const durationMs = Date.now()-started;
  const type = response.headers.get('content-type')??'';
  if(kind==='html') {
    assert.equal(response.status,200,
      'PUBLIC_SITE_NOT_200 '+path+' got '+response.status);
    assert.match(type,/text\/html/i,
      'PUBLIC_SITE_NOT_HTML '+path);
    const html=await response.text();
    assert.ok(html.length>100,
      'PUBLIC_SITE_EMPTY_HTML');
  } else {
    assert.ok([401,403].includes(response.status),
      'PRIVATE_PAPER_ENDPOINT_NOT_BLOCKED '+path+
      ' got '+response.status);
    // Avoid writing any API response or private journal bytes to CI logs.
    await response.body?.cancel();
  }
  return {path,status:response.status,durationMs,
    check:kind==='html'?'PUBLIC_SHELL_OK':'ANONYMOUS_ACCESS_BLOCKED'};
}

const report=[];
for(const test of PATHS) {
  const row=await probe(test);
  report.push(row);
  process.stdout.write(JSON.stringify(row)+'\n');
}
assert.equal(report.length,PATHS.length);
process.stdout.write('SMOKE_PUBLIC_PROBE_PASS\n');
