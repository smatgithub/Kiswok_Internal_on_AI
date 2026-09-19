'use client';

import { useEffect } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import {
  DUPLICATE_OVERRIDE_MIN_REASON,
  DuplicateCheckResult,
} from '@kiswok/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export function DuplicateReviewPanel({
  open,
  loading,
  itemCode,
  itemName,
  result,
  reason,
  onReasonChange,
  requireOverride,
  queuePosition,
  onClose,
  onConfirm,
}: {
  open: boolean;
  loading: boolean;
  itemCode: string;
  itemName: string;
  result: DuplicateCheckResult | null;
  reason: string;
  onReasonChange: (value: string) => void;
  requireOverride: boolean;
  queuePosition?: { index: number; total: number } | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const verdict = result?.verdict || 'none';
  const matches = result?.matches || [];
  const reasonOk = reason.trim().length >= DUPLICATE_OVERRIDE_MIN_REASON;
  const confirmBlocked = requireOverride && verdict === 'duplicate' && !reasonOk;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-[rgba(17,24,39,0.32)] transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={cn(
          'fixed top-0 right-0 z-[70] flex h-full w-full max-w-[520px] flex-col border-l border-[var(--border)] bg-[var(--card)] shadow-xl transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Review duplicate item"
        aria-hidden={!open}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
              Review Duplicate Item
              {queuePosition && queuePosition.total > 1
                ? ` · ${queuePosition.index + 1} of ${queuePosition.total}`
                : ''}
            </p>
            <h2 className="mt-0.5 truncate text-[18px] font-semibold text-[var(--text)]">
              {itemCode || '—'}
            </h2>
            <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--text-secondary)]">
              {itemName}
            </p>
          </div>
          <button
            type="button"
            className="rounded-[8px] p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-[13px] text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Comparing description with live SAP Material Master…
            </div>
          ) : !result ? (
            <p className="py-8 text-[13px] text-[var(--text-secondary)]">
              Duplicate check has not returned yet. Close and try Review Duplicate
              Item again.
            </p>
          ) : !result.catalog.loaded ? (
            <p className="rounded-[10px] border border-[var(--border)] bg-[var(--hover)] px-3 py-3 text-[13px] text-[var(--text-secondary)]">
              Material Master product index is not loaded. Run{' '}
              <span className="font-medium">npm run ingest:sap-master</span> after
              updating the Excel, then restart the API.
            </p>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-[14px] font-medium text-[var(--text)]">
                No similar SAP material found
              </p>
              <p className="max-w-sm text-[13px] text-[var(--text-secondary)]">
                This Icsoft description does not match an existing Product in the
                07.09.2026 Material Master.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge tone={verdict === 'duplicate' ? 'danger' : 'warning'}>
                  {verdict === 'duplicate' ? 'Likely duplicate' : 'Similar items'}
                </Badge>
                <span className="text-[12px] text-[var(--text-muted)]">
                  {matches.length} suggested · {result.catalog.products.toLocaleString()} live products
                </span>
              </div>
              {verdict === 'duplicate' ? (
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Queue / extend is blocked until you confirm this is not the same
                  material, with a short reason.
                </p>
              ) : (
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Related live SAP materials are listed for review. Size/weight
                  differences are treated as similar, not the same item.
                </p>
              )}
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[10px] border border-[var(--border)]">
                {matches.map((m) => (
                  <li key={`${m.product}-${m.score}`} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="numeric text-[13px] font-semibold text-[var(--text)]">
                          {m.product}
                        </p>
                        <p className="mt-0.5 text-[13px] leading-snug text-[var(--text)]">
                          {m.description || '—'}
                        </p>
                      </div>
                      <Badge tone={m.score >= 88 ? 'danger' : 'warning'}>
                        {m.score}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                      {[
                        m.productType,
                        m.productGroup,
                        m.uom,
                        m.hsn ? `HSN ${m.hsn}` : '',
                        m.plants.length ? `Plants ${m.plants.join(', ')}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                      Why: {m.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {requireOverride && verdict === 'duplicate' && !loading ? (
            <label className="mt-4 flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium text-[var(--text)]">
                This is not a duplicate because
                <span className="ml-0.5 text-[var(--danger)]">*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                rows={3}
                placeholder="Different size, different HSN, new vendor spec…"
                className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
              <span className="text-[12px] text-[var(--text-muted)]">
                Minimum {DUPLICATE_OVERRIDE_MIN_REASON} characters. Stored on the
                pipeline entry for audit.
              </span>
            </label>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={loading || confirmBlocked}
            onClick={onConfirm}
          >
            {verdict === 'duplicate' && requireOverride
              ? 'Confirm not a duplicate'
              : 'Done'}
          </Button>
        </div>
      </aside>
    </>
  );
}
