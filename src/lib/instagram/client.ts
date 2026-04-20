import type { IgMedia, IgMediaInsightFact, MetricCode } from '@/types'

export const API_BASE_URLS = {
  facebook: 'https://graph.facebook.com',
  instagram: 'https://graph.instagram.com',
} as const
export type ApiBaseUrl = typeof API_BASE_URLS[keyof typeof API_BASE_URLS]

export const API_VERSIONS = ['v21.0', 'v22.0', 'v23.0'] as const
export type ApiVersion = typeof API_VERSIONS[number]

export const DEFAULT_API_BASE_URL: ApiBaseUrl = API_BASE_URLS.facebook
export const DEFAULT_API_VERSION: ApiVersion = 'v22.0'

export interface RateUsage {
  call_count: number
  total_time: number
  total_cputime: number
}

/** ログ用: access_token をマスクした Graph URL */
export function graphRequestUrlForLog(url: URL): string {
  const u = new URL(url.toString())
  if (u.searchParams.has('access_token')) {
    u.searchParams.set('access_token', '[REDACTED]')
  }
  return u.toString()
}

export type InstagramRequestStep =
  | 'getMe'
  | 'getProfileBusinessDiscovery'
  | 'getProfileCountsDirect'
  | 'getProfileDisplayFields'
  | 'getMediaList'
  | 'getStoriesList'
  | 'getMediaInsights'
  | 'getMediaStoryNavigationInsights'
  | 'getMediaProfileActivityInsights'
  | 'getAccountInsightsTimeSeries'
  | 'getAccountInsightsTotalValue'
  | 'getAccountInsightsBreakdownTotalValue'
  | 'getAccountInsightsDemographics'
  | 'getAccountInsightsOnlineFollowers'
  | 'getAccountInsights'
  | 'refreshLongLivedToken'

export class InstagramClient {
  private accessToken: string
  private accountId: string
  private baseUrl: string
  private apiVersion: string
  /** graph.instagram.com のとき true（/me はこちら側のみ） */
  private useInstagramHost: boolean

  constructor(
    accessToken: string,
    accountId: string,
    options: { apiBaseUrl?: string; apiVersion?: string } = {}
  ) {
    this.accessToken = accessToken
    this.accountId = accountId
    const base = options.apiBaseUrl ?? DEFAULT_API_BASE_URL
    const version = options.apiVersion ?? DEFAULT_API_VERSION
    this.apiVersion = version
    this.baseUrl = `${base}/${version}`
    this.useInstagramHost =
      base === API_BASE_URLS.instagram || base.includes('graph.instagram.com')
  }

  /** IG User の followers_count 等は graph.facebook.com の `/{ig-user-id}` で取る */
  private igUserNodeBase(): string {
    return this.useInstagramHost
      ? `${API_BASE_URLS.facebook}/${this.apiVersion}`
      : this.baseUrl
  }

  // ========== Profile ==========
  // graph.instagram.com の /me と Graph API の IG User ノードで取れる fields が異なるため分離する。

  /**
   * `GET /me?fields=id,username,account_type,media_count` — graph.instagram.com 利用時のみ。
   * トークン主体の確認用（Instagram Login）。
   */
  async getMe() {
    if (!this.useInstagramHost) {
      throw new Error('getMe() は api_base_url が graph.instagram.com のときのみ利用できます')
    }
    return this.fetch(
      '/me',
      { fields: 'id,username,account_type,media_count' },
      undefined,
      'getMe'
    )
  }

  /**
   * 同期用: IG User ID を解決（graph.instagram.com のときは /me の id）。
   */
  private async resolveIgUserIdForProfile(): Promise<string> {
    if (this.useInstagramHost) {
      const { data: me } = await this.getMe()
      const id = (me as Record<string, unknown>)?.id
      if (id == null || String(id) === '') {
        throw new Error('Instagram /me から id を取得できませんでした')
      }
      return String(id)
    }
    return this.accountId
  }

  /**
   * フォロワー等は IG User 直の fields ではなく Business Discovery 経由（Meta 推奨パターンに合わせる）。
   * `GET /{ig_user_id}?fields=business_discovery.username(USER){followers_count,follows_count,media_count}`
   */
  private async getProfileCountsViaBusinessDiscovery(igUserId: string, instagramUsername: string) {
    const u = instagramUsername.trim().replace(/^@/, '')
    const fields =
      `business_discovery.username(${u}){followers_count,follows_count,media_count}`
    return this.fetch(`/${igUserId}`, { fields }, this.igUserNodeBase(), 'getProfileBusinessDiscovery')
  }

