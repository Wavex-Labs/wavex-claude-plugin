// WaveX public landing pages: the shared render code.
// One file, no dependency. The browser loads it as a plain script (window.WX); docs/build.mjs and the test load the same
// file in Node. Every value from a listing is data: it is escaped before it reaches the page, and a link is built only
// from a checked slug or a checked video address.
(function (root) {
  'use strict';

  var CONNECT_URL = 'https://ngvtgraldybxdbgkihfj.supabase.co/functions/v1/agent-mcp/connect';
  var INSTALL_LINK = 'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=wavex&connectorUrl=' +
    encodeURIComponent(CONNECT_URL);
  var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var PAYER = { buyer: 'Your Claude', creator: 'Creator pays', wavex: 'WaveX pays' };
  var APPS = { gmail: 'Gmail', gmail_read: 'Gmail (read)', google_calendar: 'Google Calendar', google_drive: 'Google Drive', canva: 'Canva' };
  var CATEGORIES = { email: 'Email', content: 'Content', ops: 'Operations', sales: 'Sales', finance: 'Finance', calendar: 'Calendar', research: 'Research' };

  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function esc(v) {
    return str(v).replace(/[&<>"'`]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
    });
  }
  function validSlug(s) { return typeof s === 'string' && SLUG_RE.test(s); }
  function num(v) { var n = Number(v); return isFinite(n) && v !== null && v !== '' ? n : null; }
  function label(map, key) { var k = str(key); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : k.replace(/_/g, ' '); }
  function cut(text, max) {
    var t = str(text).replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  }

  // The two buttons. The request in "Open in Claude" carries the slug only (letters, digits and dashes), never the
  // listing's name or text, so a listing cannot put words in the person's first message.
  function installLink() { return INSTALL_LINK; }
  function openRequest(slug) { return validSlug(slug) ? 'Open WaveX and show me the automation ' + slug + '.' : 'Open WaveX and show me the automations.'; }
  function openLink(slug) { return 'https://claude.ai/new?q=' + encodeURIComponent(openRequest(slug)); }

  // A creator's video link: https only, four hosts only. Answers {embed, link} or null.
  function videoEmbed(url) {
    var m = /^https:\/\/([a-z0-9.-]+)(\/[^\s"'<>\\]*)?$/i.exec(str(url).trim());
    if (!m) return null;
    var host = m[1].toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    var rest = m[2] || '/';
    var path = rest.split(/[?#]/)[0];
    var link = 'https://' + m[1].toLowerCase() + rest;
    var id;
    if (host === 'youtu.be') {
      id = /^\/([A-Za-z0-9_-]{6,20})$/.exec(path);
      return { link: link, embed: id ? 'https://www.youtube-nocookie.com/embed/' + id[1] : null };
    }
    if (host === 'youtube.com') {
      id = /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,20})$/.exec(path) || (path === '/watch' ? /[?&]v=([A-Za-z0-9_-]{6,20})(?:[&#]|$)/.exec(rest) : null);
      return { link: link, embed: id ? 'https://www.youtube-nocookie.com/embed/' + id[1] : null };
    }
    if (host === 'vimeo.com') {
      id = /^\/(\d{4,12})$/.exec(path);
      return { link: link, embed: id ? 'https://player.vimeo.com/video/' + id[1] : null };
    }
    if (host === 'loom.com') {
      id = /^\/(?:share|embed)\/([a-f0-9]{16,64})$/.exec(path);
      return { link: link, embed: id ? 'https://www.loom.com/embed/' + id[1] : null };
    }
    return null;
  }

  // A small, safe reader for the sample output: headings, lists, tables, quotes, code. Text is escaped first.
  function inline(s) {
    return esc(s)
      .replace(/&#96;((?:(?!&#96;).)+?)&#96;/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  }
  function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }
  function md(text) {
    var lines = str(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], i = 0, m;
    function flush() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        flush(); var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flush(); var h = m[1].length <= 2 ? 'h3' : 'h4';
        out.push('<' + h + '>' + inline(m[2].replace(/\s+#+\s*$/, '')) + '</' + h + '>'); i++; continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        var head = cells(line), rows = []; i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<div class="tablewrap"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>');
        continue;
      }
      var ul = /^\s*[-*]\s+(.*)$/, ol = /^\s*\d+[.)]\s+(.*)$/;
      if (ul.test(line) || ol.test(line)) {
        flush(); var re = ul.test(line) ? ul : ol, tag = re === ul ? 'ul' : 'ol', items = [];
        while (i < lines.length && (m = re.exec(lines[i]))) {
          items.push('<li>' + inline(m[1].replace(/^\[ \]\s*/, '☐ ').replace(/^\[[xX]\]\s*/, '☑ ')) + '</li>'); i++;
        }
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>'); continue;
      }
      if (/^>\s?/.test(line)) {
        flush(); var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + q.map(inline).join('<br>') + '</blockquote>'); continue;
      }
      para.push(line); i++;
    }
    flush();
    return out.join('\n');
  }
  function paragraphs(text) {
    return str(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('\n');
  }

  function priceLine(prices) {
    var p = prices || {}, run = num(p.run);
    if (p.free === true || run === 0) return 'Free';
    return run === null ? '' : run + (run === 1 ? ' credit a run' : ' credits a run');
  }
  function ratingLine(avg, count) {
    var a = num(avg), c = num(count) || 0;
    if (c < 5 || a === null) return 'New';
    return a.toFixed(1) + ' out of 5 · ' + c + ' ratings';
  }
  function runsLine(count) { var c = num(count) || 0; return c > 0 ? c + (c === 1 ? ' run' : ' runs') : ''; }
  function appsLine(apps) {
    var list = Array.isArray(apps) ? apps.map(function (a) { return label(APPS, a).replace(' (read)', ''); }) : [];
    list = list.filter(function (a, i) { return a && list.indexOf(a) === i; });
    return list.length ? 'Works with ' + list.join(', ') : 'No other app needed';
  }
  function starsText(n) { var s = Math.max(0, Math.min(5, Math.round(num(n) || 0))); return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s); }

  // opts: {base: path from this page to the docs root, firstParty: [slug], media: [slug], covers: {slug: file}}.
  function coverHtml(slug, name, opts, cls) {
    var o = opts || {}, base = o.base || '';
    if (validSlug(slug) && (o.firstParty || []).indexOf(slug) !== -1) {
      return '<div class="' + cls + '"><img src="' + esc(base + 'a/' + slug + '/cover.svg') + '" alt="" width="1200" height="630"' + (cls === 'cover' ? '' : ' loading="lazy"') + ' decoding="async"></div>';
    }
    return '<div class="' + cls + ' tile" aria-hidden="true"><span class="tile-bar"></span><span class="tile-name">' + esc(cut(name, 60)) + '</span></div>';
  }

  function videoHtml(p, opts) {
    var o = opts || {}, base = o.base || '', slug = p.slug;
    if (validSlug(slug) && (o.media || []).indexOf(slug) !== -1) {
      var poster = (o.firstParty || []).indexOf(slug) !== -1 ? ' poster="' + esc(base + 'a/' + slug + '/cover.svg') + '"' : '';
      return '<section class="block" id="video"><h2>Watch it run</h2><video class="video" controls playsinline preload="metadata"' + poster +
        ' src="' + esc(base + 'media/' + slug + '.mp4') + '"></video></section>';
    }
    var v = videoEmbed(p.video_url);
    if (!v) return '<section class="block" id="video" hidden></section>';
    return '<section class="block" id="video"><h2>Watch the video</h2><div class="video-link">' +
      (v.embed ? '<button type="button" class="btn line" data-wx="play-video" data-embed="' + esc(v.embed) + '">Play the video here</button> ' : '') +
      '<a class="btn line" data-wx="open-video" href="' + esc(v.link) + '" target="_blank" rel="noopener noreferrer">Open the video in a new tab</a></div></section>';
  }

  function stepsHtml(steps) {
    var list = Array.isArray(steps) ? steps : [];
    if (!list.length) return '<p class="muted">The steps are not listed yet.</p>';
    return '<ol class="steps">' + list.map(function (s) {
      var by = Object.prototype.hasOwnProperty.call(PAYER, str(s && s.paid_by)) ? str(s.paid_by) : 'buyer';
      var app = s && s.app ? '<span class="chip">' + esc(label(APPS, s.app)) + '</span>' : '';
      return '<li><span class="step-title">' + esc(s && s.title) + '</span><span class="step-tags">' + app +
        '<span class="badge badge-' + by + '">' + PAYER[by] + '</span></span></li>';
    }).join('') + '</ol>';
  }

  // reviews: what mkt_list_ratings answers ({average, count, ratings: [{name, stars, text, created_at}]}), or null.
  function reviewsHtml(reviews) {
    var list = reviews && Array.isArray(reviews.ratings) ? reviews.ratings : [];
    if (!list.length) return '<p class="muted">No reviews yet. Run it and be the first to rate it.</p>';
    return '<ul class="reviews">' + list.slice(0, 20).map(function (r) {
      var day = /^(\d{4}-\d{2}-\d{2})/.exec(str(r && r.created_at));
      return '<li><p class="review-head"><span class="stars" role="img" aria-label="' + (Math.round(num(r && r.stars) || 0)) + ' out of 5 stars">' +
        starsText(r && r.stars) + '</span> <span class="review-name">' + esc(cut(r && r.name, 40) || 'A member') + '</span>' +
        (day ? ' <span class="muted">' + day[1] + '</span>' : '') + '</p>' +
        (r && r.text ? '<p class="review-text">' + esc(cut(r.text, 600)) + '</p>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function creatorHtml(c) {
    var cr = c || {}, name = cut(cr.display_name, 60) || 'A member', n = num(cr.listings) || 0, f = num(cr.followers) || 0;
    var facts = [];
    if (cr.handle) facts.push('@' + esc(cr.handle));
    if (n > 0) facts.push(n + (n === 1 ? ' listing' : ' listings'));
    if (f > 0) facts.push(f + (f === 1 ? ' follower' : ' followers'));
    return '<div class="creator"><span class="avatar" aria-hidden="true">' + esc(name.slice(0, 1).toUpperCase()) + '</span><div><p class="creator-name">' + esc(name) +
      (cr.verified === true ? ' <span class="badge badge-wavex">Verified</span>' : '') + '</p><p class="muted">' + facts.join(' · ') + '</p></div></div>';
  }

  function ctaHtml(slug) {
    return '<div class="cta"><a class="btn gold" data-wx="add-wavex" href="' + esc(installLink()) + '" target="_blank" rel="noopener">Add WaveX to Claude</a>' +
      '<a class="btn line" data-wx="open-in-claude" href="' + esc(openLink(slug)) + '" target="_blank" rel="noopener">Open in Claude</a></div>' +
      '<p class="hint">First time? Add WaveX on a computer. It takes one confirm and one sign-in. Then choose Open in Claude.</p>';
  }

  // One listing: the whole <article>. p is the landing payload (spec appendix B). source is "live" or "snapshot".
  function renderListing(p, opts, reviews) {
    var o = opts || {};
    var rating = p.rating || {}, runs = p.runs || {}, version = p.version || {}, creator = p.creator || {};
    var facts = [priceLine(p.prices), ratingLine(rating.avg, rating.count), runsLine(runs.count), appsLine(p.apps)].filter(Boolean);
    var eyebrow = [label(CATEGORIES, p.category), 'by ' + (cut(creator.display_name, 60) || 'A member')].filter(Boolean).join(' · ');
    var vline = [num(version.number) !== null ? 'Version ' + num(version.number) : '', p.reviewed_at ? 'Checked by WaveX' : ''].filter(Boolean).join(' · ');
    return '<article class="listing" data-slug="' + esc(validSlug(p.slug) ? p.slug : '') + '" data-id="' + esc(UUID_RE.test(str(p.id)) ? p.id : '') + '">' +
      coverHtml(p.slug, p.name, o, 'cover') +
      '<header class="hero"><p class="eyebrow">' + esc(eyebrow) + '</p><h1>' + esc(p.name) + '</h1><p class="summary">' + esc(p.summary) + '</p>' +
      '<ul class="facts">' + facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' + ctaHtml(p.slug) + '</header>' +
      videoHtml(p, o) +
      '<section class="block" id="what"><h2>What it does</h2>' + (paragraphs(p.description) || '<p>' + esc(p.summary) + '</p>') + '</section>' +
      '<section class="block" id="steps"><h2>Steps</h2>' + stepsHtml(p.step_titles) + (vline ? '<p class="muted">' + esc(vline) + '</p>' : '') + '</section>' +
      (p.sample_output ? '<section class="block" id="sample"><h2>Sample output</h2><div class="sample md" tabindex="0">' + md(p.sample_output) + '</div></section>' : '') +
      '<section class="block" id="reviews"><h2>Reviews</h2><div data-wx-slot="reviews">' + reviewsHtml(reviews) + '</div></section>' +
      '<section class="block" id="creator"><h2>Creator</h2>' + creatorHtml(creator) + '</section>' +
      '</article>';
  }

  function listingHref(slug, opts) {
    var o = opts || {}, base = o.base || '';
    return (o.firstParty || []).indexOf(slug) !== -1 ? base + 'a/' + slug + '/' : base + 'a/?s=' + encodeURIComponent(slug);
  }
  function renderCard(c, opts) {
    if (!c || !validSlug(c.slug)) return '';
    var facts = [priceLine(c.prices), ratingLine(c.rating_avg, c.rating_count), appsLine(c.apps)].filter(Boolean);
    return '<li class="card"><a href="' + esc(listingHref(c.slug, opts)) + '" data-wx="card">' + coverHtml(c.slug, c.name, opts, 'card-cover') +
      '<span class="card-body"><span class="card-name">' + esc(c.name) + '</span><span class="card-summary">' + esc(cut(c.summary, 150)) + '</span>' +
      '<span class="card-facts">' + esc(facts.join(' · ')) + '</span></span></a></li>';
  }
  function renderCatalog(cards, opts) {
    var list = (Array.isArray(cards) ? cards : []).map(function (c) { return renderCard(c, opts); }).filter(Boolean);
    if (!list.length) return '<p class="muted">No automations are listed yet. Check back soon.</p>';
    return '<ul class="grid">' + list.join('') + '</ul>';
  }
  function renderMissing(slug, opts) {
    var base = (opts && opts.base) || '';
    var why = validSlug(slug) ? 'Nothing is live under the name ' + esc(slug) + '. Check the spelling in the link, or pick one from the catalog.'
      : !str(slug) ? 'This link has no automation name. Add one after ?s=, like a/?s=landing-page-teardown, or pick one from the catalog.'
        : 'The name after ?s= can hold only small letters, digits and dashes. Fix the link, or pick one from the catalog.';
    return '<article class="listing"><header class="hero"><h1>This automation is not listed</h1><p class="summary">' + why + '</p><div class="cta"><a class="btn gold" data-wx="to-catalog" href="' + esc(base || './') + '">See all automations</a></div></header></article>';
  }

  // The read. Asks the public read function first; when the call fails, or WaveX has no answer, it uses the bundled
  // snapshot. io: {fetch, config: {url, key}, snapshot: async () => snapshot, timeoutMs}.
  function rpc(io, name, args) {
    var cfg = io.config || {};
    if (!cfg.url || !cfg.key || typeof io.fetch !== 'function') return Promise.reject(new Error('no_config'));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, io.timeoutMs || 6000) : null;
    return io.fetch(cfg.url + '/rest/v1/rpc/' + name, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(args || {})
    }).then(function (res) {
      if (!res || !res.ok) throw new Error('http_' + (res ? res.status : 0));
      return res.json();
    }).then(function (v) { if (timer) clearTimeout(timer); return v; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function fromSnapshot(io) { return typeof io.snapshot === 'function' ? Promise.resolve().then(io.snapshot).catch(function () { return null; }) : Promise.resolve(null); }
  function loadListing(io, slug) {
    if (!validSlug(slug)) return Promise.resolve({ payload: null, source: 'none' });
    function fallback() {
      return fromSnapshot(io).then(function (s) {
        var p = s && s.landing && Object.prototype.hasOwnProperty.call(s.landing, slug) ? s.landing[slug] : null;
        return { payload: p, source: p ? 'snapshot' : 'none' };
      });
    }
    return rpc(io, 'mkt_listing_public', { p_ref: slug }).then(function (p) {
      return p && typeof p === 'object' && p.slug === slug ? { payload: p, source: 'live' } : fallback();
    }, fallback);
  }
  function loadCatalog(io) {
    function fallback() {
      return fromSnapshot(io).then(function (s) { return { cards: s && Array.isArray(s.cards) ? s.cards : [], source: s ? 'snapshot' : 'none' }; });
    }
    return rpc(io, 'mkt_list_public', { p_sort: 'new', p_limit: 50 }).then(function (r) {
      return r && Array.isArray(r.items) && r.items.length ? { cards: r.items, source: 'live' } : fallback();
    }, fallback);
  }
  function loadReviews(io, id) {
    if (!UUID_RE.test(str(id))) return Promise.resolve(null);
    return rpc(io, 'mkt_list_ratings', { p_automation: id, p_limit: 10 }).then(function (r) { return r && typeof r === 'object' ? r : null; }, function () { return null; });
  }

  var WX = {
    CONNECT_URL: CONNECT_URL, esc: esc, cut: cut, md: md, validSlug: validSlug, installLink: installLink, openRequest: openRequest, openLink: openLink,
    videoEmbed: videoEmbed, priceLine: priceLine, ratingLine: ratingLine, appsLine: appsLine, renderListing: renderListing, reviewsHtml: reviewsHtml,
    renderCard: renderCard, renderCatalog: renderCatalog, renderMissing: renderMissing, listingHref: listingHref,
    loadListing: loadListing, loadCatalog: loadCatalog, loadReviews: loadReviews
  };
  root.WX = WX;
})(typeof window !== 'undefined' ? window : globalThis);
