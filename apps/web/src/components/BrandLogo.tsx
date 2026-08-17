interface BrandLogoProps {
  variant?: 'mark' | 'horizontal'
  className?: string
  decorative?: boolean
}

export default function BrandLogo({
  variant = 'horizontal',
  className = '',
  decorative = false,
}: BrandLogoProps) {
  const src = variant === 'mark' ? '/brand/logo-mark.svg' : '/brand/logo-horizontal.svg'

  return (
    <img
      src={src}
      className={className}
      alt={decorative ? '' : 'SadarBencana'}
      aria-hidden={decorative || undefined}
    />
  )
}
