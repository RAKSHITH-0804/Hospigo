'use client';

import { useCallback, useMemo, useState } from 'react';
import { BrandScope } from '@/components/brand-scope';
import { SampleDataBadge } from '@/components/sample-data-badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { Button } from '@/components/ui/button';
import { hospitalForBookingCode, mockDoctors, mockSlots, type MockDoctor } from '@/mock/booking';
import { useMockLoad } from '@/hooks/use-mock-load';
import type { LoadMockOptions } from '@/mock/load-mock';

const emptyDoctors: MockDoctor[] = [];

function isEmptyDoctors(value: MockDoctor[]) {
  return value.length === 0;
}

export function BookingScreen({
  code,
  loadOptions,
}: {
  code: string;
  loadOptions?: LoadMockOptions;
}) {
  const hospital = useMemo(() => hospitalForBookingCode(code), [code]);
  const isEmpty = useCallback(isEmptyDoctors, []);
  const { phase, value, reload } = useMockLoad(mockDoctors, emptyDoctors, isEmpty, loadOptions);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');

  const selectedDoctor = value.find((doctor) => doctor.id === selectedDoctorId) ?? null;
  const selectedSlot = mockSlots.find((slot) => slot.id === selectedSlotId) ?? null;
  const canSendOtp = Boolean(
    selectedDoctorId && selectedSlotId && name.trim().length > 0 && mobile.trim().length > 0,
  );

  return (
    <BrandScope brandColor={hospital.brandColor}>
      <div className="booking-page">
        <header className="booking-header">
          <div className="booking-header-inner">
            <div className="min-w-0 flex-1">
              <p className="type-label font-medium">{hospital.name}</p>
              <h1 className="type-title font-medium">Book an OPD appointment</h1>
            </div>
            <SampleDataBadge />
          </div>
        </header>

        <div className="booking-body">
          {phase === 'loading' ? <LoadingState label="Loading booking options" /> : null}
          {phase === 'error' ? (
            <ErrorState message="Booking options could not be loaded." onRetry={reload} />
          ) : null}
          {phase === 'empty' ? (
            <EmptyState title="No doctors available" description="Demo doctors will appear here." />
          ) : null}

          {phase === 'ready' ? (
            <div className="booking-card">
              <div className="booking-card-grid">
                <div className="booking-col">
                  <section aria-labelledby="choose-doctor">
                    <h2 id="choose-doctor" className="type-label mb-[var(--space-3)] font-medium">
                      1 Choose doctor
                    </h2>
                    <div className="tile-grid">
                      {value.map((doctor) => {
                        const selected = selectedDoctorId === doctor.id;
                        return (
                          <button
                            key={doctor.id}
                            type="button"
                            aria-pressed={selected}
                            className="selection-tile"
                            onClick={() => setSelectedDoctorId(doctor.id)}
                          >
                            <p className="font-medium">{doctor.name}</p>
                            <p className="text-muted-foreground">
                              {doctor.speciality} · {doctor.feeLabel}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section aria-labelledby="choose-slot">
                    <h2 id="choose-slot" className="type-label mb-[var(--space-3)] font-medium">
                      2 Choose slot
                    </h2>
                    <div className="slot-grid">
                      {mockSlots.map((slot) => {
                        const selected = selectedSlotId === slot.id;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            aria-pressed={selected}
                            className="selection-tile text-center"
                            onClick={() => setSelectedSlotId(slot.id)}
                          >
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>

                <div className="booking-col">
                  <section aria-labelledby="your-details">
                    <h2 id="your-details" className="type-label mb-[var(--space-3)] font-medium">
                      3 Your details
                    </h2>
                    <form
                      className="login-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                      }}
                    >
                      <label className="field-label">
                        Name
                        <input
                          name="name"
                          autoComplete="name"
                          className="field-input"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        Mobile
                        <input
                          name="mobile"
                          type="tel"
                          autoComplete="tel"
                          className="field-input"
                          value={mobile}
                          onChange={(event) => setMobile(event.target.value)}
                        />
                      </label>
                      <Button type="submit" className="touch-target" disabled={!canSendOtp}>
                        Send OTP
                      </Button>
                    </form>
                    <p className="booking-pay-note-mobile mt-[var(--space-3)]">
                      No payment now. Pay the fee at the hospital desk when you arrive.
                    </p>
                  </section>

                  <aside className="booking-summary" aria-label="Booking summary">
                    <h2 className="type-label mb-[var(--space-2)] font-medium">Summary</h2>
                    <dl className="stack-tight type-label">
                      <div>
                        <dt className="text-muted-foreground">Doctor</dt>
                        <dd>{selectedDoctor?.name ?? 'Not selected'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Slot</dt>
                        <dd>{selectedSlot?.label ?? 'Not selected'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Fee</dt>
                        <dd>{selectedDoctor?.feeLabel ?? '—'}</dd>
                      </div>
                    </dl>
                    <p className="type-label mt-[var(--space-3)] text-muted-foreground">
                      No payment now. Pay the fee at the hospital desk when you arrive.
                    </p>
                  </aside>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </BrandScope>
  );
}