  /**
   * `business_discovery` がノードに無い／権限が無いとき用: IG User 直の数値フィールド。
   */
  private async getProfileCountsDirect(igUserId: string) {
    const fields = 'followers_count,follows_count,media_count'
    return this.fetch(`/${igUserId}`, { fields }, this.igUserNodeBase(), 'getProfileCountsDirect')
  }

  /**
   * バッチ用: 現在のフォロワー数などプロフィールカウントを取得。
   * accountId（IG User ID）は this.accountId から解決するため igUserId 引数不要。
   * `followers_count` は Insights API では取得できないため、このエンドポイントを使う。
   */
  async getProfileCounts() {
    const fields = 'followers_count,follows_count,media_count'
    return this.fetch(`/${this.accountId}`, { fields }, this.igUserNodeBase(), 'getProfileCounts')
  }

  /**
   * 表示名は counts とは別に取得。PBIA 等では profile_picture_url がノードに無いことがあるため含めない。
   */
  private async getProfileDisplayFields(igUserId: string) {
    const fields = 'id,name'
    return this.fetch(`/${igUserId}`, { fields }, this.igUserNodeBase(), 'getProfileDisplayFields')
  }

  /**
   * アカウント同期用プロフィール取得。
   * まず Business Discovery でカウント取得を試し、`business_discovery` フィールドが無い場合は IG User 直の fields にフォールバックする。
   * `instagramUsername` は表示用・Discovery 用（@ なし）。
   */
  async getProfileForSync(instagramUsername: string) {
    const normalized = instagramUsername.trim().replace(/^@/, '')
    if (!normalized) {
      throw new Error('ユーザー名が空です。アカウントに username（@なし）を登録してください。')
    }

    // graph.instagram.com（Instagram Login / Basic Display系）では、
    // graph.facebook.com の IG User ノード（business_discovery 等）が前提のID/権限を持たない。
    // そのため business_discovery 取得はスキップし、/me で取れる範囲のみ同期する。
    if (this.useInstagramHost) {
      const { data: me, rateUsage } = await this.getMe()
      const m = me as Record<string, unknown>
      return {
        data: {
          id: m.id,
          username: normalized,
          name: (m.name as string | null | undefined) ?? null,
          // followers_count / follows_count は graph.instagram.com では取得できない
          followers_count: undefined,
          follows_count: undefined,
          media_count: typeof m.media_count === 'number' ? m.media_count : undefined,
        },
        rateUsage,
      }
    }

    const igUserId = await this.resolveIgUserIdForProfile()
    // Graph API の IG User ノードIDは数値文字列。違う場合はほぼ確実に設定ミス。
    if (!/^\d+$/.test(String(igUserId))) {
      throw new Error(
        'platform_account_id が IG User ID ではない可能性があります。' +
          '（graph.facebook.com を使う場合、platform_account_id には Instagramビジネスアカウントの「IG User ID（数値）」を設定してください。' +
          'Instagram Login（graph.instagram.com）の /me.id や、別種のIDを入れるとエラーになります）'
      )
    }

    const { data: dispData, rateUsage: rateDisp } = await this.getProfileDisplayFields(igUserId)
    const d = dispData as Record<string, unknown>

    let counts: Record<string, unknown> | undefined
    let rateCounts = rateDisp

    try {
      const { data: bdData, rateUsage } = await this.getProfileCountsViaBusinessDiscovery(
        igUserId,
        normalized
      )
      rateCounts = rateUsage
      counts = (bdData as Record<string, unknown>)?.business_discovery as
        | Record<string, unknown>
        | undefined
    } catch (e) {
      const isInvalidUserId =
        e instanceof InstagramApiError && e.apiError?.code === 110
      if (isInvalidUserId) {
        throw new Error(
          'Meta API error (code 110): Invalid user id. ' +
            'platform_account_id が IG User ID ではない可能性があります。' +
            '（graph.facebook.com を使う場合、platform_account_id は Instagramビジネスアカウントの IG User ID（数値）にしてください。' +
            'もし Instagram Login（graph.instagram.com）のトークン/ID運用なら、アカウント設定の api_base_url を graph.instagram.com に合わせてください）'
        )
      }
      const isNoBusinessDiscovery =
        e instanceof InstagramApiError &&
        e.apiError?.code === 100 &&
        String(e.apiError?.message ?? '').includes('business_discovery')
      if (!isNoBusinessDiscovery) throw e
      const { data: directData, rateUsage } = await this.getProfileCountsDirect(igUserId)
      rateCounts = rateUsage
      counts = directData as Record<string, unknown>
    }

    const merged = {
      id: d.id,
      username: normalized,
      name: (d.name as string | null | undefined) ?? null,
      followers_count:
        typeof counts?.followers_count === 'number' ? counts.followers_count : undefined,
      follows_count: typeof counts?.follows_count === 'number' ? counts.follows_count : undefined,
      media_count: typeof counts?.media_count === 'number' ? counts.media_count : undefined,
    }

    return { data: merged, rateUsage: rateCounts }
  }

