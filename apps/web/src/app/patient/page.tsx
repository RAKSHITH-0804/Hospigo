import { EmptyState } from '@/components/states/empty-state';
import { sessionConfig } from '@/config/session';
import { requirePatient } from '@/lib/auth/guards';
import { PatientSignOutButton } from './patient-sign-out-button';

export default async function PatientHomePage() {
  const session = await requirePatient();
  const profiles = Array.isArray(session.linkedProfiles) ? session.linkedProfiles : [];

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[var(--size-form-card-max)] flex-col gap-[var(--space-section)] px-[var(--space-page-x)] py-[var(--space-page-y)]">
      <header className="stack-tight w-full">
        <p className="type-label font-medium tracking-wide">Hospigo</p>
        <h1 className="type-title w-full font-medium text-balance">
          {sessionConfig.patientWelcomeText}
        </h1>
        <p className="type-label text-muted-foreground">{session.phone}</p>
        <div>
          <PatientSignOutButton />
        </div>
      </header>

      <section aria-labelledby="linked-profiles">
        <h2 id="linked-profiles" className="type-heading mb-[var(--space-3)] font-medium">
          {sessionConfig.patientLinkedProfilesHeading}
        </h2>
        {profiles.length === 0 ? (
          <EmptyState
            title={sessionConfig.patientEmptyProfilesTitle}
            description={sessionConfig.patientEmptyProfilesDescription}
          />
        ) : (
          <ul className="stack-tight">
            {profiles.map((profile, index) => {
              const label =
                typeof profile === 'object' &&
                profile !== null &&
                typeof (profile as { name?: unknown }).name === 'string'
                  ? (profile as { name: string }).name
                  : sessionConfig.patientProfileFallbackLabel.replace('{n}', String(index + 1));
              return (
                <li key={index} className="type-label">
                  {label}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
