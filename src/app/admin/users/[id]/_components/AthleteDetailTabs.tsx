'use client'

import { useState } from 'react'
import { cn, formatDate } from '@/lib/utils'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'
import { computeAllTimeSummary, computeSessionVolume, computeSessionWorkingSets } from '@/lib/volumeLoad'
import type { WeeklyVolumePoint } from '@/lib/volumeLoad'
import type { PhaseExercise } from '@/types'

// ── Local types (Supabase-shaped, avoids full import of every field) ──────────
type RepRange = { min: number; max: number; label?: string; exercise_type?: string }

type Phase = {
  id: string
  name: string
  phase_order: number
  phase_type: string
  duration_weeks: number
  frequency_per_week: number
  rep_ranges: RepRange[]
  target_set_reduction_factor: number
  includes_deload: boolean
  max_rir: number | null
  max_weight_percent: number | null
}

type UserProgram = {
  id: string
  start_date: string
  phase_start_date: string | null
  status: string
  notes: string | null
  block: { id: string; name: string; description: string | null; total_mesocycles: number } | null
  current_phase: Phase | null
  current_phase_id?: string | null
}

type SetRow = {
  id: string
  set_number: number
  actual_reps: number | null
  weight_kg: number | null
  rir: number | null
  rpe: number | null
  is_warmup: boolean
  estimated_1rm: number | null
  exercise: { id: string; name: string; type: string } | null
}

type SessionRow = {
  id: string
  session_date: string
  status: string
  overall_rir: number | null
  next_week_suggestion: string | null
  survey_performance: string | null
  survey_rir_feel: string | null
  survey_recovery: string | null
  sets: SetRow[]
}

interface AthleteDetailTabsProps {
  userProgram: UserProgram | null
  phaseExercises: PhaseExercise[]
  sessions: SessionRow[]
  weeklyVolumeData: WeeklyVolumePoint[]
}

// ── Display maps ──────────────────────────────────────────────────────────────
const PHASE_TYPE_VI: Record<string, string> = {
  training:    'Tập luyện',
  maintenance: 'Duy trì',
  active_rest: 'Nghỉ tích cực',
}
const EXERCISE_TYPE_VI: Record<string, string> = {
  compound:   'Phức hợp',
  machine:    'Máy tập',
  cable:      'Cáp',
  bodyweight: 'Tự trọng',
  dumbbell:   'Tạ đơn',
}
const SESSION_STATUS_VI: Record<string, { label: string; cls: string }> = {
  completed:   { label: 'Hoàn thành', cls: 'bg-herb/10 text-herb border-herb/20' },
  in_progress: { label: 'Đang tập',   cls: 'bg-amber/10 text-amber border-amber/20' },
  planned:     { label: 'Kế hoạch',   cls: 'bg-ink/5 text-ink/40 border-ink/10' },
  skipped:     { label: 'Bỏ qua',     cls: 'bg-ink/5 text-ink/35 border-ink/8' },
}
const PERF_VI: Record<string, string> = {
  exceed: '🔥 Vượt mục tiêu',
  meet:   '✅ Đạt mục tiêu',
  miss:   '📉 Trượt',
}
const RIR_VI: Record<string, string> = {
  easier:    '💪 Khỏe hơn',
  on_target: '🎯 Đúng RIR',
  too_hard:  '😮‍💨 Quá nặng',
}
const RECOVERY_VI: Record<string, string> = {
  great:  '⚡ Khỏe mạnh',
  normal: '😐 Bình thường',
  sore:   '🤕 Đau nhức',
}

