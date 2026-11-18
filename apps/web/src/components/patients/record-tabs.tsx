'use client';

import { useState, type ReactNode } from 'react';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.patients.record;
export const RECORD_TAB_OVERVIEW = 'overview';
export const RECORD_TAB_VISITS = 'visits';
export const RECORD_TAB_BILLS = 'bills';

const TAB_VALUES: readonly string[] = [RECORD_TAB_OVERVIEW, RECORD_TAB_VISITS, RECORD_TAB_BILLS];

export function isRecordTab(value: string | null | undefined): value is string {
  return typeof value === 'string' && TAB_VALUES.includes(value);
}

/**
 * The only interactive part of the record page (tab switch). The three panels are rendered on
 * the server and passed in as props, so they add nothing to the client bundle.
 */
export function RecordTabs({
  overview,
  visits,
  bills,
  initialTab = RECORD_TAB_OVERVIEW,
}: {
  overview: ReactNode;
  visits: ReactNode;
  bills: ReactNode;
  /** Which tab opens first (the visits pager links reopen the visits tab). */
  initialTab?: string;
}) {
  const [tab, setTab] = useState(isRecordTab(initialTab) ? initialTab : RECORD_TAB_OVERVIEW);
  return (
    <>
      <Tabs
        items={[
          { value: RECORD_TAB_OVERVIEW, label: copy.tabOverview },
          { value: RECORD_TAB_VISITS, label: copy.tabVisits },
          { value: RECORD_TAB_BILLS, label: copy.tabBills },
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel when={RECORD_TAB_OVERVIEW} value={tab}>
        {overview}
      </TabPanel>
      <TabPanel when={RECORD_TAB_VISITS} value={tab}>
        {visits}
      </TabPanel>
      <TabPanel when={RECORD_TAB_BILLS} value={tab}>
        {bills}
      </TabPanel>
    </>
  );
}
