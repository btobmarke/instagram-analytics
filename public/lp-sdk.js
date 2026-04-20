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

  var config = null;
  var anonymousUserKey = null;
  var sessionId = null;
  var heartbeatTimer = null;
  var sessionEnded = false; // 二重送信防止フラグ

  function getStoredAnonKey() {
    try { return localStorage.getItem(STORAGE_KEY_ANON); } catch (e) { return null; }
  }

  function storeAnonKey(key) {
    try { localStorage.setItem(STORAGE_KEY_ANON, key); } catch (e) {}
  }

  // 通常の通信（レスポンスが必要な場合）
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

  // 離脱時専用: sendBeacon でブラウザを閉じても確実に送信
  // - text/plain Blob を使用 → CORS preflight 不要（simple request）
  // - x-api-key ヘッダーが使えないため URL クエリパラメータで認証
  function beacon(path, body) {
    if (!config || !sessionId) return;
    var url = config.apiBase + path + '?apiKey=' + encodeURIComponent(config.apiKey);
    // text/plain にすることで cross-origin でも preflight なしで送れる
    var blob = new Blob([JSON.stringify(body)], { type: 'text/plain' });
    var sent = false;
    try {
      sent = navigator.sendBeacon(url, blob);
    } catch (e) {}
    // sendBeacon が失敗 or 非対応ブラウザはフォールバック
    if (!sent) {
      post(path, body);
    }
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
        sessionEnded = false;
        startHeartbeat();
      }
      return res;
    });
  }

  /**
   * フォーム送信などで取得した属性を匿名ユーザーに紐づけ（サーバーで JSON マージ）
   * @param {Record<string, string|number|boolean>} profile 例: { companyName: '株式会社A', name: '山田' }
   */
  function setFormProfile(profile) {
    if (!anonymousUserKey || !config) return Promise.resolve(null);
    return post('/user/profile', {
      lpCode: config.lpCode,
      anonymousUserKey: anonymousUserKey,
      profile: profile || {},
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

  // ページビュー + セッション終了を beacon で送信（二重送信防止付き）
  function flushAndEnd() {
    if (!sessionId || sessionEnded) return;
    sessionEnded = true;
    stopHeartbeat();

    var staySeconds = Math.round((Date.now() - pageEnteredAt) / 1000);

    beacon('/page-view', {
      lpCode: config.lpCode,
      anonymousUserKey: anonymousUserKey,
      sessionId: sessionId,
      occurredAt: new Date().toISOString(),
      pageUrl: location.href,
      pageTitle: document.title,
      scrollPercentMax: maxScrollPercent,
      staySeconds: staySeconds,
    });

    beacon('/session/end', {
      sessionId: sessionId,
      occurredAt: new Date().toISOString(),
      exitPageUrl: location.href,
    });

    sessionId = null;
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

  function endSession() {
    flushAndEnd();
  }

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
      window.addEventListener('scroll', trackScroll, { passive: true });
    });

    // ブラウザ閉じ・タブ閉じ・ページ遷移時（デスクトップ）
    window.addEventListener('beforeunload', function () {
      flushAndEnd();
    });

    // pagehide: モバイルのスワイプ閉じ対策（beforeunload が発火しないケース）
    window.addEventListener('pagehide', function (e) {
      if (!e.persisted) {
        flushAndEnd();
      }
    });

    // visibilitychange: ハートビート管理 + バックグラウンド時間を滞在時間に含めない
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        // フォアグラウンド復帰時：バックグラウンド中の時間をリセット
        pageEnteredAt = Date.now();
        maxScrollPercent = 0;
        if (!sessionEnded) startHeartbeat();
      }
    });
  }

  // Public API
  global.LpMA = {
    init: init,
    track: sendEvent,
    pageView: sendPageView,
    endSession: endSession,
    setFormProfile: setFormProfile,
    getSessionId: function () { return sessionId; },
    getAnonKey: function () { return anonymousUserKey; },
  };
})(window);
