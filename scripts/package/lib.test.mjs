import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  browsersOf,
  createIco,
  createZip,
  FIREWALL_BLOCK_RULE,
  FIREWALL_RULE,
  HIDDEN_INFORMATION_GATES,
  INSTALLER_APP_ID,
  innoScript,
  installerInfo,
  journeySpecs,
  nameOfKey,
  packageDirOf,
  packagedServersVerdict,
  playwrightVerdicts,
  productionClosure,
  resolveLockKey,
  runsOn,
  vitestVerdicts,
} from './lib.mjs';

// The helpers of the Windows package build (PKG-01, D-164, D-166). `make package` runs the build
// and its acceptance check on the real package; these pin the parts whose mistakes would ship
// quietly: a missing or extra module, an unreadable zip.

const windows = { platform: 'win32', arch: 'x64', libc: null };
const glibc = { platform: 'linux', arch: 'x64', libc: 'glibc' };

describe('runsOn', () => {
  it('admits a package with no os, cpu or libc on every target', () => {
    expect(runsOn({}, windows)).toBe(true);
    expect(runsOn({}, glibc)).toBe(true);
  });

  it('follows os, cpu and libc, with ! as an exclusion', () => {
    expect(runsOn({ os: ['win32'], cpu: ['x64'] }, windows)).toBe(true);
    expect(runsOn({ os: ['win32'], cpu: ['arm64'] }, windows)).toBe(false);
    expect(runsOn({ os: ['linux'] }, windows)).toBe(false);
    expect(runsOn({ os: ['!win32'] }, windows)).toBe(false);
    expect(runsOn({ os: ['!win32'] }, glibc)).toBe(true);
    expect(runsOn({ os: ['linux'], libc: ['musl'] }, glibc)).toBe(false);
    expect(runsOn({ os: ['linux'], libc: ['glibc'] }, glibc)).toBe(true);
    // Off Linux there is no libc to match.
    expect(runsOn({ libc: ['glibc'] }, windows)).toBe(true);
  });
});

