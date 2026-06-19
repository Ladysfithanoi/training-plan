// Pure constants for the "Bảng tin" feature — safe to import from BOTH client
// and server code. The server-only data helpers (which pull in the service-role
// Supabase client) live in `announcements.server.ts` to keep this module free of
// `next/headers`, so client components can import these limits without dragging
// server-only code into the browser bundle.

/** Rows auto-expire this many hours after posting (keeps the DB light). */
export const ANNOUNCEMENT_EXPIRY_HOURS = 48
/** Hard cap on stored rows — admin must delete before adding past this. */
export const ANNOUNCEMENT_MAX_ITEMS = 6
/** How many cards the board shows at once (newest first). */
export const ANNOUNCEMENT_MAX_VISIBLE = 3

/** localStorage key holding the created_at of the newest announcement this
 *  browser has viewed — drives the "có tin mới" dot + "Mới" badges. */
export const ANNOUNCEMENT_SEEN_KEY = 'announcements_last_seen'
