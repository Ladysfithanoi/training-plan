/**
 * Tolerant phase_exercises INSERT
 * ─────────────────────────────────────────────────────────────────────────────
 * `phase_exercises` grew several columns through migrations that each have to be
 * run by hand in the Supabase SQL editor (006 is_amrap / target_percentage_1rm,
 * 008 sort_order, 011 week_number, 012 is_warmup). A deployment can therefore be
 * running new code against a table that is missing any subset of them.
 *
 * The importers used to handle that with an all-or-nothing retry: if the full
 * insert failed, re-insert a stripped set of rows. That threw away DATA, not
 * just columns — a whole-program import lost every per-week row and only the
 * base ("Gốc") rows survived, so an 8-week file produced 8 empty weeks.
 *
 * This helper degrades one column at a time instead: it retries the SAME rows
 * with the missing column removed, so every row still lands and only the
 * unsupported attribute is lost.
 *
 * `week_number` is the exception — dropping it would silently collapse eight
 * weeks of prescriptions into eight copies of the base program, which is worse
 * than failing. When rows actually carry a week, the insert stops with an error
 * naming the migration to run.
 */

// Columns added by later migrations — any of them may be absent on a live DB.
export const OPTIONAL_PE_COLUMNS = [
  'is_amrap', 'target_percentage_1rm', 'sort_order', 'week_number', 'is_warmup',
] as const

export type OptionalPeColumn = typeof OPTIONAL_PE_COLUMNS[number]

/** The shape both PostgREST and Postgres errors arrive in. */
export interface DbError {
  code?: string
  message?: string
}

/**
 * PostgREST rejects an unknown column before Postgres sees it
 *   PGRST204 "Could not find the 'sort_order' column of 'phase_exercises' …"
 * while a query that reaches Postgres comes back as
 *   42703 "column phase_exercises.sort_order does not exist"
 */
const MISSING_COLUMN_PATTERNS = [
  /could not find the '([a-z_]+)' column/i,
  /column\s+(?:[\w"]+\.)?"?([a-z_]+)"?\s+does not exist/i,
]

/** Which optional column an error is complaining about, if any. */
export function missingOptionalColumn(err: DbError | null): OptionalPeColumn | null {
  if (!err) return null
  const message = err.message ?? ''
  const known: readonly string[] = OPTIONAL_PE_COLUMNS

  for (const pattern of MISSING_COLUMN_PATTERNS) {
    const match = message.match(pattern)
    if (match && known.includes(match[1])) return match[1] as OptionalPeColumn
  }

  // Wording we don't recognise, but the error class is right: fall back to any
  // optional column named anywhere in the message.
  if (err.code === 'PGRST204' || err.code === '42703') {
    return OPTIONAL_PE_COLUMNS.find(c => message.includes(c)) ?? null
  }

  return null
}

export interface TolerantInsertResult {
  error: DbError | null
  /** Optional columns the DB turned out not to have; the rows still landed. */
  dropped: OptionalPeColumn[]
}

/**
 * Insert `records`, retrying without whichever optional column the DB lacks.
 *
 * `attempt` performs one insert and resolves to its error (null on success) —
 * the caller owns the Supabase client, so it can also keep the returned rows.
 */
export async function insertPhaseExercises(
  attempt: (rows: Record<string, unknown>[]) => Promise<DbError | null>,
  records: Record<string, unknown>[],
): Promise<TolerantInsertResult> {
  const rows = records.map(r => ({ ...r }))
  const dropped: OptionalPeColumn[] = []

  // At most one retry per optional column, plus the first attempt.
  for (let i = 0; i <= OPTIONAL_PE_COLUMNS.length; i++) {
    const error = await attempt(rows)
    if (!error) return { error: null, dropped }

    const column = missingOptionalColumn(error)
    if (!column) return { error, dropped }

    // Losing the week scope would turn N weeks into N copies of the base program.
    if (column === 'week_number' && rows.some(r => r.week_number != null)) {
      return {
        error: {
          code: error.code,
          message:
            'Cơ sở dữ liệu chưa có cột "week_number" nên không lưu được giáo án theo từng tuần. ' +
            'Hãy chạy migration 011_add_phase_exercise_week_number.sql trong Supabase SQL editor rồi nhập lại.',
        },
        dropped,
      }
    }

    for (const row of rows) delete row[column]
    dropped.push(column)
  }

  return { error: { message: 'Không thể ghi bài tập vào cơ sở dữ liệu.' }, dropped }
}

/** Human-readable note about what the DB could not store, or null. */
export function droppedColumnsNote(dropped: OptionalPeColumn[]): string | null {
  if (dropped.length === 0) return null
  const labels: Record<OptionalPeColumn, string> = {
    is_amrap:              'AMRAP',
    target_percentage_1rm: '%1RM',
    sort_order:            'thứ tự kéo-thả (sort_order)',
    week_number:           'tuần (week_number)',
    is_warmup:             'đánh dấu khởi động (is_warmup)',
  }
  return `Cơ sở dữ liệu chưa có cột: ${dropped.map(c => labels[c]).join(', ')}. ` +
    'Bài tập vẫn được ghi đầy đủ, chỉ riêng thông tin đó chưa lưu được — ' +
    'chạy migration tương ứng trong Supabase SQL editor để bật lại.'
}
