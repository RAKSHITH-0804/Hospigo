'use client';

import { useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.patients.record;
const TAB_OVERVIEW = 'overview';
const TAB_VISITS = 'visits';
const TAB_BILLS = 'bills';

/**
 * The only interactive part of the record page (tab switch). The overview itself is
 * rendered on the server and passed in as a prop, so it adds nothing to the client bundle.
 */
export function RecordTabs({ overview }: { overview: ReactNode }) {
  const [tab, setTab] = useState(TAB_OVERVIEW);
  return (
    <>
      <Tabs
        items={[
          { value: TAB_OVERVIEW, label: copy.tabOverview },
          { value: TAB_VISITS, label: copy.tabVisits },
          { value: TAB_BILLS, label: copy.tabBills },
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel when={TAB_OVERVIEW} value={tab}>
        {overview}
      </TabPanel>
      <TabPanel when={TAB_VISITS} value={tab}>
        <EmptyState title={copy.visitsEmptyTitle} description={copy.visitsEmptyDescription} />
      </TabPanel>
      <TabPanel when={TAB_BILLS} value={tab}>
        <EmptyState title={copy.billsEmptyTitle} description={copy.billsEmptyDescription} />
      </TabPanel>
    </>
  );
}
