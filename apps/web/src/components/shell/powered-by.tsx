import { branding } from '@/config/branding';
import { staffCopy } from '@/config/staff-copy';

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
  if (collapsed) {
    return null;
  }
  return <p className="shell-powered-by-text">{staffCopy.poweredByIndigo}</p>;
}
