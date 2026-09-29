import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDirectory, externalReferences } from './check-external-urls.mjs';

// The build check of specs/10-testing-acceptance.md §6 (Q-020): it fails on an external URL
// for a script, style, font or image in the built client, and passes on what the real build
// contains. `make build` runs it on the real build (client/package.json "build").
const script = fileURLToPath(new URL('./check-external-urls.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const dirs = [];

function dist(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-dist-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

// What the real build carries: namespace URIs, libraries' documentation links, local paths.
const CLEAN_HTML = `<!doctype html><html><head>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script type="module" crossorigin src="/assets/index-a.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-a.css">
</head><body><div id="root"></div><a href="https://example.org/licence">licence</a></body></html>`;
const CLEAN_JS = [
  'const url={pattern:`^http://[0-9.]+(:[0-9]+)?/$`};',
  'console.warn("https://github.com/konvajs/react-konva/issues/256");',
  'import{a as b}from"./messages-x.js";',
  'const ns="http://www.w3.org/2000/svg",x=`http://www.w3.org/1999/xlink`;',
  'throw Error("https://react.dev/errors/"+e);',
  'console.warn("See https://konvajs.org/docs/posts/Tainted_Canvas.html.");',
  'const m=()=>import("./DmView-x.js");',
  'fetch("/api/auth");',
].join('\n');
const CLEAN_CSS =
  '@font-face{font-family:Inter;src:url(/assets/inter-latin.woff2) format("woff2")}body{background:url("data:image/png;base64,AAAA")}';
const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0"/></svg>';

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the build fails on an external URL in the built client (@gate:external-url-build)', () => {
  it('passes a build that references only its own files', () => {
    const dir = dist({
      'index.html': CLEAN_HTML,
      'index.js': CLEAN_JS,
      'index.css': CLEAN_CSS,
      'favicon.svg': CLEAN_SVG,
    });
    expect(checkDirectory(dir)).toEqual([]);
    const result = run(dir);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    [
      'a script tag',
      'index.html',
      '<script src="https://cdn.example.com/lib.js"></script>',
      'https://cdn.example.com/lib.js',
    ],
    [
      'a stylesheet link',
      'index.html',
      '<link rel="stylesheet" href="//cdn.example.com/a.css">',
      '//cdn.example.com/a.css',
    ],
    [
      'a web font stylesheet',
      'index.html',
      "<link href='https://fonts.googleapis.com/css2?family=Inter' rel=stylesheet>",
      'https://fonts.googleapis.com/css2?family=Inter',
    ],
    [
      'a preconnect',
      'index.html',
      '<link rel="preconnect" href="https://fonts.gstatic.com">',
      'https://fonts.gstatic.com',
    ],
    ['an image', 'index.html', '<img src="http://192.0.2.7/logo.png">', 'http://192.0.2.7/logo.png'],
    [
      'an image in a srcset',
      'index.html',
      '<img srcset="/a.png 1x, https://img.example.com/a@2x.png 2x">',
      'https://img.example.com/a@2x.png',
    ],
    [
      'an inline style',
      'index.html',
      '<div style="background:url(https://img.example.com/bg.webp)"></div>',
      'https://img.example.com/bg.webp',
    ],
    [
      'a style element',
      'index.html',
      '<style>@import "https://cdn.example.com/x.css";</style>',
      'https://cdn.example.com/x.css',
    ],
    [
      'a font in CSS',
      'index.css',
      '@font-face{src:url("https://fonts.gstatic.com/s/inter.woff2")}',
      'https://fonts.gstatic.com/s/inter.woff2',
    ],
    [
      'an image in CSS',
      'index.css',
      ".a{background-image:url('HTTPS://img.example.com/a.jpg')}",
      'HTTPS://img.example.com/a.jpg',
    ],
    ['a CSS import', 'index.css', "@import 'https://cdn.example.com/b.css';", 'https://cdn.example.com/b.css'],
    ['a module import', 'index.js', 'import{x}from"https://esm.example.com/pkg";', 'https://esm.example.com/pkg'],
    [
      'a dynamic import',
      'index.js',
      'const m=await import(`https://esm.example.com/mod`);',
      'https://esm.example.com/mod',
    ],
    ['importScripts', 'worker.js', 'importScripts("https://cdn.example.com/w");', 'https://cdn.example.com/w'],
    [
      'an image URL in a string',
      'index.js',
      'img.src="https://img.example.com/token.webp";',
      'https://img.example.com/token.webp',
    ],
    [
      'a font URL in a string',
      'index.js',
      "new FontFace('Inter','url(x)');const f='//fonts.example.com/inter.woff2?v=1';",
      '//fonts.example.com/inter.woff2?v=1',
    ],
    [
      'an SVG image reference',
      'icon.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://img.example.com/a.png"/></svg>',
      'https://img.example.com/a.png',
    ],
    // Review M1: what code can reach without naming a file.
    ['a fetch', 'index.js', 'fetch("https://api.example.com/collect");', 'https://api.example.com/collect'],
    ['a WebSocket', 'index.js', 'new WebSocket("wss://live.example.com");', 'wss://live.example.com'],
    ['a beacon', 'index.js', 'navigator.sendBeacon("https://x.example.com/b");', 'https://x.example.com/b'],
    [
      'a pixel without an extension',
      'index.js',
      'i.src="https://x.example.com/p?id=1";',
      'https://x.example.com/p?id=1',
    ],
    [
      'a URL joined from pieces',
      'index.js',
      'const u="https://cdn.example.com/lib/"+n+".js";',
      'https://cdn.example.com/lib/',
    ],
    [
      'a web font stylesheet set from code',
      'index.js',
      'l.href="https://fonts.googleapis.com/css2?family=Inter";',
      'https://fonts.googleapis.com/css2?family=Inter',
    ],
    [
      'CSS inside a JavaScript string',
      'index.js',
      's.textContent=`@font-face{src:url(https://fonts.gstatic.com/s/x.woff2)}`;',
      'https://fonts.gstatic.com/s/x.woff2',
    ],
    [
      'a file on a documentation host',
      'index.js',
      'e="https://github.com/x/y/raw/main/a.js";',
      'https://github.com/x/y/raw/main/a.js',
    ],
    ['an IPv6 literal', 'index.js', 'f="http://[2001:db8::1]/x";', 'http://[2001:db8::1]/x'],
    [
      'a > inside a quoted attribute',
      'index.html',
      '<img alt="a>b" src="https://img.example.com/a.png">',
      'https://img.example.com/a.png',
    ],
    ['a base element', 'index.html', '<base href="https://cdn.example.com/">', 'https://cdn.example.com/'],
    [
      'an image-set',
      'index.css',
      '.a{background:image-set("https://img.example.com/a.png" 1x)}',
      'https://img.example.com/a.png',
    ],
  ])('fails on %s', (_label, name, text, url) => {
    const files = { 'index.html': CLEAN_HTML, 'index.js': CLEAN_JS, 'index.css': CLEAN_CSS };
    files[name] = name in files ? `${files[name]}\n${text}` : text;
    const dir = dist(files);
    expect(checkDirectory(dir)).toEqual([{ file: name, url }]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${name}: ${url}`);
  });

  it('judges each file by its kind, so a namespace URI or a documentation link never fails', () => {
    expect(externalReferences('a.js', CLEAN_JS)).toEqual([]);
    expect(externalReferences('a.svg', CLEAN_SVG)).toEqual([]);
    expect(externalReferences('a.html', CLEAN_HTML)).toEqual([]);
    expect(externalReferences('a.woff2', 'https://x.example.com/a.woff2')).toEqual([]);
  });

  it('fails when it cannot read the directory, rather than passing on nothing', () => {
    const result = run(path.join(os.tmpdir(), 'emberglass-no-such-dist'));
    expect(result.status).toBe(2);
  });

  it('runs as part of the client build, so `make build` fails with it', () => {
    const client = JSON.parse(readFileSync(path.join(root, 'client/package.json'), 'utf8'));
    expect(client.scripts.build).toMatch(/^vite build && node \.\.\/scripts\/check-external-urls\.mjs dist$/);
  });
});