  // ========== Media ==========

  async getMediaList(params: { limit?: number; after?: string; since?: string } = {}) {
    const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,is_comment_enabled,shortcode,children{id,media_url,thumbnail_url}'
    return this.fetch(
      `/${this.accountId}/media`,
      {
        fields,
        limit: String(params.limit ?? 50),
        ...(params.after ? { after: params.after } : {}),
        ...(params.since ? { since: params.since } : {}),
      },
      undefined,
      'getMediaList'
    )
  }

  /**
   * 公開中のストーリー一覧（通常24時間以内のみ返る）。
   * フィード／リールの `/{id}/media` には含まれないため、ストーリー同期は本エッジが必須。
   * @see https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/stories
   */
  async getStoriesList(params: { limit?: number; after?: string } = {}) {
    const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,is_comment_enabled,shortcode,children{id,media_url,thumbnail_url}'
    return this.fetch(
      `/${this.accountId}/stories`,
      {
        fields,
        limit: String(params.limit ?? 50),
        ...(params.after ? { after: params.after } : {}),
      },
      undefined,
      'getStoriesList'
    )
  }

  // ========== Media Insights ==========
  // Insights エッジは metric + period のみ（fields=username 等は不可）

  /** `GET /{media-id}/insights?metric=...&period=lifetime`
   * v22.0+: `impressions` / `video_views` / `ig_reels_aggregated_all_plays_count` は非推奨。`views` 等に置き換え。
   * @see https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
   */
  async getMediaInsights(mediaId: string, mediaType: 'FEED' | 'REELS' | 'VIDEO' | 'STORY') {
    const metricsMap: Record<string, string> = {
      FEED: 'views,reach,likes,comments,shares,saved,profile_visits,follows,total_interactions',
      REELS: 'views,reach,likes,comments,shares,saved,ig_reels_video_view_total_time,ig_reels_avg_watch_time,total_interactions',
      VIDEO: 'views,reach,likes,comments,shares,saved,total_interactions',
      STORY: 'views,reach,taps_forward,taps_back,exits,replies',
    }
    return this.fetch(
      `/${mediaId}/insights`,
      {
        metric: metricsMap[mediaType] ?? metricsMap.FEED,
        period: 'lifetime',
      },
      undefined,
      'getMediaInsights'
    )
  }

  /**
   * ストーリー: 公式推奨の `navigation` + `story_navigation_action_type` breakdown。
   * @see https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
   */
  async getMediaStoryNavigationInsights(mediaId: string) {
    return this.fetch(
      `/${mediaId}/insights`,
      {
        metric: 'navigation',
        breakdown: 'story_navigation_action_type',
        period: 'lifetime',
      },
      undefined,
      'getMediaStoryNavigationInsights'
    )
  }

  /**
   * 投稿→プロフィール行動（内訳あり）
   * `GET /{media-id}/insights?metric=profile_activity&breakdown=action_type&period=lifetime`
   * @see https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
   */
  async getMediaProfileActivityInsights(mediaId: string) {
    return this.fetch(
      `/${mediaId}/insights`,
      {
        metric: 'profile_activity',
        breakdown: 'action_type',
        period: 'lifetime',
      },
      undefined,
      'getMediaProfileActivityInsights'
    )
  }

  // ========== Account Insights ==========

  /**
   * アカウント日次メトリクス — 2種類のAPIコールに分けて取得
   *
   * Instagram Graph API v22+ では一部メトリクスに metric_type=total_value が必須。
   * しかし metric_type=total_value + period=day + 複数日 since/until → data:[] になる。
   *
   * 戦略:
   *  (A) reach → period=day + since/until で values 配列取得（日次分解あり）
   *  (B) accounts_engaged 等 → metric_type=total_value + period=day を **1日ずつ** 取得
   */
  async getAccountInsightsTimeSeries(since: string, until: string) {
    return this.fetch(
      `/${this.accountId}/insights`,
      {
        metric: 'reach',
        period: 'day',
        since,
        until,
      },
      undefined,
      'getAccountInsightsTimeSeries'
    )
  }

  async getAccountInsightsTotalValue(
    since: string,
    until: string,
    metrics = 'accounts_engaged,total_interactions,likes,comments,shares,saves',
  ) {
    return this.fetch(
      `/${this.accountId}/insights`,
      {
        metric: metrics,
        metric_type: 'total_value',
        period: 'day',
        since,
        until,
      },
      undefined,
      'getAccountInsightsTotalValue'
    )
  }

