'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

const COMMANDS = [
  { id: 'mdt', label: 'Open Master Data Tracking', href: '/master-data-tracking', keywords: 'find duplicate request progress created sap item' },
  { id: 'ops', label: 'Go to Operations Dashboard', href: '/', keywords: 'home kpi' },
  { id: 'icsoft', label: 'Open IcSoft Items', href: '/icsoft-items', keywords: 'erp rawmaterial category master' },
  { id: 'sap', label: 'Open SAP Item Creation', href: '/sap-items', keywords: 'zraw material master migrate' },
  { id: 'batch', label: 'Focus committed batch grid', href: '/sap-items?tab=batch', keywords: 'export template' },
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(query) ||
        c.keywords.includes(query),
    );
  }, [q]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
        else document.dispatchEvent(new CustomEvent('kiswok:open-command'));
      }
      if (e.key === 'Escape' && open) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(17,24,39,0.4)] px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <Search className="h-4 w-4 text-[var(--text-muted)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search…"
            className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        <ul className="max-h-72 overflow-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-[var(--text-muted)]">
              No matches
            </li>
          ) : (
            results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-[13px] hover:bg-[var(--hover)]"
                  onClick={() => {
                    if (item.href !== pathname) router.push(item.href);
                    onClose();
                  }}
                >
                  <span className="font-medium text-[var(--text)]">{item.label}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{item.href}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