describe('resolveLockKey and nameOfKey', () => {
  const packages = {
    '': {},
    server: {},
    'node_modules/a': {},
    'node_modules/a/node_modules/b': {},
    'node_modules/b': {},
    'node_modules/@s/c': {},
    'server/node_modules/d': {},
  };

  it('finds the nearest copy, walking up the node_modules folders as Node does', () => {
    expect(resolveLockKey(packages, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
    expect(resolveLockKey(packages, 'node_modules/a/node_modules/b', 'a')).toBe('node_modules/a');
    expect(resolveLockKey(packages, 'node_modules/@s/c', 'b')).toBe('node_modules/b');
    expect(resolveLockKey(packages, 'server', 'd')).toBe('server/node_modules/d');
    expect(resolveLockKey(packages, 'server', 'a')).toBe('node_modules/a');
    expect(resolveLockKey(packages, '', 'missing')).toBeNull();
  });

  it('names a key by what follows its last node_modules/', () => {
    expect(nameOfKey('node_modules/a/node_modules/b')).toBe('b');
    expect(nameOfKey('node_modules/@s/c')).toBe('@s/c');
  });
});

describe('productionClosure', () => {
  const lock = {
    packages: {
      '': { workspaces: ['server', 'shared'] },
      server: { dependencies: { '@x/shared': '1', native: '1' }, devDependencies: { tool: '1' } },
      shared: { dependencies: { schema: '1' } },
      'node_modules/@x/shared': { link: true, resolved: 'shared' },
      'node_modules/native': {
        dependencies: { helper: '1' },
        optionalDependencies: { 'native-win32-x64': '1', 'native-linux-x64': '1', 'native-linux-x64-musl': '1' },
        peerDependencies: { host: '1', optionalpeer: '1' },
        peerDependenciesMeta: { optionalpeer: { optional: true } },
      },
      'node_modules/native/node_modules/helper': { dependencies: { leaf: '1' } },
      'node_modules/helper': {},
      'node_modules/leaf': {},
      'node_modules/host': {},
      'node_modules/optionalpeer': {},
      'node_modules/native-win32-x64': { os: ['win32'], cpu: ['x64'], optional: true },
      'node_modules/native-linux-x64': { os: ['linux'], cpu: ['x64'], optional: true },
      'node_modules/native-linux-x64-musl': { os: ['linux'], cpu: ['x64'], optional: true },
      'node_modules/schema': {},
      'node_modules/tool': { dev: true },
    },
  };
  const all = () => true;

  it('follows dependencies, workspace links and required peers, never devDependencies', () => {
    expect(productionClosure(lock, ['server'], windows, all)).toEqual([
      'node_modules/host',
      'node_modules/leaf',
      'node_modules/native',
      'node_modules/native-win32-x64',
      'node_modules/native/node_modules/helper',
      'node_modules/schema',
    ]);
  });

  it("keeps only the optional packages for the target, read from the installed manifest's libc", () => {
    const manifest = (key) => (key === 'node_modules/native-linux-x64-musl' ? { libc: ['musl'] } : null);
    expect(productionClosure(lock, ['native'], glibc, all, manifest)).toEqual([
      'node_modules/host',
      'node_modules/leaf',
      'node_modules/native',
      'node_modules/native-linux-x64',
      'node_modules/native/node_modules/helper',
    ]);
  });

  it('leaves out an optional package that is not installed', () => {
    const installed = (key) => key !== 'node_modules/native-win32-x64';
    expect(productionClosure(lock, ['native'], windows, installed)).not.toContain('node_modules/native-win32-x64');
  });

  it('refuses a required dependency missing from the lock', () => {
    const broken = { packages: { ...lock.packages, 'node_modules/leaf': undefined } };
    delete broken.packages['node_modules/leaf'];
    expect(() => productionClosure(broken, ['native'], windows, all)).toThrow(/leaf, a dependency of/);
  });

  it('reads the real lock: the shipped native modules hold no build tool and no workspace', () => {
    const real = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    const keys = productionClosure(real, ['better-sqlite3', 'sharp'], windows, all);
    const names = keys.map(nameOfKey);
    expect(names).toContain('better-sqlite3');
    expect(names).toContain('sharp');
    expect(names).toContain('@img/sharp-win32-x64');
    expect(names.filter((name) => name.startsWith('@img/sharp-') && !name.includes('win32-x64'))).toEqual([]);
    for (const name of ['@emberglass/shared', 'vite', 'esbuild', 'typescript', 'tsx', 'node-gyp', 'prebuild-install']) {
      expect(names).not.toContain(name);
    }
  });
});

describe('packageDirOf', () => {
  it('is the package folder of a file in node_modules, scoped or not', () => {
    expect(packageDirOf('node_modules/fastify/lib/route.js')).toBe('node_modules/fastify');
    expect(packageDirOf('node_modules/@fastify/static/index.js')).toBe('node_modules/@fastify/static');
    expect(packageDirOf('node_modules/a/node_modules/b/x.js')).toBe('node_modules/a/node_modules/b');
    expect(packageDirOf('server/src/main.ts')).toBeNull();
  });
});

/** The entries of a zip, read back from its central directory as an unzip tool reads them. */
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const mode = zip.readUInt32LE(at + 38) >>> 16;
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localName = zip.readUInt16LE(offset + 26);
    const body = zip.subarray(offset + 30 + localName, offset + 30 + localName + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data, mode });
    at += 46 + nameLength;
  }
  return entries;
}

describe('createZip', () => {
  it('writes entries that read back intact, with their names, contents and modes', () => {
    const text = Buffer.from('Emberglass\r\n'.repeat(200));
    const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 251));
    const zip = createZip(
      [
        { name: 'Emberglass/README.txt', data: text },
        { name: 'Emberglass/emberglass', data: random, mode: 0o100755 },
        { name: 'Emberglass/Reset PIN.cmd', data: Buffer.alloc(0) },
      ],
      new Date(2026, 9, 2, 12, 30, 0),
    );
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      'Emberglass/README.txt',
      'Emberglass/emberglass',
      'Emberglass/Reset PIN.cmd',
    ]);
    expect(entries[0].data.equals(text)).toBe(true);
    expect(entries[1].data.equals(random)).toBe(true);
    expect(entries[1].mode & 0o777).toBe(0o755);
    expect(entries[0].mode & 0o777).toBe(0o644);
    expect(entries[2].data.length).toBe(0);
  });
});

describe('createIco', () => {
  it('indexes each PNG with its size, 256 written as 0', () => {
    const ico = createIco([
      { size: 16, png: Buffer.from('aaaa') },
      { size: 256, png: Buffer.from('bbbbbb') },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16]).toBe(0);
    const second = ico.readUInt32LE(6 + 16 + 12);
    expect(ico.subarray(second, second + 6).toString()).toBe('bbbbbb');
  });
});

