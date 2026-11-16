#!/usr/bin/env node
// Builds the WaveX public landing pages in this folder (served by GitHub Pages).
//   node docs/build.mjs [--out <dir>] [--snapshot <WX_SNAP32.json>] [--portfolio <dir with <slug>/cover.svg>] [--skip-png]
// It writes: index.html (the catalog), a/index.html (any live listing, a/?s=<slug>), a/<slug>/index.html with cover.svg and
// cover.png for each first-party listing, assets/snapshot.json (what the pages fall back to) and assets/site.js.
// With no --snapshot or --portfolio it uses the seed files when they are on this machine, else the copies already here,
// so a rebuild (for example after adding media/<slug>.mp4) works anywhere. It never calls the network.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = '/private/tmp/claude-501/-Users-geniex/f3c38bb1-ff0b-4a65-8bcd-2faba076d184/scratchpad/mvp/portfolio';
const WEB_CLIENT = '/Users/geniex/wavex-experience-architect/src/integrations/supabase/client.ts';
export const SITE_BASE = (process.env.WX_SITE_BASE || 'https://wavex-labs.github.io/wavex-claude-plugin/').replace(/\/*$/, '/');
export const API_ORIGIN = 'https://ngvtgraldybxdbgkihfj.supabase.co';
const STATIC_ASSETS = ['wx.js', 'app.js', 'wx.css', 'icon.svg', 'og.svg', 'config.js'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; " +
  `connect-src 'self' ${API_ORIGIN}; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com; ` +
  "base-uri 'none'; form-action 'none'";

export function loadWX() {
  const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController });
  vm.runInContext(fs.readFileSync(path.join(HERE, 'assets', 'wx.js'), 'utf8'), ctx, { filename: 'wx.js' });
  return ctx.WX;
}
const WX = loadWX();
const esc = WX.esc;

// The snapshot the pages ship with: cards and landing payloads only. Inline covers are left out (they ship as files).
export function trimSnapshot(snap) {
  const landing = {};
  const cards = (snap.cards || []).filter((c) => WX.validSlug(c.slug) && snap.landing && snap.landing[c.slug]);
  for (const c of cards) landing[c.slug] = snap.landing[c.slug];
  return { note: 'Saved copy of the first-party listings. The live read function is the truth.', count: cards.length, cards, landing };
}

function head({ title, description, url, image, imageAlt, base, page, slug }) {
  return `<!doctype html>
<html lang="en" data-page="${esc(page)}" data-base="${esc(base)}"${slug ? ` data-slug="${esc(slug)}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="WaveX Automations">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0B1B33">
<link rel="icon" href="${esc(base)}assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${esc(base)}assets/wx.css">
</head>
<body>
<header class="top"><div class="wrap wide"><a class="brand" href="${esc(base || './')}">Wave<b>X</b> Automations</a>${page === 'catalog' ? '' : `<a class="top-link" data-wx="all-automations" href="${esc(base || './')}">All automations</a>`}</div></header>
`;
}
function foot(base) {
  return `<footer class="foot"><div class="wrap wide"><span>WaveX Automations. Jobs your Claude runs for you.</span><a href="${esc(base || './')}">All automations</a></div></footer>
<script src="${esc(base)}assets/config.js"></script>
<script src="${esc(base)}assets/site.js"></script>
<script src="${esc(base)}assets/wx.js"></script>
<script src="${esc(base)}assets/app.js"></script>
</body>
</html>
`;
}
const NOTE = '<p class="note" id="note" hidden></p>';

// One pre-rendered listing page. site: {firstParty: [slug], media: [slug]}.
export function renderListingPage(payload, site = {}) {
  const slug = payload.slug, base = '../../';
  const opts = { base, firstParty: site.firstParty || [slug], media: site.media || [] };
  const url = `${SITE_BASE}a/${slug}/`;
  return head({ title: `${WX.cut(payload.name, 70)} · WaveX Automations`, description: WX.cut(payload.summary, 200), url, image: `${url}cover.png`,
    imageAlt: WX.cut(payload.name, 70), base, page: 'listing', slug }) +
    `<main><div class="wrap" id="app">${WX.renderListing(payload, opts, null)}</div><div class="wrap">${NOTE}</div></main>\n` + foot(base);
}
export function renderDynamicPage() {
  const base = '../';
  return head({ title: 'WaveX Automations', description: 'An automation on WaveX. Add WaveX to Claude and run it with your own Claude.', url: `${SITE_BASE}a/`,
    image: `${SITE_BASE}assets/og.png`, imageAlt: 'WaveX Automations', base, page: 'dynamic' }) +
    `<main><div class="wrap" id="app"><p class="skeleton">Loading the automation…</p><noscript><p class="note">This page needs JavaScript to show one automation. <a href="../">See all automations</a>.</p></noscript></div><div class="wrap">${NOTE}</div></main>\n` + foot(base);
}
export function renderCatalogPage(cards, site = {}) {
  const opts = { base: '', firstParty: site.firstParty || [], media: site.media || [] };
  return head({ title: 'WaveX Automations', description: 'Jobs your Claude runs for you: replies, briefs, proposals, plans. Pick one, add WaveX to Claude, and run it.',
    url: SITE_BASE, image: `${SITE_BASE}assets/og.png`, imageAlt: 'WaveX Automations', base: '', page: 'catalog' }) +
    `<main><div class="wrap wide"><section class="intro"><p class="eyebrow">WaveX Automations</p><h1>Jobs your Claude runs for you</h1>` +
    `<p class="summary">Pick a job. Add WaveX to Claude once. Then run it with your own Claude and your own apps.</p>` +
    `<div class="cta"><a class="btn gold" data-wx="add-wavex" href="${esc(WX.installLink())}" target="_blank" rel="noopener">Add WaveX to Claude</a></div>` +
    `<p class="hint">Adding WaveX takes one confirm and one sign-in. Do it on a computer.</p></section>` +
    `<div id="catalog">${WX.renderCatalog(cards, opts)}</div>${NOTE}</div></main>\n` + foot('');
}

function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function png(svgFile, pngFile, skip) {
  if (skip || fs.existsSync(pngFile)) return fs.existsSync(pngFile);
  const r = spawnSync('sips', ['-s', 'format', 'png', svgFile, '--out', pngFile], { stdio: 'ignore' });
  return r.status === 0 && fs.existsSync(pngFile);
}
// The public project address and the public (anon) key the website already ships. Written once; never printed.
function ensureConfig(file) {
  if (fs.existsSync(file)) return;
  const m = /PROD_SUPABASE_PUBLISHABLE_KEY\s*=\s*"([A-Za-z0-9._-]+)"/.exec(fs.readFileSync(WEB_CLIENT, 'utf8'));
  if (!m) throw new Error('config: the public key was not found in the website client file. Fix: write docs/assets/config.js by hand.');
  const role = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8')).role;
  if (role !== 'anon') throw new Error('config: the key in the website client file is not the public (anon) key. Fix: use the anon key only.');
  write(file, `// The public project address and the public (anon) key. The WaveX website ships the same two values.\nwindow.WX_CONFIG = { url: ${JSON.stringify(API_ORIGIN)}, key: ${JSON.stringify(m[1])} };\n`);
}

export function build({ out = HERE, snapshot, portfolio, skipPng = false } = {}) {
  const ownSnap = path.join(HERE, 'assets', 'snapshot.json');
  const snapFile = snapshot || (fs.existsSync(path.join(SEED, 'seed', 'WX_SNAP32.json')) ? path.join(SEED, 'seed', 'WX_SNAP32.json') : ownSnap);
  const coverDir = portfolio || (fs.existsSync(SEED) ? SEED : null);
  const snap = trimSnapshot(JSON.parse(fs.readFileSync(snapFile, 'utf8')));
  const slugs = snap.cards.map((c) => c.slug);
  ensureConfig(path.join(HERE, 'assets', 'config.js'));
  if (path.resolve(out) !== HERE) for (const f of STATIC_ASSETS) write(path.join(out, 'assets', f), fs.readFileSync(path.join(HERE, 'assets', f)));

  const media = slugs.filter((s) => fs.existsSync(path.join(HERE, 'media', `${s}.mp4`)));
  const site = { firstParty: slugs, media };
  let pngs = 0;
  for (const slug of slugs) {
    const dir = path.join(out, 'a', slug);
    const src = coverDir ? path.join(coverDir, slug, 'cover.svg') : path.join(HERE, 'a', slug, 'cover.svg');
    if (!fs.existsSync(src)) throw new Error(`cover: no cover.svg for ${slug}. Fix: add ${src}.`);
    const svg = fs.readFileSync(src, 'utf8');
    if (/<script|\son\w+\s*=|href\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(svg)) throw new Error(`cover: ${slug}/cover.svg holds a script or an outside address. Fix: remove it.`);
    write(path.join(dir, 'cover.svg'), svg);
    if (png(path.join(dir, 'cover.svg'), path.join(dir, 'cover.png'), skipPng)) pngs++;
    write(path.join(dir, 'index.html'), renderListingPage(snap.landing[slug], site));
  }
  png(path.join(out, 'assets', 'og.svg'), path.join(out, 'assets', 'og.png'), skipPng);
  write(path.join(out, 'a', 'index.html'), renderDynamicPage());
  write(path.join(out, 'index.html'), renderCatalogPage(snap.cards, site));
  write(path.join(out, 'assets', 'snapshot.json'), JSON.stringify(snap) + '\n');
  write(path.join(out, 'assets', 'site.js'), `window.WX_SITE = ${JSON.stringify({ first_party: slugs, media })};\n`);
  write(path.join(out, '.nojekyll'), '');
  return { out, pages: slugs.length, slugs, media, pngs, snapshot: snapFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k) => (a.indexOf(k) !== -1 ? a[a.indexOf(k) + 1] : undefined);
  const r = build({ out: arg('--out') ? path.resolve(arg('--out')) : HERE, snapshot: arg('--snapshot'), portfolio: arg('--portfolio'), skipPng: a.includes('--skip-png') });
  console.log(`built ${r.pages} listing pages, the catalog and a/index.html in ${r.out}`);
  console.log(`covers as PNG: ${r.pngs} of ${r.pages}; demo videos found: ${r.media.length} of ${r.pages}; snapshot: ${r.snapshot}`);
}
