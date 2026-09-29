// The built client's offline check (specs/10-testing-acceptance.md §6, specs/02-architecture.md §6,
// Q-020): the build fails when anything in it references a script, style, font or image on
// another host. `npm run build` runs it on `client/dist` after Vite, so `make build`, CI's build
// job and `npm start`'s first build all fail on such a reference. @gate:external-url-build
//
// A reference is what a browser would fetch: in HTML the src, href, srcset, poster and data
// attributes of the elements that load something; in CSS and inline styles every url() and
// @import; in SVG every href; in JavaScript a module imported from a URL, a script loaded by
// importScripts, and any absolute URL whose path names a script, style, font or image file.
// Namespace URIs (http://www.w3.org/2000/svg) and the documentation links in libraries' error
// messages are not fetched and name no such file, so they pass.
//
//   node scripts/check-external-urls.mjs <dist directory>
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An absolute URL a browser would send off this host: a scheme with an authority, or
// protocol-relative. `data:` and `blob:` URLs and paths on the same host are local.
const EXTERNAL = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const RESOURCE_FILE = /\.(?:m?js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#][^'"`\s]*)?$/i;
const LOADING_ELEMENTS = /^(?:script|link|img|image|source|video|audio|track|iframe|embed|object|input|use)$/i;

/** @param {string} value @returns {boolean} */
export function isExternal(value) {
  return EXTERNAL.test(value);
}

/** @param {string} css */
function cssReferences(css) {
  const found = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) found.push(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])([^'"]*)\1/gi)) found.push(m[2]);
  return found;
}

/** @param {string} html */
function htmlReferences(html) {
  const found = [];
  for (const tag of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const [, name, attributes] = tag;
    for (const attribute of attributes.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const key = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (key === 'style') found.push(...cssReferences(value));
      else if (!LOADING_ELEMENTS.test(name)) continue;
      else if (key === 'srcset') found.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0]));
      else if (['src', 'href', 'xlink:href', 'poster', 'data'].includes(key)) found.push(value);
    }
  }
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) found.push(...cssReferences(style[1]));
  return found;
}

/** @param {string} js */
function scriptReferences(js) {
  const found = [];
  const quoted = String.raw`(['"\x60])([^'"\x60]*)\1`;
  for (const m of js.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${quoted}`, 'g'))) found.push(m[2]);
  for (const m of js.matchAll(new RegExp(String.raw`\b(?:from|import)\s*${quoted}`, 'g'))) found.push(m[2]);
  for (const m of js.matchAll(new RegExp(String.raw`\bimportScripts\s*\(\s*${quoted}`, 'g'))) found.push(m[2]);
  for (const m of js.matchAll(/(['"`])((?:[a-z][a-z0-9+.-]*:)?\/\/[^'"`\s]+)\1/gi)) {
    if (RESOURCE_FILE.test(m[2])) found.push(m[2]);
  }
  return found;
}

/**
 * The external references in one built file, judged by its extension.
 * @param {string} name
 * @param {string} text
 * @returns {string[]}
 */
export function externalReferences(name, text) {
  const extension = path.extname(name).toLowerCase();
  let found = [];
  if (extension === '.html' || extension === '.htm') {
    found = htmlReferences(text);
    for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      found.push(...scriptReferences(script[1]));
  } else if (extension === '.svg') found = htmlReferences(text);
  else if (extension === '.css') found = cssReferences(text);
  else if (extension === '.js' || extension === '.mjs') found = scriptReferences(text);
  else if (extension === '.webmanifest' || extension === '.json') {
    found = [...text.matchAll(/"((?:[a-z][a-z0-9+.-]*:)?\/\/[^"]+)"/gi)].map((m) => m[1]);
  }
  return [...new Set(found.filter(isExternal))];
}

/** @param {string} dir @returns {{ file: string, url: string }[]} */
export function checkDirectory(dir) {
  const problems = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const bytes = readFileSync(full);
    if (bytes.includes(0)) continue;
    const file = path.relative(dir, full).split(path.sep).join('/');
    for (const url of externalReferences(entry.name, bytes.toString('utf8'))) problems.push({ file, url });
  }
  return problems;
}

function main(args) {
  const dir = args[0];
  if (!dir) {
    console.error('usage: node scripts/check-external-urls.mjs <dist directory>');
    return 2;
  }
  let problems;
  try {
    problems = checkDirectory(dir);
  } catch (error) {
    console.error(`check-external-urls: cannot read ${dir}: ${error.message}`);
    return 2;
  }
  if (problems.length > 0) {
    console.error(
      'The built client references files on other hosts; the app must work offline (specs/02-architecture.md §6):',
    );
    for (const { file, url } of problems) console.error(`  ${file}: ${url}`);
    return 1;
  }
  console.log(`check-external-urls: ${dir} references no script, style, font or image on another host.`);
  return 0;
}

// Not `import.meta.main`: Node 24 before 24.2 lacks it and would skip main() silently.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
