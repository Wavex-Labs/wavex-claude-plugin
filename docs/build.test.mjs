// LAND: the public landing pages. Run: node --test docs/build.test.mjs
// It renders pages from the snapshot, checks the link-preview tags and both buttons, the fallback when the public read
// fails, that listing text stays text, and that the folder on disk is what build.mjs makes. It never calls the network
// and never prints the public key.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadWX, renderListingPage, renderCatalogPage, renderDynamicPage, trimSnapshot, SITE_BASE, API_ORIGIN } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WX = loadWX();
const SNAP = JSON.parse(fs.readFileSync(path.join(HERE, 'assets', 'snapshot.json'), 'utf8'));
const SLUGS = SNAP.cards.map((c) => c.slug);
const SITE = { firstParty: SLUGS, media: [] };
const CONNECT = 'https://app.wavexcard.com/mcp/connect';
const TWO = ['landing-page-teardown', 'reply-in-my-voice'];

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#96;/g, '`').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function meta(html, key) {
  const m = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html);
  return m ? unesc(m[1]) : null;
}
function hrefOf(html, wx) {
  const m = new RegExp(`<a [^>]*data-wx="${wx}"[^>]*>`).exec(html);
  assert.ok(m, `no control named ${wx}`);
  return unesc(/href="([^"]*)"/.exec(m[0])[1]);
}
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('two pages render from the snapshot with the title, description and picture tags a link preview reads', () => {
  for (const slug of TWO) {
    const p = SNAP.landing[slug];
    const html = renderListingPage(p, SITE);
    const title = `${p.name} · WaveX Automations`;
    assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], title);
    assert.equal(meta(html, 'description'), WX.cut(p.summary, 200));
    assert.equal(meta(html, 'og:title'), title);
    assert.equal(meta(html, 'og:description'), WX.cut(p.summary, 200));
    assert.equal(meta(html, 'og:type'), 'website');
    assert.equal(meta(html, 'og:url'), `${SITE_BASE}a/${slug}/`);
    assert.equal(meta(html, 'og:image'), `${SITE_BASE}a/${slug}/cover.png`);
    assert.equal(meta(html, 'og:image:width'), '1200');
    assert.equal(meta(html, 'og:image:height'), '630');
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'twitter:image'), `${SITE_BASE}a/${slug}/cover.png`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE_BASE}a/${slug}/">`));
    assert.match(html, /^<!doctype html>\n<html lang="en" data-page="listing"/);
    assert.ok(meta(html, 'description').length >= 40, 'the description says something');
  }
});

test('both buttons are on each page: the install link with the /connect address, and Open in Claude naming the listing', () => {
  for (const slug of TWO) {
    const html = renderListingPage(SNAP.landing[slug], SITE);
    const add = new URL(hrefOf(html, 'add-wavex'));
    assert.equal(add.origin + add.pathname, 'https://claude.ai/customize/connectors');
    assert.deepEqual([...add.searchParams.keys()], ['modal', 'connectorName', 'connectorUrl']);
    assert.equal(add.searchParams.get('modal'), 'add-custom-connector');
    assert.equal(add.searchParams.get('connectorName'), 'wavex');
    assert.equal(add.searchParams.get('connectorUrl'), CONNECT);
    assert.ok(add.href.endsWith('connectorUrl=' + encodeURIComponent(CONNECT)), 'the address is encoded and has no query of its own');
    assert.match(html, />Add WaveX to Claude<\/a>/);

    const open = new URL(hrefOf(html, 'open-in-claude'));
    assert.equal(open.origin + open.pathname, 'https://claude.ai/new');
    assert.deepEqual([...open.searchParams.keys()], ['q']);
    assert.equal(open.searchParams.get('q'), `Open WaveX and show me the automation ${slug}.`);
    assert.match(html, />Open in Claude<\/a>/);
    assert.equal((html.match(/class="btn gold"/g) || []).length, 1, 'one gold button per screen');
  }
});

