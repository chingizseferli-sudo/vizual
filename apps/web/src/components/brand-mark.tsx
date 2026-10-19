import { cn } from '@/lib/utils'

type BrandMarkProps = {
  logoUrl?: string
  iconUrl?: string
  siteName: string
  variant?: 'logo' | 'icon'
  className?: string
  imageClassName?: string
}

export function BrandMark({
  logoUrl,
  iconUrl,
  siteName,
  variant = 'logo',
  className,
  imageClassName,
}: BrandMarkProps) {
  const imageUrl = variant === 'icon' ? iconUrl || logoUrl : logoUrl || iconUrl

  if (imageUrl) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <img
          src={imageUrl}
          alt={siteName}
          // Intrinsic size of the default logo/icon reserves space before the
          // image loads; CSS sets the rendered size and the loaded image's own
          // aspect ratio takes over.
          width={variant === 'icon' ? 32 : 980}
          height={variant === 'icon' ? 32 : 300}
          className={cn(
            variant === 'icon'
              ? 'size-8 object-contain'
              : 'h-10 w-auto max-w-[190px] object-contain',
            imageClassName
          )}
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 text-sm font-black text-white',
        className
      )}
      aria-label={siteName}
    >
      V
    </span>
  )
}