export function AthleteDetailTabs({
  userProgram,
  phaseExercises,
  sessions,
  weeklyVolumeData,
}: AthleteDetailTabsProps) {
  const [tab, setTab] = useState<'log' | 'volume'>('log')

  const tabs = [
    { key: 'log'    as const, label: 'Nhật ký tập luyện' },
    { key: 'volume' as const, label: 'Tiến độ Thể tích' },
  ]

  return (
    <div className="space-y-4">
      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-ink/10 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'shrink-0 px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-amber text-amber'
                : 'border-transparent text-ink/45 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: Nhật ký tập luyện (Khối → Giai đoạn → Nhật ký matrix) ──── */}
      {tab === 'log' && (
        <div className="space-y-4">
          <ProgramTab userProgram={userProgram} />
          <LogTab sessions={sessions} phaseExercises={phaseExercises} />
          <div className="pt-2 pb-4 text-center">
            <p className="font-sans text-[11px] font-medium text-ink/20 tracking-wide">
              Powered by Trung Precision Coach System
            </p>
          </div>
        </div>
      )}

      {/* ── Tab 2: Tiến độ Thể tích ──────────────────────────────────────── */}
      {tab === 'volume' && (
        <VolumeTab weeklyVolumeData={weeklyVolumeData} />
      )}
    </div>
  )

  // ── Sub-components defined as local functions for co-location ─────────────

  function ProgramTab({
    userProgram,
  }: {
    userProgram: UserProgram | null
  }) {
    if (!userProgram) {
      return (
        <div className="rounded-xl border border-ink/8 bg-white px-5 py-10 text-center">
          <p className="text-sm text-ink/40">Học viên chưa được giao chương trình tập luyện.</p>
        </div>
      )
    }

    const phase = userProgram.current_phase
    const block = userProgram.block

    return (
      <div className="space-y-4">

        {/* Block card */}
        <div className="rounded-xl border border-ink/10 bg-white p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink/35 mb-1">
                Khối tập luyện
              </p>
              <h2 className="text-lg font-bold text-ink">{block?.name ?? '—'}</h2>
              {block?.description && (
                <p className="text-sm text-ink/50 mt-1">{block.description}</p>
              )}
            </div>
            <span className="shrink-0 rounded-full border border-slate/20 bg-slate/8 px-2.5 py-1 text-xs font-semibold text-slate">
              {block?.total_mesocycles ?? '—'} chu kỳ
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink/50 pt-2 border-t border-ink/6">
            <span>📅 Bắt đầu: {formatDate(userProgram.start_date)}</span>
            {userProgram.phase_start_date && (
              <span>🔄 Giai đoạn hiện tại từ: {formatDate(userProgram.phase_start_date)}</span>
            )}
          </div>
        </div>

        {/* Phase card */}
        {phase ? (
          <div className="rounded-xl border border-herb/20 bg-herb/4 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-herb/60 mb-1">
                  Giai đoạn #{phase.phase_order}
                </p>
                <h3 className="text-base font-bold text-ink">{phase.name}</h3>
              </div>
              <span className="shrink-0 rounded-full border border-herb/25 bg-herb/10 px-2.5 py-1 text-xs font-semibold text-herb">
                {PHASE_TYPE_VI[phase.phase_type] ?? phase.phase_type}
              </span>
            </div>

            {/* Phase meta grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Thời lượng',    value: `${phase.duration_weeks} tuần` },
                { label: 'Tần suất',      value: `${phase.frequency_per_week}×/tuần` },
                { label: 'Loại',          value: PHASE_TYPE_VI[phase.phase_type] ?? phase.phase_type },
                phase.max_rir != null
                  ? { label: 'Max RIR',   value: phase.max_rir }
                  : { label: 'Mức giảm thể tích', value: phase.target_set_reduction_factor < 1 ? `${Math.round((1 - phase.target_set_reduction_factor) * 100)}%` : '—' },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border border-ink/8 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/35 mb-0.5">
                    {item.label}
                  </p>
                  <p className="text-sm font-semibold text-ink">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Rep zones */}
            {phase.rep_ranges?.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-2">
                  Vùng rep được kê
                </p>
                <div className="flex flex-wrap gap-2">
                  {phase.rep_ranges.map((rr, i) => (
                    <span
                      key={i}
                      className="rounded-lg border border-amber/25 bg-amber/6 px-2.5 py-1 text-xs font-medium text-ink/70"
                    >
                      {rr.label ?? `Zone ${i + 1}`}: {rr.min}–{rr.max} reps
                      {rr.exercise_type && (
                        <span className="ml-1 text-ink/40">({EXERCISE_TYPE_VI[rr.exercise_type] ?? rr.exercise_type})</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-ink/8 bg-white px-5 py-6 text-center">
            <p className="text-sm text-ink/40">Chưa có giai đoạn nào được kích hoạt.</p>
          </div>
        )}

      </div>
    )
  }

  // ── Volume tab ─────────────────────────────────────────────────────────────
  function VolumeTab({ weeklyVolumeData }: { weeklyVolumeData: WeeklyVolumePoint[] }) {
    const summary = computeAllTimeSummary(weeklyVolumeData)

    const statCards: { label: string; value: string; sub?: string }[] = [
      {
        label: 'Tổng thể tích',
        value: summary.totalVolumeKg >= 1000
          ? `${(summary.totalVolumeKg / 1000).toFixed(1)}k kg`
          : `${summary.totalVolumeKg.toLocaleString('vi-VN')} kg`,
        sub: `${weeklyVolumeData.length} tuần gần nhất`,
      },
      {
        label: 'TB / tuần',
        value: summary.avgVolumePerWeek >= 1000
          ? `${(summary.avgVolumePerWeek / 1000).toFixed(1)}k kg`
          : `${summary.avgVolumePerWeek.toLocaleString('vi-VN')} kg`,
      },
      {
        label: 'TB / buổi',
        value: summary.avgVolumePerSession >= 1000
          ? `${(summary.avgVolumePerSession / 1000).toFixed(1)}k kg`
          : `${summary.avgVolumePerSession.toLocaleString('vi-VN')} kg`,
      },
      {
        label: 'Hiệp làm việc',
        value: summary.totalWorkingSets.toLocaleString('vi-VN'),
        sub: `${summary.totalSessions} buổi tập`,
      },
    ]

    return (
      <div className="space-y-5">

        {/* ── Summary stats row ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map((card, i) => (
            <div
              key={i}
              className="rounded-xl border border-ink/8 bg-white px-4 py-3.5 space-y-0.5"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35">
                {card.label}
              </p>
              <p className="text-xl font-bold font-mono text-ink tabular-nums">
                {card.value}
              </p>
              {card.sub && (
                <p className="text-[11px] text-ink/35">{card.sub}</p>
              )}
            </div>
          ))}
        </div>

        {/* ── Line chart ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-ink/8 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-ink/6 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Tổng Volume theo Tuần</p>
              <p className="text-[11px] text-ink/40 mt-0.5">
                Volume Load = Reps × Tạ (kg) — tổng các hiệp làm việc mỗi tuần
              </p>
            </div>
            {weeklyVolumeData.length > 0 && (
              <span className="shrink-0 rounded-full border border-amber/25 bg-amber/8 px-2.5 py-1 text-[10px] font-bold text-amber/80">
                {weeklyVolumeData.length} tuần
              </span>
            )}
          </div>
          <div className="px-5 pb-5 pt-4">
            <WeeklyVolumeChart data={weeklyVolumeData} />
          </div>
        </div>

        {/* ── Week-by-week breakdown table ─────────────────────────────────── */}
        {weeklyVolumeData.length > 0 && (
          <div className="rounded-xl border border-ink/8 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-ink/6">
              <p className="text-sm font-semibold text-ink">Chi tiết theo tuần</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-[10px] text-ink/35 uppercase tracking-wide border-b border-ink/6">
                    <th className="text-left px-5 py-2.5">Tuần</th>
                    <th className="text-right px-4 py-2.5">Volume (kg)</th>
                    <th className="text-right px-4 py-2.5">Hiệp làm việc</th>
                    <th className="text-right px-4 py-2.5">Buổi tập</th>
                    <th className="text-right px-5 py-2.5">Δ tuần trước</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {[...weeklyVolumeData].reverse().map((w, i, arr) => {
                    const prev = arr[i + 1]
                    const delta = prev ? w.totalVolumeKg - prev.totalVolumeKg : null
                    const pct   = prev && prev.totalVolumeKg > 0
                      ? ((delta! / prev.totalVolumeKg) * 100).toFixed(1)
                      : null
                    return (
                      <tr key={w.weekStart} className="hover:bg-ink/2 transition-colors">
                        <td className="px-5 py-2.5">
                          <p className="font-medium text-ink">{w.weekLabel}</p>
                          <p className="text-[11px] text-ink/35 font-mono">{w.weekStart}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink tabular-nums">
                          {w.totalVolumeKg === 0
                            ? <span className="text-ink/25">—</span>
                            : w.totalVolumeKg >= 1000
                              ? `${(w.totalVolumeKg / 1000).toFixed(1)}k`
                              : w.totalVolumeKg.toLocaleString('vi-VN')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink/60 tabular-nums font-mono">
                          {w.workingSets}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink/60 tabular-nums">
                          {w.sessionsCount}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {delta == null ? (
                            <span className="text-ink/20 text-xs">—</span>
                          ) : delta > 0 ? (
                            <span className="text-herb font-semibold text-xs tabular-nums">
                              ↑ +{pct}%
                            </span>
                          ) : delta < 0 ? (
                            <span className="text-danger font-semibold text-xs tabular-nums">
                              ↓ {pct}%
                            </span>
                          ) : (
                            <span className="text-ink/35 text-xs">→ 0%</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    )
  }

  function LogTab({ sessions, phaseExercises }: { sessions: SessionRow[]; phaseExercises: PhaseExercise[] }) {
    const completedSessions = sessions.filter(s => s.sets.length > 0 || s.status === 'completed')

    if (completedSessions.length === 0) {
      return (
        <div className="rounded-xl border border-ink/8 bg-white px-5 py-10 text-center">
          <p className="text-sm text-ink/40">Học viên chưa ghi nhận buổi tập nào.</p>
        </div>
      )
    }

    const MAX_SETS = 6
    // Lookup phase-exercise prescription (target sets / rep range) by exercise id
    const targetByExercise = new Map(phaseExercises.map(pe => [pe.exercise_id, pe]))

    return (
      <div className="space-y-5">
        {completedSessions.map(session => {
          const statusMeta = SESSION_STATUS_VI[session.status] ?? { label: session.status, cls: '' }
          const hasSurvey = session.survey_performance && session.survey_rir_feel && session.survey_recovery

          // Group sets by exercise (preserve exercise id for target lookup)
          const byExercise = session.sets.reduce(
            (acc, s) => {
              const exId = s.exercise?.id ?? '__unknown__'
              if (!acc[exId]) acc[exId] = { id: exId, name: s.exercise?.name ?? 'Bài tập không xác định', type: s.exercise?.type ?? '', sets: [] }
              acc[exId].sets.push(s)
              return acc
            },
            {} as Record<string, { id: string; name: string; type: string; sets: SetRow[] }>,
          )
          const exerciseGroups = Object.values(byExercise)

          // Session-level metrics for the summary block
          const volSets = session.sets.map(s => ({
            actual_reps: s.actual_reps ?? null, weight_kg: s.weight_kg ?? null, is_warmup: s.is_warmup,
          }))
          const volumeKg    = Math.round(computeSessionVolume(volSets))
          const workingSets = computeSessionWorkingSets(volSets)

          return (
            <div key={session.id} className="rounded-xl border border-ink/8 bg-white overflow-hidden">

              {/* Session header */}
              <div className="px-5 py-3.5 border-b border-ink/6 bg-ink/1 flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-ink">{formatDate(session.session_date)}</h3>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusMeta.cls)}>
                    {statusMeta.label}
                  </span>
                  <span className="text-xs text-ink/35">{session.sets.length} hiệp</span>
                  {session.overall_rir != null && (
                    <span className="text-xs text-ink/35">· RIR TB: {session.overall_rir.toFixed(1)}</span>
                  )}
                </div>

                {/* Survey pills */}
                {hasSurvey && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-medium bg-ink/5 rounded px-1.5 py-0.5 text-ink/50">{PERF_VI[session.survey_performance!]}</span>
                    <span className="text-[10px] font-medium bg-ink/5 rounded px-1.5 py-0.5 text-ink/50">{RIR_VI[session.survey_rir_feel!]}</span>
                    <span className="text-[10px] font-medium bg-ink/5 rounded px-1.5 py-0.5 text-ink/50">{RECOVERY_VI[session.survey_recovery!]}</span>
                  </div>
                )}
              </div>

              {/* ── Read-only spreadsheet matrix ──────────────────────────── */}
              {exerciseGroups.length > 0 ? (
                <div className="p-3">
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{exerciseGroups.length} bài tập · chỉ xem</span>
                      <span className="ml-auto inline-flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-slate-200" />Kg</span>
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-slate-300" />Lần</span>
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="border-separate border-spacing-0" style={{ minWidth: '720px', width: '100%' }}>
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-20 border-b border-r border-slate-100 bg-white px-3 py-2.5 text-left" style={{ minWidth: 150 }}>
                              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Tên bài</span>
                            </th>
                            <th className="border-b border-r border-slate-100 bg-white px-3 py-2.5 text-left" style={{ width: 92 }}>
                              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Mục tiêu</span>
                            </th>
                            {Array.from({ length: MAX_SETS }, (_, i) => (
                              <th key={i} className="border-b border-r border-slate-100 bg-white px-2 py-2 text-center" style={{ width: 96 }}>
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block">Hiệp {i + 1}</span>
                                <div className="flex justify-center gap-2 mt-0.5">
                                  <span className="text-[8px] text-slate-400 font-mono font-semibold">Kg</span>
                                  <span className="text-[8px] text-slate-400 font-mono font-semibold">Lần</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {exerciseGroups.map((group, rowIdx) => {
                            const pe = targetByExercise.get(group.id)
                            const targetSets = pe?.target_sets ?? group.sets.length
                            const targetLabel = pe
                              ? (pe.is_amrap
                                  ? `${pe.target_sets}× ${pe.target_rep_min}–${pe.target_rep_max}+A`
                                  : `${pe.target_sets} × ${pe.target_rep_min}–${pe.target_rep_max}`)
                              : '—'
                            const rowTint  = rowIdx % 2 === 1
                            const stickyBg = rowTint ? 'bg-slate-50' : 'bg-white'
                            return (
                              <tr key={group.id}>
                                <td className={cn('sticky left-0 z-10 border-b border-r border-slate-100 px-3 py-2.5', stickyBg)} style={{ minWidth: 150 }}>
                                  <p className="font-sans font-semibold text-sm text-slate-700 leading-tight">{group.name}</p>
                                  {group.type && <p className="text-[10px] text-slate-400 mt-0.5">{EXERCISE_TYPE_VI[group.type] ?? group.type}</p>}
                                </td>
                                <td className={cn('border-b border-r border-slate-100 px-3 py-2.5', rowTint ? 'bg-slate-50/40' : '')} style={{ width: 92 }}>
                                  <p className="font-mono text-[11px] text-slate-500 whitespace-nowrap">{targetLabel}</p>
                                  {pe?.rir_target != null && !pe.is_amrap && <p className="font-mono text-[10px] text-slate-400">RIR {pe.rir_target}</p>}
                                </td>
                                {Array.from({ length: MAX_SETS }, (_, si) => {
                                  const setNum = si + 1
                                  const s = group.sets.find(x => x.set_number === setNum)
                                  const isTarget = setNum <= targetSets
                                  return (
                                    <td key={si} className={cn('border-b border-r border-slate-100 px-1.5 py-2', rowTint ? 'bg-slate-50/40' : '', !isTarget && !s && 'opacity-40')} style={{ width: 96 }}>
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text" readOnly tabIndex={-1}
                                          aria-label={`${group.name} hiệp ${setNum} kg`}
                                          value={s?.weight_kg != null ? String(s.weight_kg) : ''}
                                          placeholder="—"
                                          className="h-8 w-[44px] rounded-md border-none shadow-none bg-slate-50 text-slate-500 text-center text-sm font-mono tabular-nums cursor-not-allowed outline-none placeholder:text-slate-300"
                                        />
                                        <input
                                          type="text" readOnly tabIndex={-1}
                                          aria-label={`${group.name} hiệp ${setNum} reps`}
                                          value={s?.actual_reps != null ? String(s.actual_reps) : ''}
                                          placeholder="—"
                                          className="h-8 w-[44px] rounded-md border-none shadow-none bg-slate-100 text-slate-600 text-center text-sm font-mono tabular-nums font-semibold cursor-not-allowed outline-none placeholder:text-slate-300"
                                        />
                                      </div>
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Meta metrics: total volume + autoregulation suggestion ── */}
                  <div className="mt-3 rounded-xl border border-herb/20 bg-herb/4 px-5 py-4 space-y-3">
                    {volumeKg > 0 && (
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-herb">Khối lượng tổng kết</span>
                        <p className="text-2xl font-black font-mono text-amber tabular-nums">
                          {volumeKg >= 1000 ? `${(volumeKg / 1000).toFixed(1)}k` : volumeKg.toLocaleString('vi-VN')}
                          <span className="text-base font-bold ml-1">kg</span>
                        </p>
                        <span className="text-sm text-ink/50">· {workingSets} hiệp làm việc 💪</span>
                      </div>
                    )}
                    {session.next_week_suggestion && (
                      <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 flex items-start gap-2.5">
                        <span className="text-base shrink-0">📋</span>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Gợi ý điều chỉnh tuần sau</p>
                          <p className="text-xs text-ink/70 leading-relaxed">{session.next_week_suggestion}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="px-5 py-4 text-xs text-ink/35">Không có hiệp nào được ghi trong buổi này.</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }
}