test('each page has the cover, what it does, the steps with payer badges, the sample output, reviews and the creator', () => {
  for (const slug of TWO) {
    const p = SNAP.landing[slug];
    const html = renderListingPage(p, SITE);
    assert.match(html, new RegExp(`<div class="cover"><img src="../../a/${slug}/cover.svg" alt=""`));
    assert.match(html, new RegExp(`<h1>${WX.esc(p.name)}</h1>`));
    for (const id of ['what', 'steps', 'sample', 'reviews', 'creator']) assert.match(html, new RegExp(`<section class="block" id="${id}">`));
    assert.ok(html.includes(WX.esc(p.description.split('\n')[0])), 'the description is on the page');
    for (const s of p.step_titles) assert.ok(html.includes(`<span class="step-title">${WX.esc(s.title)}</span>`), `step ${s.title}`);
    assert.equal((html.match(/<span class="badge badge-buyer">Your Claude<\/span>/g) || []).length, p.step_titles.length);
    assert.match(html, /<div class="sample md" tabindex="0"><h3>/);
    assert.match(html, /No reviews yet\./);
    assert.match(html, /<p class="creator-name">WaveX <span class="badge badge-wavex">Verified<\/span><\/p>/);
    assert.ok(html.includes(`<li>${p.prices.run} credits a run</li>`));
    assert.ok(html.includes('<li>New</li>'), 'under 5 ratings shows New');
  }
  assert.match(renderListingPage(SNAP.landing['landing-page-teardown'], SITE), /<div class="tablewrap"><table><thead><tr><th>Criterion<\/th>/);
  assert.match(renderListingPage(SNAP.landing['reply-in-my-voice'], SITE), /<span class="chip">Gmail<\/span>/);
});

