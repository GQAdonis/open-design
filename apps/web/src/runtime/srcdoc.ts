/**
 * Wrap an artifact's HTML for a sandboxed iframe. Corresponds to
 * buildSrcdoc in packages/runtime/src/index.ts — the reference version also
 * injects an edit-mode overlay and tweak bridge, which this starter omits.
 *
 * If the model returned a full document, pass it through unchanged; otherwise
 * wrap the fragment in a minimal doctype shell.
 *
 * When `options.deck` is set we also inject a `postMessage` listener that
 * lets the host advance / rewind slides without relying on the iframe
 * having keyboard focus. The host posts:
 *   { type: 'od:slide', action: 'next' | 'prev' | 'first' | 'last' | 'go', index?: number }
 * and the iframe responds with:
 *   { type: 'od:slide-state', active: number, count: number }
 * after every navigation so the host can render its own counter / dots.
 */
import {
  buildManualEditBridge,
  buildManualEditBridgeStyle,
  MANUAL_EDIT_DISCOVERY_SELECTOR,
  MANUAL_EDIT_SOURCE_PATH_ATTR,
} from '../edit-mode/bridge';

export type SrcdocOptions = {
  deck?: boolean;
  baseHref?: string;
  initialSlideIndex?: number;
  commentBridge?: boolean;
  inspectBridge?: boolean;
  selectionBridge?: boolean;
  editBridge?: boolean;
  paletteBridge?: boolean;
  initialPalette?: string | null;
  annotateBridge?: boolean;
};

export function buildSrcdoc(
  html: string,
  options: SrcdocOptions = {}
): string {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  const isFullDoc = head.startsWith("<!doctype") || head.startsWith("<html");
  const wrapped = isFullDoc
    ? html
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;
  const withOdIds = annotateMissingOdIds(wrapped);
  const withSourcePaths = options.editBridge ? annotateManualEditSourcePaths(withOdIds) : withOdIds;
  const withBase = options.baseHref ? injectBaseHref(withSourcePaths, options.baseHref) : withSourcePaths;
  const withShim = injectSandboxShim(withBase);
  const withDeck = options.deck ? injectDeckBridge(withShim, options.initialSlideIndex) : withShim;
  // Comment + Inspect share an element-selection bridge: both pick a
  // [data-od-id] / [data-screen-label] node and route the host's reply
  // to either the comment popover (annotate) or the inspect panel
  // (live-style overrides). Inject once when either mode is on. Pass the
  // requested modes through so the bridge boots with picking already
  // active — without that initial seed there is a window after each
  // srcdoc rebuild where the host's `od:*-mode` postMessage races the
  // bridge's own listener install and the iframe ignores clicks.
  const withSelection = options.selectionBridge || options.commentBridge || options.inspectBridge
    ? injectSelectionBridge(withDeck, {
        initialCommentMode: !!options.commentBridge,
        initialInspectMode: !!options.inspectBridge,
      })
    : withDeck;
  const withPalette = options.paletteBridge
    ? injectPaletteBridge(withSelection, { initialPalette: options.initialPalette ?? null })
    : withSelection;
  const withEdit = options.editBridge ? injectManualEditBridge(withPalette) : withPalette;
  // The tweaks bridge is always injected — it's a passive listener that
  // toggles a `.tw-panel`'s visibility in response to host postMessage. Tying
  // it to a per-call option would force iframe srcdoc regeneration (and a
  // visible flash) every time the host toggle flips.
  const withTweaks = injectTweaksBridge(withEdit);
  const withAnnotate = injectAnnotateBridge(withTweaks, {
    initialEnabled: !!options.annotateBridge,
  });
  return injectSrcdocTransportActivationBridge(injectSnapshotBridge(withAnnotate));
}

/**
 * Build the lazy transport shell.
 *
 * The shell does two things:
 *   1. Register a listener for `od:srcdoc-transport-activate` that replaces
 *      its own document with the real artifact HTML.
 *   2. Post `od:srcdoc-transport-ready` to the parent as soon as the listener
 *      is installed. This `ready` signal is the only reliable way for the
 *      host to know the listener is live; without it, the host risks posting
 *      `activate` before the iframe's script has executed (e.g. right after a
 *      key-driven re-mount), in which case the message is dropped and the
 *      iframe stays stuck on the empty shell. See #2253.
 */
export function buildLazySrcdocTransport(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script data-od-lazy-srcdoc-transport>(function(){
      window.addEventListener('message', function(ev){
        var data = ev && ev.data;
        if (!data || data.type !== 'od:srcdoc-transport-activate' || typeof data.html !== 'string') return;
        document.open();
        document.write(data.html);
        document.close();
      });
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'od:srcdoc-transport-ready' }, '*');
        }
      } catch (_) { /* sandboxed parent — host falls back to onLoad */ }
    })();</script>
  </head>
  <body></body>
</html>`;
}

export interface SrcDocActivationInputs {
  /** The real artifact HTML the host wants to inject into the shell. */
  srcDoc: string;
  /** Host is currently showing the URL-loaded iframe (srcDoc iframe is hidden). */
  useUrlLoadPreview: boolean;
  /** Host's render pipeline is routing through the lazy transport shell. */
  useLazySrcDocTransport: boolean;
  /** The shell document has loaded AND posted `od:srcdoc-transport-ready`. */
  shellReady: boolean;
  /** Which artifact HTML has already been pushed into this shell (dedupe). */
  activatedHtml: string | null;
}

/**
 * Pure decision for whether the host should now post
 * `od:srcdoc-transport-activate` to the shell iframe.
 *
 * Gating on `shellReady` is the fix for #2253: without it, an activation
 * triggered by `useUrlLoadPreview` flipping to false (e.g. opening the
 * Tweaks palette) can fire while the iframe's shell script has not yet
 * registered its message listener. The message is dropped, the shell stays
 * on its empty 536-byte body, and the dedupe check then suppresses the
 * follow-up activation from the iframe's onLoad path.
 */
export function canActivateSrcDocTransport(state: SrcDocActivationInputs): boolean {
  if (!state.srcDoc) return false;
  if (state.useUrlLoadPreview) return false;
  if (!state.useLazySrcDocTransport) return false;
  if (!state.shellReady) return false;
  if (state.activatedHtml === state.srcDoc) return false;
  return true;
}

function injectSrcdocTransportActivationBridge(doc: string): string {
  const script = `<script data-od-srcdoc-transport-activation>(function(){
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:srcdoc-transport-activate' || typeof data.html !== 'string') return;
    document.open();
    document.write(data.html);
    document.close();
  });
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

