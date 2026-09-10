'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Hỏi người dùng có muốn cài app vào màn hình chính điện thoại không.
 *
 * Hai đường khác nhau, vì hai hệ máy làm khác nhau:
 *
 * • Android (Chrome/Edge/Samsung) — trình duyệt bắn `beforeinstallprompt` khi
 *   trang đủ điều kiện cài (có manifest, có service worker, chạy HTTPS). Ta
 *   chặn banner mặc định của trình duyệt lại, hiện banner riêng đúng tông app,
 *   rồi khi bấm "Cài đặt" mới gọi `prompt()` — hộp thoại cài đặt thật của hệ
 *   điều hành.
 *
 * • iOS (Safari) — Apple không hỗ trợ `beforeinstallprompt`, cài app chỉ có
 *   đường thủ công qua nút Chia sẻ. Nên ở đây banner chuyển thành hướng dẫn
 *   từng bước thay vì nút bấm.
 *
 * Đã cài rồi (đang chạy ở chế độ standalone) thì không hiện gì cả.
 */

/** `beforeinstallprompt` chưa nằm trong lib DOM chuẩn của TypeScript. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Bấm "Để sau" thì im lặng chừng này rồi mới hỏi lại — hỏi mỗi lần mở app là
// làm phiền, mà không hỏi lại lần nào thì người đổi ý không còn đường cài.
const SNOOZE_KEY = 'pwa-install-snoozed-at'
const SNOOZE_DAYS = 14
// Chờ một nhịp cho trang vẽ xong rồi mới hiện, đỡ đập vào mặt người dùng.
const SHOW_DELAY_MS = 4000

function isSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY))
    if (!at) return false
    return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Safari chế độ riêng tư có thể ném lỗi khi đụng localStorage.
    return false
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()))
  } catch {
    /* không lưu được thì thôi, lần sau hỏi lại */
  }
}

/** Đang mở từ icon màn hình chính (không phải trong tab trình duyệt)? */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari iOS dùng cờ riêng, không theo chuẩn display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS từ 13 khai man là máy Mac; nhận ra qua màn hình cảm ứng.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)

  // Đăng ký service worker — không có nó Chrome sẽ không bắn
  // `beforeinstallprompt`, tức là banner cài đặt không bao giờ hiện.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* trình duyệt cũ hoặc chạy HTTP: bỏ qua, app vẫn dùng bình thường */
    })
  }, [])

  useEffect(() => {
    if (isStandalone()) return

    let timer: number | undefined

    // Android: chờ trình duyệt báo "trang này cài được".
    function onBeforeInstall(e: Event) {
      e.preventDefault() // giữ lại sự kiện để tự chọn thời điểm hỏi
      setDeferred(e as BeforeInstallPromptEvent)
      if (!isSnoozed()) timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    }

    // Cài xong (từ banner của ta hoặc từ menu trình duyệt) thì dẹp banner.
    function onInstalled() {
      setVisible(false)
      setDeferred(null)
      try {
        localStorage.removeItem(SNOOZE_KEY)
      } catch {
        /* bỏ qua */
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    // iOS: không có sự kiện nào để chờ, tự bật hướng dẫn thủ công.
    if (isIOS() && !isSnoozed()) {
      timer = window.setTimeout(() => {
        setIosHint(true)
        setVisible(true)
      }, SHOW_DELAY_MS)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const dismiss = useCallback(() => {
    snooze()
    setVisible(false)
  }, [])

  async function handleInstall() {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      // Từ chối hộp thoại thật thì cũng nghỉ hỏi một thời gian.
      if (outcome === 'dismissed') snooze()
    } catch {
      /* người dùng đóng hộp thoại: coi như chưa cài */
    } finally {
      // Một `beforeinstallprompt` chỉ xài được một lần.
      setDeferred(null)
      setInstalling(false)
      setVisible(false)
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Cài ứng dụng vào điện thoại"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-ink/12 bg-bone p-4 shadow-[0_8px_32px_rgba(20,17,14,0.18)]">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-xl border border-ink/10"
          />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-bold text-ink">Cài app vào điện thoại?</p>
            <p className="mt-1 text-sm leading-relaxed text-ink/70">
              {iosHint
                ? 'Mở thẳng từ màn hình chính, toàn màn hình, không còn thanh địa chỉ.'
                : 'Thêm biểu tượng vào màn hình chính để mở nhanh như một app riêng, gần như không tốn dung lượng.'}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Đóng"
            className="-mr-1 -mt-1 shrink-0 cursor-pointer rounded-lg p-1.5 text-ink/40 transition-colors hover:bg-ink/6 hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {iosHint ? (
          <ol className="mt-3 space-y-1.5 rounded-xl bg-ink/5 p-3 text-sm text-ink/80">
            <li>
              <span className="font-semibold text-ink">1.</span> Bấm nút{' '}
              <span className="font-semibold text-ink">Chia sẻ</span> ở thanh dưới của Safari
            </li>
            <li>
              <span className="font-semibold text-ink">2.</span> Kéo xuống chọn{' '}
              <span className="font-semibold text-ink">Thêm vào MH chính</span>
            </li>
            <li>
              <span className="font-semibold text-ink">3.</span> Bấm{' '}
              <span className="font-semibold text-ink">Thêm</span> ở góc trên bên phải
            </li>
          </ol>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button size="md" className="flex-1" loading={installing} onClick={handleInstall}>
              Cài đặt
            </Button>
            <Button variant="secondary" size="md" onClick={dismiss}>
              Để sau
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
