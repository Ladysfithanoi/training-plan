/*
 * Service worker tối giản — CHỦ ĐÍCH không cache nội dung app.
 *
 * Vì sao vẫn cần: Chrome/Edge chỉ bắn `beforeinstallprompt` (sự kiện để hỏi
 * "cài app vào điện thoại?") khi trang có service worker đăng ký kèm trình xử
 * lý `fetch`. Không có tệp này thì banner cài đặt sẽ không bao giờ hiện trên
 * Android.
 *
 * Vì sao KHÔNG cache: giáo án, tiến độ, thông báo đều là dữ liệu sống, cache
 * lại sẽ cho học viên xem số liệu cũ mà không hay biết. Nên mọi request đều đi
 * thẳng ra mạng; chỉ khi mất mạng và người dùng đang mở một trang mới thì trả
 * về trang báo mất kết nối.
 */

const OFFLINE_URL = '/offline.html'
const CACHE = 'tap-luyen-offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))),
  )
  // Bản mới thay bản cũ ngay, không đợi đóng hết tab.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  // Chỉ can thiệp khi người dùng mở/chuyển trang. Mọi thứ khác (API, ảnh, JS)
  // để trình duyệt tự lo — không đụng vào là không thể trả nhầm bản cũ.
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
  )
})
