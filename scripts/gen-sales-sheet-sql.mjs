#!/usr/bin/env node
/**
 * 店舗日報 TSV → sales_days + sales_hourly_slots 用 SQL 生成
 *
 * 使い方:
 *   node scripts/gen-sales-sheet-sql.mjs < scripts/data/sales_sheet.tsv > out.sql
 *
 * TSV 想定列（先頭から、タブ区切り）:
 *   0:年 1:月 2:日 3:曜日
 *   4:ランチ税込 5:ランチ税額 6:ディナー税込 7:ディナー税額 8:店内税込 9:店内税額
 *   10:ランチ税抜 11:ディナー税抜 12:店内税抜
 *   以降 11時〜21時 × 3列 = 枚数,税込,税抜（計33列）→ 列13〜45
 *
 * スキップ: 日が空、合計行（月に「合計」）、曜日に「ー」の行
 */

import fs from 'node:fs'

const SERVICE_ID = process.env.SERVICE_ID ?? '1eaee33d-eece-4fe5-a511-8f863cd75bcf'
const SESSION_LABEL = process.env.SESSION_LABEL ?? '本店'

const HOUR_STARTS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

function escSqlStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function jsonMemoWeekday(wd, lunchIn, lunchTax, dinnerIn, dinnerTax, storeIn, storeTax) {
  const o = {
    source: 'spreadsheet',
    weekday: wd || null,
    lunch_tax_in: lunchIn,
    lunch_tax_amount: lunchTax,
    dinner_tax_in: dinnerIn,
    dinner_tax_amount: dinnerTax,
    store_tax_in: storeIn,
    store_tax_amount: storeTax,
  }
  return escSqlStr(JSON.stringify(o))
}

