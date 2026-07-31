import { Suspense } from 'react';
import SapItemStudio from '@/components/sap/SapItemStudio';

export default function SapItemsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-[var(--text-secondary)]">Loading SAP Item Creation…</div>
      }
    >
      <SapItemStudio />
    </Suspense>
  );
}
