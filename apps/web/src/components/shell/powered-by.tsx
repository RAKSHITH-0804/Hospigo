import { branding } from '@/config/branding';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

export function PoweredBy({ collapsed = false }: { collapsed?: boolean }) {
  const logo = branding.indigoLogo;
  if (logo) {
    return (
      <div className="shell-powered-by">
        <img
          src={logo.src}
          alt={logo.alt}
          width={logo.width}
          height={logo.height}
          className="shell-powered-by-logo"
        />
      </div>
    );
  }
  // Collapsed: the text stays for screen readers but is fully hidden visually.
  return (
    <p className={cn('shell-powered-by-text', collapsed && 'visually-hidden')}>
      {staffCopy.poweredByIndigo}
    </p>
  );
}