  /** v22+ 相当: アカウント日次の不足メトリクス（impressions は非推奨のため含めない） */
  async getAccountInsightsTotalValueExtended(since: string, until: string) {
    const metrics =
      'views,replies,profile_links_taps,follows_and_unfollows,reposts,' +
      'accounts_engaged,total_interactions,likes,comments,shares,saves'
    return this.getAccountInsightsTotalValue(since, until, metrics)
  }

  /**
   * アカウント日次: breakdown 付き total_value（1日レンジ推奨）
   * 例: reach + media_product_type / follow_type、views + follow_type 等
   * （API v20+ では views の内訳は breakdown=follow_type。follower_type は無効）
   */
  async getAccountInsightsBreakdownTotalValue(params: {
    since: string
    until: string
    metric: 'reach' | 'views'
    breakdown: 'media_product_type' | 'follow_type'
  }) {
    return this.fetch(
      `/${this.accountId}/insights`,
      {
        metric: params.metric,
        metric_type: 'total_value',
        period: 'day',
        since: params.since,
        until: params.until,
        breakdown: params.breakdown,
      },
      undefined,
      'getAccountInsightsBreakdownTotalValue'
    )
  }

  /**
   * デモグラフィック系（lifetime + total_value + breakdown）
   * v20+ では last_N_days 系 timeframe が廃止。timeframe は省略するか this_month / this_week のみ。
   */
  async getAccountInsightsDemographics(params: {
    metric: 'engaged_audience_demographics' | 'follower_demographics'
    breakdown: 'country' | 'age' | 'gender' | 'city'
    /** 未指定なら timeframe クエリを付けない（推奨）。v20+ では last_N_days 系は廃止 */
    timeframe?: 'this_month' | 'this_week'
  }) {
    const q: Record<string, string> = {
      metric: params.metric,
      period: 'lifetime',
      metric_type: 'total_value',
      breakdown: params.breakdown,
    }
    if (params.timeframe) q.timeframe = params.timeframe
    return this.fetch(`/${this.accountId}/insights`, q, undefined, 'getAccountInsightsDemographics')
  }

  /**
   * online_followers（条件付きで利用可能）
   * v20+ では time_series と組み合わせ不可 → total_value + period=day
   */
  async getAccountInsightsOnlineFollowers(since: string, until: string) {
    return this.fetch(
      `/${this.accountId}/insights`,
      {
        metric: 'online_followers',
        metric_type: 'total_value',
        period: 'day',
        since,
        until,
      },
      undefined,
      'getAccountInsightsOnlineFollowers'
    )
  }

  // ========== Token Refresh ==========

  async refreshLongLivedToken() {
    return this.fetch('/oauth/access_token', { grant_type: 'ig_refresh_token' }, undefined, 'refreshLongLivedToken')
  }

  // ========== Core Fetch ==========

  private async fetch(
    endpoint: string,
    params: Record<string, string> = {},
    graphBase?: string,
    step?: InstagramRequestStep
  ): Promise<{
    data: unknown
    paging?: { cursors?: { after?: string }; next?: string }
    rateUsage: RateUsage | null
  }> {
    const root = graphBase ?? this.baseUrl
    const url = new URL(`${root}${endpoint}`)
    url.searchParams.set('access_token', this.accessToken)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const response = await globalThis.fetch(url.toString())
    const rateHeader = response.headers.get('X-App-Usage')
    const rateUsage: RateUsage | null = rateHeader ? JSON.parse(rateHeader) : null

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      const apiErrPayload = (error as Record<string, unknown>)?.error as Record<string, unknown> ?? {}
      throw new InstagramApiError(response.status, apiErrPayload, {
        safeUrl: graphRequestUrlForLog(url),
        step,
      })
    }

    const data = await response.json()
    return { data, paging: (data as Record<string, unknown>)?.paging as typeof data, rateUsage }
  }
}

export interface InstagramApiRequestContext {
  safeUrl: string
  step?: InstagramRequestStep
}

export class InstagramApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: Record<string, unknown>,
    public readonly requestContext?: InstagramApiRequestContext
  ) {
    super(`Instagram API Error ${status}: ${JSON.stringify(apiError)}`)
    this.name = 'InstagramApiError'
  }

  get isTokenExpired() {
    return this.status === 400 &&
      (this.apiError?.code === 190 || String(this.apiError?.type).includes('OAuthException'))
  }

  get isRateLimited() {
    return this.status === 429 || this.apiError?.code === 4
  }
}

/**
 * X-App-Usage が閾値を超えているか確認する
 */
export function isRateLimitExceeded(usage: RateUsage | null, threshold = 80): boolean {
  if (!usage) return false
  return usage.call_count > threshold ||
    usage.total_time > threshold ||
    usage.total_cputime > threshold
}