function injectSnapshotBridge(doc: string): string {
  const script = `<script data-od-snapshot-bridge>(function(){
  function isCrossOrigin(src){
    if (!src || src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) return false;
    // Protocol-relative URLs (//cdn.example.com/...) are always cross-origin.
    if (src.indexOf('//') === 0) return true;
    // In a srcdoc iframe window.location.origin === 'null'.  Every absolute http/https URL
    // is therefore cross-origin regardless of hostname.
    if (src.indexOf('http://') === 0 || src.indexOf('https://') === 0) {
      if (window.location.origin === 'null') return true;
      try { return new URL(src).origin !== window.location.origin; }
      catch(_){ return true; }
    }
    return false;
  }
  // Try to load each cross-origin image with CORS and convert to dataURL.
  // CDNs that support CORS → embedded as data URL (no taint).
  // CDNs without CORS → map to null → blanked from clone (no taint, image hidden).
  function prefetchCrossOriginImages(){
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    var map = {};
    var promises = [];
    for (var ii = 0; ii < imgs.length; ii++){
      (function(imgEl){
        var src = imgEl.currentSrc || imgEl.getAttribute('src') || '';
        if (!src || !isCrossOrigin(src) || Object.prototype.hasOwnProperty.call(map, src)) return;
        map[src] = null;
        promises.push(new Promise(function(resolve){
          var settled = false;
          function finish(){ if(settled) return; settled = true; resolve(undefined); }
          var probe = new Image();
          probe.crossOrigin = 'anonymous';
          probe.onload = function(){
            var c = document.createElement('canvas');
            c.width = Math.max(1, probe.naturalWidth);
            c.height = Math.max(1, probe.naturalHeight);
            var ctx2 = c.getContext('2d');
            if (ctx2){ try{ ctx2.drawImage(probe,0,0); map[src]=c.toDataURL(); }catch(_){} }
            finish();
          };
          probe.onerror = finish;
          probe.src = src;
          setTimeout(finish, 1200);
        }));
      })(imgs[ii]);
    }
    return Promise.all(promises).then(function(){ return map; });
  }
  function stripUrlFromStyle(style){
    // Remove any CSS declaration whose value contains url(...) to prevent canvas taint.
    return style.replace(/[^:;]*:[^;]*url\([^)]*\)[^;]*;?/g, '');
  }
  function copyComputedStyle(source, target){
    if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) return;
    var computed = window.getComputedStyle(source);
    var isFixed = computed.getPropertyValue('position') === 'fixed';
    // Strip any url() from existing inline style first, then append computed non-url values.
    var style = target.getAttribute('style') || '';
    if (style.indexOf('url(') !== -1) style = stripUrlFromStyle(style);
    for (var i = 0; i < computed.length; i++){
      var prop = computed[i];
      var val = computed.getPropertyValue(prop);
      // Override url() with 'none' so inline style beats any <style> rule.
      if (val.indexOf('url(') !== -1) { style += prop + ':none;'; continue; }
      // Skip font-family; we inject a system-font !important reset in sanitizeClone instead.
      // Embedding web-font names here would reach the browser's CORS-less font cache and taint.
      if (prop === 'font-family' || prop === 'font') continue;
      style += prop + ':' + val + ';';
    }
    if (isFixed) {
      var rect = source.getBoundingClientRect();
      var sx = window.scrollX || 0; var sy = window.scrollY || 0;
      style += 'position:absolute!important;top:' + (rect.top + sy) + 'px!important;left:' + (rect.left + sx) + 'px!important;right:auto!important;bottom:auto!important;width:' + rect.width + 'px!important;height:' + rect.height + 'px!important;';
    }
    target.setAttribute('style', style);
  }
  function syncElementState(source, target, imgDataUrlMap){
    var tag = source.tagName ? source.tagName.toLowerCase() : '';
    if (tag === 'img') {
      var src = source.currentSrc || source.getAttribute('src') || '';
      if (src) {
        // imgDataUrlMap === null means "keep all sources" (SVG path — no canvas taint concern).
        if (!isCrossOrigin(src) || imgDataUrlMap === null) {
          target.setAttribute('src', src);
        } else {
          var mapped = imgDataUrlMap && imgDataUrlMap[src];
          if (mapped) target.setAttribute('src', mapped);
          else target.removeAttribute('src');
        }
      }
    }
    if (tag === 'input' || tag === 'textarea') target.setAttribute('value', source.value || '');
    if (tag === 'canvas') {
      try {
        var img = document.createElement('img');
        img.setAttribute('src', source.toDataURL('image/png'));
        img.setAttribute('style', target.getAttribute('style') || '');
        target.parentNode && target.parentNode.replaceChild(img, target);
      } catch (_) {}
    }
  }
  function inlineSnapshotStyles(originalRoot, cloneRoot, imgDataUrlMap){
    copyComputedStyle(originalRoot, cloneRoot);
    syncElementState(originalRoot, cloneRoot, imgDataUrlMap);
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length);
    for (var i = 0; i < count; i++){
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i], imgDataUrlMap);
    }
    var scripts = cloneRoot.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
  }
  function bakeScrollContainers(originalRoot, cloneRoot){
    var originals = [originalRoot].concat(Array.prototype.slice.call(originalRoot.querySelectorAll ? originalRoot.querySelectorAll('*') : []));
    var clones = [cloneRoot].concat(Array.prototype.slice.call(cloneRoot.querySelectorAll ? cloneRoot.querySelectorAll('*') : []));
    var count = Math.min(originals.length, clones.length);
    for (var i = 0; i < count; i++){
      var source = originals[i];
      var target = clones[i];
      if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) continue;
      var tag = source.tagName ? source.tagName.toLowerCase() : '';
      if (tag === 'html' || tag === 'body') continue;
      var scrollLeft = Math.round(source.scrollLeft || 0);
      var scrollTop = Math.round(source.scrollTop || 0);
      var scrollW = Math.round(source.scrollWidth || 0);
      var scrollH = Math.round(source.scrollHeight || 0);
      var clientW = Math.round(source.clientWidth || 0);
      var clientH = Math.round(source.clientHeight || 0);
      if ((scrollLeft === 0 && scrollTop === 0) || (scrollW <= clientW && scrollH <= clientH)) continue;
      var doc = target.ownerDocument || document;
      var wrapper = doc.createElement('div');
      wrapper.setAttribute('data-od-scroll-bake', '1');
      wrapper.setAttribute(
        'style',
        'display:block!important;box-sizing:border-box!important;width:' + Math.max(scrollW, clientW, 1) + 'px!important;min-height:' + Math.max(scrollH, clientH, 1) + 'px!important;transform:translate(' + (-scrollLeft) + 'px,' + (-scrollTop) + 'px)!important;transform-origin:0 0!important;'
      );
      while (target.firstChild) wrapper.appendChild(target.firstChild);
      target.appendChild(wrapper);
      var style = target.getAttribute('style') || '';
      style += 'overflow:hidden!important;scrollbar-width:none!important;';
      target.setAttribute('style', style);
    }
  }
  // Final pass: remove every cross-origin resource that could taint the canvas.
  function sanitizeClone(root, imgDataUrlMap){
    // <img>: replace cross-origin src with prefetched data URL or blank; strip srcset.
    var imgs = root.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++){
      var src = imgs[i].getAttribute('src') || '';
      if (isCrossOrigin(src)){
        var du = imgDataUrlMap && imgDataUrlMap[src];
        if (du) imgs[i].setAttribute('src', du);
        else imgs[i].removeAttribute('src');
      }
      imgs[i].removeAttribute('srcset');
    }
    // Remove ALL <link> elements — stylesheets are already inlined as computed styles,
    // and even "same-origin" stylesheets can @font-face cross-origin fonts.
    var links = root.querySelectorAll('link');
    for (var j = links.length - 1; j >= 0; j--) links[j].remove();
    // Remove ALL canvas elements — tainted source canvases leave untransferable clones.
    var canvases = root.querySelectorAll('canvas');
    for (var cv = canvases.length - 1; cv >= 0; cv--) canvases[cv].remove();
    // Remove embedded media elements: cross-origin content inside these taints the canvas.
    var media = root.querySelectorAll('iframe,video,audio,embed,object');
    for (var k = 0; k < media.length; k++) media[k].remove();
    // Remove <source> elements (picture/video fallback).
    var srcs = root.querySelectorAll('source');
    for (var s2 = 0; s2 < srcs.length; s2++) srcs[s2].remove();
    // SVG <use> with external href (e.g. Bootstrap Icons sprite from CDN).
    var uses = root.querySelectorAll('use');
    for (var u = 0; u < uses.length; u++){
      var uhref = uses[u].getAttribute('href') || uses[u].getAttribute('xlink:href') || '';
      if (isCrossOrigin(uhref.split('#')[0])) uses[u].remove();
    }
    // SVG <image> / <feImage> with cross-origin href.
    var svgImgs = root.querySelectorAll('image,feImage');
    for (var si = 0; si < svgImgs.length; si++){
      var ihref = svgImgs[si].getAttribute('href') || svgImgs[si].getAttribute('xlink:href') || svgImgs[si].getAttribute('src') || '';
      if (isCrossOrigin(ihref)) svgImgs[si].remove();
    }
    // <input type="image"> with cross-origin src.
    var imgInputs = root.querySelectorAll('input[type="image"]');
    for (var ii2 = 0; ii2 < imgInputs.length; ii2++){
      if (isCrossOrigin(imgInputs[ii2].getAttribute('src') || '')) imgInputs[ii2].removeAttribute('src');
    }
    // Strip url() from any remaining inline style attributes.
    var styled = root.querySelectorAll('[style]');
    for (var m = 0; m < styled.length; m++){
      var st = styled[m].getAttribute('style') || '';
      if (st.indexOf('url(') !== -1) styled[m].setAttribute('style', stripUrlFromStyle(st));
    }
    // Sanitize <style> block content: strip @import, @font-face, and replace url() with none.
    var styleEls = root.querySelectorAll('style');
    for (var n = 0; n < styleEls.length; n++){
      var txt = styleEls[n].textContent || '';
      if (txt.indexOf('url(') !== -1 || txt.indexOf('@import') !== -1){
        txt = txt.replace(/@import\s[^;]+;?/g, '');
        txt = txt.replace(/@font-face\s*\{[^}]*\}/g, '');
        txt = txt.replace(/url\([^)]*\)/g, 'none');
        styleEls[n].textContent = txt;
      }
    }
    // Debug: log any remaining cross-origin references so we can catch new cases.
    var leaks = [];
    var allAttrSrc = root.querySelectorAll('[src]');
    for (var d1 = 0; d1 < allAttrSrc.length; d1++){
      var ds = allAttrSrc[d1].getAttribute('src') || '';
      if (ds && ds.indexOf('data:') !== 0 && isCrossOrigin(ds)) leaks.push(allAttrSrc[d1].tagName+'[src]='+ds.slice(0,60));
    }
    var allAttrHref = root.querySelectorAll('[href]');
    for (var d2 = 0; d2 < allAttrHref.length; d2++){
      var dh = allAttrHref[d2].getAttribute('href') || '';
      if (dh && isCrossOrigin(dh.split('#')[0])) leaks.push(allAttrHref[d2].tagName+'[href]='+dh.slice(0,60));
    }
    var remainStyle = root.querySelectorAll('[style]');
    for (var d3 = 0; d3 < remainStyle.length; d3++){
      if ((remainStyle[d3].getAttribute('style')||'').indexOf('url(') !== -1) leaks.push(remainStyle[d3].tagName+'[style]url()');
    }
    var remainStyleEl = root.querySelectorAll('style');
    for (var d4 = 0; d4 < remainStyleEl.length; d4++){
      if ((remainStyleEl[d4].textContent||'').indexOf('url(') !== -1) leaks.push('<style>url()');
    }
    if (leaks.length) console.warn('[snapshot] remaining cross-origin refs after sanitize:', leaks);
    // Force system fonts on every element.  Web fonts loaded by the original page sit in the
    // browser's font cache without CORS headers; reusing them in the SVG foreignObject context
    // taints the canvas.  A !important override prevents the browser from reaching that cache.
    var fontHead = root.querySelector('head') || root;
    var fontReset = document.createElement('style');
    fontReset.setAttribute('data-od-font-reset', '1');
    fontReset.textContent = '*,*::before,*::after{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;}';
    fontHead.appendChild(fontReset);
  }
  function waitForImages(){
    var imgs = Array.prototype.slice.call(document.images || []);
    return Promise.all(imgs.map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve){
        var settled = false;
        function finish(){ if(settled) return; settled = true; resolve(undefined); }
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
        setTimeout(finish, 900);
      });
    }));
  }
  function encodeSvgDataUrl(svg){
    try {
      if (typeof TextEncoder !== 'undefined') {
        var bytes = new TextEncoder().encode(svg);
        var binary = '';
        var chunk = 32768;
        for (var i = 0; i < bytes.length; i += chunk) {
          var slice = bytes.subarray(i, i + chunk);
          for (var j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
        }
        return 'data:image/svg+xml;base64,' + btoa(binary);
      }
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    } catch (_) {
      return '';
    }
  }
  function snapshotViewport(raw){
    var fullW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var fullH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var x = 0;
    var y = 0;
    var w = fullW;
    var h = fullH;
    if (raw && typeof raw === 'object') {
      x = Math.max(0, Math.floor(Number(raw.x) || 0));
      y = Math.max(0, Math.floor(Number(raw.y) || 0));
      w = Math.max(1, Math.floor(Number(raw.w) || fullW));
      h = Math.max(1, Math.floor(Number(raw.h) || fullH));
    }
    return { fullH: fullH, fullW: fullW, h: h, w: w, x: x, y: y };
  }
  function appendSnapshotOverlay(clone, overlayHtml, overlayCss, sx, sy, cropX, cropY, w, h){
    if (!overlayHtml) return;
    try {
      var head = clone.querySelector('head') || clone;
      var body = clone.querySelector('body') || clone;
      var style = document.createElement('style');
      style.setAttribute('data-od-snapshot-overlay', '1');
      style.textContent = (overlayCss || '') + '#od-snapshot-overlay-layer{position:absolute!important;left:0!important;top:0!important;width:' + (w + cropX) + 'px!important;height:' + (h + cropY) + 'px!important;overflow:hidden!important;pointer-events:none!important;background:transparent!important;z-index:2147483647!important;transform:translate(' + (sx - cropX) + 'px,' + (sy - cropY) + 'px)!important;transform-origin:0 0!important;}#od-snapshot-overlay-layer #oi-sel,#od-snapshot-overlay-layer #oi-hov,#od-snapshot-overlay-layer #oi-svg,#od-snapshot-overlay-layer #oi-card,#od-snapshot-overlay-layer .oi-badge,#od-snapshot-overlay-layer .oi-shot,#od-snapshot-overlay-layer .oi-shot-fly,#od-snapshot-overlay-layer #oi-cpk{display:block;}';
      head.appendChild(style);
      var layer = document.createElement('div');
      layer.setAttribute('id', 'od-snapshot-overlay-layer');
      layer.innerHTML = overlayHtml;
      body.appendChild(layer);
    } catch (_) {}
  }
  function inlineOverlayComputedStyles(source, target){
    if (!source || !target) return;
    copyComputedStyle(source, target);
    syncElementState(source, target, null);
    var originals = source.querySelectorAll ? source.querySelectorAll('*') : [];
    var clones = target.querySelectorAll ? target.querySelectorAll('*') : [];
    var count = Math.min(originals.length, clones.length);
    for (var i = 0; i < count; i++) {
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i], null);
    }
  }
  function renderLiveSvgSnapshot(id,opts){
    try {
      var viewport = snapshotViewport(opts && opts.viewport);
      var w = viewport.w;
      var h = viewport.h;
      var cropX = viewport.x;
      var cropY = viewport.y;
      var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
      var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      var sx = Math.max(0, (window.scrollX || document.documentElement.scrollLeft || (document.body ? document.body.scrollLeft : 0) || 0) + cropX);
      var sy = Math.max(0, (window.scrollY || document.documentElement.scrollTop || (document.body ? document.body.scrollTop : 0) || 0) + cropY);
      docW = Math.max(docW, sx + w);
      docH = Math.max(docH, sy + h);
      var clone = document.documentElement.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      // Pass null so cross-origin image sources are kept (no canvas taint concern for SVG output).
      inlineSnapshotStyles(document.documentElement, clone, null);
      bakeScrollContainers(document.documentElement, clone);
      var scripts = clone.querySelectorAll('script');
      for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
      var bases = clone.querySelectorAll('base');
      for (var b = bases.length - 1; b >= 0; b--) bases[b].remove();
      var head = clone.querySelector('head') || clone;
      var viewportStyle = document.createElement('style');
      viewportStyle.setAttribute('data-od-live-snapshot', '1');
      viewportStyle.textContent = 'html{margin:0!important;width:' + docW + 'px!important;min-height:' + docH + 'px!important;overflow:hidden!important;}body{margin:0!important;width:' + docW + 'px!important;min-height:' + docH + 'px!important;transform:translate(' + (-sx) + 'px,' + (-sy) + 'px)!important;transform-origin:0 0!important;}*{content-visibility:visible!important;}';
      head.appendChild(viewportStyle);
      // Decorative artifacts injected by the OI bridge are always removed
      // from the page clone. Annotation captures add them back as a second
      // viewport-space layer so page content and floating UI cannot drift.
      var overlaySelector = '#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,.oi-shot,.oi-shot-fly,#oi-cpk';
      // Do NOT use [data-oi] here — the selection bridge adds data-oi to page content
      // elements (e.g. the <h3> the user clicked), so querying it removes page content.
      var removeFromClone = clone.querySelectorAll(overlaySelector);
      for (var co = removeFromClone.length - 1; co >= 0; co--) removeFromClone[co].remove();
      var overlayMarkup = '';
      if (!opts || !opts.skipOverlay) {
        var overlayNodes = document.querySelectorAll(overlaySelector);
        for (var oi = 0; oi < overlayNodes.length; oi++) {
          try {
            var node = overlayNodes[oi];
            var overlayClone = node.cloneNode(true);
            var r = node.getBoundingClientRect && node.getBoundingClientRect();
            inlineOverlayComputedStyles(node, overlayClone);
            if (r && overlayClone && overlayClone.style) {
              overlayClone.style.position = 'absolute';
              overlayClone.style.left = Math.round(r.left) + 'px';
              overlayClone.style.top = Math.round(r.top) + 'px';
              overlayClone.style.width = Math.round(r.width) + 'px';
              overlayClone.style.height = Math.round(r.height) + 'px';
              overlayClone.style.margin = '0';
              overlayClone.style.transform = 'none';
            }
            overlayMarkup += overlayClone.outerHTML || '';
          } catch (_) {
            overlayMarkup += overlayNodes[oi].outerHTML || '';
          }
        }
      }
      var overlayHtml = '';
      var overlayCss = '';
      if ((!opts || !opts.skipOverlay) && opts && opts.overlay && opts.overlay.html) {
        overlayHtml = opts.overlay.html || '';
        overlayCss = opts.overlay.css || '';
      } else if (overlayMarkup) {
        var oiStyle = document.querySelector('style[data-oi]');
        overlayHtml = overlayMarkup;
        overlayCss = oiStyle ? oiStyle.textContent || '' : '';
      }
      appendSnapshotOverlay(clone, overlayHtml, overlayCss, sx, sy, cropX, cropY, w, h);
      var html = new XMLSerializer().serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
        html +
        '</foreignObject></svg>';
      var svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      window.parent.postMessage({ type: 'od:snapshot:result', id: id, blob: svgBlob, mime: 'image/svg+xml', w: w, h: h, fallback: 'live-svg' }, '*');
    } catch (err) {
      window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: String(err && err.message || err) }, '*');
    }
  }
  function renderSnapshot(id, options){
    options = options || {};
    if (options.preferSvg) { renderLiveSvgSnapshot(id, options); return; }
    prefetchCrossOriginImages().then(function(imgDataUrlMap){
      var viewport = snapshotViewport(options.viewport);
      var w = viewport.w;
      var h = viewport.h;
      var cropX = viewport.x;
      var cropY = viewport.y;
      var dpr = window.devicePixelRatio || 1;
      var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
      var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      var sx = Math.max(0, (window.scrollX || document.documentElement.scrollLeft || (document.body ? document.body.scrollLeft : 0) || 0) + cropX);
      var sy = Math.max(0, (window.scrollY || document.documentElement.scrollTop || (document.body ? document.body.scrollTop : 0) || 0) + cropY);
      docW = Math.max(docW, sx + w);
      docH = Math.max(docH, sy + h);
      var clone = document.documentElement.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      inlineSnapshotStyles(document.documentElement, clone, imgDataUrlMap);
      bakeScrollContainers(document.documentElement, clone);
      sanitizeClone(clone, imgDataUrlMap);
      var baseElsC = clone.querySelectorAll('base');
      for (var bc = baseElsC.length - 1; bc >= 0; bc--) baseElsC[bc].remove();
      var viewportStyleC = document.createElement('style');
      viewportStyleC.setAttribute('data-od-live-snapshot', '1');
      viewportStyleC.textContent = 'html{margin:0!important;width:' + docW + 'px!important;min-height:' + docH + 'px!important;overflow:hidden!important;}body{margin:0!important;width:' + docW + 'px!important;min-height:' + docH + 'px!important;transform:translate(' + (-sx) + 'px,' + (-sy) + 'px)!important;transform-origin:0 0!important;}*{content-visibility:visible!important;}';
      (clone.querySelector('head') || clone).appendChild(viewportStyleC);
      var overlaySelC = '#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,.oi-shot,.oi-shot-fly,#oi-cpk';
      var overlayEls = clone.querySelectorAll(overlaySelC);
      for (var oc = overlayEls.length - 1; oc >= 0; oc--) overlayEls[oc].remove();
      var serializer = new XMLSerializer();
      var overlayMarkupC = '';
      if (!options.skipOverlay) {
        var overlayNodesC = document.querySelectorAll(overlaySelC);
        for (var oic = 0; oic < overlayNodesC.length; oic++) {
          try {
            var overlayNodeC = overlayNodesC[oic];
            var overlayCloneC = overlayNodeC.cloneNode(true);
            var rc = overlayNodeC.getBoundingClientRect && overlayNodeC.getBoundingClientRect();
            inlineOverlayComputedStyles(overlayNodeC, overlayCloneC);
            if (rc && overlayCloneC && overlayCloneC.style) {
              overlayCloneC.style.position = 'absolute';
              overlayCloneC.style.left = Math.round(rc.left) + 'px';
              overlayCloneC.style.top = Math.round(rc.top) + 'px';
              overlayCloneC.style.width = Math.round(rc.width) + 'px';
              overlayCloneC.style.height = Math.round(rc.height) + 'px';
              overlayCloneC.style.margin = '0';
              overlayCloneC.style.transform = 'none';
            }
            overlayMarkupC += overlayCloneC.outerHTML || '';
          } catch (_) {
            overlayMarkupC += overlayNodesC[oic].outerHTML || '';
          }
        }
      }
      var overlayHtmlC = '';
      var overlayCssC = '';
      if (!options.skipOverlay && options.overlay && options.overlay.html) {
        overlayHtmlC = options.overlay.html || '';
        overlayCssC = options.overlay.css || '';
      } else if (overlayMarkupC) {
        var oiStyleC = document.querySelector('style[data-oi]');
        overlayHtmlC = overlayMarkupC;
        overlayCssC = oiStyleC ? oiStyleC.textContent || '' : '';
      }
      appendSnapshotOverlay(clone, overlayHtmlC, overlayCssC, sx, sy, cropX, cropY, w, h);
      var html = serializer.serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
        html +
        '</foreignObject></svg>';
      function svgSnapshotDataUrl(){
        try {
          return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        } catch (_) {
          return '';
        }
      }
      function postSvgSnapshot(error){
        var fallbackUrl = svgSnapshotDataUrl();
        if (fallbackUrl) {
          window.parent.postMessage({
            type: 'od:snapshot:result',
            id: id,
            dataUrl: fallbackUrl,
            w: Math.max(1, Math.floor(w * dpr)),
            h: Math.max(1, Math.floor(h * dpr)),
            fallback: 'svg',
            error: error || null
          }, '*');
          return;
        }
        window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: error || 'snapshot fallback failed' }, '*');
      }
      var svgBlob = new Blob([svg], {type:'image/svg+xml;charset=utf-8'});
      var svgUrl = URL.createObjectURL(svgBlob);
      var img = new Image();
      var imageSettled = false;
      img.onload = function(){
        imageSettled = true;
        URL.revokeObjectURL(svgUrl);
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(w * dpr));
          canvas.height = Math.max(1, Math.floor(h * dpr));
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.scale(dpr, dpr);
          ctx.drawImage(img, 0, 0, w, h);
          var dataUrl;
          try { dataUrl = canvas.toDataURL('image/png'); } catch(te) {
            postSvgSnapshot('tainted:' + String(te && te.message || te));
            return;
          }
          window.parent.postMessage({ type: 'od:snapshot:result', id: id, dataUrl: dataUrl, w: canvas.width, h: canvas.height }, '*');
        } catch (err) {
          postSvgSnapshot(String(err && err.message || err));
        }
      };
      img.onerror = function(){
        imageSettled = true;
        URL.revokeObjectURL(svgUrl);
        postSvgSnapshot('snapshot image failed');
      };
      img.src = svgUrl;
      setTimeout(function(){
        if (imageSettled) return;
        imageSettled = true;
        URL.revokeObjectURL(svgUrl);
        postSvgSnapshot('snapshot image timed out');
      }, 5000);
    });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:snapshot' || !data.id) return;
    var opts = { overlay: data.overlay || null, preferSvg: !!data.preferSvg, skipOverlay: !!data.skipOverlay, viewport: data.viewport || null };
    if (data.preferSvg) { renderSnapshot(String(data.id), opts); return; }
    waitForImages().then(function(){ renderSnapshot(String(data.id), opts); });
  });
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

// Palette bridge: re-skin the page on host postMessage. Generated pages
// hard-code multiple shades of one accent and a CSS-variable swap will
// not catch them. We walk the DOM and shift any chromatic paint to the
// target palette's hue while keeping each color's saturation and
// lightness — pale tints stay pale, bold CTAs stay bold, just in the
// new color family. Mono-noir desaturates instead of shifting.
function injectPaletteBridge(
  doc: string,
  options: { initialPalette: string | null } = { initialPalette: null },
): string {
  const initial = options.initialPalette
    ? JSON.stringify(String(options.initialPalette))
    : 'null';
  const script = `<script data-od-palette-bridge>(function(){
  var PALETTES = {
    'coral':       { hue: 10,  satFloor: 0.55, mono: false },
    'electric':    { hue: 262, satFloor: 0.55, mono: false },
    'acid-forest': { hue: 142, satFloor: 0.55, mono: false },
    'risograph':   { hue: 349, satFloor: 0.60, mono: false },
    'mono-noir':   { hue: 0,   satFloor: 0,    mono: true  }
  };
  var current = ${initial};
  var ATTR = 'data-od-palette-fix';
  var SAVED = '__odPaletteSaved__';
  var MIN_SAT = 0.08;
  var WALK_LIMIT = 12000;
  var STYLE_RULE_LIMIT = 5000;
  var ROOT_SELECTOR = /(^|,)\\s*(:root|html|body|:host)\\s*($|,)/;
  var varApplied = Object.create(null);
  var probeEl = null;
  function parseRgb(s){
    var str = String(s||'').trim();
    if (!str || str === 'transparent' || str === 'none') return null;
    var m = str.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    var p = m[1].split(/[\\s,/]+/).filter(Boolean).map(function(x){ return parseFloat(x); });
    if (p.length < 3) return null;
    return { r: p[0]||0, g: p[1]||0, b: p[2]||0, a: p[3] == null ? 1 : p[3] };
  }
  function rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255;
    var max=Math.max(r,g,b), min=Math.min(r,g,b);
    var h=0, s=0, l=(max+min)/2;
    if (max!==min){
      var d=max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      if (max===r) h=(g-b)/d + (g<b?6:0);
      else if (max===g) h=(b-r)/d + 2;
      else h=(r-g)/d + 4;
      h *= 60;
    }
    return {h:h, s:s, l:l};
  }
  function h2rgb(p,q,t){
    if (t<0) t+=1;
    if (t>1) t-=1;
    if (t<1/6) return p+(q-p)*6*t;
    if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  }
  function hslStr(h,s,l){
    h = ((h%360)+360)%360/360;
    var r,g,b;
    if (s===0){ r=g=b=l; }
    else {
      var q = l<0.5 ? l*(1+s) : l+s-l*s;
      var p = 2*l-q;
      r=h2rgb(p,q,h+1/3); g=h2rgb(p,q,h); b=h2rgb(p,q,h-1/3);
    }
    return 'rgb('+Math.round(r*255)+','+Math.round(g*255)+','+Math.round(b*255)+')';
  }
  function chromatic(c){
    if (!c || c.a < 0.3) return null;
    var hsl = rgbToHsl(c.r,c.g,c.b);
    if (hsl.s < MIN_SAT) return null;
    if (hsl.l < 0.04 || hsl.l > 0.98) return null;
    return hsl;
  }
  function shift(hsl, palette){
    if (palette.mono) return hslStr(0, 0, hsl.l);
    var sat = Math.max(hsl.s, palette.satFloor * 0.7);
    return hslStr(palette.hue, sat, hsl.l);
  }
  function normalizeColor(value){
    var raw = String(value||'').trim();
    if (!raw) return null;
    var direct = parseRgb(raw);
    if (direct) return direct;
    if (raw.indexOf('var(') === 0 || raw.indexOf('--') === 0) return null;
    if (!probeEl){
      probeEl = document.createElement('div');
      probeEl.style.display = 'none';
      (document.body || document.documentElement).appendChild(probeEl);
    }
    probeEl.style.color = '';
    try { probeEl.style.color = raw; } catch (_){ return null; }
    if (!probeEl.style.color) return null;
    return parseRgb(probeEl.style.color);
  }
  function isRootSelector(selector){
    return !!selector && ROOT_SELECTOR.test(String(selector));
  }
  function forEachStyleRule(rules, visit, budget){
    if (!rules || !budget.left) return;
    for (var i=0; i<rules.length && budget.left>0; i++){
      var rule = rules[i];
      budget.left--;
      if (rule.selectorText && rule.style && isRootSelector(rule.selectorText)) visit(rule);
      if (rule.cssRules && rule.cssRules.length) forEachStyleRule(rule.cssRules, visit, budget);
    }
  }
  function applyVarTint(palette){
    var sheets = document.styleSheets;
    if (!sheets || !sheets.length) return;
    var budget = { left: STYLE_RULE_LIMIT };
    for (var i=0; i<sheets.length; i++){
      var sheet = sheets[i];
      var rules = null;
      try { rules = sheet.cssRules; } catch (_){ continue; }
      forEachStyleRule(rules, function(rule){
        var decl = rule.style;
        for (var j=0; j<decl.length; j++){
          var name = decl[j];
          if (name.indexOf('--') !== 0) continue;
          var raw = decl.getPropertyValue(name);
          var color = normalizeColor(raw);
          var hsl = chromatic(color);
          if (!hsl) continue;
          document.documentElement.style.setProperty(name, shift(hsl, palette));
          varApplied[name] = true;
        }
      }, budget);
    }
  }
  function restoreVars(){
    for (var name in varApplied){
      document.documentElement.style.setProperty(name, '');
    }
    varApplied = Object.create(null);
  }
  function restoreAll(){
    restoreVars();
    var nodes = document.querySelectorAll('['+ATTR+']');
    for (var i=0;i<nodes.length;i++){
      var el = nodes[i], saved = el[SAVED];
      if (saved){
        if ('bg' in saved) el.style.backgroundColor = saved.bg;
        if ('color' in saved) el.style.color = saved.color;
        if ('border' in saved) el.style.borderColor = saved.border;
        if ('fill' in saved){ if (saved.fill) el.setAttribute('fill', saved.fill); else el.removeAttribute('fill'); }
        if ('stroke' in saved){ if (saved.stroke) el.setAttribute('stroke', saved.stroke); else el.removeAttribute('stroke'); }
      }
      el.removeAttribute(ATTR);
      delete el[SAVED];
    }
  }
  function applyTint(id){
    var palette = PALETTES[id];
    if (!palette) return;
    applyVarTint(palette);
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i=0; i<all.length && i<WALK_LIMIT; i++){
      var el = all[i], cs = getComputedStyle(el), saved = {}, changed = false;
      var bg = chromatic(parseRgb(cs.backgroundColor));
      if (bg){ saved.bg = el.style.backgroundColor; el.style.setProperty('background-color', shift(bg, palette), 'important'); changed = true; }
      var fg = chromatic(parseRgb(cs.color));
      if (fg){ saved.color = el.style.color; el.style.setProperty('color', shift(fg, palette), 'important'); changed = true; }
      var bd = chromatic(parseRgb(cs.borderTopColor));
      if (bd){ saved.border = el.style.borderColor; el.style.setProperty('border-color', shift(bd, palette), 'important'); changed = true; }
      var fillAttr = el.getAttribute && el.getAttribute('fill');
      if (fillAttr){
        var f = chromatic(parseRgb(cs.fill));
        if (f){ saved.fill = fillAttr; el.setAttribute('fill', shift(f, palette)); changed = true; }
      }
      var strokeAttr = el.getAttribute && el.getAttribute('stroke');
      if (strokeAttr){
        var sk = chromatic(parseRgb(cs.stroke));
        if (sk){ saved.stroke = strokeAttr; el.setAttribute('stroke', shift(sk, palette)); changed = true; }
      }
      if (changed){ el[SAVED] = saved; el.setAttribute(ATTR, '1'); }
    }
  }
  function apply(id){
    restoreAll();
    if (!id || !PALETTES[id]){ current = null; return; }
    current = id;
    applyTint(id);
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:palette') return;
    apply(data.palette ? String(data.palette) : null);
  });
  function boot(){ if (current) apply(current); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

function annotateManualEditSourcePaths(doc: string): string {
  if (typeof DOMParser === 'undefined') return doc;
  try {
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    parsed.body.querySelectorAll(MANUAL_EDIT_DISCOVERY_SELECTOR).forEach((el) => {
      if (el.hasAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR)) return;
      const path = sourcePathForElement(el);
      if (path) el.setAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR, path);
    });
    return serializeHtmlDocument(parsed);
  } catch {
    return doc;
  }
}

function sourcePathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    parts.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

function serializeHtmlDocument(doc: Document): string {
  const doctype = doc.doctype ? '<!doctype html>\n' : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}

/**
 * Auto-annotate structural HTML elements that lack `data-od-id` or
 * `data-screen-label` so that the selection bridge (Picker / Pods /
 * Tweaks) can target them. This fixes imported designs whose HTML was
 * generated outside of Open Design and therefore carries no OD-specific
 * annotations.
 */
function annotateMissingOdIds(doc: string): string {
  if (typeof DOMParser === 'undefined') return doc;
  try {
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    // Only target divs that are direct children of semantic containers or body;
    // deeply nested layout divs (e.g. flex/grid wrappers) create noise in the
    // selection bridge without adding meaningful pickable targets.
    const selector = [
      'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'button', 'a', '[id]',
      'body > div[class]', 'body > div[id]',
      'section > div[class]', 'section > div[id]',
      'article > div[class]', 'article > div[id]',
      'main > div[class]', 'main > div[id]',
      'header > div[class]', 'header > div[id]',
      'footer > div[class]', 'footer > div[id]',
      'nav > div[class]', 'nav > div[id]',
      'aside > div[class]', 'aside > div[id]',
      '[id] > div[class]', '[id] > div[id]',
    ].join(', ');
    const skipTags = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed']);
    let fallbackIndex = 0;
    parsed.body.querySelectorAll(selector).forEach((el) => {
      if (el.hasAttribute('data-od-id') || el.hasAttribute('data-screen-label')) return;
      const tag = el.tagName.toLowerCase();
      if (skipTags.has(tag)) return;
      const path = sourcePathForElement(el);
      el.setAttribute('data-od-id', path || `od-${tag}-${fallbackIndex++}`);
    });
    return serializeHtmlDocument(parsed);
  } catch {
    return doc;
  }
}

function injectManualEditBridge(doc: string): string {
  const withStyle = injectBeforeHeadEnd(doc, buildManualEditBridgeStyle());
  return injectBeforeBodyEnd(withStyle, buildManualEditBridge(true));
}

function injectBeforeHeadEnd(doc: string, payload: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.head) parsed.head.insertAdjacentHTML('beforeend', payload);
      return serializeHtmlDocument(parsed);
    } catch { /* DOMParser failed; fall through to string path */ }
  }
  // String fallback: find the real </head> (last one before <body>)
  // to skip </head> literals inside <script>/<style> in <head>.
  const lower = doc.toLowerCase();
  const bodyStart = lower.indexOf('<body');
  const limit = bodyStart >= 0 ? bodyStart : lower.length;
  const idx = lower.lastIndexOf('</head>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${payload}`);
  return payload + doc;
}

function injectBeforeBodyEnd(doc: string, payload: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.body) parsed.body.insertAdjacentHTML('beforeend', payload);
      return serializeHtmlDocument(parsed);
    } catch { /* DOMParser failed; fall through to string path */ }
  }
  // String fallback: find the real </body> (last one before </html>)
  // to skip </body> literals inside <script>/<style> in <body>.
  const lower = doc.toLowerCase();
  const htmlEnd = lower.lastIndexOf('</html>');
  const limit = htmlEnd >= 0 ? htmlEnd : lower.length;
  const idx = lower.lastIndexOf('</body>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  return doc + payload;
}

