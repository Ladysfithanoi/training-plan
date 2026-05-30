'use client'

/**
 * WeeklyVolumeChart
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure-SVG responsive line + area chart for weekly Volume Load (kg) data.
 * Zero external charting dependencies — Tailwind-styled container, vanilla SVG
 * for the chart elements.
 *
 * Design tokens used:
 *   --color-amber   #B5651E  line, fill, data points
 *   --color-ink     #14110E  axes, labels
 *   --color-paper   #F6F2EA  dot background
 *   --font-mono               axis tick values
 *   --font-sans               x-axis week labels
 */

import { fmtVol, type WeeklyVolumePoint } from '@/lib/volumeLoad'
import { cn } from '@/lib/utils'

// ─── Chart geometry constants ─────────────────────────────────────────────────
const VB_W = 760          // viewBox width
const VB_H = 240          // viewBox height
const PAD  = { l: 60, t: 24, r: 20, b: 56 } as const

const INNER_W = VB_W - PAD.l - PAD.r    // 680
const INNER_H = VB_H - PAD.t - PAD.b    // 160

const GRID_LINES = 5
const DOT_R      = 5     // data-point circle radius

// ─── Y-axis scale helpers ─────────────────────────────────────────────────────

/** Round `v` up to a "nice" number for the axis maximum. */
function niceMax(v: number): number {
  if (v === 0) return 1000
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / exp
  const nice = norm <= 1.5 ? 2 : norm <= 3 ? 4 : norm <= 7 ? 10 : 10
  return Math.ceil(v / (exp * nice / 10)) * (exp * nice / 10)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  data: WeeklyVolumePoint[]
  className?: string
}

