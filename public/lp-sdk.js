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
 *     spa: true, // 同一ドキュメント内の History 遷移ごとに pageView（省略時は従来どおり）
 *   });
 *   // セクション到達（IntersectionObserver 等から1セクション1回推奨）
 *   // LpMA.trackSectionInView('pricing');
 *   // LpMA.trackSectionInView('pricing', '料金');
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
  var spaHooksInstalled = false;
  /** popstate 時に「離脱した仮想ページ」URL・タイトルを送るための直前状態 */
  var spaLastUrl = '';
  var spaLastTitle = '';

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
      userAgent: navigator.userAgent,
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

  /**
   * セクション到達（ビューポート内表示）の推奨イベント。
   * meta は { section_id: string, section_name?: string } 形式（ダッシュボードのセッション詳細と連携）。
   */
  function trackSectionInView(sectionId, sectionName) {
    if (!sectionId) return Promise.resolve(null);
    var meta = { section_id: String(sectionId) };
    if (sectionName != null && String(sectionName).length > 0) {
      meta.section_name = String(sectionName);
    }
    return sendEvent('section_in_view', meta);
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

  /**
   * 現在表示中の仮想ページの PV を送り、スクロール・滞在カウンタを次ページ用にリセットする。
   * pushState / replaceState の直前（location がまだ旧 URL）と popstate で利用。
   */
  function flushSpaVirtualPage(leavingUrl, leavingTitle) {
    if (!sessionId || sessionEnded) return;
    var staySeconds = Math.round((Date.now() - pageEnteredAt) / 1000);
    sendPageView(leavingUrl, leavingTitle, maxScrollPercent, staySeconds);
    maxScrollPercent = 0;
    pageEnteredAt = Date.now();
  }

  function installSpaHistoryHooks() {
    if (spaHooksInstalled || !config || !config.spa) return;
    spaHooksInstalled = true;
    spaLastUrl = location.href;
    spaLastTitle = document.title;

    var origPush = history.pushState;
    var origReplace = history.replaceState;

    history.pushState = function (state, title, url) {
      var hrefBefore = location.href;
      var titleBefore = document.title;
      var ret = origPush.call(history, state, title, url);
      if (sessionId && !sessionEnded && location.href !== hrefBefore) {
        flushSpaVirtualPage(hrefBefore, titleBefore);
      }
      spaLastUrl = location.href;
      spaLastTitle = document.title;
      return ret;
    };

    history.replaceState = function (state, title, url) {
      var hrefBefore = location.href;
      var titleBefore = document.title;
      var ret = origReplace.call(history, state, title, url);
      if (sessionId && !sessionEnded && location.href !== hrefBefore) {
        flushSpaVirtualPage(hrefBefore, titleBefore);
      }
      spaLastUrl = location.href;
      spaLastTitle = document.title;
      return ret;
    };

    window.addEventListener('popstate', function () {
      if (!sessionId || sessionEnded) return;
      flushSpaVirtualPage(spaLastUrl, spaLastTitle);
      spaLastUrl = location.href;
      spaLastTitle = document.title;
    });

    window.addEventListener('hashchange', function () {
      if (!sessionId || sessionEnded) return;
      if (location.href === spaLastUrl) return;
      flushSpaVirtualPage(spaLastUrl, spaLastTitle);
      spaLastUrl = location.href;
      spaLastTitle = document.title;
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
      if (config.spa) {
        installSpaHistoryHooks();
      }
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
    trackSectionInView: trackSectionInView,
    pageView: sendPageView,
    endSession: endSession,
    setFormProfile: setFormProfile,
    getSessionId: function () { return sessionId; },
    getAnonKey: function () { return anonymousUserKey; },
  };
})(window);