test('payer badges say who does the step: Your Claude, Creator pays, WaveX pays', () => {
  const p = { ...SNAP.landing[TWO[0]], step_titles: [
    { title: 'One', kind: 'prompt', app: null, paid_by: 'buyer' }, { title: 'Two', kind: 'prompt', app: null, paid_by: 'creator' },
    { title: 'Three', kind: 'prompt', app: null, paid_by: 'wavex' }, { title: 'Four', kind: 'prompt', app: null, paid_by: 'someone-else' }] };
  const html = WX.renderListing(p, {}, null);
  assert.equal((html.match(/badge-buyer">Your Claude</g) || []).length, 2, 'an unknown payer reads as the buyer');
  assert.equal((html.match(/badge-creator">Creator pays</g) || []).length, 1);
  assert.equal((html.match(/badge-wavex">WaveX pays</g) || []).length, 1);
});

test('the video block: the demo file first, then an allowed link, else nothing', () => {
  const slug = TWO[0], p = SNAP.landing[slug];
  const withFile = renderListingPage({ ...p, video_url: 'https://youtu.be/dQw4w9WgXcQ' }, { firstParty: SLUGS, media: [slug] });
  assert.match(withFile, new RegExp(`<video class="video" controls playsinline preload="metadata" poster="../../a/${slug}/cover.svg" src="../../media/${slug}.mp4"></video>`));
  assert.doesNotMatch(withFile, /data-embed=/, 'the file wins over the link');

  const withLink = renderListingPage({ ...p, video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5' }, SITE);
  assert.match(withLink, /data-wx="play-video" data-embed="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.equal(hrefOf(withLink, 'open-video'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5');
  assert.doesNotMatch(withLink, /<iframe|<video/, 'nothing from another site loads before the person presses Play');

  assert.match(renderListingPage(p, SITE), /<section class="block" id="video" hidden><\/section>/);
  assert.equal(WX.videoEmbed('https://youtu.be/dQw4w9WgXcQ').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(WX.videoEmbed('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789');
  assert.equal(WX.videoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef').embed, 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
  assert.equal(WX.videoEmbed('https://vimeo.com/channels/staff').embed, null, 'an allowed host with an unknown shape is a plain link');
  for (const bad of ['http://youtu.be/dQw4w9WgXcQ', 'javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://user@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/x"onmouseover="1', '//youtu.be/dQw4w9WgXcQ', '', null, 'https://tiktok.com/@a/video/1']) {
    assert.equal(WX.videoEmbed(bad), null, `refused: ${bad}`);
    assert.match(renderListingPage({ ...p, video_url: bad }, SITE), /id="video" hidden><\/section>/);
  }
});

test('listing text is data: hostile text stays text and cannot shape a link', () => {
  const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const p = { ...SNAP.landing[TWO[0]], slug: evil, id: evil, name: evil, summary: evil, description: evil + '\n\n' + evil, category: evil, apps: [evil],
    step_titles: [{ title: evil, kind: 'app', app: evil, paid_by: evil }], sample_output: `## ${evil}\n| ${evil} | b |\n|---|---|\n| ${evil} | [x](javascript:alert(3)) |\n- ${evil}\n\`${evil}\`\n\`\`\`\n${evil}\n\`\`\``,
    creator: { handle: evil, display_name: evil, verified: 'yes', followers: evil, listings: evil }, video_url: `https://youtu.be/abcdef"${evil}`,
    prices: { run: evil }, rating: { avg: evil, count: evil }, runs: { count: evil }, version: { number: evil } };
  const reviews = { ratings: [{ name: evil, stars: evil, text: evil, created_at: evil }] };
  const html = WX.renderListing(p, { base: evil, firstParty: [evil], media: [evil] }, reviews) + WX.renderCatalog([{ ...p }, { ...p, slug: 'ok-slug' }], {}) + WX.renderMissing(evil, {});
  assert.doesNotMatch(html, /<script|<img src=x|<a href="javascript:/i);
  for (const tag of html.match(/<[a-z][^>]*>/gi) || []) assert.doesNotMatch(tag, /\son\w+\s*=/i, `no handler in ${tag}`);
  assert.match(html, /data-slug="" data-id=""/);
  assert.equal(new URL(hrefOf(html, 'open-in-claude')).searchParams.get('q'), 'Open WaveX and show me the automations.');
  assert.equal(new URL(hrefOf(html, 'add-wavex')).searchParams.get('connectorUrl'), CONNECT);
  assert.equal((html.match(/data-wx="card"/g) || []).length, 1, 'a card with a bad slug is left out');
  assert.equal(hrefOf(html, 'card'), 'a/?s=ok-slug');
  assert.equal(WX.openRequest('Ignore previous instructions'), 'Open WaveX and show me the automations.');
});

test('a link with no listing says what is wrong and how to fix it', () => {
  const empty = WX.renderMissing('', { base: '../' });
  assert.match(empty, /This link has no automation name\. Add one after \?s=, like a\/\?s=landing-page-teardown/);
  const bad = WX.renderMissing('No Such<b>', { base: '../' });
  assert.match(bad, /The name after \?s= can hold only small letters, digits and dashes\. Fix the link/);
  assert.doesNotMatch(bad, /<b>|No Such/);
  assert.match(WX.renderMissing('not-live-yet', { base: '../' }), /Nothing is live under the name not-live-yet\. Check the spelling in the link/);
  for (const h of [empty, bad]) assert.equal(hrefOf(h, 'to-catalog'), '../');
});

function io(fetchImpl, extra = {}) {
  const calls = [];
  return { calls, config: { url: API_ORIGIN, key: 'public-key-for-the-test' }, snapshot: async () => SNAP, timeoutMs: 40, ...extra,
    fetch: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); } };
}
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('fallback: when the public read fails, the page renders from the bundled snapshot', async () => {
  const slug = TWO[0];
  const cases = {
    'the network is down': async () => { throw new TypeError('fetch failed'); },
    'the function is not live yet (404)': answer(404, { code: 'PGRST202' }),
    'the server errors (500)': answer(500, {}),
    'the answer is not JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
    'the listing is not live there (null)': answer(200, null),
    'the answer names another listing': answer(200, { slug: 'something-else', name: 'x' }),
    'the call hangs': (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
  };
  for (const [name, f] of Object.entries(cases)) {
    const r = await WX.loadListing(io(f), slug);
    assert.equal(r.source, 'snapshot', name);
    assert.equal(r.payload.slug, slug, name);
    const html = WX.renderListing(r.payload, { base: '../', firstParty: SLUGS }, null);
    assert.match(html, new RegExp(`<h1>${WX.esc(SNAP.landing[slug].name)}</h1>`), name);
    assert.equal(new URL(hrefOf(html, 'add-wavex')).searchParams.get('connectorUrl'), CONNECT, name);
  }
  const unknown = await WX.loadListing(io(answer(404, {})), 'not-a-real-listing');
  assert.deepEqual({ ...unknown }, { payload: null, source: 'none' });
  const bad = io(answer(200, {}));
  assert.deepEqual({ ...(await WX.loadListing(bad, '../etc')) }, { payload: null, source: 'none' });
  assert.equal(bad.calls.length, 0, 'a bad slug is never sent');
  const noSnap = await WX.loadListing(io(answer(500, {}), { snapshot: async () => { throw new Error('gone'); } }), slug);
  assert.equal(noSnap.source, 'none');
  const noKey = await WX.loadListing(io(answer(200, { slug }), { config: {} }), slug);
  assert.equal(noKey.source, 'snapshot', 'with no key the page still shows the saved copy');
});

test('live: the read goes to the public function with the public key, and its answer wins over the snapshot', async () => {
  const slug = TWO[1];
  const live = { ...SNAP.landing[slug], name: 'Reply In My Voice (live)', rating: { avg: 4.8, count: 12, stars: {} }, runs: { count: 40, success_rate: 0.98 } };
  const o = io(answer(200, live));
  const r = await WX.loadListing(o, slug);
  assert.equal(r.source, 'live');
  assert.equal(o.calls.length, 1);
  assert.equal(o.calls[0].url, `${API_ORIGIN}/rest/v1/rpc/mkt_listing_public`);
  assert.equal(o.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(o.calls[0].init.body), { p_ref: slug });
  assert.equal(o.calls[0].init.headers.apikey, 'public-key-for-the-test');
  assert.equal(o.calls[0].init.credentials, 'omit');
  const html = WX.renderListing(r.payload, { base: '../', firstParty: SLUGS }, null);
  assert.match(html, /<h1>Reply In My Voice \(live\)<\/h1>/);
  assert.match(html, /<li>4\.8 out of 5 · 12 ratings<\/li><li>40 runs<\/li>/);

  const cat = io(answer(200, { items: [{ slug: 'a-member-listing', name: 'A member listing', summary: 'S', prices: { run: 0, free: true }, apps: [] }], next: null }));
  const c = await WX.loadCatalog(cat);
  assert.equal(c.source, 'live');
  assert.deepEqual(JSON.parse(cat.calls[0].init.body), { p_sort: 'new', p_limit: 50 });
  const grid = WX.renderCatalog(c.cards, { base: '', firstParty: SLUGS });
  assert.equal(hrefOf(grid, 'card'), 'a/?s=a-member-listing');
  assert.match(grid, /class="card-cover tile"/, 'a listing with no first-party cover gets a drawn tile');
  assert.match(grid, /Free · New · No other app needed/);
  const down = await WX.loadCatalog(io(async () => { throw new Error('down'); }));
  assert.equal(down.source, 'snapshot');
  assert.equal(down.cards.length, SLUGS.length);

  const rv = io(answer(200, { average: 4.5, count: 2, ratings: [{ name: 'D.', stars: 5, text: 'Saved me an hour.', created_at: '2026-11-18T10:00:00+00' }] }));
  const reviews = await WX.loadReviews(rv, live.id);
  assert.deepEqual(JSON.parse(rv.calls[0].init.body), { p_automation: live.id, p_limit: 10 });
  assert.match(WX.reviewsHtml(reviews), /aria-label="5 out of 5 stars">★★★★★<\/span> <span class="review-name">D\.<\/span> <span class="muted">2026-11-18<\/span>/);
  assert.equal(await WX.loadReviews(rv, 'not-an-id'), null);
  assert.equal(rv.calls.length, 1, 'a bad id is never sent');
  assert.equal(await WX.loadReviews(io(answer(500, {})), live.id), null);
});

test('the catalog lists every first-party listing, links each to its own page, and has the install button', () => {
  const html = renderCatalogPage(SNAP.cards, SITE);
  assert.equal(SLUGS.length, 13);
  const hrefs = [...html.matchAll(/<a href="([^"]+)" data-wx="card">/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, SLUGS.map((s) => `a/${s}/`));
  for (const c of SNAP.cards) assert.ok(html.includes(`<span class="card-name">${WX.esc(c.name)}</span>`));
  assert.equal(new URL(hrefOf(html, 'add-wavex')).searchParams.get('connectorUrl'), CONNECT);
  assert.equal(meta(html, 'og:image'), `${SITE_BASE}assets/og.png`);
  assert.equal(meta(html, 'og:url'), SITE_BASE);
  const dyn = renderDynamicPage();
  assert.match(dyn, /data-page="dynamic" data-base="..\/"/);
  assert.match(dyn, /<noscript>/);
  assert.equal(meta(dyn, 'og:image'), `${SITE_BASE}assets/og.png`);
});

test('the folder on disk is exactly what build.mjs makes from its own snapshot and covers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-land-')); made.push(tmp);
  const r = build({ out: tmp, snapshot: path.join(HERE, 'assets', 'snapshot.json'), portfolio: path.join(HERE, 'a'), skipPng: true });
  assert.equal(r.pages, 13);
  const text = files(tmp).map((f) => path.relative(tmp, f)).filter((f) => /\.(html|js|json|svg|css)$/.test(f)).sort();
  assert.equal(text.filter((f) => /^a\/[^/]+\/index\.html$/.test(f)).length, 13);
  for (const f of text) assert.equal(fs.readFileSync(path.join(HERE, f), 'utf8'), fs.readFileSync(path.join(tmp, f), 'utf8'), `${f} is stale: run node docs/build.mjs`);
  const mine = files(HERE).map((f) => path.relative(HERE, f)).filter((f) => /\.(html|js|json|svg|css)$/.test(f) && !/^media\//.test(f)).sort();
  assert.deepEqual(mine, text, 'no stray page or script in docs/');
  for (const slug of SLUGS) {
    for (const f of ['index.html', 'cover.svg', 'cover.png']) assert.ok(fs.existsSync(path.join(HERE, 'a', slug, f)), `${slug}/${f}`);
    assert.equal(fs.readFileSync(path.join(HERE, 'a', slug, 'cover.png')).subarray(1, 4).toString('latin1'), 'PNG');
    assert.equal(fs.readFileSync(path.join(HERE, 'a', slug, 'index.html'), 'utf8'), renderListingPage(SNAP.landing[slug], { firstParty: SLUGS, media: r.media }));
  }
  assert.equal(fs.readFileSync(path.join(HERE, 'assets', 'og.png')).subarray(1, 4).toString('latin1'), 'PNG');
  assert.ok(fs.existsSync(path.join(HERE, '.nojekyll')));
});

test('no outside script, style, font or tracker; no inline script or style; every page carries the content rule', () => {
  const all = files(HERE).filter((f) => /\.(html|js|css|svg)$/.test(f) && !/build(\.test)?\.mjs$/.test(f));
  const pages = all.filter((f) => f.endsWith('.html'));
  assert.equal(pages.length, 15);
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8'), name = path.relative(HERE, f);
    const csp = meta(html, 'Content-Security-Policy') || unesc((/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html) || [])[1] || '');
    assert.match(csp, /default-src 'none'; script-src 'self'; style-src 'self';/, name);
    assert.ok(csp.includes(`connect-src 'self' ${API_ORIGIN};`), name);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(m[1], /^ src="(?:\.\.\/){0,2}assets\/(?:config|site|wx|app)\.js"$/, `${name}: only our own scripts`);
      assert.equal(m[2], '', `${name}: no inline script`);
    }
    assert.equal((html.match(/<script\b/g) || []).length, 4, name);
    for (const m of html.matchAll(/<link\b[^>]*>/g)) assert.match(m[0], /rel="canonical"|href="(?:\.\.\/){0,2}assets\/(?:wx\.css|icon\.svg)"/, name);
    assert.doesNotMatch(html, /<style\b|\sstyle=|<iframe|<object|<embed|<form|<base\b/i, name);
    for (const tag of html.match(/<[a-z][^>]*>/gi) || []) assert.doesNotMatch(tag, /\son[a-z]+\s*=/i, `${name}: ${tag}`);
    for (const m of html.matchAll(/\s(?:src|poster)="([^"]*)"/g)) assert.doesNotMatch(m[1], /^(?:[a-z]+:)?\/\//i, `${name}: ${m[1]} loads from our own site`);
    const outside = [...html.matchAll(/href="(https?:[^"]*)"/g)].map((m) => new URL(unesc(m[1])).origin);
    for (const o of outside) assert.ok(['https://claude.ai', new URL(SITE_BASE).origin].includes(o), `${name}: link to ${o}`);
  }
  const css = fs.readFileSync(path.join(HERE, 'assets', 'wx.css'), 'utf8');
  assert.doesNotMatch(css, /@import|@font-face|url\(/i, 'system fonts only, nothing fetched by the style sheet');
  assert.match(css, /prefers-color-scheme: dark/);
  for (const f of all) {
    const t = fs.readFileSync(f, 'utf8'), name = path.relative(HERE, f);
    assert.doesNotMatch(t, /googletagmanager|google-analytics|gtag\(|fonts\.googleapis|fonts\.gstatic|plausible|segment\.com|facebook\.net|hotjar|mixpanel|amplitude|doubleclick|cdn\.jsdelivr|unpkg\.com|cdnjs/i, name);
    assert.doesNotMatch(t, /document\.cookie|localStorage|sessionStorage|sendBeacon|navigator\.userAgent/, `${name}: nothing is stored or reported`);
    if (f.endsWith('.svg')) assert.doesNotMatch(t, /<script|href=|<image|<foreignObject/i, `${name}: a cover is shapes and text only`);
  }
});

test('the key on the page is the public one, and the snapshot holds no prompt, cost or user id', () => {
  const cfg = fs.readFileSync(path.join(HERE, 'assets', 'config.js'), 'utf8');
  const key = /key: "([A-Za-z0-9._-]+)"/.exec(cfg);
  assert.ok(key, 'config.js holds a key');
  const claims = JSON.parse(Buffer.from(key[1].split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.role, 'anon', 'the key is the public (anon) key');
  assert.ok(cfg.includes(`url: "${API_ORIGIN}"`));
  for (const f of files(HERE)) {
    if (/\.(png|mp4)$/.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8'), name = path.relative(HERE, f);
    if (!/build\.test\.mjs$/.test(f)) assert.doesNotMatch(t, /service_role|sk_live_|sk_test_|sb_secret_/, name);
    if (name !== path.join('assets', 'config.js')) assert.ok(!t.includes(key[1]), `${name} does not repeat the key`);
    for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) assert.equal(m[0], key[1], `${name}: only the public key`);
  }
  const banned = new Set(['prompt', 'definition', 'creator_id', 'user_id', 'compute_credits', 'compute_cost']);
  (function scan(o, where) {
    if (Array.isArray(o)) o.forEach((v, i) => scan(v, `${where}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.ok(!banned.has(k), `${where}.${k}`); scan(v, `${where}.${k}`); }
  })(SNAP, 'snapshot');
  assert.deepEqual(Object.keys(SNAP), ['note', 'count', 'cards', 'landing']);
  assert.deepEqual(trimSnapshot({ cards: [...SNAP.cards, { slug: 'Bad Slug' }, { slug: 'no-landing' }], landing: SNAP.landing, covers: { x: 'data:' } }), SNAP);
});
