/* Khatulistiwa Resto — Apps Script API client (GitHub Pages build).
 *
 * Replaces the original Apps Script RPC (google dot script dot run). The Apps Script backend is the SAME project
 * and the SAME Google Sheet; only the transport changed:
 *   api.withSuccessHandler(fn).method(a, b)   (same shape as before)
 * becomes
 *   api.withSuccessHandler(fn).method(a, b)        (identical behaviour)
 * or, for new code:
 *   api.call('method', [a, b]).then(envelope => ...)
 *   api.get('getAppData')                            (GET, read-only)
 *
 * CORS: Apps Script cannot set Access-Control-Allow-Origin and does not
 * answer OPTIONS preflights, so every request here is a CORS "simple"
 * request — GET, or POST with Content-Type: text/plain;charset=utf-8 and
 * no custom headers. Never change the content type to application/json.
 * The exec URL redirects (302) to script.googleusercontent.com; fetch
 * follows that redirect automatically (redirect: 'follow').
 *
 * Envelope: the server always returns {ok:true, data:...} or
 * {ok:false, message:...}. The success handler is called with that
 * envelope even when ok === false (exactly like the original RPC, whose
 * success handler received the function's return value). The failure
 * handler only fires on transport / parse errors.
 */
(function () {
  'use strict';

  var READ_ONLY_ACTIONS = ['getAppData', 'getInitialAppData', 'getTransactions', 'lookupCustomerByPhone'];

  function execUrl() {
    var cfg = (typeof window !== 'undefined' && window.APPS_SCRIPT_CONFIG) || {};
    if (!cfg.url) throw new Error('APPS_SCRIPT_CONFIG.url is not set (public/config.js)');
    return cfg.url;
  }

  function parseResponse(text) {
    try { return JSON.parse(text); }
    catch (e) { return { ok: false, message: 'Invalid JSON response from Apps Script: ' + String(text).slice(0, 200) }; }
  }

  function request(action, args) {
    var url = execUrl();
    // Read-only actions use GET (no body, no redirect/POST complications).
    if (READ_ONLY_ACTIONS.indexOf(action) !== -1) {
      var q = url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=' + encodeURIComponent(action);
      if (args && args.length) q += '&args=' + encodeURIComponent(JSON.stringify(args));
      return fetch(q, { method: 'GET', redirect: 'follow' })
        .then(function (r) { return r.text(); })
        .then(parseResponse);
    }
    // Everything else: POST with text/plain (simple request, no preflight).
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, args: args || [] }),
      redirect: 'follow'
    })
      .then(function (r) { return r.text(); })
      .then(parseResponse);
  }

  // Dispatch one call, honouring the captured handlers.
  function dispatch(action, args, handlers) {
    var p = request(action, args);
    return p.then(function (envelope) {
      if (handlers && handlers.success) { try { handlers.success(envelope); } catch (e) { console.error(e); } }
      return envelope;
    }).catch(function (err) {
      var envelope = { ok: false, message: String(err && err.message ? err.message : err) };
      if (handlers && handlers.failure) { try { handlers.failure(err); } catch (e) { console.error(e); } }
      else { console.warn('[api] ' + action + ' failed:', err); }
      return envelope;
    });
  }

  // A chain object: api.withSuccessHandler(fn).withFailureHandler(fn).method(...)
  function makeChain(handlers) {
    var h = { success: handlers.success || null, failure: handlers.failure || null };
    return new Proxy({}, {
      get: function (_target, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return makeChain({ success: fn, failure: h.failure }); };
        if (prop === 'withFailureHandler') return function (fn) { return makeChain({ success: h.success, failure: fn }); };
        if (typeof prop !== 'string') return undefined;
        return function () { dispatch(prop, Array.prototype.slice.call(arguments), h); };
      }
    });
  }

  var base = {
    // Low-level: returns a Promise resolving to the {ok, data} envelope.
    call: function (action, args) { return dispatch(action, args, null); },
    // Alias used by new code: api.run('submitOrder', [order])
    run: function (action, args) { return dispatch(action, args, null); },
    // GET read-only actions.
    get: function (action, args) {
      if (READ_ONLY_ACTIONS.indexOf(action) === -1) return Promise.resolve({ ok: false, message: 'Action not allowed via GET: ' + action });
      return dispatch(action, args, null);
    },
    withSuccessHandler: function (fn) { return makeChain({ success: fn, failure: null }); },
    withFailureHandler: function (fn) { return makeChain({ success: null, failure: fn }); }
  };

  // Direct calls (api.getAppData(), api.submitOrder(order), ...) behave like
  // Direct method calls without handlers: fire the request and
  // return a Promise that resolves to the envelope (never rejects).
  var api = new Proxy(base, {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return function () { return dispatch(prop, Array.prototype.slice.call(arguments), null); };
    }
  });

  window.api = api;
})();