// The installer's script (PKG-02, specs/09-operations.md §4, §5, Q-108, D-172, D-174, D-175): the promises the
// spec makes are lines of it, so that an edit that drops one fails here, before any Windows runner.
describe('innoScript', () => {
  const script = innoScript({
    version: '1.0.0-rc.1',
    stage: 'D:\\a\\dist\\package\\Emberglass',
    outDir: 'D:\\a\\dist\\package',
    outName: 'Emberglass-1.0.0-rc.1-win-x64-setup',
    icon: 'D:\\a\\emberglass.ico',
    info: 'D:\\a\\info.txt',
  });
  const lines = script.split('\r\n');
  const section = (name) => {
    const start = lines.indexOf(`[${name}]`);
    expect(start, name).toBeGreaterThan(-1);
    const end = lines.findIndex((line, index) => index > start && /^\[[A-Za-z]+\]$/.test(line));
    return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line && !line.startsWith(';'));
  };

  it('installs for every user, always under Program Files, x64 only, with one administrator prompt, as one fixed app', () => {
    const setup = section('Setup');
    expect(setup).toContain(`AppId={{${INSTALLER_APP_ID}}`);
    expect(setup).toContain('PrivilegesRequired=admin');
    expect(setup.some((line) => line.startsWith('PrivilegesRequiredOverridesAllowed'))).toBe(false);
    expect(setup).toContain('DefaultDirName={autopf}\\Emberglass');
    // No other folder: one a user may write to would let them replace what the firewall and Start Menu trust.
    expect(setup).toContain('DisableDirPage=yes');
    expect(setup).toContain('UsePreviousAppDir=no');
    expect(setup).toContain('ArchitecturesAllowed=x64os');
    expect(setup).toContain('ArchitecturesInstallIn64BitMode=x64os');
    expect(setup).toContain('AppVersion=1.0.0-rc.1');
    expect(setup).toContain('VersionInfoVersion=1.0.0.0');
    expect(setup).toContain('CloseApplications=force');
    // A short page on what it does, never a licence to accept: the AGPL asks nothing of whoever runs it.
    expect(setup.some((line) => line.startsWith('LicenseFile='))).toBe(false);
    expect(setup).toContain('InfoBeforeFile=D:\\a\\info.txt');
  });

  it('tells the DM on uninstalling that the data is kept, and where', () => {
    const messages = section('Messages');
    expect(messages.find((line) => line.startsWith('ConfirmUninstall='))).toContain('%APPDATA%\\Emberglass are kept');
    expect(messages.find((line) => line.startsWith('UninstalledAll='))).toContain('still in %APPDATA%\\Emberglass');
    expect(installerInfo('1.0.0')).toContain('Updating or\r\n  uninstalling never deletes them.');
  });

  it('adds Start Menu shortcuts, a desktop one only on request, all with the Emberglass icon', () => {
    const icons = section('Icons');
    expect(icons.filter((line) => line.startsWith('Name: "{group}\\'))).toHaveLength(3);
    expect(icons.find((line) => line.startsWith('Name: "{group}\\Emberglass"'))).toContain(
      'Filename: "{app}\\Emberglass.cmd"',
    );
    expect(icons.find((line) => line.startsWith('Name: "{autodesktop}'))).toContain('Tasks: desktopicon');
    expect(section('Tasks')).toEqual([
      'Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked',
    ]);
    for (const line of icons.filter((each) => each.includes('.cmd')))
      expect(line).toContain('IconFilename: "{app}\\emberglass.exe"');
  });

  it('keeps exactly two inbound rules for emberglass.exe: TCP allowed on private networks, all blocked on the others', () => {
    const netsh = section('Run').filter((line) => line.startsWith('Filename: "{sys}\\netsh.exe"'));
    const program = 'program=""{app}\\emberglass.exe""';
    const allow = `name=""${FIREWALL_RULE}"" ${program}`;
    const block = `name=""${FIREWALL_BLOCK_RULE}"" ${program}`;
    // The older ones go before the new ones are added, so an upgrade never leaves more.
    expect(netsh).toHaveLength(4);
    expect(netsh[0]).toContain(`advfirewall firewall delete rule ${allow}`);
    expect(netsh[1]).toContain(`advfirewall firewall delete rule ${block}`);
    expect(netsh[2]).toContain(
      `advfirewall firewall add rule ${allow} dir=in action=allow protocol=TCP profile=private enable=yes`,
    );
    expect(netsh[3]).toContain(
      `advfirewall firewall add rule ${block} dir=in action=block profile=public,domain enable=yes`,
    );
    expect(script).not.toMatch(/action=allow[^\r\n]*profile=(?:any|public|domain)/);
    const uninstall = section('UninstallRun');
    expect(uninstall.filter((line) => line.includes(`delete rule ${allow}`))).toHaveLength(1);
    expect(uninstall.filter((line) => line.includes(`delete rule ${block}`))).toHaveLength(1);
  });

  it('stops a running Emberglass from this folder, and only that one, before an upgrade or an uninstall', () => {
    // As a parameter in [UninstallRun]; inside a Pascal string in [Code], where a quote is doubled.
    expect(section('UninstallRun')[0]).toContain("Where-Object Path -eq '{app}\\emberglass.exe' | Stop-Process -Force");
    expect(section('Code').join('\n')).toMatch(
      /function PrepareToInstall[\s\S]*Where-Object Path -eq ''\{app\}\\emberglass\.exe'' \| Stop-Process -Force/,
    );
    // No braces in what Inno Setup expands: { would start one of its constants.
    expect(section('UninstallRun')[0]).not.toMatch(/\{ \$_/);
  });

  it('starts Emberglass after installing as the DM, never as the administrator, and not when silent', () => {
    const start = section('Run').find((line) => line.includes('Emberglass.cmd'));
    expect(start).toContain('runasoriginaluser');
    expect(start).toContain('postinstall');
    expect(start).toContain('skipifsilent');
  });

  it('replaces the app folder whole on an upgrade and never acts on the data directory', () => {
    expect(section('InstallDelete')).toEqual(['Type: filesandordirs; Name: "{app}\\app"']);
    // The messages name %APPDATA%\Emberglass to the DM; no directive acts on it.
    const acting = lines.filter((line) => !line.startsWith('ConfirmUninstall=') && !line.startsWith('UninstalledAll='));
    expect(acting.join('\n')).not.toMatch(/userappdata|commonappdata|localappdata|%APPDATA%|UninstallDelete/i);
  });

  it('refuses a version without major.minor.patch', () => {
    expect(() => innoScript({ version: 'next', stage: 's', outDir: 'o', outName: 'n', icon: 'i', info: 'f' })).toThrow(
      /major\.minor\.patch/,
    );
  });
});

