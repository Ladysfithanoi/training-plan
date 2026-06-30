'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { MovementPattern } from '@/types'

interface ImportRow {
  name: string
  type: string
  movement_pattern_id: string
  optimal_rep_min: number
  optimal_rep_max: number
  muscle_groups: string
  description: string
  video_url: string
}

interface Props {
  open: boolean
  onClose: () => void
  patterns: MovementPattern[]
  onImported: (count: number) => void
}

const EXERCISE_TYPES_VI = [
  { value: 'compound', label: 'Phức hợp' },
  { value: 'machine', label: 'Máy tập' },
  { value: 'cable', label: 'Cáp' },
  { value: 'bodyweight', label: 'Trọng lượng cơ thể' },
  { value: 'dumbbell', label: 'Tạ đơn' },
]

export function ImportExcelModal({ open, onClose, patterns, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<number | null>(null)

  function resolveColumn(headers: string[], candidates: string[]): number {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.toLowerCase().trim() === c.toLowerCase())
      if (idx !== -1) return idx
    }
    return -1
  }

  async function handleFile(file: File) {
    setParseError(null)
    setRows([])
    setImportDone(null)
    setImportError(null)
    setFileName(file.name)

    try {
      const xlsx = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const workbook = xlsx.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const raw: string[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]

      if (raw.length < 2) {
        setParseError('Tệp không có dữ liệu.')
        return
      }

      const headers = (raw[0] as string[]).map(h => String(h).trim())
      const nameIdx = resolveColumn(headers, ['name', 'exercise', 'exercise name', 'tên bài tập', 'tên'])
      const typeIdx = resolveColumn(headers, ['type', 'exercise type', 'loại bài', 'loại'])
      const patternIdx = resolveColumn(headers, ['pattern', 'movement pattern', 'movement_pattern', 'chuỗi chuyển động'])
      const repMinIdx = resolveColumn(headers, ['rep min', 'rep_min', 'optimal_rep_min', 'min reps', 'reps tối thiểu'])
      const repMaxIdx = resolveColumn(headers, ['rep max', 'rep_max', 'optimal_rep_max', 'max reps', 'reps tối đa'])
      const muscleIdx = resolveColumn(headers, ['muscle', 'muscles', 'muscle groups', 'muscle_groups', 'nhóm cơ'])
      const descIdx = resolveColumn(headers, ['description', 'desc', 'notes', 'mô tả', 'ghi chú'])
      const videoIdx = resolveColumn(headers, ['video', 'video_url', 'video url', 'youtube', 'link', 'link kỹ thuật'])

      if (nameIdx === -1) {
        setParseError('Không tìm thấy cột "name" (tên bài tập). Hãy đảm bảo hàng đầu tiên có tiêu đề.')
        return
      }

      const patternByName: Record<string, string> = {}
      for (const p of patterns) patternByName[p.name.toLowerCase()] = p.id

      const parsed: ImportRow[] = []
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i] as string[]
        const name = String(row[nameIdx] ?? '').trim()
        if (!name) continue

        let movement_pattern_id = ''
        if (patternIdx !== -1) {
          const pName = String(row[patternIdx] ?? '').trim().toLowerCase()
          movement_pattern_id = patternByName[pName] ?? ''
        }

        parsed.push({
          name,
          type: typeIdx !== -1 ? String(row[typeIdx] ?? '').trim() : 'compound',
          movement_pattern_id,
          optimal_rep_min: repMinIdx !== -1 ? Number(row[repMinIdx]) || 5 : 5,
          optimal_rep_max: repMaxIdx !== -1 ? Number(row[repMaxIdx]) || 20 : 20,
          muscle_groups: muscleIdx !== -1 ? String(row[muscleIdx] ?? '').trim() : '',
          description: descIdx !== -1 ? String(row[descIdx] ?? '').trim() : '',
          video_url: videoIdx !== -1 ? String(row[videoIdx] ?? '').trim() : '',
        })
      }

      if (parsed.length === 0) {
        setParseError('Không tìm thấy dòng dữ liệu hợp lệ.')
        return
      }

      setRows(parsed)
    } catch (err) {
      setParseError(`Lỗi đọc tệp: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`)
    }
  }

  function updateRow(i: number, field: keyof ImportRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  async function handleImport() {
    setImporting(true)
    setImportError(null)

    const payload = rows.map(r => ({
      name: r.name,
      type: r.type || 'compound',
      movement_pattern_id: r.movement_pattern_id || null,
      optimal_rep_min: r.optimal_rep_min || 5,
      optimal_rep_max: r.optimal_rep_max || 20,
      muscle_groups: r.muscle_groups
        ? r.muscle_groups.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      description: r.description || null,
      video_url: r.video_url || null,
    }))

    const res = await fetch('/api/exercises/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: payload }),
    })

    const data = await res.json()
    setImporting(false)

    if (!res.ok) {
      setImportError(data.error ?? 'Nhập thất bại')
      return
    }

    setImportDone(data.imported)
    onImported(data.imported)
  }

  function handleClose() {
    setRows([])
    setFileName(null)
    setParseError(null)
    setImportDone(null)
    setImportError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Nhập bài tập từ Excel / CSV" size="lg">
      {importDone !== null ? (
        <div className="py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-herb/10 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-ink">Nhập thành công</p>
          <p className="text-sm text-ink/50">{importDone} bài tập đã được nhập.</p>
          <Button variant="primary" onClick={handleClose}>Hoàn tất</Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Khu vực kéo thả */}
          <div
            className="rounded-xl border-2 border-dashed border-ink/20 p-6 text-center cursor-pointer hover:border-amber/50 hover:bg-amber/3 transition-all"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
          >
            <svg className="h-8 w-8 text-ink/25 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-ink/60">
              {fileName ? fileName : 'Kéo thả hoặc nhấn để tải tệp lên'}
            </p>
            <p className="text-xs text-ink/35 mt-1">.xlsx, .xls, .csv — Hàng đầu tiên phải là tiêu đề cột</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>

          {/* Gợi ý cột */}
          <div className="rounded-lg bg-amber/6 border border-amber/15 px-4 py-3 text-xs text-ink/60 space-y-1">
            <p className="font-semibold text-amber">Tên cột được hỗ trợ (không phân biệt chữ hoa/thường)</p>
            <p>
              <span className="font-medium text-ink/70">name / tên bài tập</span> (bắt buộc),
              type / loại bài, pattern / chuỗi chuyển động, rep min, rep max, nhóm cơ, mô tả, video / link kỹ thuật
            </p>
          </div>

          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {/* Bảng xem trước */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-ink">
                {rows.length} dòng được phát hiện — kiểm tra trước khi nhập
              </p>

              <div className="overflow-auto max-h-72 rounded-xl border border-ink/8 bg-white">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="border-b border-ink/8 sticky top-0 bg-white z-10">
                    <tr className="text-ink/40 uppercase tracking-wide">
                      <th className="text-left px-3 py-2">Tên bài tập</th>
                      <th className="text-left px-3 py-2">Loại</th>
                      <th className="text-left px-3 py-2">Chuỗi CĐ</th>
                      <th className="text-left px-3 py-2">Rep Min</th>
                      <th className="text-left px-3 py-2">Rep Max</th>
                      <th className="text-left px-3 py-2">Nhóm cơ</th>
                      <th className="text-left px-3 py-2">Link kỹ thuật</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {rows.map((row, i) => (
                      <tr key={i} className="hover:bg-ink/2">
                        <td className="px-3 py-1.5">
                          <input
                            value={row.name}
                            onChange={e => updateRow(i, 'name', e.target.value)}
                            className="w-full bg-transparent focus:outline-none focus:bg-white rounded px-1 py-0.5 border border-transparent focus:border-amber/40"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={row.type}
                            onChange={e => updateRow(i, 'type', e.target.value)}
                            className="bg-transparent focus:outline-none text-xs"
                          >
                            {EXERCISE_TYPES_VI.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={row.movement_pattern_id}
                            onChange={e => updateRow(i, 'movement_pattern_id', e.target.value)}
                            className="bg-transparent focus:outline-none text-xs"
                          >
                            <option value="">— không —</option>
                            {patterns.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 w-16">
                          <input
                            type="number"
                            value={row.optimal_rep_min}
                            onChange={e => updateRow(i, 'optimal_rep_min', e.target.value)}
                            className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40"
                          />
                        </td>
                        <td className="px-3 py-1.5 w-16">
                          <input
                            type="number"
                            value={row.optimal_rep_max}
                            onChange={e => updateRow(i, 'optimal_rep_max', e.target.value)}
                            className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            value={row.muscle_groups}
                            onChange={e => updateRow(i, 'muscle_groups', e.target.value)}
                            placeholder="đùi trước, mông..."
                            className="w-full bg-transparent focus:outline-none focus:bg-white rounded px-1 py-0.5 border border-transparent focus:border-amber/40"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            value={row.video_url}
                            onChange={e => updateRow(i, 'video_url', e.target.value)}
                            placeholder="https://youtu.be/..."
                            className="w-full bg-transparent focus:outline-none focus:bg-white rounded px-1 py-0.5 border border-transparent focus:border-amber/40"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importError && <p className="text-sm text-danger">{importError}</p>}

              <div className="flex gap-2">
                <Button
                  variant="herb"
                  loading={importing}
                  onClick={handleImport}
                  className="flex-1"
                >
                  Nhập {rows.length} bài tập
                </Button>
                <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
              </div>
            </div>
          )}

          {rows.length === 0 && !parseError && (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
