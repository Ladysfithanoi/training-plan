import type { MetadataRoute } from 'next'

/**
 * Web App Manifest — phục vụ tại /manifest.webmanifest.
 *
 * Có tệp này (kèm HTTPS) thì trình duyệt mới coi web là "cài được": Chrome/Edge
 * trên Android bắn sự kiện `beforeinstallprompt` để <InstallPrompt /> hỏi người
 * dùng, còn Safari iOS cho "Thêm vào Màn hình chính" từ nút Chia sẻ.
 *
 * `display: 'standalone'` → mở từ màn hình chính là một app riêng, không còn
 * thanh địa chỉ trình duyệt.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Tên hiện dưới icon sau khi cài: để trùng nhau + trùng apple-mobile-web-app-title
    // trong src/app/layout.tsx, để Android và iOS cùng hiện một tên.
    name: 'Training Plan',
    short_name: 'Training Plan',
    description: 'Hệ thống phân kỳ tập luyện và theo dõi tiến độ chuyên nghiệp.',
    // Mở thẳng vào trang chính; chưa đăng nhập thì proxy tự đưa về /login.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Đồng bộ với --color-paper / --color-ink trong globals.css.
    background_color: '#F6F2EA',
    theme_color: '#F6F2EA',
    lang: 'vi',
    categories: ['fitness', 'health', 'sports'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android khoét icon theo hình của máy (tròn/vuông bo) → bản maskable đã
      // chừa sẵn vùng an toàn để không cắt mất dấu ấn thương hiệu.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