function injectBaseHref(doc: string, baseHref: string): string {
  const safeHref = escapeAttr(baseHref);
  const tag = `<base href="${safeHref}">`;
  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  if (/<html[^>]*>/i.test(doc)) {
    return doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  }
  return tag + doc;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Sandboxed iframes (we use `sandbox="allow-scripts"`) without
// `allow-same-origin` raise a SecurityError on first `localStorage` /
// `sessionStorage` access. Many freeform-generated decks call
// `localStorage.getItem(...)` at the top of their IIFE without a
// try/catch — when it throws, the whole script aborts and the deck
// becomes a static, unnavigable preview. We install a same-origin
// in-memory shim BEFORE any user script runs so those decks degrade
// gracefully (position just doesn't persist across reloads).
// allow-popups and allow-popups-to-escape-sandbox are needed for 
// links with target="_blank" to work in the sandboxed preview.
// Empty hrefs and hash only hrefs will be intercepted and ignored.
// hrefs leading to an id on the page will be scrolled into view.
function injectSandboxShim(doc: string): string {
  const shim = `<script data-od-sandbox-shim>(function(){
  function makeStore(){
    var data = {};
    var api = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; },
      clear: function(){ data = {}; },
      key: function(i){ return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
    return api;
  }
  function tryShim(name){
    var works = false;
    try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
    catch (_) { works = false; }
    if (works) return;
    try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
    catch (_) { try { window[name] = makeStore(); } catch (__) {} }
  }
  tryShim('localStorage');
  tryShim('sessionStorage');
  document.addEventListener('click', (e) => {
    if (!e.target || !(e.target instanceof Element)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (href === null) return;
    var isAnchor = href.startsWith('#') || href === '';
    if (isAnchor) {
      e.preventDefault();
      if (href === '' || href === '#') {
        window.scrollTo({ top: 0 });
        history.replaceState(null, '', ' ');
      } else {
        var targetId = href.slice(1);
        var target = targetId ? document.getElementById(targetId) : null;
        if (target) {
          target.scrollIntoView();
          location.hash === href && history.replaceState(null, '', ' ');
          location.hash = href;
        }
      }
    } else if (link.getAttribute('target') === '_blank') {
      e.preventDefault();
      let safe = false;
      try {
        var url = new URL(href, location.href);
        safe =
          url.protocol === 'http:' ||
          url.protocol === 'https:' ||
          url.protocol === 'mailto:';
      } catch (_) {}
      safe && window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
})();</script>`;
  if (/<head[^>]*>/i.test(doc))
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  if (/<body[^>]*>/i.test(doc))
    return doc.replace(/<body[^>]*>/i, (m) => `${m}${shim}`);
  return shim + doc;
}

// Selection bridge: shared substrate for Comment mode and Inspect mode.
// Both modes pick a [data-od-id] / [data-screen-label] element on click;
// the difference is what the host does with the selection — annotate
// (Comment) or live-tune basic styles (Inspect).
//
// Inspect adds four messages on top of the comment protocol:
//   in:  { type: 'od:inspect-set', elementId, selector, prop, value }
//        Apply (or unset, when value === '') a per-element CSS override.
//   in:  { type: 'od:inspect-reset', elementId? } Clear overrides for one
//        element, or all if elementId is omitted.
//   in:  { type: 'od:inspect-extract' } Reply with the cumulative
//        override map so the host can persist to source.
//   in:  { type: 'od:inspect-replay', overrides } Replace the in-memory
//        override map with the host's authoritative set so the iframe
//        preview matches host state after every srcdoc rebuild. Without
//        this the bridge re-hydrates only the persisted <style> block on
//        load, so any unsaved edit the host still holds disappears from
//        the preview while saveInspectToSource() can later commit CSS the
//        user is no longer seeing. Re-validates every entry under the
//        same allow-list / value sanitizer applied to od:inspect-set.
//   out: { type: 'od:inspect-overrides', overrides } The current snapshot,
//        sent in reply to extract and after every set/reset/replay. The
//        host re-derives the persisted CSS body from the structured map
//        under its own allow-list — the bridge's own stylesheet text is
//        NOT included in this message because artifact JS can forge a
//        same-source od:inspect-overrides containing a hostile `css`.
//
// Overrides are written into a single <style data-od-inspect-overrides>
// block in <head>, with `!important` on every property so the bridge
// can defeat author inline styles (common in agent-generated HTML).
//
// Security: this bridge runs inside a sandboxed iframe but still shares the
// host page context for the override <style> element. The message listener
// does NOT validate ev.origin — the web app runs on configurable ports and
// preview domains, so the host origin is not stable. The bridge therefore
// trusts any parent that can postMessage to it and relies on iframe
// sandboxing + the prop allow-list / value sanitization below to contain
// damage. Any parent able to postMessage here can already mount the iframe.
function injectSelectionBridge(
  doc: string,
  options: { initialCommentMode?: boolean; initialInspectMode?: boolean } = {},
): string {
  const initialComment = options.initialCommentMode ? 'true' : 'false';
  const initialInspect = options.initialInspectMode ? 'true' : 'false';
  const script = `<script data-od-selection-bridge>(function(){
  var commentEnabled = ${initialComment};
  var inspectEnabled = ${initialInspect};
  // Comment mode has two sub-tools (kept on the host side as boardTool):
  //   'picker' — click-to-select an element for annotation.
  //   'pod'    — pointer-drag a freeform stroke that the host turns into a
  //              pod selection covering whatever the stroke encloses.
  // Inspect mode always uses 'picker'-style click selection regardless of
  // this value.
  var mode = 'picker';
  var hoveredId = null;
  var drawing = false;
  var stroke = [];
  var postTargetsTimer = null;
  // overrides[elementId] = { selector: '[data-od-id="x"]', props: { color: '#fff', ... } }
  var overrides = Object.create(null);
  var styleEl = null;
  // Allow-list of CSS properties the host may override. A malicious parent
  // could otherwise smuggle arbitrary CSS (or, with </style>, raw HTML)
  // through od:inspect-set. Keep this in sync with the InspectPanel UI.
  var ALLOWED_PROPS = {
    'color': true,
    'background-color': true,
    'font-size': true,
    'font-weight': true,
    'font-family': true,
    'line-height': true,
    'text-align': true,
    'padding': true,
    'padding-top': true,
    'padding-right': true,
    'padding-bottom': true,
    'padding-left': true,
    'border-radius': true
  };
  // Reject any value that could break out of a 'prop: value' declaration:
  // semicolons (extra declarations), braces (close the rule), angle
  // brackets (close the <style> tag), and newlines (defense in depth).
  var UNSAFE_VALUE = /[;{}<>\\n\\r]/;
  function active(){ return commentEnabled || inspectEnabled; }
  function esc(value){ try { return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\\\"'); } catch (_) { return String(value); } }
  // Recompute the selector from elementId rather than trusting the one in
  // the inbound message — a forged selector like
  // '} </style><script>...' would otherwise be concatenated into the
  // override <style> sheet verbatim. The hint string is only inspected to
  // decide which attribute kind (data-od-id vs data-screen-label) was the
  // user's pick at click time, so we tune the same node the host
  // serializer keys off; the hint itself is never written into CSS.
  function safeSelectorFor(elementId, hint){
    var id = String(elementId);
    var kind = null;
    if (typeof hint === 'string') {
      if (hint.indexOf('[data-od-id=') === 0) kind = 'data-od-id';
      else if (hint.indexOf('[data-screen-label=') === 0) kind = 'data-screen-label';
    }
    if (kind === 'data-screen-label' && document.querySelector('[data-screen-label="' + esc(id) + '"]')) {
      return '[data-screen-label="' + esc(id) + '"]';
    }
    if (kind === 'data-od-id' && document.querySelector('[data-od-id="' + esc(id) + '"]')) {
      return '[data-od-id="' + esc(id) + '"]';
    }
    if (document.querySelector('[data-od-id="' + esc(id) + '"]')) {
      return '[data-od-id="' + esc(id) + '"]';
    }
    if (document.querySelector('[data-screen-label="' + esc(id) + '"]')) {
      return '[data-screen-label="' + esc(id) + '"]';
    }
    return null;
  }
  function ensureStyleEl(){
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.querySelector('style[data-od-inspect-overrides]');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-od-inspect-overrides', '');
      (document.head || document.documentElement).appendChild(styleEl);
    }
    return styleEl;
  }
  // Hydrate the in-memory override map from any persisted
  // <style data-od-inspect-overrides> block already in the document.
  // Without this, the first od:inspect-set rebuilds the sheet from an
  // empty map and silently drops every previously saved rule for other
  // elements — a subsequent Save-to-source would then erase them from
  // the artifact too.
  function hydrateOverridesFromDom(){
    var existing = document.querySelector('style[data-od-inspect-overrides]');
    if (!existing) return;
    var text = existing.textContent || '';
    var ruleRe = /(\\[data-(?:od-id|screen-label)="[^"]*"\\])\\s*\\{\\s*([^}]*)\\}/g;
    var match;
    while ((match = ruleRe.exec(text)) !== null) {
      var selector = match[1];
      var declBody = match[2];
      var idMatch = selector.match(/="([^"]*)"/);
      if (!idMatch) continue;
      var elementId = idMatch[1];
      var props = Object.create(null);
      var decls = declBody.split(';');
      for (var d = 0; d < decls.length; d++) {
        var raw = decls[d];
        if (!raw) continue;
        var colon = raw.indexOf(':');
        if (colon <= 0) continue;
        var name = raw.slice(0, colon).trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(ALLOWED_PROPS, name)) continue;
        var value = raw.slice(colon + 1).replace(/!important/i, '').trim();
        if (!value || UNSAFE_VALUE.test(value)) continue;
        props[name] = value;
      }
      if (Object.keys(props).length) {
        overrides[elementId] = { selector: selector, props: props };
      }
    }
    styleEl = existing;
  }
  function rebuildStyleSheet(){
    var el = ensureStyleEl();
    var lines = [];
    Object.keys(overrides).forEach(function(id){
      var entry = overrides[id];
      if (!entry) return;
      var props = entry.props || {};
      var keys = Object.keys(props);
      if (!keys.length) return;
      var body = keys.map(function(k){ return k + ': ' + props[k] + ' !important'; }).join('; ');
      lines.push(entry.selector + ' { ' + body + ' }');
    });
    el.textContent = lines.join('\\n');
  }
  function postOverrides(){
    var clean = {};
    Object.keys(overrides).forEach(function(id){
      var entry = overrides[id];
      if (entry && entry.props && Object.keys(entry.props).length) {
        clean[id] = { selector: entry.selector, props: Object.assign({}, entry.props) };
      }
    });
    // Intentionally do NOT include a css string here. Artifact code
    // running inside this iframe shares window.parent and could forge
    // od:inspect-overrides with a hostile css (e.g. </style><script>...).
    // The host re-derives CSS from the structured overrides map under
    // its own allow-list, so any stray css field on the wire would only
    // be a false-trust trap.
    try { window.parent.postMessage({ type: 'od:inspect-overrides', overrides: clean }, '*'); } catch (_) {}
  }
  function styleSnapshot(el){
    try {
      var cs = window.getComputedStyle(el);
      return {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        borderRadius: cs.borderTopLeftRadius,
        textAlign: cs.textAlign,
        fontFamily: cs.fontFamily
      };
    } catch (_) { return null; }
  }
  function annotatedSelectorFor(el){
    var id = el.getAttribute('data-od-id') || el.getAttribute('data-screen-label');
    if (!id) return null;
    return el.hasAttribute('data-od-id') ? '[data-od-id="' + esc(id) + '"]' : '[data-screen-label="' + esc(id) + '"]';
  }
  function domSelectorFor(el){
    if (!el || !el.tagName || el === document.documentElement || el === document.body) return null;
    var parts = [];
    var node = el;
    while (node && node !== document.documentElement && node !== document.body) {
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (!tag || /^(script|style|template|meta|link|title|noscript)$/.test(tag)) return null;
      var parent = node.parentElement;
      if (!parent) return null;
      var index = 1;
      var sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName && sibling.tagName.toLowerCase() === tag) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      node = parent;
    }
    if (!parts.length) return null;
    return 'body > ' + parts.join(' > ');
  }
  function visibleTarget(el){
    if (!el || !el.getBoundingClientRect) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (/^(script|style|template|meta|link|title|noscript)$/.test(el.tagName ? el.tagName.toLowerCase() : '')) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    } catch (_) {
      return false;
    }
    return true;
  }
function meaningfulDomFallbackTarget(el) {
  if (!visibleTarget(el)) return false;

  var tag = el.tagName ? el.tagName.toLowerCase() : '';

  if (/^(a|button|input|textarea|select|label|img|video|canvas|h1|h2|h3|h4|h5|h6|p|li|td|th|section|article|main|aside|nav)$/.test(tag)) {
    return true;
  }

  if (
    el.getAttribute &&
    (
      el.getAttribute('role') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title')
    )
  ) {
    return true;
  }

  if (tag === 'svg') {
    return !!(
      el.getAttribute &&
      (
        el.getAttribute('role') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title')
      )
    );
  }

  var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  var meaningfulChildren = 0;
  for (var child = el.firstElementChild;child;child = child.nextElementSibling) {
    if ((child.textContent || '').replace(/\s+/g, ' ').trim()) {
      meaningfulChildren++;
      if (meaningfulChildren > 1) return false;
    }
  }

  return true;
}
  function targetFrom(el, allowDomFallback, clickedEl){
    var id = el.getAttribute('data-od-id') || el.getAttribute('data-screen-label');
    var selector = annotatedSelectorFor(el);
    if (!id && allowDomFallback && meaningfulDomFallbackTarget(el)) {
      selector = domSelectorFor(el);
      if (selector) id = 'dom:' + selector;
    }
    if (!id || !selector) return null;
    var rect = el.getBoundingClientRect();
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    var html = '';
    try { html = (el.outerHTML || '').replace(/\\s+/g, ' ').match(/^<[^>]+>/)?.[0] || ''; } catch (_) {}
    var payload = {
      type: 'od:comment-target',
      elementId: id,
      selector: selector,
      label: tag + cls,
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      htmlHint: html.slice(0, 180),
      style: styleSnapshot(el)
    };
    if (clickedEl && clickedEl !== el) {
      var clickedTag = clickedEl.tagName ? clickedEl.tagName.toLowerCase() : 'element';
      var clickedCls = typeof clickedEl.className === 'string' && clickedEl.className.trim() ? '.' + clickedEl.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
      payload.clickedDescendant = {
        label: clickedTag + clickedCls,
        text: (clickedEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
      };
    }
    return payload;
  }
  function allTargets(){
    var annotatedNodes = document.querySelectorAll('[data-od-id], [data-screen-label]');
    var includeDomFallback = canUseDomFallback();
    var nodes = includeDomFallback
      ? document.querySelectorAll('body *')
      : annotatedNodes;
    var items = [];
    var seen = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var item = targetFrom(nodes[i], includeDomFallback);
      if (item && !seen[item.elementId]) {
        seen[item.elementId] = true;
        items.push(item);
      }
    }
    return items;
  }
  var postTargetsPending = false;
  var postPreviewScrollPending = false;
  function previewScrollElement(){
    return document.querySelector('.design-canvas') || document.scrollingElement || document.documentElement;
  }
  function postPreviewScroll(){
    var el = previewScrollElement();
    if (!el) return;
    var frame = document.scrollingElement || document.documentElement;
    window.parent.postMessage({
      type: 'od:preview-scroll',
      canvasLeft: Math.round(el.scrollLeft || 0),
      canvasTop: Math.round(el.scrollTop || 0),
      frameLeft: Math.round(frame.scrollLeft || 0),
      frameTop: Math.round(frame.scrollTop || 0)
    }, '*');
  }
  function schedulePostPreviewScroll(){
    if (postPreviewScrollPending) return;
    postPreviewScrollPending = true;
    window.requestAnimationFrame(function(){
      postPreviewScrollPending = false;
      postPreviewScroll();
    });
  }
  function requestPreviewScrollRestore(){
    window.parent.postMessage({ type: 'od:preview-scroll-request' }, '*');
  }
  function postTargets(){
    if (!active()) return;
    window.parent.postMessage({ type: 'od:comment-targets', targets: allTargets() }, '*');
  }
  function schedulePostTargets(){
    if (!active() || postTargetsPending) return;
    postTargetsPending = true;
    if (postTargetsTimer) window.clearTimeout(postTargetsTimer);
    postTargetsTimer = window.setTimeout(function(){
      window.requestAnimationFrame(function(){
        postTargetsPending = false;
        postTargetsTimer = null;
        postTargets();
      });
    }, 120);
  }
  function relativePoint(ev){
    return { x: Math.round(ev.clientX), y: Math.round(ev.clientY) };
  }
  function postStroke(type){
    window.parent.postMessage({ type: type, points: stroke.slice() }, '*');
  }
  function canUseDomFallback(){
    return commentEnabled && !inspectEnabled && document.querySelectorAll('[data-od-id], [data-screen-label]').length === 0;
  }
  function closestTarget(event){
    var clicked = event.target;
    var el = clicked;
    var fallback = null;
    var allowDomFallback = mode === 'picker' && canUseDomFallback();
    while (el && el !== document.documentElement) {
      if (el.getAttribute && (el.hasAttribute('data-od-id') || el.hasAttribute('data-screen-label'))) {
        return { target: el, clicked: clicked };
      }
      if (!fallback && allowDomFallback && meaningfulDomFallbackTarget(el)) fallback = el;
      el = el.parentElement;
    }
    return fallback ? { target: fallback, clicked: clicked } : null;
  }
  function applyOverride(elementId, selector, prop, value){
    if (!elementId || !prop) return;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_PROPS, prop)) return;
    var safeSelector = safeSelectorFor(elementId, selector);
    if (!safeSelector) return;
    var v = (value == null) ? '' : String(value).trim();
    if (v && UNSAFE_VALUE.test(v)) return;
    var entry = overrides[elementId];
    if (!entry) {
      entry = { selector: safeSelector, props: Object.create(null) };
      overrides[elementId] = entry;
    } else {
      entry.selector = safeSelector;
    }
    if (!v) delete entry.props[prop];
    else entry.props[prop] = v;
    if (Object.keys(entry.props).length === 0) delete overrides[elementId];
    rebuildStyleSheet();
    postOverrides();
  }
  function resetOverrides(elementId){
    if (elementId) delete overrides[elementId];
    else overrides = Object.create(null);
    rebuildStyleSheet();
    postOverrides();
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || !data.type) return;
    if (data.type === 'od:comment-mode') {
      commentEnabled = !!data.enabled;
      mode = data.mode === 'pod' ? 'pod' : 'picker';
      document.documentElement.toggleAttribute('data-od-comment-mode', commentEnabled);
      document.documentElement.setAttribute('data-od-comment-mode-kind', mode);
      if (active()) setTimeout(postTargets, 0);
      else hoveredId = null;
      if (!commentEnabled || mode !== 'pod') {
        drawing = false;
        stroke = [];
        try { window.parent.postMessage({ type: 'od:pod-clear' }, '*'); } catch (_) {}
      }
      return;
    }
    if (data.type === 'od:preview-scroll-restore') {
      var frame = document.scrollingElement || document.documentElement;
      var el = previewScrollElement();
      if (frame) frame.scrollTo(Number(data.frameLeft || 0), Number(data.frameTop || 0));
      if (el) el.scrollTo(Number(data.canvasLeft || 0), Number(data.canvasTop || 0));
      setTimeout(postPreviewScroll, 0);
      return;
    }
    if (data.type === 'od:inspect-mode') {
      inspectEnabled = !!data.enabled;
      document.documentElement.toggleAttribute('data-od-inspect-mode', inspectEnabled);
      if (active()) setTimeout(postTargets, 0);
      else hoveredId = null;
      return;
    }
    if (data.type === 'od:inspect-set') {
      applyOverride(data.elementId, data.selector, data.prop, data.value);
      return;
    }
    if (data.type === 'od:inspect-reset') {
      resetOverrides(data.elementId);
      return;
    }
    if (data.type === 'od:inspect-extract') {
      postOverrides();
      return;
    }
    if (data.type === 'od:inspect-replay') {
      // Replace the in-memory map with the host's authoritative set so
      // unsaved edits survive a srcdoc rebuild (toggling inspect off/on,
      // switching to comment, any other reload reloads the iframe from
      // previewSource without the unsaved style block). Re-validate every
      // entry: a parent able to postMessage to this bridge is otherwise
      // trusted, but applying its payload through the same allow-list /
      // value sanitizer keeps the override sheet under the bridge's own
      // contract instead of whatever the parent sent.
      var raw = (data && typeof data.overrides === 'object' && data.overrides) ? data.overrides : {};
      overrides = Object.create(null);
      var ids = Object.keys(raw);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var entry = raw[id];
        if (!entry || typeof entry.props !== 'object' || !entry.props) continue;
        var safeSelector = safeSelectorFor(id, entry.selector);
        if (!safeSelector) continue;
        var clean = Object.create(null);
        var pkeys = Object.keys(entry.props);
        for (var p = 0; p < pkeys.length; p++) {
          var name = String(pkeys[p]).toLowerCase();
          if (!Object.prototype.hasOwnProperty.call(ALLOWED_PROPS, name)) continue;
          var rawValue = entry.props[pkeys[p]];
          if (rawValue == null) continue;
          var v = String(rawValue).trim();
          if (!v || UNSAFE_VALUE.test(v)) continue;
          clean[name] = v;
        }
        if (Object.keys(clean).length) overrides[id] = { selector: safeSelector, props: clean };
      }
      rebuildStyleSheet();
      postOverrides();
      return;
    }
  });
  function pickerActive(){ return inspectEnabled || (commentEnabled && mode === 'picker'); }
  document.addEventListener('mouseover', function(ev){
    if (!pickerActive()) return;
    var result = closestTarget(ev);
    if (!result) return;
    var payload = targetFrom(result.target, commentEnabled && mode === 'picker' && !inspectEnabled);
    if (!payload || payload.elementId === hoveredId) return;
    hoveredId = payload.elementId;
    window.parent.postMessage(Object.assign({}, payload, { type: 'od:comment-hover' }), '*');
  }, true);
  document.addEventListener('mouseout', function(ev){
    if (!pickerActive()) return;
    var result = closestTarget(ev);
    if (!result) return;
    var next = ev.relatedTarget;
    while (next && next !== document.documentElement) {
      if (next === result.target) return;
      next = next.parentElement;
    }
    hoveredId = null;
    window.parent.postMessage({ type: 'od:comment-leave' }, '*');
  }, true);
  document.addEventListener('click', function(ev){
    if (!pickerActive()) return;
    var result = closestTarget(ev);
    if (result) {
      ev.preventDefault();
      ev.stopPropagation();
      var payload = targetFrom(result.target, commentEnabled && mode === 'picker' && !inspectEnabled, result.clicked);
      if (payload) window.parent.postMessage(payload, '*');
      return;
    }
    // Free-pin fallback (comment mode only). Lets users drop a comment
    // at a click location even when the artifact has no data-od-id
    // annotations. Skipped for pod mode (drawing) and inspect mode
    // (needs a real selector for live overrides).
    if (!canUseDomFallback() || mode === 'pod') return;
    // Skip clicks on interactive elements so links / buttons / inputs
    // keep their native behavior; pin only on inert surfaces.
    var t = ev.target;
    var walk = t && t.nodeType === 1 ? t : null;
    while (walk && walk !== document.documentElement) {
      var tag = walk.tagName;
      if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'LABEL') return;
      if (walk.isContentEditable) return;
      walk = walk.parentElement;
    }
    ev.preventDefault();
    ev.stopPropagation();
    // Store viewport coordinates to match regular getBoundingClientRect()
    // element targets; the host overlay renders this position directly.
    var pinX = Math.round(ev.clientX);
    var pinY = Math.round(ev.clientY);
    var pinId = 'pin-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    window.parent.postMessage({
      type: 'od:comment-target',
      elementId: pinId,
      // Synthetic selector / label so daemon upsert validation (which
      // requires both to be non-empty) accepts the saved free-pin.
      selector: '[data-od-pin="' + pinId + '"]',
      label: 'pin',
      text: '',
      position: { x: pinX - 12, y: pinY - 12, width: 24, height: 24 },
      htmlHint: '',
      style: null,
      freePin: true
    }, '*');
  }, true);
  // Pod drawing — only active in comment mode with the 'pod' tool.
  document.addEventListener('pointerdown', function(ev){
    if (!commentEnabled || mode !== 'pod' || ev.button !== 0) return;
    drawing = true;
    stroke = [relativePoint(ev)];
    ev.preventDefault();
    ev.stopPropagation();
    postStroke('od:pod-stroke');
  }, true);
  document.addEventListener('pointermove', function(ev){
    if (!drawing || mode !== 'pod') return;
    var point = relativePoint(ev);
    var last = stroke[stroke.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 4) return;
    stroke.push(point);
    ev.preventDefault();
    ev.stopPropagation();
    postStroke('od:pod-stroke');
  }, true);
  function finishStroke(ev){
    if (!drawing || mode !== 'pod') return;
    drawing = false;
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    postStroke('od:pod-select');
  }
  document.addEventListener('pointerup', finishStroke, true);
  document.addEventListener('pointercancel', finishStroke, true);
  window.addEventListener('resize', schedulePostTargets);
  document.addEventListener('scroll', function(){
    schedulePostTargets();
    schedulePostPreviewScroll();
  }, true);
  var mo = new MutationObserver(schedulePostTargets);
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  // Reflect the host-requested initial modes on the documentElement so
  // the cursor/hover styles match what the bridge picks up on click.
  if (commentEnabled) document.documentElement.toggleAttribute('data-od-comment-mode', true);
  if (inspectEnabled) document.documentElement.toggleAttribute('data-od-inspect-mode', true);
  document.documentElement.setAttribute('data-od-comment-mode-kind', mode);
  hydrateOverridesFromDom();
  // Acknowledge the hydrated overrides to the host as a preview signal so
  // diagnostic listeners (and tests) can observe that the bridge is in sync
  // with the persisted style sheet. The host no longer treats this message
  // as save input — it parses the artifact source itself — but emitting it
  // keeps the iframe → host channel symmetric across set/reset/extract.
  if (Object.keys(overrides).length) setTimeout(postOverrides, 0);
  setTimeout(requestPreviewScrollRestore, 0);
  setTimeout(requestPreviewScrollRestore, 80);
  setTimeout(requestPreviewScrollRestore, 240);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postTargets);
  else setTimeout(postTargets, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postPreviewScroll);
  else setTimeout(postPreviewScroll, 0);
})();</script>`;
  const style = `<style data-od-selection-bridge-style>
html[data-od-comment-mode] body * { cursor: crosshair !important; }
html[data-od-inspect-mode] body * { cursor: crosshair !important; }
html[data-od-comment-mode][data-od-comment-mode-kind="pod"] body * { cursor: cell !important; }
/* Nested iframes (e.g. shared device frames) consume clicks in their own browsing context.
   While picker modes are on, disable pointer events on outer-document iframes so the
   hit target resolves to an annotated ancestor (card, shell) in this document. */
html[data-od-comment-mode] body iframe,
html[data-od-inspect-mode] body iframe { pointer-events: none !important; }
</style>`;
  return injectBeforeBodyEnd(injectBeforeHeadEnd(doc, style), script);
}

// The deck bridge supports three deck conventions found across our skills
// and freeform-generated artifacts:
//   1. Horizontal scroll decks (simple-deck, guizang-ppt) — slides laid out
//      side-by-side, navigation = scrollTo({ left }).
//   2. Class-toggle decks (deck-framework, freeform pitches) — one slide
//      carries `.active` or `.is-active`; siblings are display:none. Their
//      own JS listens for ArrowRight/Left, so we drive them by dispatching
//      synthetic KeyboardEvents.
//   3. Visibility-only decks — no class toggle, slides hidden via inline
//      style. We fall back to keyboard dispatch + visibility detection.
//
// All three report `{ active, count }` back to the host so the toolbar can
// render a unified counter. A MutationObserver on each `.slide` lets us
// catch class changes from the deck's own keyboard handler.
//
// We also inject a small CSS override that fixes a common authoring
// mistake in fixed-canvas decks: a `.stage { display: grid; place-items:
// center }` only centers items within their grid cells, but the track
// itself stays `start`-aligned, so the 1920x1080 canvas top-lefts at
// (0,0) of the stage. Combined with `transform-origin: center center`,
// the scaled canvas ends up offset toward the bottom-right of any
// preview that's smaller than 1920x1080 — exactly what users see in the
// sandbox iframe. `place-content: center` centers the track itself.
//
// Framework decks (apps/daemon/src/prompts/deck-framework.ts) opt out:
// their `fit()` already centers a `transform-origin: top left` stage with
// an explicit `translate(tx, ty)` that assumes the stage's natural layout
// position is (0, 0). If we force `place-content: center` on their
// `.deck-shell` grid, the implicit track gets re-centered to
// ((sw-1920)/2, (sh-1080)/2) and `fit()`'s translate stacks on top, so
// the scaled stage lands ~1000px off-screen and the user sees a mostly-
// black preview with a sliver of slide content in the top-left. Skip the
// override whenever the framework's marker id is present.
function injectDeckBridge(doc: string, initialSlideIndex = 0): string {
  const safeInitialSlideIndex = Number.isFinite(initialSlideIndex)
    ? Math.max(0, Math.floor(initialSlideIndex))
    : 0;
  const isFrameworkDeck = /\bid\s*=\s*["']deck-stage["']/i.test(doc);
  const styleFix = isFrameworkDeck
    ? ''
    : `<style data-od-deck-fix>
.stage, .deck-stage, .deck-shell { place-content: center !important; }
</style>`;
  const script = `<script data-od-deck-bridge>(function(){
  var initialSlideIndex = ${safeInitialSlideIndex};
  var didRestoreInitialSlide = initialSlideIndex <= 0;
  function slides(){
    // Structured selectors first so decorative .slide markup in non-deck
    // pages (icons, badges, code samples) is not counted as deck slides;
    // fall back to all .slide only when nothing structured matched, so
    // freeform decks that nest slides under an extra wrapper still report
    // the real count instead of leaving the host counter at 1 / 0.
    var structured = document.querySelectorAll('.deck > .slide, .deck-stage > .slide, .deck-shell > .slide, body > .slide');
    if (structured.length) return structured;
    return document.querySelectorAll('.slide');
  }
  function scroller(){
    if (document.body && document.body.scrollWidth > document.body.clientWidth + 1) return document.body;
    return document.scrollingElement || document.documentElement;
  }
  function isScrollDeck(){
    var sc = scroller();
    return !!(sc && sc.scrollWidth > sc.clientWidth + 1);
  }
  function findActiveByClass(list){
    for (var i=0; i<list.length; i++) {
      var cl = list[i].classList;
      if (cl && (cl.contains('is-active') || cl.contains('active') || cl.contains('current'))) return i;
    }
    return -1;
  }
  function findActiveByVisibility(list){
    for (var i=0; i<list.length; i++) {
      try {
        var cs = window.getComputedStyle(list[i]);
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return i;
      } catch (_) {}
    }
    return -1;
  }
  function activeIndex(list){
    if (!list || !list.length) return 0;
    if (isScrollDeck()) {
      var w = Math.max(1, window.innerWidth);
      return Math.max(0, Math.min(list.length - 1, Math.round(scroller().scrollLeft / w)));
    }
    var byClass = findActiveByClass(list);
    if (byClass >= 0) return byClass;
    var byVis = findActiveByVisibility(list);
    if (byVis >= 0) return byVis;
    return 0;
  }
  function dispatchKey(key){
    // Bubbles so any listener on window picks it up too. We dispatch on
    // document only — dispatching on window/body in addition would cause
    // bubbling to fire the same document-level listener twice.
    var init = { key: key, code: key, bubbles: true, cancelable: true, composed: true };
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', init));
      document.dispatchEvent(new KeyboardEvent('keyup', init));
    } catch (_) {}
  }
  function pad2(n){ return (n < 10 ? '0' : '') + n; }
  function activeClassName(list){
    var names = ['active', 'is-active', 'current'];
    for (var n=0; n<names.length; n++) {
      for (var i=0; i<list.length; i++) {
        if (list[i].classList && list[i].classList.contains(names[n])) return names[n];
      }
    }
    return 'active';
  }
  function canSetActive(list){
    if (findActiveByClass(list) >= 0) return true;
    for (var i=0; i<list.length; i++) {
      if (list[i].style.display === 'none') return true;
      if (list[i].style.visibility === 'hidden') return true;
      if (list[i].hasAttribute('hidden')) return true;
    }
    return false;
  }
  function updateDeckChrome(i, count){
    var cur = document.getElementById('deck-cur');
    var total = document.getElementById('deck-total');
    var prev = document.getElementById('deck-prev');
    var next = document.getElementById('deck-next');
    if (cur) cur.textContent = pad2(i + 1);
    if (total) total.textContent = pad2(count);
    if (prev) prev.toggleAttribute('disabled', i <= 0);
    if (next) next.toggleAttribute('disabled', i >= count - 1);
  }
  function setActive(i){
    var list = slides();
    if (!list.length) return false;
    var target = Math.max(0, Math.min(list.length - 1, i));
    var activeClass = activeClassName(list);
    var usesInlineDisplay = false;
    var usesInlineVisibility = false;
    var usesHidden = false;
    for (var j=0; j<list.length; j++) {
      usesInlineDisplay = usesInlineDisplay || list[j].style.display === 'none';
      usesInlineVisibility = usesInlineVisibility || list[j].style.visibility === 'hidden';
      usesHidden = usesHidden || list[j].hasAttribute('hidden');
    }
    for (var k=0; k<list.length; k++) {
      if (list[k].classList) {
        list[k].classList.remove('active', 'is-active', 'current');
        if (k === target) list[k].classList.add(activeClass);
      }
      if (usesHidden) {
        if (k === target) list[k].removeAttribute('hidden');
        else list[k].setAttribute('hidden', '');
      }
      if (usesInlineDisplay && list[k].style) {
        list[k].style.display = k === target ? '' : 'none';
      }
      if (usesInlineVisibility && list[k].style) {
        list[k].style.visibility = k === target ? '' : 'hidden';
      }
    }
    updateDeckChrome(target, list.length);
    report();
    return true;
  }
  function scrollGo(i){
    var list = slides();
    var next = Math.max(0, Math.min(list.length - 1, i));
    scroller().scrollTo({ left: next * window.innerWidth, behavior: 'smooth' });
    setTimeout(report, 380);
  }
  function targetFor(action, list){
    var i = activeIndex(list);
    if (action === 'next') return i + 1;
    if (action === 'prev') return i - 1;
    if (action === 'first') return 0;
    if (action === 'last') return list.length - 1;
    return i;
  }
  function go(action){
    var list = slides();
    if (!list.length) return;
    var target = Math.max(0, Math.min(list.length - 1, targetFor(action, list)));
    if (isScrollDeck()) {
      scrollGo(target);
      return;
    }
    if (canSetActive(list) && setActive(target)) return;
    if (action === 'next') dispatchKey('ArrowRight');
    else if (action === 'prev') dispatchKey('ArrowLeft');
    else if (action === 'first') dispatchKey('Home');
    else if (action === 'last') dispatchKey('End');
    setTimeout(report, 280);
  }
  function gotoIndex(i){
    var list = slides();
    if (!list.length) return;
    var target = Math.max(0, Math.min(list.length - 1, i));
    if (isScrollDeck()) { scrollGo(target); return; }
    if (canSetActive(list) && setActive(target)) return;
    var current = activeIndex(list);
    var diff = target - current;
    if (!diff) { report(); return; }
    var key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
    var n = Math.abs(diff);
    for (var k = 0; k < n; k++) dispatchKey(key);
    setTimeout(report, 320);
  }
  function report(){
    try {
      var list = slides();
      var i = activeIndex(list);
      var count = list.length;
      window.parent.postMessage({
        type: 'od:slide-state',
        active: i,
        count: count,
      }, '*');
      document.querySelectorAll('.slide-number').forEach(function(el){
        el.setAttribute('data-current',i+1); el.setAttribute('data-total',count);
      });
      document.querySelectorAll('.progress-bar>span').forEach(function(el){
        el.style.width=(count?((i+1)/count*100)+'%':'0');
      });
    } catch (e) {}
  }
  function restoreInitialSlide(){
    if (didRestoreInitialSlide) { report(); return; }
    var list = slides();
    if (!list.length) return;
    didRestoreInitialSlide = true;
    gotoIndex(initialSlideIndex);
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:slide') return;
    if (data.action === 'go' && typeof data.index === 'number') gotoIndex(data.index);
    else go(data.action);
  });
  function ownDeckButton(id, action){
    var btn = document.getElementById(id);
    if (!btn || btn.__odDeckOwned) return;
    btn.__odDeckOwned = true;
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopImmediatePropagation();
      go(action);
    }, true);
  }
  ownDeckButton('deck-prev', 'prev');
  ownDeckButton('deck-next', 'next');
  // Report once on load and on every scroll-end so the host stays in sync.
  window.addEventListener('load', function(){ setTimeout(restoreInitialSlide, 200); });
  document.addEventListener('scroll', function(){
    clearTimeout(window.__odReportT);
    window.__odReportT = setTimeout(report, 120);
  }, { passive: true, capture: true });
  // Nudge the deck's own fit/resize listener after layout settles. Fixed-canvas
  // decks (e.g. ".canvas { width: 1920px }" + "transform: scale(...)") compute
  // their scale on first run, which fires when the iframe is still 0x0 in
  // sandboxed previews — the deck's fit() then resolves to scale(0) / scale(1)
  // and never recovers. Re-firing 'resize' lets the deck recompute, and a
  // ResizeObserver picks up later layout settles (zoom toggle, sidebar drag).
  function nudgeResize(){
    try { window.dispatchEvent(new Event('resize')); }
    catch (_) {}
  }
  // Aggressively nudge during the first second so the deck catches the
  // iframe's first non-zero size; bail out early once the iframe reports a
  // real width. Without this loop, fixed-canvas decks render at scale(0).
  function chaseFirstLayout(){
    var attempts = 0;
    function tick(){
      attempts += 1;
      var w = window.innerWidth;
      nudgeResize();
      if (w > 0 && attempts >= 2) return; // one extra nudge after first non-zero
      if (attempts < 30) setTimeout(tick, 50);
    }
    tick();
  }
  if (document.readyState === 'complete') chaseFirstLayout();
  else window.addEventListener('load', chaseFirstLayout);
  // Re-nudge whenever the iframe itself is resized by the host (e.g.
  // user toggles zoom, resizes the chat sidebar, exits Present).
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var ro = new ResizeObserver(function(){ nudgeResize(); });
      ro.observe(document.documentElement);
    } catch (_) {}
  }
  // For class-toggle decks the deck's own keyboard handler updates classes
  // on the slide elements; an attribute observer translates that into the
  // host counter without depending on scroll events.
  function observeSlides(){
    var list = slides();
    if (!list.length) { setTimeout(observeSlides, 150); return; }
    try {
      var mo = new MutationObserver(function(){
        clearTimeout(window.__odReportT2);
        window.__odReportT2 = setTimeout(report, 60);
      });
      for (var i = 0; i < list.length; i++) {
        mo.observe(list[i], { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
    } catch (e) {}
    setTimeout(restoreInitialSlide, 100);
  }
  observeSlides();
})();</script>`;
  return injectBeforeBodyEnd(injectBeforeHeadEnd(doc, styleFix), script);
}

// The tweaks bridge lets the host toolbar toggle the visibility of the artifact's
// native tweaks panel. Bidirectional: host posts `od:tweaks-panel-visible` to
// drive panel visibility; bridge posts `od:tweaks-panel-state` back whenever the
// artifact's own `× close` button or `T` shortcut flips the `.tw-hidden` class,
// so the toolbar toggle stays in sync. Also reports `od:tweaks-available` so the
// host can disable the toggle on artifacts without a `.tw-panel`.
function injectTweaksBridge(doc: string): string {
  // Hide-state styling mirrors the artifact's own `.tw-hidden` (transform +
  // opacity) so the CSS transition plays in both directions. `.tw-restore` is
  // kept permanently hidden — the host toolbar is the only entry point.
  const style = `<style data-od-tweaks-bridge-style>
[data-od-tweaks-hidden] .tw-panel {
  transform: translateX(calc(100% + 32px)) !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
.tw-restore { display: none !important; }
</style>`;
  const script = `<script data-od-tweaks-bridge>(function(){
  // Synchronously hide BEFORE the artifact body parses so the panel never
  // flashes on initial paint. The host removes the attribute via postMessage
  // once it knows the desired state.
  document.documentElement.setAttribute('data-od-tweaks-hidden', '');

  var suppressEcho = false;
  var observer = null;

  function panelEl(){ return document.querySelector('.tw-panel'); }

  function applyClassesToPanel(visible){
    var panel = panelEl();
    if (panel) panel.classList.toggle('tw-hidden', !visible);
  }

  function setPanelVisible(visible){
    suppressEcho = true;
    document.documentElement.toggleAttribute('data-od-tweaks-hidden', !visible);
    applyClassesToPanel(visible);
    // Clear flag after the MutationObserver has had a chance to fire for this
    // change so we don't echo our own host-driven toggles back to the host.
    Promise.resolve().then(function(){ suppressEcho = false; });
  }

  function postState(){
    var panel = panelEl();
    if (!panel) return;
    try {
      parent.postMessage({
        type: 'od:tweaks-panel-state',
        visible: !panel.classList.contains('tw-hidden'),
      }, '*');
    } catch (e) {}
  }

  function postAvailability(){
    try {
      parent.postMessage({
        type: 'od:tweaks-available',
        available: !!panelEl(),
      }, '*');
    } catch (e) {}
  }

  function attachObserver(){
    var panel = panelEl();
    if (!panel || observer) return;
    observer = new MutationObserver(function(){
      if (suppressEcho) return;
      postState();
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  function onReady(){
    // Capture the panel authored visibility BEFORE we apply the host hidden
    // attribute. The bridge sets data-od-tweaks-hidden synchronously in head
    // (before the body parses), so on entry to onReady the attribute is
    // always present even though the artifact may have authored the panel
    // as default-visible. Reading the panel class first is the only place
    // we can still observe the author intent. Then drive the attribute,
    // classes, and posted state from that captured value so a default
    // visible tw-panel reports visible:true and the toolbar toggle starts
    // ON. Issue surfaced in PR #1643 review.
    var panel = panelEl();
    var initialVisible = !!panel && !panel.classList.contains('tw-hidden');
    document.documentElement.toggleAttribute('data-od-tweaks-hidden', !initialVisible);
    applyClassesToPanel(initialVisible);
    attachObserver();
    postAvailability();
    // Post the captured initial visibility so the toolbar toggle reflects
    // the default state on mount. Without this the toggle reads OFF while
    // a default-visible tw-panel artifact clearly shows its panel and the
    // user would have to click toggle-on then toggle-off to actually hide.
    postState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  window.addEventListener('message', function(ev){
    if (!ev.data || ev.data.type !== 'od:tweaks-panel-visible') return;
    setPanelVisible(!!ev.data.visible);
  });
})();</script>`;
  const withStyle = /<\/head>/i.test(doc)
    ? doc.replace(/<\/head>/i, style + '</head>')
    : /<head[^>]*>/i.test(doc)
      ? doc.replace(/<head[^>]*>/i, (m) => m + style)
      : style + doc;
  // Inject the bridge as early as possible (inside <head>) so the synchronous
  // attribute set runs before the artifact body parses.
  if (/<\/head>/i.test(withStyle)) return withStyle.replace(/<\/head>/i, script + '</head>');
  if (/<head[^>]*>/i.test(withStyle)) return withStyle.replace(/<head[^>]*>/i, (m) => m + script);
  return script + withStyle;
}

/**
 * Inject the annotation (element-inspect) bridge. It can boot active when
 * srcdoc is rebuilt for annotation mode, and it still listens for host
 * `od:annotate-mode` messages after load.
 */
function injectAnnotateBridge(doc: string, options: { initialEnabled?: boolean } = {}): string {
  const initialEnabled = options.initialEnabled ? 'true' : 'false';
  const script = `<script data-od-annotate-bridge>(function(){
if(document.documentElement.hasAttribute('data-od-annotate-ready'))return;document.documentElement.setAttribute('data-od-annotate-ready','');
if(window.__oiCleanup){try{window.__oiCleanup();}catch(_){}}
var INITIAL_ENABLED=${initialEnabled};
var PINK='#e879a0',PURPLE='#6d28d9',CW=312,GAP=10;
var PP=['display','position','align-items','justify-content','flex-direction','flex-wrap','gap','grid-template-columns','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','border-radius','border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','border-width','border-style','border-color','background-color','color','font-family','font-size','font-weight','line-height','letter-spacing','text-align','opacity','overflow','box-shadow'];
var SK={position:'static',opacity:'1',overflow:'visible','border-style':'none','border-width':'0px','border-radius':'0px','border-top-left-radius':'0px','border-top-right-radius':'0px','border-bottom-right-radius':'0px','border-bottom-left-radius':'0px','letter-spacing':'normal','font-weight':'400','background-color':'rgba(0, 0, 0, 0)','text-align':'start',margin:'0px'};
var CP={'color':1,'background-color':1,'border-color':1};
var BP={'padding':1,'padding-top':1,'padding-right':1,'padding-bottom':1,'padding-left':1,'margin':1,'margin-top':1,'margin-right':1,'margin-bottom':1,'margin-left':1,'border-radius':1,'border-top-left-radius':1,'border-top-right-radius':1,'border-bottom-right-radius':1,'border-bottom-left-radius':1};
var css=document.createElement('style');
css.setAttribute('data-oi','');
css.textContent='#oi-sel,#oi-hov{position:fixed;pointer-events:none;box-sizing:border-box;z-index:99997;display:none}'
  +'#oi-sel{border:2px solid #e879a0}'
  +'#oi-hov{border:1px solid #e879a0;opacity:.5}'
  +'#oi-hit{position:fixed;inset:0;z-index:99994;display:none;background:transparent;cursor:crosshair;pointer-events:none}'
  +'#oi-svg{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99996;overflow:visible;display:none}'
  +'#oi-card{position:fixed;z-index:99999;display:none;width:312px;max-height:480px;overflow-y:auto;overflow-x:hidden;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;box-shadow:0 0 0 .5px rgba(0,0,0,.06),0 4px 6px rgba(0,0,0,.04),0 20px 56px rgba(0,0,0,.16);font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:11.5px;line-height:1.62;color:#0d0d0d;user-select:text}'
  +'#oi-card::-webkit-scrollbar{width:3px}'
  +'#oi-card::-webkit-scrollbar-thumb{background:rgba(0,0,0,.12);border-radius:2px}'
  +'.oi-hdr{padding:10px 12px 8px;position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid rgba(0,0,0,.07);border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;gap:6px}'
  +'.oi-hdr-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}'
  +'.oi-tag{font-size:11px;font-weight:600;color:#0d0d0d;word-break:break-all}'
  +'.oi-dim{display:none}'
  +'.oi-body{padding:8px 0 10px;background:#fff}'
  +'.oi-row{position:relative;display:grid;grid-template-columns:minmax(96px,.88fr) minmax(120px,1.12fr);column-gap:10px;row-gap:4px;padding:5px 14px 5px 26px;align-items:start}'
  +'.oi-row:hover{background:rgba(232,121,160,.07)}'
  +'.oi-row.active{background:rgba(232,121,160,.08)}'
  +'.oi-row.active:before{content:"";position:absolute;left:11px;top:50%;width:6px;height:6px;border-radius:50%;background:#e879a0;transform:translateY(-50%)}'
  +'.oi-pn{color:#e879a0;font-size:11px;white-space:normal;overflow-wrap:anywhere;line-height:1.55}'
  +'.oi-pv{text-align:right;font-size:11px;color:#111;display:flex;align-items:flex-start;justify-content:flex-end;gap:5px;min-width:0;white-space:normal;overflow:visible;line-height:1.55}'
  +'.oi-val{min-width:24px;max-width:160px;overflow:visible;white-space:normal;overflow-wrap:anywhere;outline:none;border-radius:4px;padding:0 2px;cursor:text}'
  +'.oi-val:focus{background:rgba(232,121,160,.13);box-shadow:0 0 0 1px rgba(232,121,160,.45)}'
  +'.oi-sw{width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.14);flex-shrink:0;cursor:pointer}'
  +'.oi-color-row .oi-val{cursor:text}'
  +'.oi-color-input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}'
  +'.oi-file-input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}'
  +'.oi-ref{border-top:1px solid rgba(0,0,0,.07);padding:10px 14px 12px}'
  +'.oi-ref-title{font-size:10px;color:#777;margin-bottom:7px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
  +'.oi-ref-grid{display:flex;flex-wrap:wrap;gap:7px}'
  +'.oi-chip{width:17px;height:17px;border-radius:5px;border:1px solid rgba(0,0,0,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);cursor:pointer}'
  +'.oi-chip:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,0,0,.14),inset 0 0 0 1px rgba(255,255,255,.28)}'
  +'.oi-opt{border:1px solid rgba(0,0,0,.13);background:#fff;border-radius:6px;padding:4px 8px;font:11px ui-monospace,Menlo,monospace;color:#111;cursor:pointer;max-width:150px;white-space:normal;overflow-wrap:anywhere;text-align:left;line-height:1.35}'
  +'.oi-opt:hover{border-color:rgba(232,121,160,.65);background:rgba(232,121,160,.08)}'
  +'.oi-badge{position:fixed;pointer-events:none;z-index:99998;background:#6d28d9;color:#fff;font-family:ui-monospace,monospace;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;transform:translate(-50%,-50%);white-space:nowrap}'
  +'body.oi-mode *{cursor:crosshair!important}'
  +'body.oi-mode #oi-card,body.oi-mode #oi-card *{cursor:default!important;pointer-events:auto}'
  +'body.oi-mode #oi-card .oi-hdr{cursor:move!important}'
  +'body.oi-mode #oi-card .oi-hdr button{cursor:default!important}'
  +'body.oi-mode #oi-card .oi-val{cursor:text!important}'
  +'.oi-quad{padding:0}'
  +'.oi-quad-hd{display:flex;align-items:center;justify-content:space-between;padding:5px 14px 5px 26px;user-select:none}'
  +'.oi-quad-hd:hover{background:rgba(232,121,160,.07);cursor:default}'
  +'.oi-quad-right{display:flex;align-items:center;gap:5px}'
  +'.oi-quad-sum{color:#111;font-size:11px;font-style:normal}'
  +'.oi-quad-xbtn{background:none;border:none;padding:1px 5px;cursor:pointer;color:#aaa;font-size:10px;line-height:1;border-radius:3px}'
  +'.oi-quad-xbtn:hover{color:#555;background:rgba(0,0,0,.06)}'
  +'.oi-qgrid{display:none;grid-template-columns:1fr 1fr;gap:3px;padding:3px 14px 7px 26px}'
  +'.oi-quad.open .oi-qgrid{display:grid}'
  +'.oi-qcell{display:flex;align-items:center;gap:4px;background:rgba(232,121,160,.05);border:1px solid rgba(232,121,160,.2);border-radius:4px;padding:0 6px;height:24px;min-width:0}'
  +'.oi-qicon{color:#e879a0;flex-shrink:0;display:flex;align-items:center;opacity:.8;font-style:normal}'
  +'.oi-qcell .oi-pv{flex:1;min-width:0;display:flex;align-items:center}'
  +'.oi-qcell .oi-val{flex:1;min-width:0;outline:none;background:transparent;font:inherit;font-size:11px;color:#111;cursor:text;border-radius:2px;padding:0 2px;text-align:right}'
  +'.oi-qcell .oi-val:focus{background:rgba(232,121,160,.13)}'
  +'#oi-cpk{position:fixed;z-index:100001;display:none;background:#fff;border-radius:14px;width:270px;box-shadow:0 12px 40px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);overflow:hidden;user-select:none}'
  +'.oi-cpk-hdr{display:flex;align-items:center;padding:14px 14px 0;gap:14px;cursor:move;user-select:none}'
  +'.oi-cpk-tab{border:none;background:transparent;font:600 15px/1.2 system-ui,sans-serif;color:#1a1a1a;cursor:pointer;padding:0;letter-spacing:-.01em}'
  +'.oi-cpk-tab.active{color:#f54e00}'
  +'.oi-cpk-sep{flex:1}'
  +'.oi-cpk-close{width:30px;height:30px;border:1.5px solid #ddd;border-radius:8px;background:#fff;font:17px/1 system-ui,sans-serif;color:#666;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0}'
  +'.oi-cpk-close:hover{background:#f5f5f5}'
  +'.oi-cpk-body{padding:12px 14px 0}'
  +'.oi-cpk-sv{position:relative;width:100%;height:170px;border-radius:8px;overflow:hidden;cursor:crosshair;margin-bottom:12px}'
  +'.oi-cpk-sv-bg,.oi-cpk-sv-s,.oi-cpk-sv-v{position:absolute;inset:0}'
  +'.oi-cpk-sv-s{background:linear-gradient(to right,#fff,transparent)}'
  +'.oi-cpk-sv-v{background:linear-gradient(to bottom,transparent,#000)}'
  +'.oi-cpk-svdot{position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.1);transform:translate(-50%,-50%);pointer-events:none}'
  +'.oi-cpk-ctls{display:flex;align-items:center;gap:10px;margin-bottom:10px}'
  +'.oi-cpk-eye{width:28px;height:28px;border:none;background:transparent;cursor:pointer;padding:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#888;border-radius:5px}'
  +'.oi-cpk-eye:hover{background:#f0f0f0}'
  +'.oi-cpk-sliders{flex:1;display:flex;flex-direction:column;gap:8px}'
  +'.oi-cpk-hue{position:relative;height:12px;border-radius:6px;cursor:pointer;background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}'
  +'.oi-cpk-atrk{position:relative;height:12px;border-radius:6px;cursor:pointer;background:repeating-linear-gradient(45deg,#ccc,#ccc 5px,#f8f8f8 5px,#f8f8f8 10px)}'
  +'.oi-cpk-abar{position:absolute;inset:0;border-radius:6px}'
  +'.oi-cpk-sdot{position:absolute;top:50%;width:16px;height:16px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none}'
  +'.oi-cpk-inp{display:flex;align-items:center;gap:6px;margin-bottom:12px}'
  +'.oi-cpk-fmt{border:1.5px solid #e0e0e0;border-radius:7px;padding:5px 8px;font:12px system-ui,sans-serif;color:#333;background:#fafafa;cursor:pointer;white-space:nowrap;flex-shrink:0}'
  +'.oi-cpk-hexin{flex:1;border:1.5px solid #e0e0e0;border-radius:7px;padding:5px 8px;font:13px ui-monospace,Menlo,monospace;color:#111;background:#fafafa;outline:none;min-width:0;text-transform:uppercase}'
  +'.oi-cpk-hexin:focus{border-color:#bbb;background:#fff}'
  +'.oi-cpk-opain{width:40px;border:1.5px solid #e0e0e0;border-radius:7px;padding:5px 4px;font:12px system-ui,sans-serif;color:#111;background:#fafafa;outline:none;text-align:center;-moz-appearance:textfield}'
  +'.oi-cpk-opain:focus{border-color:#bbb;background:#fff}'
  +'.oi-cpk-pct{font:12px system-ui,sans-serif;color:#888;flex-shrink:0}'
  +'.oi-cpk-div{height:1px;background:#f0f0f0}'
  +'.oi-cpk-pal{padding:10px 14px 12px}'
  +'.oi-cpk-pal-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font:12px system-ui,sans-serif;color:#555;cursor:pointer}'
  +'.oi-cpk-pg{display:flex;flex-wrap:wrap;gap:5px}'
  +'.oi-cpk-pc{width:20px;height:20px;border-radius:5px;border:1.5px solid rgba(0,0,0,.12);cursor:pointer;flex-shrink:0;box-sizing:border-box}'
  +'.oi-cpk-pc:hover{transform:scale(1.15);box-shadow:0 2px 6px rgba(0,0,0,.18)}'
  +'.oi-cpk-grad{display:none}'
  +'.oi-cpk-is-grad .oi-cpk-solid{display:none}'
  +'.oi-cpk-is-grad .oi-cpk-grad{display:block}'
  +'.oi-cpk-gbar-wrap{padding:4px 14px 4px}'
  +'.oi-cpk-gbar{position:relative;height:14px;border-radius:7px;background:repeating-linear-gradient(45deg,#ccc,#ccc 4px,#f8f8f8 4px,#f8f8f8 8px);margin-top:20px;cursor:crosshair;overflow:visible}'
  +'.oi-cpk-gbar-fill{position:absolute;inset:0;border-radius:7px;pointer-events:none}'
  +'.oi-cpk-ghandle{position:absolute;top:-19px;width:18px;height:18px;transform:translateX(-50%);cursor:pointer;border-radius:4px;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);box-sizing:border-box}'
  +'.oi-cpk-ghandle.sel{box-shadow:0 0 0 2.5px #2a7fff,0 1px 4px rgba(0,0,0,.2)}'
  +'.oi-cpk-gstops-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 6px;font:600 12px system-ui,sans-serif;color:#555}'
  +'.oi-cpk-gadd{border:none;background:transparent;font:20px/1 system-ui;color:#888;cursor:pointer;padding:0}'
  +'.oi-cpk-glist{padding:0 14px 12px;display:flex;flex-direction:column;gap:5px;max-height:120px;overflow-y:auto}'
  +'.oi-cpk-gstop-row{display:flex;align-items:center;gap:4px;border-radius:5px;padding:2px 3px;cursor:pointer}'
  +'.oi-cpk-gstop-row.sel{background:rgba(42,127,255,.08)}'
  +'.oi-cpk-gstop-swatch{width:14px;height:14px;border-radius:3px;border:1.5px solid rgba(0,0,0,.15);flex-shrink:0;box-sizing:border-box}'
  +'.oi-cpk-gstop-hex{flex:1;border:1.5px solid #e0e0e0;border-radius:5px;padding:3px 5px;font:11px ui-monospace,Menlo,monospace;color:#111;background:#fafafa;outline:none;min-width:0;text-transform:uppercase}'
  +'.oi-cpk-gstop-opa{width:34px;border:1.5px solid #e0e0e0;border-radius:5px;padding:3px 2px;text-align:center;font:11px system-ui;color:#111;background:#fafafa;outline:none;box-sizing:border-box}'
  +'.oi-cpk-gstop-pct{font:10px system-ui;color:#aaa;flex-shrink:0}'
  +'.oi-cpk-gstop-pos{width:34px;border:1.5px solid #e0e0e0;border-radius:5px;padding:3px 2px;text-align:center;font:11px system-ui;color:#333;background:#fafafa;outline:none;box-sizing:border-box}'
  +'.oi-cpk-gstop-del{border:none;background:transparent;font:13px/1 system-ui;color:#ccc;cursor:pointer;padding:0 2px;flex-shrink:0}'
  +'.oi-cpk-gstop-del:hover{color:#999}'
  +'.oi-hdr-actions{display:flex;gap:4px;align-items:center}'
  +'.oi-hdr-btn{border:none;background:transparent;padding:2px 6px;border-radius:3px;font:12px ui-monospace,Menlo,monospace;color:rgba(232,121,160,.96);cursor:pointer;white-space:nowrap;line-height:1.35;font-weight:700}'
  +'.oi-hdr-key{opacity:.78;font-size:12px;margin-right:5px;font-weight:700}'
  +'.oi-hdr-btn:hover{background:rgba(232,121,160,.1)}'
  +'.oi-shot{position:fixed;z-index:100000;pointer-events:none;border-radius:10px;background:rgba(0,0,0,.82);box-shadow:0 0 0 9999px rgba(0,0,0,.08),0 0 0 1px rgba(255,255,255,.72) inset;animation:oi-shot-flash 280ms cubic-bezier(.23,1,.32,1) both}'
  +'.oi-shot-fly{position:fixed;z-index:100001;pointer-events:none;overflow:hidden;border-radius:10px;background:#fff;box-shadow:0 18px 46px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.82) inset;transform-origin:center;animation:oi-shot-fly 1200ms cubic-bezier(.23,1,.32,1) both}'
  +'.oi-shot-fly>*{pointer-events:none!important;margin:0!important;max-width:none!important;max-height:none!important}'
  +'@keyframes oi-shot-flash{0%{opacity:0;transform:scale(.985)}34%{opacity:.88;transform:scale(1)}100%{opacity:0;transform:scale(1.01)}}'
  +'@keyframes oi-shot-fly{0%{opacity:0;transform:translate(0,0) scale(1)}12%{opacity:1;transform:translate(0,-8px) scale(.98)}48%{opacity:1;transform:translate(calc(var(--oi-fly-x)*.38),calc(var(--oi-fly-y)*.18 - 26px)) scale(.56);border-radius:18px}100%{opacity:0;transform:translate(var(--oi-fly-x),var(--oi-fly-y)) scale(.12);border-radius:999px}}';
document.head.appendChild(css);
function mk(tag,id){var el=document.createElement(tag);if(id)el.id=id;document.body.appendChild(el);return el;}
var act=false,sel=null,selR=null,bgs=[],pickedEvents=new WeakSet();
var ready=false,currentProps=[],activeProp='';
var L={uploadImage:'⌘M 截屏',imageRef:'Image',textRef:'Text references',colorRef:'Design system colors',refOptions:'Options'};
function boot(){
  if(ready||!document.body)return;ready=true;
  document.querySelectorAll('#oi-hit,#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,.oi-shot,.oi-shot-fly').forEach(function(el){el.remove();});
  var hit=mk('div','oi-hit'),selB=mk('div','oi-sel'),hovB=mk('div','oi-hov');
  var svgEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgEl.id='oi-svg';svgEl.setAttribute('xmlns','http://www.w3.org/2000/svg');document.body.appendChild(svgEl);
  var card=mk('div','oi-card');
  var cardDrag=null;
  function isHost(el){return !!(el&&el.matches&&el.matches('#oi-hit,#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,[data-oi],[data-od-annotate-bridge]'));}
  function domPath(el){var parts=[],node=el;while(node&&node!==document.body){var parent=node.parentElement;if(!parent)break;var children=Array.prototype.slice.call(parent.children).filter(function(child){return!isHost(child);});parts.unshift(children.indexOf(node));node=parent;}return parts.length?'path-'+parts.join('-'):'';}
  function stableId(el){var explicit=el.getAttribute('data-od-id');if(explicit)return explicit;var generated=el.getAttribute('data-od-source-path')||el.getAttribute('data-od-runtime-id')||domPath(el);if(generated)el.setAttribute('data-od-runtime-id',generated);return generated||'';}
  function postSave(prop,val){if(!sel)return;var id=stableId(sel);if(!id)return;try{window.parent&&window.parent.postMessage({type:'od:annotate-style-change',id:id,property:prop,value:val,label:eSel(sel)},'*');}catch(_){}}
  function postTextSave(val){if(!sel)return;var id=stableId(sel);if(!id)return;try{window.parent&&window.parent.postMessage({type:'od:annotate-text-change',id:id,value:val,label:eSel(sel)},'*');}catch(_){}}
  function postImageSave(file){if(!sel||!file)return;var id=stableId(sel);if(!id)return;try{window.parent&&window.parent.postMessage({type:'od:annotate-image-change',id:id,file:file,alt:sel.getAttribute('alt')||'',label:eSel(sel)},'*');}catch(_){}}
  function postImageSrcSave(src,alt){if(!sel)return;var id=stableId(sel);if(!id)return;try{window.parent&&window.parent.postMessage({type:'od:annotate-image-src-change',id:id,src:src,alt:alt||'',label:eSel(sel)},'*');}catch(_){}}
  function eSel(el){var tag=el.tagName.toLowerCase(),cls=Array.from(el.classList).slice(0,5).map(function(c){return'.'+c;}).join(''),id=el.id?'#'+el.id:'';return'&lt;'+tag+'&gt;'+(id||cls);}
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function toHex(rgb){var m=rgb.match(/rgba?\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)/);return m?'#'+[m[1],m[2],m[3]].map(function(n){return(+n).toString(16).padStart(2,'0');}).join(''):rgb;}
  function colorsIn(s){return String(s||'').match(/#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|oklch\\([^)]*\\)|oklab\\([^)]*\\)|color\\([^)]*\\)/g)||[];}
  function cleanColor(v){var s=String(v||'').trim();if(!s||/transparent/i.test(s)||/rgba\\([^)]*,\\s*0\\s*\\)$/i.test(s))return'';return toHex(s);}
  function uniq(arr){var out=[],seen={};(arr||[]).forEach(function(v){var s=String(v||'').trim();if(!s||seen[s.toLowerCase()])return;seen[s.toLowerCase()]=1;out.push(s);});return out;}
  function hsvToRgb(h,s,v){var i=Math.floor(h/60)%6,f=h/60-Math.floor(h/60),p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s),rgb=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];return{r:Math.round(rgb[0]*255),g:Math.round(rgb[1]*255),b:Math.round(rgb[2]*255)};}
  function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;var max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,s=max===0?0:d/max,v=max,h=0;if(d>0){if(max===r)h=((g-b)/d+6)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}return{h:h,s:s,v:v};}
  function parseColorToHsva(str){var s=String(str||'').trim(),m,hsv;if((m=s.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([\\d.]+))?\\s*\\)/))){hsv=rgbToHsv(+m[1],+m[2],+m[3]);return{h:hsv.h,s:hsv.s,v:hsv.v,a:m[4]!=null?parseFloat(m[4]):1};}if((m=s.match(/^#([0-9a-fA-F]{3,8})$/))){var hx=m[1];if(hx.length===3||hx.length===4)hx=hx.split('').map(function(c){return c+c;}).join('');var r=parseInt(hx.slice(0,2),16),g=parseInt(hx.slice(2,4),16),b=parseInt(hx.slice(4,6),16),a=hx.length>=8?parseInt(hx.slice(6,8),16)/255:1;hsv=rgbToHsv(r,g,b);return{h:hsv.h,s:hsv.s,v:hsv.v,a:a};}return null;}
  function hsvaToColor(h,s,v,a){var c=hsvToRgb(h,s,v);if(a>=0.999)return'#'+[c.r,c.g,c.b].map(function(n){return n.toString(16).padStart(2,'0');}).join('');return'rgba('+c.r+','+c.g+','+c.b+','+Math.round(a*100)/100+')';}
  var cpk={el:null,pv:null,h:0,s:1,v:1,a:1,drag:null,moveOff:null,hexFocused:false,opaFocused:false,grad:{stops:[],sel:0},gradDragging:null};
  var EYESVG='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  function cpkBuild(){
    if(cpk.el)return;
    var el=document.createElement('div');el.id='oi-cpk';
    el.innerHTML=
      '<div class="oi-cpk-hdr"><button class="oi-cpk-tab active" data-tab="solid">纯色</button><button class="oi-cpk-tab" data-tab="gradient">渐变</button><span class="oi-cpk-sep"></span><button class="oi-cpk-close">×</button></div>'+
      '<div class="oi-cpk-body">'+
        '<div class="oi-cpk-sv"><div class="oi-cpk-sv-bg"></div><div class="oi-cpk-sv-s"></div><div class="oi-cpk-sv-v"></div><div class="oi-cpk-svdot"></div></div>'+
        '<div class="oi-cpk-ctls"><button class="oi-cpk-eye">'+EYESVG+'</button><div class="oi-cpk-sliders"><div class="oi-cpk-hue"><div class="oi-cpk-sdot" id="oi-cpk-hd"></div></div><div class="oi-cpk-atrk"><div class="oi-cpk-abar"></div><div class="oi-cpk-sdot" id="oi-cpk-ad"></div></div></div></div>'+
        '<div class="oi-cpk-inp"><button class="oi-cpk-fmt">Hex ▾</button><input id="oi-cpk-hex" class="oi-cpk-hexin" type="text" maxlength="6" spellcheck="false"><input id="oi-cpk-opa" class="oi-cpk-opain" type="number" min="0" max="100"><span class="oi-cpk-pct">%</span></div>'+
      '</div>'+
      '<div class="oi-cpk-solid"><div class="oi-cpk-div"></div><div class="oi-cpk-pal"><div class="oi-cpk-pal-row"><span>在此页面</span><span>▾</span></div><div class="oi-cpk-pg" id="oi-cpk-pg"></div></div></div>'+
      '<div class="oi-cpk-grad"><div class="oi-cpk-gbar-wrap"><div class="oi-cpk-gbar" id="oi-cpk-gbar"><div class="oi-cpk-gbar-fill"></div></div></div><div class="oi-cpk-gstops-hd"><span>断点</span><button class="oi-cpk-gadd">+</button></div><div class="oi-cpk-glist" id="oi-cpk-glist"></div></div>';
    document.body.appendChild(el);cpk.el=el;
    el.querySelector('.oi-cpk-close').addEventListener('click',function(){cpkClose();});
    el.querySelector('.oi-cpk-hdr').addEventListener('mousedown',function(e){
      if(e.target.closest('button'))return;
      e.preventDefault();
      var r=el.getBoundingClientRect();
      cpk.moveOff={x:e.clientX-r.left,y:e.clientY-r.top};
    });
    el.querySelectorAll('.oi-cpk-tab').forEach(function(btn){
      btn.addEventListener('click',function(){
        el.querySelectorAll('.oi-cpk-tab').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        var isGrad=btn.getAttribute('data-tab')==='gradient';
        el.classList.toggle('oi-cpk-is-grad',isGrad);
        if(isGrad){
          if(!cpk.grad.stops.length){cpk.grad.stops=[{pos:0,h:cpk.h,s:cpk.s,v:cpk.v,a:cpk.a},{pos:1,h:cpk.h,s:Math.max(0,cpk.s-0.5),v:Math.min(1,cpk.v+0.3),a:cpk.a}];cpk.grad.sel=0;}
          gradUI();cpkEmit();
        }
      });
    });
    var gbarEl=el.querySelector('#oi-cpk-gbar');
    gbarEl.addEventListener('mousedown',function(e){
      if(e.target.classList.contains('oi-cpk-ghandle'))return;
      var r=gbarEl.getBoundingClientRect(),pos=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      cpk.grad.stops.push({pos:pos,h:cpk.h,s:cpk.s,v:cpk.v,a:cpk.a});
      cpk.grad.stops.sort(function(a,b){return a.pos-b.pos;});
      var newSt=cpk.grad.stops.find(function(s){return Math.abs(s.pos-pos)<0.0001;});
      cpk.grad.sel=newSt?cpk.grad.stops.indexOf(newSt):0;
      gradUI();cpkEmit();e.preventDefault();
    });
    el.querySelector('.oi-cpk-gadd').addEventListener('click',function(){
      var pos=0.5;
      if(cpk.grad.stops.length>=2){var best=0;for(var gai=0;gai<cpk.grad.stops.length-1;gai++){var gap=cpk.grad.stops[gai+1].pos-cpk.grad.stops[gai].pos;if(gap>best){best=gap;pos=(cpk.grad.stops[gai].pos+cpk.grad.stops[gai+1].pos)/2;}}}
      cpk.grad.stops.push({pos:pos,h:cpk.h,s:cpk.s,v:cpk.v,a:cpk.a});
      cpk.grad.stops.sort(function(a,b){return a.pos-b.pos;});
      var newSt2=cpk.grad.stops.find(function(s){return Math.abs(s.pos-pos)<0.0001;});
      cpk.grad.sel=newSt2?cpk.grad.stops.indexOf(newSt2):0;
      gradUI();cpkEmit();
    });
    // Eyedropper (EyeDropper API)
    el.querySelector('.oi-cpk-eye').addEventListener('click',function(){
      if(!window.EyeDropper)return;
      try{new window.EyeDropper().open().then(function(r){var p=parseColorToHsva(r.sRGBHex);if(p&&cpk.pv){cpk.h=p.h;cpk.s=p.s;cpk.v=p.v;cpkUI();cpkEmit();}}).catch(function(){});}catch(_){}
    });
    function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
    var svEl=el.querySelector('.oi-cpk-sv');
    function svDrag(e){var r=svEl.getBoundingClientRect();cpk.s=clamp((e.clientX-r.left)/r.width,0,1);cpk.v=clamp(1-(e.clientY-r.top)/r.height,0,1);cpkUI();cpkEmit();}
    svEl.addEventListener('mousedown',function(e){e.preventDefault();cpk.drag='sv';svDrag(e);});
    var hueEl=el.querySelector('.oi-cpk-hue');
    function hueDrag(e){var r=hueEl.getBoundingClientRect();cpk.h=clamp((e.clientX-r.left)/r.width,0,0.9999)*360;cpkUI();cpkEmit();}
    hueEl.addEventListener('mousedown',function(e){e.preventDefault();cpk.drag='hue';hueDrag(e);});
    var aEl=el.querySelector('.oi-cpk-atrk');
    function aDrag(e){var r=aEl.getBoundingClientRect();cpk.a=clamp((e.clientX-r.left)/r.width,0,1);cpkUI();cpkEmit();}
    aEl.addEventListener('mousedown',function(e){e.preventDefault();cpk.drag='a';aDrag(e);});
    document.addEventListener('mousemove',function(e){
      if(cpk.moveOff){var x=e.clientX-cpk.moveOff.x,y=e.clientY-cpk.moveOff.y;el.style.left=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,x))+'px';el.style.top=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,y))+'px';return;}
      if(cpk.gradDragging){var gb=el.querySelector('#oi-cpk-gbar');if(gb){var gr=gb.getBoundingClientRect();cpk.gradDragging.pos=Math.max(0,Math.min(1,(e.clientX-gr.left)/gr.width));cpk.grad.stops.sort(function(a,b){return a.pos-b.pos;});cpk.grad.sel=cpk.grad.stops.indexOf(cpk.gradDragging);gradUI();cpkEmit();}return;}
      if(cpk.drag==='sv')svDrag(e);else if(cpk.drag==='hue')hueDrag(e);else if(cpk.drag==='a')aDrag(e);
    });
    document.addEventListener('mouseup',function(){cpk.drag=null;cpk.moveOff=null;cpk.gradDragging=null;});
    var hexIn=el.querySelector('#oi-cpk-hex'),opaIn=el.querySelector('#oi-cpk-opa');
    hexIn.addEventListener('change',function(){
      var h2=hexIn.value.replace(/[^0-9a-fA-F]/g,'');if(h2.length<6)return;
      var p=parseColorToHsva('#'+h2);if(!p)return;cpk.h=p.h;cpk.s=p.s;cpk.v=p.v;cpkUI();cpkEmit();
    });
    opaIn.addEventListener('change',function(){
      var n=parseInt(opaIn.value,10);if(isNaN(n))return;cpk.a=Math.max(0,Math.min(100,n))/100;cpkUI();cpkEmit();
    });
    hexIn.addEventListener('focus',function(){cpk.hexFocused=true;});
    hexIn.addEventListener('blur',function(){cpk.hexFocused=false;});
    opaIn.addEventListener('focus',function(){cpk.opaFocused=true;});
    opaIn.addEventListener('blur',function(){cpk.opaFocused=false;});
  }
  function cpkUI(){
    if(!cpk.el)return;
    var h=cpk.h,s=cpk.s,v=cpk.v,a=cpk.a,rgb=hsvToRgb(h,s,v),pure=hsvToRgb(h,1,1);
    var bg=cpk.el.querySelector('.oi-cpk-sv-bg');if(bg)bg.style.background='hsl('+Math.round(h)+',100%,50%)';
    var svd=cpk.el.querySelector('.oi-cpk-svdot');if(svd){svd.style.left=(s*100)+'%';svd.style.top=((1-v)*100)+'%';}
    var hd=cpk.el.querySelector('#oi-cpk-hd');if(hd)hd.style.left=(h/360*100)+'%';
    var abar=cpk.el.querySelector('.oi-cpk-abar');if(abar)abar.style.background='linear-gradient(to right,rgba('+pure.r+','+pure.g+','+pure.b+',0),rgb('+pure.r+','+pure.g+','+pure.b+'))';
    var ad=cpk.el.querySelector('#oi-cpk-ad');if(ad)ad.style.left=(a*100)+'%';
    var hexIn=cpk.el.querySelector('#oi-cpk-hex'),opaIn=cpk.el.querySelector('#oi-cpk-opa');
    var hexStr=[rgb.r,rgb.g,rgb.b].map(function(n){return n.toString(16).toUpperCase().padStart(2,'0');}).join('');
    if(hexIn&&!cpk.hexFocused)hexIn.value=hexStr;
    if(opaIn&&!cpk.opaFocused)opaIn.value=Math.round(a*100);
    if(cpk.el.classList.contains('oi-cpk-is-grad'))gradUI();
  }
  function cpkPopulatePalette(){
    var pg=cpk.el&&cpk.el.querySelector('#oi-cpk-pg');if(!pg)return;
    var colors=paletteColors(currentProps).filter(function(c){return!!parseColorToHsva(c);});
    pg.innerHTML=colors.map(function(c){return'<button class="oi-cpk-pc" style="background:'+c+'" title="'+c+'" data-color="'+c+'"></button>';}).join('');
    pg.querySelectorAll('.oi-cpk-pc').forEach(function(btn){btn.addEventListener('click',function(){var p=parseColorToHsva(btn.getAttribute('data-color'));if(!p)return;cpk.h=p.h;cpk.s=p.s;cpk.v=p.v;cpk.a=p.a;cpkUI();cpkEmit();});});
  }
  function cpkEmit(){if(!cpk.pv)return;if(cpk.el&&cpk.el.classList.contains('oi-cpk-is-grad')){var gst=cpk.grad.stops[cpk.grad.sel];if(gst){gst.h=cpk.h;gst.s=cpk.s;gst.v=cpk.v;gst.a=cpk.a;}var css=gradToCSS();var gval=cpk.pv.querySelector('.oi-val'),gsw=cpk.pv.querySelector('.oi-sw');if(gval)gval.textContent=css;if(gsw){gsw.style.background=css;gsw.setAttribute('data-color',css);}if(sel){pushUndo(captureUndo('background-image'));sel.style.setProperty('background-image',css);postSave('background-image',css);}refreshAfterEdit();}else{setColorPv(cpk.pv,hsvaToColor(cpk.h,cpk.s,cpk.v,cpk.a));}}
  function gradToCSS(){
    if(!cpk.grad.stops.length)return'transparent';
    var ss=cpk.grad.stops.slice().sort(function(a,b){return a.pos-b.pos;});
    return'linear-gradient(to right,'+ss.map(function(s){var c=hsvToRgb(s.h,s.s,s.v);var hex='#'+[c.r,c.g,c.b].map(function(n){return n.toString(16).padStart(2,'0');}).join('');return(s.a<0.999?'rgba('+c.r+','+c.g+','+c.b+','+Math.round(s.a*100)/100+')':hex)+' '+Math.round(s.pos*100)+'%';}).join(',')+')';
  }
  function gradUI(){
    if(!cpk.el)return;
    var gbar=cpk.el.querySelector('#oi-cpk-gbar'),glist=cpk.el.querySelector('#oi-cpk-glist');
    if(!gbar||!glist)return;
    var gfill=gbar.querySelector('.oi-cpk-gbar-fill');
    if(gfill)gfill.style.background=gradToCSS();
    gbar.querySelectorAll('.oi-cpk-ghandle').forEach(function(h){h.remove();});
    cpk.grad.stops.forEach(function(st,i){
      var handle=document.createElement('div');
      handle.className='oi-cpk-ghandle'+(i===cpk.grad.sel?' sel':'');
      var rgb=hsvToRgb(st.h,st.s,st.v);
      handle.style.cssText='background:rgb('+rgb.r+','+rgb.g+','+rgb.b+');left:'+Math.round(st.pos*100)+'%;';
      handle.addEventListener('mousedown',function(e){
        e.stopPropagation();e.preventDefault();
        cpk.grad.sel=i;cpk.h=st.h;cpk.s=st.s;cpk.v=st.v;cpk.a=st.a;
        cpk.gradDragging=st;
        gradUI();cpkUI();
      });
      gbar.appendChild(handle);
    });
    glist.innerHTML='';
    cpk.grad.stops.forEach(function(st,i){
      var rgb=hsvToRgb(st.h,st.s,st.v);
      var hex=[rgb.r,rgb.g,rgb.b].map(function(n){return n.toString(16).toUpperCase().padStart(2,'0');}).join('');
      var row=document.createElement('div');
      row.className='oi-cpk-gstop-row'+(i===cpk.grad.sel?' sel':'');
      row.innerHTML=
        '<span class="oi-cpk-gstop-swatch" style="background:rgb('+rgb.r+','+rgb.g+','+rgb.b+')"></span>'+
        '<input class="oi-cpk-gstop-hex" type="text" maxlength="6" value="'+hex+'" spellcheck="false">'+
        '<input class="oi-cpk-gstop-opa" type="number" min="0" max="100" value="'+Math.round(st.a*100)+'">'+
        '<span class="oi-cpk-gstop-pct">%</span>'+
        '<input class="oi-cpk-gstop-pos" type="number" min="0" max="100" value="'+Math.round(st.pos*100)+'">'+
        '<span class="oi-cpk-gstop-pct">%</span>'+
        '<button class="oi-cpk-gstop-del">—</button>';
      row.addEventListener('mousedown',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON')return;cpk.grad.sel=i;cpk.h=st.h;cpk.s=st.s;cpk.v=st.v;cpk.a=st.a;gradUI();cpkUI();});
      var hIn=row.querySelector('.oi-cpk-gstop-hex');
      hIn.addEventListener('change',function(){var h2=hIn.value.replace(/[^0-9a-fA-F]/g,'');if(h2.length<6)return;var p=parseColorToHsva('#'+h2);if(!p)return;st.h=p.h;st.s=p.s;st.v=p.v;if(i===cpk.grad.sel){cpk.h=st.h;cpk.s=st.s;cpk.v=st.v;}gradUI();cpkUI();cpkEmit();});
      var oIn=row.querySelector('.oi-cpk-gstop-opa');
      oIn.addEventListener('change',function(){var n=parseInt(oIn.value,10);if(isNaN(n))return;st.a=Math.max(0,Math.min(100,n))/100;if(i===cpk.grad.sel)cpk.a=st.a;gradUI();cpkUI();cpkEmit();});
      var pIn=row.querySelector('.oi-cpk-gstop-pos');
      pIn.addEventListener('change',function(){var n=parseInt(pIn.value,10);if(isNaN(n))return;st.pos=Math.max(0,Math.min(100,n))/100;cpk.grad.stops.sort(function(a,b){return a.pos-b.pos;});cpk.grad.sel=cpk.grad.stops.indexOf(st);gradUI();cpkEmit();});
      row.querySelector('.oi-cpk-gstop-del').addEventListener('click',function(e){e.stopPropagation();if(cpk.grad.stops.length<=2)return;var si=cpk.grad.stops.indexOf(st);if(si>=0)cpk.grad.stops.splice(si,1);if(cpk.grad.sel>=cpk.grad.stops.length)cpk.grad.sel=cpk.grad.stops.length-1;var ns=cpk.grad.stops[cpk.grad.sel];if(ns){cpk.h=ns.h;cpk.s=ns.s;cpk.v=ns.v;cpk.a=ns.a;}gradUI();cpkUI();cpkEmit();});
      glist.appendChild(row);
    });
  }
  function cpkOpen(pv){
    cpkBuild();cpk.pv=pv;
    var val=pv.querySelector('.oi-val'),valStr=val?val.textContent:'',parsed=parseColorToHsva(valStr);
    cpk.el.querySelectorAll('.oi-cpk-tab').forEach(function(b){b.classList.remove('active');});
    cpk.el.querySelector('[data-tab="solid"]').classList.add('active');
    cpk.el.classList.remove('oi-cpk-is-grad');
    cpk.grad.stops=[];cpk.grad.sel=0;cpk.gradDragging=null;
    if(parsed){cpk.h=parsed.h;cpk.s=parsed.s;cpk.v=parsed.v;cpk.a=parsed.a;}else{cpk.h=0;cpk.s=0;cpk.v=0;cpk.a=1;}
    var r=card.getBoundingClientRect(),pw=270,ph=460;
    var x=r.right+8,y=r.top;
    if(x+pw>window.innerWidth-8)x=r.left-pw-8;if(x<8)x=8;
    if(y+ph>window.innerHeight-8)y=window.innerHeight-ph-8;if(y<8)y=8;
    cpk.el.style.cssText='display:block;left:'+x+'px;top:'+y+'px;';
    cpkUI();cpkPopulatePalette();
  }
  function cpkClose(){if(cpk.el)cpk.el.style.display='none';cpk.pv=null;}
  function paletteColors(props){var out=[],seen={};function add(v){var c=cleanColor(v);if(!c||seen[c.toLowerCase()]||c==='rgba(0, 0, 0, 0)')return;seen[c.toLowerCase()]=1;out.push(c);}
    props.forEach(function(p){if(CP[p.n])add(p.v);});
    try{var rs=getComputedStyle(document.documentElement);for(var i=0;i<rs.length;i++){var n=rs[i];if(n.indexOf('--')===0)colorsIn(rs.getPropertyValue(n)).forEach(add);}}catch(_){}
    try{Array.from(document.styleSheets).forEach(function(ss){try{Array.from(ss.cssRules||[]).forEach(function(r){colorsIn(r.cssText).forEach(add);});}catch(_){}});}catch(_){}
    try{Array.from(document.querySelectorAll('[style]')).slice(0,400).forEach(function(el){colorsIn(el.getAttribute('style')).forEach(add);});}catch(_){}
    return out.slice(0,30);
  }
  function valuesFor(prop){var out=[],en={display:['block','flex','grid','inline-flex','inline-block','none'],position:['relative','absolute','fixed','sticky','static'],'align-items':['stretch','flex-start','center','flex-end','baseline'],'justify-content':['flex-start','center','flex-end','space-between','space-around','space-evenly'],'flex-direction':['row','column','row-reverse','column-reverse'],'flex-wrap':['nowrap','wrap','wrap-reverse'],'text-align':['left','center','right','justify'],'font-weight':['300','400','500','600','700','800']};if(en[prop])return en[prop];if(BP[prop])out=out.concat(['0px','4px','8px','12px','16px','20px','24px','32px','40px','48px']);try{Array.from(document.querySelectorAll('body *')).slice(0,600).forEach(function(el){var cs=getComputedStyle(el),v=cs.getPropertyValue(prop).trim();if(v&&v!=='normal'&&v!=='none'&&v!=='auto')out.push(prop==='font-family'?v.split(',')[0].trim().replace(/["']/g,''):v);});}catch(_){}try{var rs=getComputedStyle(document.documentElement);for(var i=0;i<rs.length;i++){var n=rs[i],v=rs.getPropertyValue(n).trim();if(n.indexOf('--')===0&&(/font|type|space|gap|size|radius|leading|line|weight/i.test(n)))out.push(v);}}catch(_){}return uniq(out).slice(0,24);}
  function textSnippets(){var out=[];try{Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,span')).slice(0,300).forEach(function(el){if(el.children.length)return;var t=(el.textContent||'').replace(/\\s+/g,' ').trim();if(t&&t.length<80)out.push(t);});}catch(_){}return uniq(out).slice(0,16);}
  function refItems(prop){return prop==='__image'?{kind:'value',title:L.imageRef,items:[L.uploadImage],isUpload:true}:prop==='__text'?{kind:'value',title:L.textRef,items:textSnippets()}:CP[prop]?{kind:'color',title:L.colorRef,items:paletteColors(currentProps)}:{kind:'value',title:L.refOptions+' \xb7 '+prop,items:valuesFor(prop)};}
  function propsOf(el){var cs=window.getComputedStyle(el),rect=el.getBoundingClientRect(),out=[{n:'width',v:Math.round(rect.width)+'px'},{n:'height',v:Math.round(rect.height)+'px'}];for(var i=0;i<PP.length;i++){var p=PP[i],v=cs.getPropertyValue(p).trim();if(!v)continue;if(SK[p]===v&&!BP[p])continue;if((v==='none'||v==='0px'||v==='normal'||v==='auto')&&['display','overflow','gap'].indexOf(p)<0&&!BP[p])continue;if(p==='font-family')v=v.split(',')[0].trim().replace(/["']/g,'');if(p==='box-shadow'&&v==='none')continue;out.push({n:p,v:v});}return out;}
  function shownValue(p){if(CP[p.n]){var t=p.v.indexOf('0, 0, 0, 0')>=0||p.v==='transparent';return t?'transparent':toHex(p.v);}return p.v;}
  function canEditText(el){return !!(el&&el.children&&el.children.length===0&&(el.textContent||'').trim());}
  function imageName(el){var src=el.getAttribute('src')||'';return src.split('/').pop()||src||L.uploadImage;}
  function openCard(el){
    var rect=el.getBoundingClientRect(),props=propsOf(el);
    if(el.tagName&&el.tagName.toLowerCase()==='img')props.unshift({n:'__image',v:imageName(el)});
    if(canEditText(el))props.unshift({n:'__text',v:(el.textContent||'').trim()});
    currentProps=props;
    var pm={};for(var pi=0;pi<props.length;pi++)pm[props[pi].n]=props[pi];
    var QGS={'padding':['padding-top','padding-right','padding-bottom','padding-left'],'margin':['margin-top','margin-right','margin-bottom','margin-left'],'border-radius':['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius']};
    var QSM={};for(var qk in QGS){var qs=QGS[qk];for(var qj=0;qj<qs.length;qj++)QSM[qs[qj]]=qk;}
    var SVGT='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM20 5H4V19H20V5ZM18 7V9H6V7H18Z"/></svg>';
    var SVGB='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM20 5H4V19H20V5ZM18 15V17H6V15H18Z"/></svg>';
    var SVGL='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM20 5H4V19H20V5ZM8 7V17H6V7H8Z"/></svg>';
    var SVGR='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM20 5H4V19H20V5ZM18 7V17H16V7H18Z"/></svg>';
    var QO_PM=[0,3,2,1],QI_PM=[SVGT,SVGL,SVGB,SVGR];
    var QO_BR=[0,1,3,2],QI_BR=['◤','◥','◣','◢'];
    function mkqcell(sideProp,icon){var sp=pm[sideProp],sv=sp?shownValue(sp):'0px';return '<div class="oi-qcell"><em class="oi-qicon">'+icon+'</em><span class="oi-pv" data-p="'+esc(sideProp)+'"><span class="oi-val" contenteditable="true" spellcheck="false">'+esc(sv)+'</span></span></div>';}
    function mkquad(sh){var sides=QGS[sh],isR=sh==='border-radius',qo=isR?QO_BR:QO_PM,qi=isR?QI_BR:QI_PM,sp=pm[sh],sum=sp?esc(shownValue(sp)):'',qh='<div class="oi-quad" data-q="'+esc(sh)+'"><div class="oi-quad-hd"><span class="oi-pn">'+esc(sh)+'</span><div class="oi-quad-right">'+(sum?'<em class="oi-quad-sum">'+sum+'</em>':'')+'<button class="oi-quad-xbtn" type="button">▸</button></div></div><div class="oi-qgrid">';for(var k=0;k<4;k++)qh+=mkqcell(sides[qo[k]],qi[k]);return qh+'</div></div>';}
    var emittedQ={};
    var h='<div class="oi-hdr"><div class="oi-tag">'+eSel(el)+'</div><div class="oi-hdr-actions"><button class="oi-hdr-btn" type="button" data-action="capture"><span class="oi-hdr-key">⌘M</span>截屏</button></div></div><div class="oi-body">';
    for(var i=0;i<props.length;i++){
      var p=props[i];
      if(QSM[p.n]){var gk=QSM[p.n];if(!emittedQ[gk]&&!pm[gk]){var gs=QGS[gk],allG=true;for(var gi=0;gi<gs.length;gi++){if(!pm[gs[gi]]){allG=false;break;}}if(allG){emittedQ[gk]=true;h+=mkquad(gk);}}continue;}
      if(QGS[p.n]&&!emittedQ[p.n]){var allQ=true,qa=QGS[p.n];for(var qi2=0;qi2<qa.length;qi2++){if(!pm[qa[qi2]]){allQ=false;break;}}if(allQ){emittedQ[p.n]=true;h+=mkquad(p.n);continue;}}
      var val=(p.n==='__text'||p.n==='__image')?p.v:shownValue(p),sw='',colorClass=CP[p.n]?' oi-color-row':'';
      if(CP[p.n]&&val!=='transparent')sw='<span class="oi-sw" data-color="'+esc(val)+'" style="background:'+esc(p.v)+'"></span>';
      h+='<div class="oi-row'+colorClass+'"><span class="oi-pn">'+esc(p.n==='__text'?'text':p.n==='__image'?'image':p.n)+'</span><span class="oi-pv" data-p="'+esc(p.n)+'">'+sw+'<span class="oi-val" contenteditable="'+(p.n==='__image'?'false':'true')+'" spellcheck="false">'+esc(val)+'</span></span></div>';
    }
    h+='</div><div class="oi-ref"><div class="oi-ref-title"></div><div class="oi-ref-grid"></div></div><input class="oi-color-input" type="color" value="#000000"><input class="oi-file-input" type="file" accept="image/*">';
    card.innerHTML=h;card.style.display='block';
    setActiveProp((props.find(function(p){return p.n==='__text'||p.n==='__image';})||props.find(function(p){return CP[p.n];})||props[0]||{}).n||'',false);
    placeCard(rect);
  }
  function renderRefs(prop){var data=refItems(prop),title=card.querySelector('.oi-ref-title'),grid=card.querySelector('.oi-ref-grid');if(!title||!grid)return;title.textContent=data.title;grid.innerHTML=(data.items||[]).map(function(v){return data.kind==='color'?'<button class="oi-chip" type="button" data-color="'+esc(v)+'" title="'+esc(v)+'" style="background:'+esc(v)+'"></button>':'<button class="oi-opt" type="button" '+(data.isUpload?'data-od-upload="1" ':'')+'data-value="'+esc(v)+'" title="'+esc(v)+'">'+esc(v)+'</button>';}).join('');}
  function setActiveProp(prop,focusValue){if(!prop)return;activeProp=prop;card.querySelectorAll('.oi-row.active').forEach(function(r){r.classList.remove('active');});card.querySelectorAll('.oi-pv[data-active-color]').forEach(function(n){n.removeAttribute('data-active-color');});var pv=card.querySelector('.oi-pv[data-p="'+prop.replace(/"/g,'\\\\"')+'"]');if(pv){var row=pv.closest('.oi-row');if(row)row.classList.add('active');if(CP[prop])pv.setAttribute('data-active-color','1');if(focusValue){var val=pv.querySelector('.oi-val');if(val){val.focus({preventScroll:true});document.execCommand&&document.execCommand('selectAll',false,null);}}}renderRefs(prop);}
  function refreshAfterEdit(){if(!sel)return;selR=sel.getBoundingClientRect();posBox(selB,selR);placeCard(selR);}
  var undoStack=[],isUndoing=false;
  function playCaptureAnimation(){
    var target=sel||card;
    if(!target)return;
    var r=target.getBoundingClientRect();
    if(!r||r.width<=0||r.height<=0)return;
    document.querySelectorAll('.oi-shot,.oi-shot-fly').forEach(function(el){el.remove();});
    var fx=document.createElement('div');
    fx.className='oi-shot';
    fx.style.left=r.left+'px';
    fx.style.top=r.top+'px';
    fx.style.width=r.width+'px';
    fx.style.height=r.height+'px';
    document.body.appendChild(fx);
    fx.addEventListener('animationend',function(){fx.remove();},{once:true});
    setTimeout(function(){if(fx&&fx.parentNode)fx.remove();},340);
    setTimeout(function(){
      var fly=document.createElement('div');
      fly.className='oi-shot-fly';
      fly.style.left=r.left+'px';
      fly.style.top=r.top+'px';
      fly.style.width=r.width+'px';
      fly.style.height=r.height+'px';
      fly.style.setProperty('--oi-fly-x',(-(r.left+r.width+120))+'px');
      fly.style.setProperty('--oi-fly-y',(Math.max(28-r.top,-Math.min(220,r.top*.45)))+'px');
      try{
        var clone=target.cloneNode(true);
        clone.removeAttribute&&clone.removeAttribute('id');
        clone.setAttribute&&clone.setAttribute('aria-hidden','true');
        clone.style.width=r.width+'px';
        clone.style.height=r.height+'px';
        clone.style.boxSizing='border-box';
        clone.style.transform='none';
        fly.appendChild(clone);
      }catch(_){}
      document.body.appendChild(fly);
      fly.addEventListener('animationend',function(){fly.remove();},{once:true});
      setTimeout(function(){if(fly&&fly.parentNode)fly.remove();},1480);
    },170);
  }
  function inlineOverlayStyle(n,c){try{if(!n||!c||!c.style)return;var cs=getComputedStyle(n),st=c.style;for(var i=0;i<cs.length;i++){var p=cs[i],v=cs.getPropertyValue(p);if(!v||v.indexOf('url(')!==-1)continue;st.setProperty(p,v,cs.getPropertyPriority(p));}var ns=n.children||[],csn=c.children||[],len=Math.min(ns.length,csn.length);for(var j=0;j<len;j++)inlineOverlayStyle(ns[j],csn[j]);}catch(_){}}
  function overlaySnapshot(){var html='';try{document.querySelectorAll('#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,.oi-shot,.oi-shot-fly,#oi-cpk,.oi-cpk').forEach(function(n){var c=n.cloneNode(true),r=n.getBoundingClientRect&&n.getBoundingClientRect();inlineOverlayStyle(n,c);if(r&&c&&c.style){c.style.position='absolute';c.style.left=Math.round(r.left)+'px';c.style.top=Math.round(r.top)+'px';c.style.width=Math.round(r.width)+'px';c.style.height=Math.round(r.height)+'px';c.style.margin='0';c.style.transform='none';if(c.id==='oi-card'||c.id==='oi-svg'||c.classList.contains('oi-badge')||c.classList.contains('oi-shot')||c.classList.contains('oi-shot-fly'))c.style.display='block';}html+=c.outerHTML||'';});}catch(_){}return{html:html,css:css.textContent||'',scrollX:window.scrollX||0,scrollY:window.scrollY||0};}
  function captureAnnotatable(captureId){playCaptureAnimation();try{window.parent&&window.parent.postMessage({type:'od:annotate-capture',captureId:captureId||'',overlay:overlaySnapshot()},'*');}catch(_){}}
  function pushUndo(entry){if(isUndoing||!entry||!entry.id)return;undoStack.push(entry);if(undoStack.length>80)undoStack.shift();}
  function captureUndo(prop){if(!sel)return null;var id=stableId(sel);if(!id)return null;if(prop==='__text')return{kind:'text',id:id,value:sel.textContent||''};if(prop==='__image')return{kind:'image',id:id,src:sel.getAttribute('src')||'',alt:sel.getAttribute('alt')||''};return{kind:'style',id:id,prop:prop,value:sel.style.getPropertyValue(prop)||''};}
  function updateRow(prop,value){var pv=card.querySelector('.oi-pv[data-p="'+prop.replace(/"/g,'\\\\"')+'"]'),val=pv&&pv.querySelector('.oi-val'),sw=pv&&pv.querySelector('.oi-sw');if(val)val.textContent=value;if(sw)sw.style.background=value;}
  function undoLast(){var item=undoStack.pop();if(!item)return;var target=sel&&stableId(sel)===item.id?sel:document.querySelector('[data-od-id="'+item.id.replace(/"/g,'\\\\"')+'"],[data-od-runtime-id="'+item.id.replace(/"/g,'\\\\"')+'"],[data-od-source-path="'+item.id.replace(/"/g,'\\\\"')+'"]');if(!target)return;isUndoing=true;sel=target;if(item.kind==='text'){target.textContent=item.value;updateRow('__text',item.value);refreshAfterEdit();postTextSave(item.value);}else if(item.kind==='image'){target.setAttribute('src',item.src);if(item.alt)target.setAttribute('alt',item.alt);else target.removeAttribute('alt');updateRow('__image',imageName(target));refreshAfterEdit();postImageSrcSave(item.src,item.alt);}else if(item.kind==='style'){if(item.value)target.style.setProperty(item.prop,item.value);else target.style.removeProperty(item.prop);updateRow(item.prop,item.value||getComputedStyle(target).getPropertyValue(item.prop).trim());refreshAfterEdit();postSave(item.prop,item.value);}isUndoing=false;}
  function applyEdit(node){if(!sel||!node)return;var pv=node.closest('.oi-pv');if(!pv)return;var prop=pv.getAttribute('data-p'),val=prop==='__text'?node.textContent:node.textContent.trim();if(!prop)return;if(prop==='__text'){pushUndo(captureUndo(prop));sel.textContent=val;refreshAfterEdit();postTextSave(val);return;}if(!val)return;pushUndo(captureUndo(prop));if(prop==='width'||prop==='height'){sel.style[prop]=val;}else{sel.style.setProperty(prop,val);}var sw=pv.querySelector('.oi-sw');if(sw&&CP[prop])sw.style.background=val;refreshAfterEdit();postSave(prop,val);}
  function activeColorPv(){return card.querySelector('.oi-pv[data-active-color="1"]')||card.querySelector('.oi-color-row .oi-pv');}
  function setColorPv(pv,color){if(!pv)return;var val=pv.querySelector('.oi-val'),sw=pv.querySelector('.oi-sw'),prop=pv.getAttribute('data-p');if(val)val.textContent=color;if(sw){sw.style.background=color;sw.setAttribute('data-color',color);}if(sel&&prop){pushUndo(captureUndo(prop));sel.style.setProperty(prop,color);postSave(prop,color);}refreshAfterEdit();}
  function chooseImage(){var input=card.querySelector('.oi-file-input');if(input)input.click();}
  function setValueFor(prop,value){if(prop==='__image'){chooseImage();return;}var pv=card.querySelector('.oi-pv[data-p="'+prop.replace(/"/g,'\\\\"')+'"]'),val=pv&&pv.querySelector('.oi-val');if(!pv||!val)return;if(CP[prop]){setColorPv(pv,value);return;}val.textContent=value;applyEdit(val);}
  function openColorPicker(pv){if(!pv)return;card.querySelectorAll('.oi-pv[data-active-color]').forEach(function(n){n.removeAttribute('data-active-color');});pv.setAttribute('data-active-color','1');cpkOpen(pv);}
  function placeCard(r){var vw=window.innerWidth,vh=window.innerHeight,ch=Math.min(440,card.scrollHeight||280);var x=r.right+GAP,y=r.bottom+GAP;if(x+CW>vw-8)x=r.left-CW-GAP;if(x<8)x=Math.max(8,r.left);if(y+ch>vh-8)y=r.top-ch-GAP;if(y<8)y=8;card.style.left=x+'px';card.style.top=y+'px';}
  function posBox(box,r){box.style.display='block';box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';}
  function clrM(){while(svgEl.firstChild)svgEl.removeChild(svgEl.firstChild);bgs.forEach(function(b){b.remove();});bgs=[];svgEl.style.display='none';}
  function ln(x1,y1,x2,y2,d){var l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);l.setAttribute('stroke',PINK);l.setAttribute('stroke-width','1');if(d)l.setAttribute('stroke-dasharray','4 3');svgEl.appendChild(l);}
  function bdg(x,y,t){var b=document.createElement('div');b.className='oi-badge';b.textContent=t;b.style.left=x+'px';b.style.top=y+'px';document.body.appendChild(b);bgs.push(b);}
  function meas(sR,hR){clrM();svgEl.style.display='block';var vw=window.innerWidth,vh=window.innerHeight;[[0,sR.top,sR.left,sR.top],[sR.right,sR.top,vw,sR.top],[0,sR.bottom,sR.left,sR.bottom],[sR.right,sR.bottom,vw,sR.bottom],[sR.left,0,sR.left,sR.top],[sR.left,sR.bottom,sR.left,vh],[sR.right,0,sR.right,sR.top],[sR.right,sR.bottom,sR.right,vh]].forEach(function(a){ln(a[0],a[1],a[2],a[3],true);});var ovH=sR.left<hR.right&&sR.right>hR.left,ovV=sR.top<hR.bottom&&sR.bottom>hR.top;var midY=ovV?(Math.max(sR.top,hR.top)+Math.min(sR.bottom,hR.bottom))/2:(sR.top+sR.bottom)/2,midX=ovH?(Math.max(sR.left,hR.left)+Math.min(sR.right,hR.right))/2:(sR.left+sR.right)/2;if(hR.left>=sR.right){ln(sR.right,midY,hR.left,midY,false);bdg((sR.right+hR.left)/2,midY,Math.round(hR.left-sR.right)+'px');}if(hR.right<=sR.left){ln(hR.right,midY,sR.left,midY,false);bdg((hR.right+sR.left)/2,midY,Math.round(sR.left-hR.right)+'px');}if(hR.top>=sR.bottom){ln(midX,sR.bottom,midX,hR.top,false);bdg(midX,(sR.bottom+hR.top)/2,Math.round(hR.top-sR.bottom)+'px');}if(hR.bottom<=sR.top){ln(midX,hR.bottom,midX,sR.top,false);bdg(midX,(hR.bottom+sR.top)/2,Math.round(sR.top-hR.bottom)+'px');};}
  function enter(){act=true;document.body.classList.add('oi-mode');hit.style.display='block';}
  function exit(){act=false;document.body.classList.remove('oi-mode');hit.style.display='none';desel();}
  function desel(){sel=selR=null;card.style.display='none';card.innerHTML='';selB.style.display='none';hovB.style.display='none';clrM();cpkClose();}
  function select(t){if(!t||t===document.documentElement||t===document.body)return;if(sel===t){desel();return;}sel=t;selR=sel.getBoundingClientRect();hovB.style.display='none';clrM();posBox(selB,selR);openCard(sel);}
  function pick(e){if(!act||pickedEvents.has(e))return;pickedEvents.add(e);if(card.contains(e.target)||(cpk.el&&cpk.el.contains(e.target)))return;e.preventDefault();e.stopImmediatePropagation();var t=e.target;if(t===hit){hit.style.display='none';t=document.elementFromPoint(e.clientX,e.clientY);hit.style.display='block';}if(!t||t===document.documentElement||t===document.body)return;select(t);}
  function move(e){if(cardDrag){var x=e.clientX-cardDrag.x,y=e.clientY-cardDrag.y;card.style.left=Math.max(0,Math.min(window.innerWidth-card.offsetWidth,x))+'px';card.style.top=Math.max(0,Math.min(window.innerHeight-card.offsetHeight,y))+'px';return;}if(!act)return;var t=e.target;if(card.contains(t)){hovB.style.display='none';return;}if(t===sel){hovB.style.display='none';clrM();return;}var r=t.getBoundingClientRect();if(r.width+r.height===0)return;posBox(hovB,r);if(sel){selR=sel.getBoundingClientRect();posBox(selB,selR);meas(selR,r);}}
  function key(e){if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='z'){e.preventDefault();e.stopPropagation();undoLast();return;}if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='m'){e.preventDefault();e.stopPropagation();captureAnnotatable();return;}if(e.key==='Escape'){if(sel)desel();else exit();}}
  function scroll(){if(!sel)return;selR=sel.getBoundingClientRect();posBox(selB,selR);placeCard(selR);}
  function message(e){if(!e||!e.data)return;if(e.data.type==='od:annotate-mode'){if(e.data.enabled)enter();else exit();return;}if(e.data.type==='od:annotate-locale'){var s=e.data.strings;if(s&&typeof s==='object'){if(s.uploadImage)L.uploadImage=s.uploadImage;if(s.imageRef)L.imageRef=s.imageRef;if(s.textRef)L.textRef=s.textRef;if(s.colorRef)L.colorRef=s.colorRef;if(s.refOptions)L.refOptions=s.refOptions;}return;}if(e.data.type==='od:annotate-capture-result'){return;}if(e.data.type==='od:annotate-trigger-animation'){playCaptureAnimation();return;}if(e.data.type==='od:annotate-undo'){undoLast();return;}if(e.data.type==='od:annotate-trigger-capture'){captureAnnotatable(e.data.captureId||'');return;}if(e.data.type==='od:annotate-pick'){if(!act)enter();var t=document.elementFromPoint(Number(e.data.x||0),Number(e.data.y||0));select(t);}}
  card.addEventListener('pointerdown',function(e){e.stopPropagation();var pv=e.target.closest&&e.target.closest('.oi-pv');if(pv)setActiveProp(pv.getAttribute('data-p'),false);},true);
  card.addEventListener('click',function(e){var capBtn=e.target.closest&&e.target.closest('[data-action="capture"]');if(capBtn){captureAnnotatable();return;}var xbtn=e.target.closest&&e.target.closest('.oi-quad-xbtn');if(xbtn){var qd=xbtn.closest('.oi-quad');if(qd){qd.classList.toggle('open');xbtn.textContent=qd.classList.contains('open')?'▾':'▸';}return;}var imgTarget=e.target.closest&&e.target.closest('.oi-pv[data-p="__image"],[data-od-upload="1"]');if(imgTarget){captureAnnotatable();return;}var opt=e.target.closest&&e.target.closest('.oi-opt');if(opt){setValueFor(activeProp,opt.getAttribute('data-value')||'');return;}var chip=e.target.closest&&e.target.closest('.oi-chip');if(chip){setValueFor(activeProp,chip.getAttribute('data-color')||'');return;}var sw=e.target.closest&&e.target.closest('.oi-color-row .oi-sw');if(sw){openColorPicker(sw.closest('.oi-pv'));}});
  card.addEventListener('change',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('oi-color-input'))setColorPv(activeColorPv(),e.target.value);});
  card.addEventListener('change',function(e){if(!(e.target&&e.target.classList&&e.target.classList.contains('oi-file-input')))return;var file=e.target.files&&e.target.files[0];if(!file||!sel)return;pushUndo(captureUndo('__image'));var url=URL.createObjectURL(file);sel.setAttribute('src',url);var pv=card.querySelector('.oi-pv[data-p="__image"]'),val=pv&&pv.querySelector('.oi-val');if(val)val.textContent=file.name;refreshAfterEdit();postImageSave(file);e.target.value='';});
  card.addEventListener('input',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('oi-color-input'))setColorPv(activeColorPv(),e.target.value);});
  card.addEventListener('focusin',function(e){var pv=e.target&&e.target.closest&&e.target.closest('.oi-pv');if(pv)setActiveProp(pv.getAttribute('data-p'),false);});
  card.addEventListener('input',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('oi-val'))applyEdit(e.target);});
  card.addEventListener('blur',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('oi-val'))applyEdit(e.target);},true);
  card.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='z'){e.preventDefault();e.stopPropagation();undoLast();return;}if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='m'){e.preventDefault();e.stopPropagation();captureAnnotatable();return;}if(e.target&&e.target.classList&&e.target.classList.contains('oi-val')){e.stopPropagation();if(e.key==='Enter'){e.preventDefault();applyEdit(e.target);e.target.blur();}if(e.key==='Escape'){e.preventDefault();e.target.blur();}}});
  card.addEventListener('mousedown',function(e){var h=e.target.closest&&e.target.closest('.oi-hdr');if(!h||e.target.closest('button,a,input,select,textarea'))return;e.preventDefault();var r=card.getBoundingClientRect();cardDrag={x:e.clientX-r.left,y:e.clientY-r.top};},true);
  function cardUp(){cardDrag=null;}
  window.addEventListener('pointerdown',pick,true);
  document.addEventListener('pointerdown',pick,true);
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',cardUp);
  window.addEventListener('keydown',key,true);
  window.addEventListener('scroll',scroll,{passive:true});
  window.addEventListener('message',message);
  window.__oiCleanup=function(){window.removeEventListener('pointerdown',pick,true);document.removeEventListener('pointerdown',pick,true);document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',cardUp);window.removeEventListener('keydown',key,true);window.removeEventListener('scroll',scroll);window.removeEventListener('message',message);document.querySelectorAll('#oi-hit,#oi-sel,#oi-hov,#oi-svg,#oi-card,.oi-badge,.oi-shot,.oi-shot-fly').forEach(function(el){el.remove();});};
  if(INITIAL_ENABLED)enter();
}
if(document.body)boot();else document.addEventListener('DOMContentLoaded',boot);
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}