export function WeeklyVolumeChart({ data, className }: Props) {
  // ── Empty state ──────────────────────────────────────────────────────────────
  if (data.length === 0) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-ink/8 bg-ink/2 py-12',
        className,
      )}>
        <span className="text-2xl opacity-30">📊</span>
        <p className="text-sm text-ink/35">Chưa có dữ liệu volume để hiển thị.</p>
        <p className="text-xs text-ink/25">Học viên cần ghi ít nhất 1 buổi tập có ghi tạ.</p>
      </div>
    )
  }

  // ── Scale ────────────────────────────────────────────────────────────────────
  const rawMax  = Math.max(...data.map(d => d.totalVolumeKg))
  const maxVol  = niceMax(rawMax)

  /** X coordinate for data-point index i */
  const xAt = (i: number): number =>
    PAD.l + (data.length === 1 ? INNER_W / 2 : (i / (data.length - 1)) * INNER_W)

  /** Y coordinate for volume value v */
  const yAt = (v: number): number =>
    PAD.t + INNER_H - (v / maxVol) * INNER_H

  const bottomY = PAD.t + INNER_H   // Y coordinate of X axis baseline

  // Precompute point coordinates
  const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(d.totalVolumeKg), d }))

  // ── SVG paths ────────────────────────────────────────────────────────────────
  const lineCmd = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const areaCmd = pts.length > 0
    ? `${lineCmd} L ${pts[pts.length - 1].x.toFixed(1)} ${bottomY} L ${pts[0].x.toFixed(1)} ${bottomY} Z`
    : ''

  // ── Trend calculation ────────────────────────────────────────────────────────
  let trendIcon = ''
  let trendCls  = ''
  if (data.length >= 2) {
    const last = data[data.length - 1].totalVolumeKg
    const prev = data[data.length - 2].totalVolumeKg
    if (last > prev * 1.02)       { trendIcon = '↑'; trendCls = 'text-herb' }
    else if (last < prev * 0.98)  { trendIcon = '↓'; trendCls = 'text-danger' }
    else                          { trendIcon = '→'; trendCls = 'text-ink/40' }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={cn('w-full', className)}>

      {/* Trend pill */}
      {trendIcon && (
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('text-sm font-bold font-mono', trendCls)}>
            {trendIcon}
          </span>
          <span className="text-xs text-ink/40">
            {data[data.length - 1].totalVolumeKg === 0
              ? 'Chưa có tạ được ghi tuần này'
              : `Tuần mới nhất: ${data[data.length - 1].totalVolumeKg.toLocaleString('vi-VN')} kg`}
          </span>
        </div>
      )}

      {/* SVG chart — min-width so very narrow containers still show labels */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label="Biểu đồ volume tập luyện theo tuần"
          className="w-full"
          style={{ minWidth: 340, display: 'block' }}
        >
          <defs>
            {/* Gradient fill under the line */}
            <linearGradient id="volAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#B5651E" stopOpacity={0.18} />
              <stop offset="75%"  stopColor="#B5651E" stopOpacity={0.04} />
              <stop offset="100%" stopColor="#B5651E" stopOpacity={0}    />
            </linearGradient>
          </defs>

          {/* ── Grid ─────────────────────────────────────────────────────── */}
          {Array.from({ length: GRID_LINES + 1 }, (_, j) => {
            const fraction = j / GRID_LINES
            const vy = fraction * maxVol
            const cy = yAt(vy)
            return (
              <g key={j}>
                {/* Horizontal grid line */}
                <line
                  x1={PAD.l}  y1={cy}
                  x2={PAD.l + INNER_W} y2={cy}
                  stroke="#14110E"
                  strokeOpacity={j === 0 ? 0.15 : 0.06}
                  strokeWidth={j === 0 ? 1 : 0.5}
                  strokeDasharray={j === 0 ? undefined : '3 4'}
                />
                {/* Y-axis label */}
                <text
                  x={PAD.l - 8}
                  y={cy + 4}
                  textAnchor="end"
                  fontSize={10}
                  fontFamily="'JetBrains Mono', 'Courier New', monospace"
                  fill="#14110E"
                  fillOpacity={0.35}
                >
                  {fmtVol(Math.round(vy))}
                </text>
              </g>
            )
          })}

          {/* ── Y-axis rule ───────────────────────────────────────────────── */}
          <line
            x1={PAD.l} y1={PAD.t}
            x2={PAD.l} y2={bottomY + 4}
            stroke="#14110E" strokeOpacity={0.15}
          />

          {/* ── Area fill ─────────────────────────────────────────────────── */}
          {areaCmd && (
            <path d={areaCmd} fill="url(#volAreaGrad)" />
          )}

          {/* ── Line ─────────────────────────────────────────────────────── */}
          {pts.length > 1 && (
            <path
              d={lineCmd}
              fill="none"
              stroke="#B5651E"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* ── Data points + labels ──────────────────────────────────────── */}
          {pts.map((p, i) => {
            const labelY = p.y - 10
            const vol    = p.d.totalVolumeKg
            return (
              <g key={i}>
                {/* Native tooltip for hover */}
                <title>
                  {`${p.d.weekLabel} (${p.d.weekStart})\nVolume: ${vol.toLocaleString('vi-VN')} kg\nHiệp làm việc: ${p.d.workingSets}\nBuổi tập: ${p.d.sessionsCount}`}
                </title>

                {/* Dot: outer ring */}
                <circle
                  cx={p.x} cy={p.y} r={DOT_R + 2}
                  fill="#F6F2EA"
                  stroke="#B5651E"
                  strokeWidth={2}
                />
                {/* Dot: filled centre */}
                <circle
                  cx={p.x} cy={p.y} r={DOT_R - 2}
                  fill={vol === 0 ? '#F6F2EA' : '#B5651E'}
                />

                {/* Volume label above dot (compact, only for non-zero) */}
                {vol > 0 && (
                  <text
                    x={p.x}
                    y={Math.max(PAD.t + 2, labelY)}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily="'JetBrains Mono', 'Courier New', monospace"
                    fill="#B5651E"
                    fillOpacity={0.8}
                  >
                    {fmtVol(vol)}
                  </text>
                )}

                {/* X-axis week label */}
                <text
                  x={p.x}
                  y={bottomY + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="'Be Vietnam Pro', system-ui, sans-serif"
                  fill="#14110E"
                  fillOpacity={0.45}
                >
                  {p.d.weekLabel}
                </text>

                {/* Working-set count below week label */}
                <text
                  x={p.x}
                  y={bottomY + 30}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="'JetBrains Mono', 'Courier New', monospace"
                  fill="#14110E"
                  fillOpacity={0.28}
                >
                  {p.d.workingSets}h
                </text>
              </g>
            )
          })}

          {/* ── Y-axis unit label ─────────────────────────────────────────── */}
          <text
            x={PAD.l - 8}
            y={PAD.t - 8}
            textAnchor="end"
            fontSize={9}
            fontFamily="'JetBrains Mono', 'Courier New', monospace"
            fill="#14110E"
            fillOpacity={0.25}
          >
            kg
          </text>

          {/* ── X-axis legend ─────────────────────────────────────────────── */}
          <text
            x={PAD.l + INNER_W / 2}
            y={VB_H - 2}
            textAnchor="middle"
            fontSize={8.5}
            fontFamily="'Be Vietnam Pro', system-ui, sans-serif"
            fill="#14110E"
            fillOpacity={0.22}
          >
            (số nhỏ = hiệp làm việc)
          </text>
        </svg>
      </div>
    </div>
  )
}
