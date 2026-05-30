/**
 * Layout for public guest program pages (/p/[token]).
 * Intentionally minimal — no sidebar, no auth checks.
 * The root layout already applies the font and lang="vi".
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <div className="max-w-xl mx-auto px-4 py-8">
        {children}
      </div>
    </div>
  )
}
