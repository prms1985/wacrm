import Image from 'next/image';
import { cn } from '@/lib/utils';

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/aiba-logo.png"
      alt="AiBA"
      width={2172}
      height={724}
      sizes="192px"
      loading="eager"
      className={cn('h-auto w-36 shrink-0 object-contain', className)}
    />
  );
}
