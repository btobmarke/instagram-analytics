/**
 * 天気情報取得ユーティリティ（Open-Meteo）
 *
 * Open-Meteo は API キー不要の気象データサービス。
 * 非商用利用向けの無料プランを提供している。
 *
 * ⚠️ 注意: 商用利用の場合は利用規約（https://open-meteo.com/en/terms）を確認し、
 *            必要に応じて有料プランに切り替えること。
 *
 * バッチ1日1回・プロジェクト単位で取得し、project_external_daily にキャッシュする。
 * 直接呼び出しは行わず、必ずキャッシュ経由で表示すること。
 */

export interface WeatherData {
  temperature_max:  number | null
  temperature_min:  number | null
  precipitation_mm: number | null
  weather_code:     number | null
  weather_desc:     string | null
}

/**
 * WMO 天気コード → 日本語説明
 * https://open-meteo.com/en/docs#weathervariables (WMO Weather Codes)
 */
export function wmoCodeToDesc(code: number): string {
  if (code === 0)        return '快晴'
  if (code <= 2)         return '晴れ〜曇り'
  if (code === 3)        return '曇り'
  if (code <= 9)         return '霧・霞'
  if (code <= 12)        return '霧雨'
  if (code <= 19)        return 'みぞれ'
  if (code <= 21)        return '小雨'
  if (code <= 22)        return '雪'
  if (code <= 29)        return '雷雨（前時間）'
  if (code <= 35)        return '砂嵐'
  if (code <= 39)        return '地吹雪'
  if (code <= 49)        return '霧'
  if (code <= 57)        return '霧雨'
  if (code <= 67)        return '雨'
  if (code <= 77)        return '雪'
  if (code <= 82)        return 'にわか雨'
  if (code <= 84)        return '激しいにわか雨'
  if (code <= 86)        return 'にわか雪'
  if (code <= 94)        return '雷雨'
  return '激しい雷雨'
}

/**
 * WMO コードから絵文字を返す（UI 表示用）
 */
export function wmoCodeToEmoji(code: number | null): string {
  if (code == null)      return '—'
  if (code === 0)        return '☀️'
  if (code <= 2)         return '🌤️'
  if (code === 3)        return '☁️'
  if (code <= 49)        return '🌫️'
  if (code <= 67)        return '🌧️'
  if (code <= 77)        return '❄️'
  if (code <= 82)        return '🌦️'
  if (code <= 86)        return '🌨️'
  return '⛈️'
}

/**
 * Open-Meteo Archive API で指定日の天気を取得する。
 *
 * 注意: Archive API は「現在から5日以上前」のデータのみ対応。
 *       直近5日は Forecast API が必要だが、バッチで昨日分を取得する分には問題ない。
 *
 * @param params.latitude  緯度（例: 35.6895 = 東京）
 * @param params.longitude 経度（例: 139.6917 = 東京）
 * @param params.date      YYYY-MM-DD（取得したい日）
 */
export async function fetchWeather(params: {
  latitude:  number
  longitude: number
  date:      string
}): Promise<WeatherData> {
  const empty: WeatherData = {
    temperature_max:  null,
    temperature_min:  null,
    precipitation_mm: null,
    weather_code:     null,
    weather_desc:     null,
  }

  try {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive')
    url.searchParams.set('latitude',   String(params.latitude))
    url.searchParams.set('longitude',  String(params.longitude))
    url.searchParams.set('start_date', params.date)
    url.searchParams.set('end_date',   params.date)
    url.searchParams.set('daily',      'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code')
    url.searchParams.set('timezone',   'Asia/Tokyo')

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      // タイムアウト: 10秒
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.warn(`[weather] Open-Meteo API error: ${res.status} ${res.statusText}`)
      return empty
    }

    const json = await res.json()
    const daily = json?.daily
    if (!daily) return empty

    const wc = daily.weather_code?.[0] ?? null

    return {
      temperature_max:  daily.temperature_2m_max?.[0]  ?? null,
      temperature_min:  daily.temperature_2m_min?.[0]  ?? null,
      precipitation_mm: daily.precipitation_sum?.[0]   ?? null,
      weather_code:     wc,
      weather_desc:     wc != null ? wmoCodeToDesc(wc) : null,
    }
  } catch (err) {
    console.warn('[weather] fetchWeather failed:', err)
    return empty
  }
}

/**
 * 複数日分の天気を順次取得する（APIレート制限を考慮して直列で処理）
 * @param dates YYYY-MM-DD の配列
 */
export async function fetchWeatherBatch(params: {
  latitude:  number
  longitude: number
  dates:     string[]
}): Promise<Record<string, WeatherData>> {
  if (params.dates.length === 0) return {}

  // 連続した日付の場合はまとめて1リクエストで取得できる
  const sorted = [...params.dates].sort()
  const startDate = sorted[0]
  const endDate   = sorted[sorted.length - 1]

  const result: Record<string, WeatherData> = {}

  try {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive')
    url.searchParams.set('latitude',   String(params.latitude))
    url.searchParams.set('longitude',  String(params.longitude))
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date',   endDate)
    url.searchParams.set('daily',      'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code')
    url.searchParams.set('timezone',   'Asia/Tokyo')

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      console.warn(`[weather] Open-Meteo batch error: ${res.status}`)
      params.dates.forEach(d => {
        result[d] = { temperature_max: null, temperature_min: null, precipitation_mm: null, weather_code: null, weather_desc: null }
      })
      return result
    }

    const json = await res.json()
    const daily = json?.daily
    if (!daily?.time) {
      params.dates.forEach(d => {
        result[d] = { temperature_max: null, temperature_min: null, precipitation_mm: null, weather_code: null, weather_desc: null }
      })
      return result
    }

    const times: string[] = daily.time
    times.forEach((dateStr: string, i: number) => {
      const wc = daily.weather_code?.[i] ?? null
      result[dateStr] = {
        temperature_max:  daily.temperature_2m_max?.[i]  ?? null,
        temperature_min:  daily.temperature_2m_min?.[i]  ?? null,
        precipitation_mm: daily.precipitation_sum?.[i]   ?? null,
        weather_code:     wc,
        weather_desc:     wc != null ? wmoCodeToDesc(wc) : null,
      }
    })
  } catch (err) {
    console.warn('[weather] fetchWeatherBatch failed:', err)
    params.dates.forEach(d => {
      result[d] = { temperature_max: null, temperature_min: null, precipitation_mm: null, weather_code: null, weather_desc: null }
    })
  }

  return result
}