function num(s) {
  if (s == null || s === '') return null
  const t = String(s).trim().replace(/[¥,]/g, '')
  if (t === '' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function intOrNull(s) {
  const n = num(s)
  return n == null ? null : Math.trunc(n)
}

function isTotalRow(cols) {
  const m = String(cols[1] ?? '').trim()
  const d = String(cols[2] ?? '').trim()
  return m.includes('合計') || d.includes('合計')
}

function parseLine(line) {
  const cols = line.split('\t')
  while (cols.length < 46) cols.push('')
  return cols
}

function buildDaySql(cols) {
  const y = String(cols[0] ?? '').trim()
  const mo = String(cols[1] ?? '').trim()
  const d = String(cols[2] ?? '').trim()
  const wd = String(cols[3] ?? '').trim()

  if (!y || !mo || !d || wd === 'ー') return null
  if (isTotalRow(cols)) return null

  const yi = Number(y)
  const mi = Number(mo)
  const di = Number(d)
  if (![yi, mi, di].every(n => Number.isFinite(n))) return null

  const pad = (n) => String(n).padStart(2, '0')
  const salesDate = `${yi}-${pad(mi)}-${pad(di)}`

  const lunchIn = num(cols[4])
  const lunchTax = num(cols[5])
  const dinnerIn = num(cols[6])
  const dinnerTax = num(cols[7])
  const storeIn = num(cols[8])
  const storeTax = num(cols[9])
  const lunchEx = num(cols[10])
  const dinnerEx = num(cols[11])
  const storeEx = num(cols[12])

  const parentMemo = jsonMemoWeekday(wd, lunchIn, lunchTax, dinnerIn, dinnerTax, storeIn, storeTax)

  const lines = []
  lines.push(`INSERT INTO sales_days (service_id, sales_date, session_label, data_source, memo)`)
  lines.push(`VALUES (`)
  lines.push(`  '${SERVICE_ID}'::uuid,`)
  lines.push(`  '${salesDate}',`)
  lines.push(`  '${escSqlStr(SESSION_LABEL)}',`)
  lines.push(`  'manual',`)
  lines.push(`  '${parentMemo}'::text`)
  lines.push(`)`)
  lines.push(`ON CONFLICT (service_id, sales_date, session_label)`)
  lines.push(`DO UPDATE SET memo = EXCLUDED.memo, updated_at = now();`)
  lines.push(``)
  lines.push(`WITH d AS (`)
  lines.push(`  SELECT id FROM sales_days`)
  lines.push(`  WHERE service_id = '${SERVICE_ID}'::uuid`)
  lines.push(`    AND sales_date = '${salesDate}'`)
  lines.push(`    AND session_label = '${escSqlStr(SESSION_LABEL)}'`)
  lines.push(`)`)
  lines.push(`INSERT INTO sales_hourly_slots (`)
  lines.push(`  sales_day_id, slot_label, session_start_time, session_end_time,`)
  lines.push(`  total_amount_with_tax, total_amount_without_tax, business_hours_minutes, is_rest_break, memo`)
  lines.push(`)`)

  const slotRows = []
  const pushSlot = (label, t0, t1, amtIn, amtEx, slotMemo) => {
    const memoSql = slotMemo == null ? 'NULL::text' : `'${escSqlStr(slotMemo)}'::text`
    const start = t0 == null ? 'NULL::time' : `'${t0}'::time`
    const end = t1 == null ? 'NULL::time' : `'${t1}'::time`
    const mins =
      t0 == null || t1 == null
        ? 'NULL::int'
        : `(EXTRACT(EPOCH FROM ('${t1}'::time - '${t0}'::time))::int / 60)`
    const ain = amtIn == null ? 'NULL::numeric' : String(amtIn)
    const aex = amtEx == null ? 'NULL::numeric' : String(amtEx)
    slotRows.push(
      `  SELECT d.id, '${escSqlStr(label)}', ${start}, ${end}, ${ain}, ${aex}, ${mins}, false, ${memoSql} FROM d`,
    )
  }

  pushSlot('ランチ（税込）', null, null, lunchIn, lunchEx, null)
  pushSlot('ディナー（税込）', null, null, dinnerIn, dinnerEx, null)
  pushSlot('店内売上（税込）', null, null, storeIn, storeEx, null)

  let col = 13
  for (let i = 0; i < HOUR_STARTS.length; i++) {
    const h = HOUR_STARTS[i]
    const h2 = h + 1
    const tickets = intOrNull(cols[col])
    const amtIn = num(cols[col + 1])
    const amtEx = num(cols[col + 2])
    col += 3
    const label = `${String(h).padStart(2, '0')}:00-${String(h2).padStart(2, '0')}:00`
    const t0 = `${String(h).padStart(2, '0')}:00`
    const t1 = `${String(h2).padStart(2, '0')}:00`
    const memo =
      tickets == null && amtIn == null && amtEx == null
        ? null
        : JSON.stringify({ ticket_count: tickets ?? 0 })
    pushSlot(label, t0, t1, amtIn, amtEx, memo)
  }

  lines.push(slotRows.join('\nUNION ALL\n'))
  lines.push(`ON CONFLICT (sales_day_id, slot_label) DO UPDATE SET`)
  lines.push(`  session_start_time = EXCLUDED.session_start_time,`)
  lines.push(`  session_end_time = EXCLUDED.session_end_time,`)
  lines.push(`  total_amount_with_tax = EXCLUDED.total_amount_with_tax,`)
  lines.push(`  total_amount_without_tax = EXCLUDED.total_amount_without_tax,`)
  lines.push(`  business_hours_minutes = EXCLUDED.business_hours_minutes,`)
  lines.push(`  memo = EXCLUDED.memo,`)
  lines.push(`  updated_at = now();`)
  lines.push(``)

  return lines.join('\n')
}

const raw = fs.readFileSync(0, 'utf8')
const out = []
out.push(`-- Generated by scripts/gen-sales-sheet-sql.mjs`)
out.push(`-- service_id=${SERVICE_ID} session_label=${SESSION_LABEL}`)
out.push(`BEGIN;`)
out.push(``)

for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue
  const cols = parseLine(line)
  const sql = buildDaySql(cols)
  if (sql) out.push(sql)
}

out.push(`COMMIT;`)
process.stdout.write(out.join('\n'))