// The package gates' verdicts (PKG-03, D-176, D-177): `make package-gates` passes only on these, so every way a gate
// can go missing must fail one (review T-H1).
describe("the package gates' verdicts", () => {
  const failed = (verdicts) => verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.message);
  const gate = (id, status = 'passed', title = `@gate:${id} does what it says`) => ({ title, status });
  const vitest = (...tests) => ({ testResults: [{ assertionResults: tests }] });
  const all = () => HIDDEN_INFORMATION_GATES.map((id) => gate(id));

  it('passes the three hidden-information gates when each ran once and passed', () => {
    expect(failed(vitestVerdicts(vitest(...all(), { title: 'another test', status: 'skipped' })))).toEqual([]);
  });

  it('fails a hidden-information gate that is missing, skipped, failed, duplicated or renamed, and a missing report', () => {
    const [first, second, third] = HIDDEN_INFORMATION_GATES;
    expect(failed(vitestVerdicts(vitest(gate(first), gate(second))))).toEqual([
      `@gate:${third} ran against the package and passed (not run)`,
    ]);
    expect(failed(vitestVerdicts(vitest(gate(first), gate(second), gate(third, 'skipped'))))).toHaveLength(1);
    expect(failed(vitestVerdicts(vitest(gate(first), gate(second), gate(third, 'failed'))))).toHaveLength(1);
    expect(failed(vitestVerdicts(vitest(...all(), gate(third))))).toHaveLength(1);
    expect(
      failed(vitestVerdicts(vitest(gate(first), gate(second), gate(third, 'passed', `@gate:${third}-x renamed`)))),
    ).toHaveLength(1);
    expect(failed(vitestVerdicts(null))).toHaveLength(3);
    expect(failed(vitestVerdicts({ testResults: [] }))).toHaveLength(3);
  });

  it('fails every hidden-information gate when a file they live in holds an inverted test', () => {
    expect(failed(vitestVerdicts(vitest(...all()), ["it.fails('passes when it fails', () => {})"]))).toHaveLength(3);
    expect(failed(vitestVerdicts(vitest(...all()), ["it('fails nothing', () => {})"]))).toEqual([]);
  });

  const journeys = ['first-run.spec.ts', 'run.spec.ts'];
  const spec = (file, project, status = 'expected', expectedStatus = 'passed', title = 'a journey') => ({
    file,
    title,
    tests: [{ projectName: project, status, expectedStatus }],
  });
  const offlineGate = (status = 'expected') =>
    spec('offline.spec.ts', 'offline', status, 'passed', '@gate:offline-e2e the run sent nothing');
  const playwright = (...specs) => ({ suites: [{ file: 'x', specs }] });
  const everything = (browsers) => [
    ...browsers.flatMap((browser) => journeys.map((journey) => spec(`journeys/${journey}`, browser))),
    offlineGate(),
  ];

  it('passes every journey in every browser and the offline gate when each ran and passed', () => {
    expect(
      failed(playwrightVerdicts(playwright(...everything(['chromium', 'msedge'])), journeys, ['chromium', 'msedge'])),
    ).toEqual([]);
  });

  it('fails a journey missing in one browser, failed, flaky, skipped, or passing only as an expected failure', () => {
    const browsers = ['chromium', 'msedge'];
    const without = everything(browsers).filter(
      (each) => !(each.file === 'journeys/run.spec.ts' && each.tests[0].projectName === 'msedge'),
    );
    expect(failed(playwrightVerdicts(playwright(...without), journeys, browsers))).toEqual([
      'run.spec.ts ran in msedge against the package and passed (not run)',
    ]);
    for (const [status, expectedStatus] of [
      ['unexpected', 'passed'],
      ['flaky', 'passed'],
      ['skipped', 'passed'],
      ['expected', 'failed'],
    ]) {
      const specs = everything(browsers).map((each) =>
        each.file === 'journeys/run.spec.ts' && each.tests[0].projectName === 'chromium'
          ? spec('journeys/run.spec.ts', 'chromium', status, expectedStatus)
          : each,
      );
      expect(failed(playwrightVerdicts(playwright(...specs), journeys, browsers)), status).toHaveLength(1);
    }
  });

  it('finds journeys in nested suites and by Windows paths, and counts only the offline project as the offline gate', () => {
    const report = {
      suites: [
        {
          file: 'journeys\\first-run.spec.ts',
          suites: [
            {
              specs: [
                { title: 'nested', tests: [{ projectName: 'chromium', status: 'expected', expectedStatus: 'passed' }] },
              ],
            },
          ],
        },
        { file: 'x', specs: [spec('journeys\\run.spec.ts', 'chromium')] },
        // Each browser's probe carries the offline marker; it is not the run's offline gate.
        {
          file: 'x',
          specs: [
            spec('journeys/offline-probe.spec.ts', 'chromium', 'expected', 'passed', '@gate:offline-e2e a probe'),
          ],
        },
      ],
    };
    expect(failed(playwrightVerdicts(report, journeys, ['chromium']))).toEqual([
      '@gate:offline-e2e ran after them and passed (not run)',
    ]);
    expect(
      failed(
        playwrightVerdicts(playwright(...everything(['chromium']).slice(0, -1), offlineGate('skipped')), journeys, [
          'chromium',
        ]),
      ),
    ).toHaveLength(1);
    expect(failed(playwrightVerdicts(null, journeys, ['chromium']))).toHaveLength(3);
  });

  it('runs in Chromium always, whatever EMBERGLASS_E2E_BROWSERS says', () => {
    expect(browsersOf(undefined)).toEqual(['chromium']);
    expect(browsersOf(' , ')).toEqual(['chromium']);
    expect(browsersOf('chromium,msedge')).toEqual(['chromium', 'msedge']);
    expect(browsersOf('msedge, firefox')).toEqual(['chromium', 'msedge', 'firefox']);
  });

  it('requires every journey spec on disk, so a journey added later is required too', () => {
    const dir = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'e2e', 'tests', 'journeys');
    const specs = journeySpecs(dir);
    for (const name of ['first-run', 'prepare', 'connect', 'run', 'recover', 'large-scene', 'offline-probe']) {
      expect(specs).toContain(`${name}.spec.ts`);
    }
    expect(specs.every((name) => name.endsWith('.spec.ts'))).toBe(true);
  });

  it('requires at least four packaged servers for the hidden-information gates, every one of the package', () => {
    const line = (folder) => JSON.stringify({ folder, pid: 1 });
    const four = ['a', 'a', 'a', 'a'].map(line);
    expect(packagedServersVerdict(four, 'a').ok).toBe(true);
    expect(packagedServersVerdict(four.slice(1), 'a').ok).toBe(false);
    expect(packagedServersVerdict([...four, line('elsewhere')], 'a').ok).toBe(false);
    expect(packagedServersVerdict([], 'a').ok).toBe(false);
  });
});
