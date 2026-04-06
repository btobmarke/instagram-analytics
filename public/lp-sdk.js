/**
 * LP計測 SDK (lp-sdk.js)
 *
 * 使用方法:
 * <script src="/lp-sdk.js"></script>
 * <script>
 *   LpMA.init({
 *     apiBase: 'https://your-app.vercel.app/api/public/lp',
 *     apiKey: 'lp_xxxxxxxx',
 *     lpCode: 'your-lp-code',
 *   });
 * </script>
 */
(function (global) {
  'use strict';

  var STORAGE_KEY_ANON = 'lp_ma_anon_key';
  var HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60秒
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分

  var config = null;
  var anonymousUserKey = null;
  var sessionId = null;
  var heartbeatTimer = null;

  function getStoredAnonKey() {
    try { return localStorage.getItem(STORAGE_KEY_ANON); } catch (e) { return null; }
  }

  function storeAnonKey(key) {
    try { localStorage.setItem(STORAGE_KEY_ANON, key); } catch (e) {}
  }

  function post(path, body) {
    return fetch(config.apiBase + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json(); })
      .catch(function () { return null; });
  }

  function identify() {
    return post('/identify', {
      lpCode: config.lpCode,
      existingAnonymousKey: getStoredAnonKey(),
      userAgent: navigator.userAgent,
      clientTimestamp: new Date().toISOString(),
    }).then(function (res) {
      if (res && res.success) {
        anonymousUserKey = res.data.anonymousUserKey;
        storeAnonKey(anonymousUserKey);
      }
      return res;
    });
  }

  function startSession() {
    if (!anonymousUserKey) return Promise.resolve(null);
    return post('/session/start', {
      lpCode: config.lpCode,
      anonymousUserKey: anonymousUserKey,
      startedAt: new Date().toISOString(),
      referrerSource: document.referrer ? new URL(document.referrer).hostname : 'direct',
      landingPageUrl: location.href,
    }).then(function (res) {
      if (res && res.success) {
        sessionId = res.data.sessionId;
        startHeartbeat();
      }
      return res;
    });
  }

  function sendPageView(pageUrl, pageTitle, scrollPercentMax, staySeconds) {
    if (!sessionId) return Promise.resolve(null);
    return post('/page-view', {
      lpCode: config.lpCode,
      anonymousUserKey: anonymousUserKey,
      sessionId: sessionId,
      occurredAt: new Date().toISOString(),
      pageUrl: pageUrl || location.href,
      pageTitle: pageTitle || document.title,
      scrollPercentMax: scrollPercentMax,
      staySeconds: staySeconds,
    });
  }

  function sendEvent(eventId, meta) {
    if (!sessionId) return Promise.resolve(null);
    return post('/event', {
      lpCode: config.lpCode,
      anonymousUserKey: anonymousUserKey,
      sessionId: sessionId,
      eventId: eventId,
      occurredAt: new Date().toISOString(),
      pageUrl: location.href,
      meta: meta || {},
    });
  }

  function heartbeat() {
    if (!sessionId) return;
    post('/session/heartbeat', {
      sessionId: sessionId,
      occurredAt: new Date().toISOString(),
    });
  }

  function endSession() {
    if (!sessionId) return;
    stopHeartbeat();
    post('/session/end', {
      sessionId: sessionId,
      occurredAt: new Date().toISOString(),
      exitPageUrl: location.href,
    });
    sessionId = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // 最大スクロール率追跡
  var maxScrollPercent = 0;
  function trackScroll() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var percent = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
    if (percent > maxScrollPercent) maxScrollPercent = percent;
  }

  // 滞在時間追跡
  var pageEnteredAt = Date.now();

  function init(options) {
    if (!options || !options.apiBase || !options.apiKey || !options.lpCode) {
      console.error('[LpMA] init options required: apiBase, apiKey, lpCode');
      return;
    }
    config = options;

    // 自動初期化
    identify().then(function () {
      return startSession();
    }).then(function () {
      // 初回ページビュー（DOMContentLoaded後）
      window.addEventListener('scroll', trackScroll, { passive: true });
    });

    // ページアンロード時にセッション終了
    window.addEventListener('beforeunload', function () {
      var staySeconds = Math.round((Date.now() - pageEnteredAt) / 1000);
      sendPageView(location.href, document.title, maxScrollPercent, staySeconds);
      endSession();
    });

    // visibilitychange でバックグラウンド移行時もハートビート停止
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        startHeartbeat();
      }
    });
  }

  // Public API
  global.LpMA = {
    init: init,
    track: sendEvent,
    pageView: sendPageView,
    endSession: endSession,
    getSessionId: function () { return sessionId; },
    getAnonKey: function () { return anonymousUserKey; },
  };
})(window);
