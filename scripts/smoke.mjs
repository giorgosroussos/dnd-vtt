// `make smoke`: health of the running system through its public entry points.
//
// There is deliberately no health route: every /api route but PIN entry and
// setup requires a DM session (specs/02-architecture.md §5). The check is what a
// TV and a DM browser do: load each view and its entry script, and see that /api
// is answered by the API rather than swallowed by the client.
//
//   node scripts/smoke.mjs [--wait SECONDS]     base URL: SMOKE_URL, else http://127.0.0.1:$EMBERGLASS_PORT (3000)

const args = process.argv.slice(2);
const waitIndex = args.indexOf('--wait');
const waitSeconds = waitIndex >= 0 ? Number(args[waitIndex + 1]) : 0;
const base = process.env.SMOKE_URL ?? `http://127.0.0.1:${process.env.EMBERGLASS_PORT || 3000}`;

async function check() {
  const failures = [];
  for (const path of ['/', '/dm']) {
    const response = await fetch(new URL(path, base));
    const html = await response.text();
    if (response.status !== 200 || !/text\/html/.test(response.headers.get('content-type') ?? '')) {
      failures.push(
        `GET ${path}: expected 200 text/html, got ${response.status} ${response.headers.get('content-type')}`,
      );
      continue;
    }
    if (!html.includes('id="root"')) failures.push(`GET ${path}: the page has no #root element`);
    const entry = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (!entry) {
      failures.push(`GET ${path}: no module entry script`);
      continue;
    }
    const script = await fetch(new URL(entry, base));
    if (script.status !== 200 || !/javascript/.test(script.headers.get('content-type') ?? '')) {
      failures.push(`GET ${entry}: expected 200 JavaScript, got ${script.status}`);
    }
  }
  const api = await fetch(new URL('/api/smoke-unknown-route', base));
  const body = await api.text();
  if (api.status !== 404 || body.includes('id="root"')) {
    failures.push(`GET /api/smoke-unknown-route: expected a 404 from the API, got ${api.status}`);
  }
  return failures;
}

const deadline = Date.now() + waitSeconds * 1000;
for (;;) {
  let failures;
  try {
    failures = await check();
  } catch (error) {
    failures = [`${base} is not answering: ${error.cause?.code ?? error.message}`];
  }
  if (failures.length === 0) {
    console.log(
      `smoke: ${base} serves the player view, the DM view and their scripts; /api answers 404 for unknown routes.`,
    );
    process.exit(0);
  }
  if (Date.now() >= deadline) {
    for (const failure of failures) console.error(`smoke: FAIL ${failure}`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
