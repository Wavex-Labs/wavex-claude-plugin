// WaveX public landing pages: the browser side. It reads live data with the public key and keeps the page that was
// built from the snapshot when the call fails. It loads nothing from another site until the person presses Play.
(function () {
  'use strict';
  var WX = window.WX, doc = document, html = doc.documentElement;
  if (!WX) return;
  var page = html.getAttribute('data-page');
  var base = html.getAttribute('data-base') || '';
  var site = window.WX_SITE || {};
  var opts = { base: base, firstParty: site.first_party || [], media: site.media || [] };
  var app = doc.getElementById('app');
  var note = doc.getElementById('note');
  var EMBEDS = ['https://www.youtube-nocookie.com/embed/', 'https://player.vimeo.com/video/', 'https://www.loom.com/embed/'];

  function snapshot() {
    return window.fetch(base + 'assets/snapshot.json', { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('no_snapshot');
      return r.json();
    });
  }
  function io(withSnapshot) {
    return { fetch: window.fetch ? window.fetch.bind(window) : null, config: window.WX_CONFIG || {}, snapshot: withSnapshot ? snapshot : null };
  }
  function say(text) { if (note) { note.textContent = text; note.hidden = !text; } }
  function setMeta(name, value) { var m = doc.querySelector('meta[name="' + name + '"]'); if (m) m.setAttribute('content', value); }

  function fillReviews(id) {
    WX.loadReviews(io(false), id).then(function (r) {
      var slot = doc.querySelector('[data-wx-slot="reviews"]');
      if (slot && r && Array.isArray(r.ratings) && r.ratings.length) slot.innerHTML = WX.reviewsHtml(r);
    });
  }
  // A demo file added after the last build still shows: ask our own site whether media/<slug>.mp4 is there.
  function findDemo(slug) {
    var block = doc.getElementById('video');
    if (!block || doc.querySelector('video.video') || !WX.validSlug(slug) || !window.fetch) return;
    var src = base + 'media/' + slug + '.mp4';
    window.fetch(src, { method: 'HEAD', credentials: 'omit' }).then(function (r) {
      if (!r.ok || !/^video\//.test(r.headers.get('content-type') || '')) return;
      var v = doc.createElement('video');
      v.className = 'video'; v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.src = src;
      var h = doc.createElement('h2'); h.textContent = 'Watch it run';
      block.textContent = ''; block.appendChild(h); block.appendChild(v); block.hidden = false;
    }).catch(function () {});
  }
  function show(payload, source) {
    app.innerHTML = WX.renderListing(payload, opts, null);
    doc.title = WX.cut(payload.name, 70) + ' · WaveX Automations';
    setMeta('description', WX.cut(payload.summary, 200));
    say(source === 'snapshot' ? 'WaveX did not answer just now. This is a saved copy. Prices and reviews may be newer inside WaveX.' : '');
    if (source === 'live') fillReviews(payload.id);
    findDemo(payload.slug);
  }

  doc.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-wx="play-video"]') : null;
    if (!b) return;
    var src = b.getAttribute('data-embed') || '';
    if (!EMBEDS.some(function (p) { return src.indexOf(p) === 0; })) return;
    var f = doc.createElement('iframe');
    f.className = 'video'; f.src = src; f.title = 'Video';
    f.setAttribute('allow', 'fullscreen; picture-in-picture'); f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'no-referrer'); f.setAttribute('loading', 'lazy');
    b.parentNode.parentNode.insertBefore(f, b.parentNode);
    b.remove();
  });

  if (page === 'listing') {
    // Built from the snapshot already. Swap in the live answer when there is one; otherwise keep what is on the page.
    var slug = html.getAttribute('data-slug') || '';
    WX.loadListing(io(false), slug).then(function (r) {
      if (r.source === 'live') show(r.payload, 'live'); else findDemo(slug);
    });
  } else if (page === 'dynamic') {
    var s = '';
    try { s = (new URLSearchParams(window.location.search).get('s') || '').trim().toLowerCase(); } catch (e) { s = ''; }
    WX.loadListing(io(true), s).then(function (r) {
      if (r.payload) show(r.payload, r.source);
      else { app.innerHTML = WX.renderMissing(s, opts); doc.title = 'Not listed · WaveX Automations'; }
    });
  } else if (page === 'catalog') {
    var grid = doc.getElementById('catalog');
    WX.loadCatalog(io(false)).then(function (r) {
      if (grid && r.source === 'live') grid.innerHTML = WX.renderCatalog(r.cards, opts);
    });
  }
})();
