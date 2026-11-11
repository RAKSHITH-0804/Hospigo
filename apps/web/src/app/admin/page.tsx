import { StorageStatusCard } from '@/components/admin/storage-status-card';

export default function AdminPage() {
  return (
    <div className="flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-medium">Hospitals</h1>
      <StorageStatusCard />
    </div>
  );
}
