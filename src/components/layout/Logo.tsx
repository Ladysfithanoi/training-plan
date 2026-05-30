import Image from 'next/image'

/**
 * App brand mark. Sourced from `public/TrungPN.png`.
 * Change the logo in one place: replace that file (keep the name) or update `src` here.
 */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <Image
      src="/TrungPN.png"
      alt="Kế hoạch Tập luyện"
      width={200}
      height={200}
      priority
      className={`${className} rounded-lg object-contain shrink-0`}
    />
  )
}
