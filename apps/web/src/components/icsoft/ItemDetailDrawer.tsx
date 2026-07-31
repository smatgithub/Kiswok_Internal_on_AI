'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Loader2, MapPin, Store, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  api,
  IcsoftItemShop,
  IcsoftItemStoreLocation,
  optimizeItemDetail,
} from '@/lib/api';

export type PropertyGroup = {
  id: string;
  title: string;
  fields: string[];
};

/** Logical character/field groups for RawMaterial master detail (excludes nested loc/shop) */
export const ITEM_PROPERTY_GROUPS: PropertyGroup[] = [
  {
    id: 'identity',
    title: 'Identity',
    fields: ['Sl No', 'RawMatCode', 'RawMatName', 'Description', 'Prefix'],
  },
  {
    id: 'classification',
    title: 'Classification',
    fields: ['Main Category', 'Item Category', 'Inspection Reqired'],
  },
  {
    id: 'units',
    title: 'Units & Weight',
    fields: ['UOM', 'PurchaseUom', 'Weight', 'WeightUom'],
  },
  {
    id: 'manufacturing',
    title: 'Manufacturing & Planning',
    fields: [
      'Manufactured',
      'LeadTime',
      'Tolerance',
      'Saleable',
      'Max_level',
      'Min_level',
    ],
  },
  {
    id: 'quality',
    title: 'Quality & Documents',
    fields: [
      'InspecReq',
      'InspCriteria',
      'SpecificationNo',
      'DrawingNo',
      'Attachment',
    ],
  },
  {
    id: 'tax',
    title: 'Tax & Accounts',
    fields: ['HSNCode', 'Name'],
  },
  {
    id: 'audit',
    title: 'Audit',
    fields: ['EntryComputer', 'EntryBy', 'RawMatID'],
  },
];

const NESTED_KEYS = new Set([
  'shops',
  'locations',
  'ShopName',
  'LocationMaxLevel',
  'LocationMinLevel',
  'LocationLeadTime',
  'LocationBatchSize',
  'LocationCount',
  'ShopCount',
]);

function formatValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ItemDetailDrawer({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const rawMatId = row?.RawMatID != null ? Number(row.RawMatID) : null;

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);
  const [selectedLocationKey, setSelectedLocationKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !rawMatId || Number.isNaN(rawMatId)) {
      setDetailRow(null);
      setSelectedLocationKey(null);
      setDetailError('');
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    setDetailRow(null);
    setSelectedLocationKey(null);

    api
      .icsoftItemDetail(rawMatId)
      .then((res) => {
        if (cancelled) return;
        const optimized = optimizeItemDetail(res.data);
        setDetailRow(optimized);
        const locations = (res.data.locations || []) as IcsoftItemStoreLocation[];
        if (locations.length) {
          setSelectedLocationKey(locations[0].key);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setDetailError((e as Error).message);
        // Fallback to grid row so popup still works
        setDetailRow(row);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, rawMatId, row]);

  const display = detailRow || row;

  const shops = useMemo(
    () => (Array.isArray(display?.shops) ? (display!.shops as IcsoftItemShop[]) : []),
    [display],
  );

  const locations = useMemo(
    () =>
      Array.isArray(display?.locations)
        ? (display!.locations as IcsoftItemStoreLocation[])
        : [],
    [display],
  );

  const selectedLocation = useMemo(
    () => locations.find((l) => l.key === selectedLocationKey) || null,
    [locations, selectedLocationKey],
  );

  const known = new Set(ITEM_PROPERTY_GROUPS.flatMap((g) => g.fields));
  const extraKeys = display
    ? Object.keys(display).filter(
        (k) => !known.has(k) && k !== 'RawMatID' && !NESTED_KEYS.has(k),
      )
    : [];

  async function extendForSap() {
    if (!rawMatId || Number.isNaN(rawMatId)) return;
    const hints = selectedLocation
      ? [
          {
            rawMatId,
            plant: selectedLocation.sapPlantCode || undefined,
            storageLocation: selectedLocation.storageLocation || undefined,
            locationId: selectedLocation.locationId,
          },
        ]
      : undefined;
    try {
      await api.enqueuePipeline([rawMatId], hints);
    } catch {
      /* navigate anyway — wizard will load item */
    }
    const params = new URLSearchParams({
      extendRawMatId: String(rawMatId),
      phase: 'wizard',
    });
    if (selectedLocation?.sapPlantCode) {
      params.set('plant', selectedLocation.sapPlantCode);
    }
    if (selectedLocation?.storageLocation) {
      params.set('sloc', selectedLocation.storageLocation);
    }
    if (selectedLocation?.locationId != null) {
      params.set('locationId', String(selectedLocation.locationId));
    }
    onClose();
    router.push(`/sap-items?${params.toString()}`);
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-[rgba(17,24,39,0.28)] transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={cn(
          'fixed top-0 right-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border)] bg-[var(--card)] shadow-xl transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Item properties"
        aria-hidden={!open}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
              Item properties
            </p>
            <h2 className="mt-0.5 truncate text-[18px] font-semibold text-[var(--text)]">
              {display ? formatValue(display.RawMatCode) : '—'}
            </h2>
            <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--text-secondary)]">
              {display ? formatValue(display.RawMatName) : ''}
            </p>
            {locations.length > 0 ? (
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {locations.length} store location(s) · select one before Extend for SAP
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              disabled={!rawMatId || loadingDetail || (locations.length > 0 && !selectedLocation)}
              onClick={extendForSap}
              title={
                selectedLocation
                  ? `Extend with plant ${selectedLocation.sapPlantCode || '—'} / SLoc ${selectedLocation.storageLocation || '—'}`
                  : 'Open SAP Item Creation wizard for this material'
              }
            >
              <ArrowUpRight className="h-4 w-4" />
              Extend for SAP
            </Button>
            <Button variant="icon" size="icon" onClick={onClose} aria-label="Close panel">
              <X className="h-[18px] w-[18px]" />
            </Button>
          </div>
        </div>

        <div className="scroll-panel flex-1 space-y-4 p-4">
          {!display ? (
            <p className="text-[13px] text-[var(--text-muted)]">Select a grid row to view details.</p>
          ) : loadingDetail ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading full shop & location details…
            </div>
          ) : (
            <>
              {detailError ? (
                <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-bg)] px-3 py-2 text-[12px] text-[var(--warning)]">
                  Full detail load failed ({detailError}). Showing grid summary.
                </div>
              ) : null}

              {locations.length > 0 ? (
                <section className="rounded-[12px] border border-[var(--border)]">
                  <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2">
                    <h3 className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.04em] text-[var(--text-secondary)] uppercase">
                      <MapPin className="h-3.5 w-3.5" />
                      Store locations
                    </h3>
                    <Badge tone="info">{locations.length}</Badge>
                  </header>
                  <ul className="divide-y divide-[var(--border)]">
                    {locations.map((loc) => {
                      const selected = loc.key === selectedLocationKey;
                      return (
                        <li key={loc.key}>
                          <button
                            type="button"
                            onClick={() => setSelectedLocationKey(loc.key)}
                            className={cn(
                              'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors',
                              selected
                                ? 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]'
                                : 'hover:bg-[var(--hover)]',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-semibold text-[var(--text)]">
                                {loc.locationName || `Location ${loc.locationId}`}
                              </span>
                              <input
                                type="radio"
                                name="store-location"
                                checked={selected}
                                onChange={() => setSelectedLocationKey(loc.key)}
                                aria-label={`Select ${loc.locationName || loc.locationId}`}
                              />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge tone={selected ? 'info' : 'neutral'}>
                                Plant {loc.sapPlantCode || '—'}
                              </Badge>
                              <Badge tone={selected ? 'success' : 'neutral'}>
                                SLoc {loc.storageLocation || '—'}
                              </Badge>
                              <Badge>ID {loc.locationId}</Badge>
                            </div>
                            <p className="numeric text-[12px] text-[var(--text-muted)]">
                              Max {formatValue(loc.locationMaxLevel)} · Min{' '}
                              {formatValue(loc.locationMinLevel)} · Lead{' '}
                              {formatValue(loc.locationLeadTime)} · Batch{' '}
                              {formatValue(loc.locationBatchSize)}
                              {loc.locationReorderLevel != null
                                ? ` · ROL ${loc.locationReorderLevel}`
                                : ''}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {shops.length > 0 ? (
                <section className="rounded-[12px] border border-[var(--border)]">
                  <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2">
                    <h3 className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.04em] text-[var(--text-secondary)] uppercase">
                      <Store className="h-3.5 w-3.5" />
                      Shops
                    </h3>
                    <Badge tone="info">{shops.length}</Badge>
                  </header>
                  <ul className="divide-y divide-[var(--border)]">
                    {shops.map((shop, idx) => (
                      <li
                        key={`${shop.shopId ?? 'x'}-${idx}`}
                        className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-[13px]"
                      >
                        <div>
                          <p className="font-medium text-[var(--text)]">
                            {shop.shopName || `Shop ${shop.shopId ?? '—'}`}
                          </p>
                          {shop.itemSubCategory ? (
                            <p className="text-[12px] text-[var(--text-muted)]">
                              {shop.itemSubCategory}
                            </p>
                          ) : null}
                        </div>
                        {shop.shopId != null ? (
                          <Badge>#{shop.shopId}</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {ITEM_PROPERTY_GROUPS.map((group) => {
                const entries = group.fields
                  .filter(
                    (f) =>
                      (display && f in display) ||
                      ['RawMatName', 'Description', 'RawMatCode'].includes(f),
                  )
                  .map((field) => ({
                    field,
                    value: formatValue(display?.[field]),
                  }));
                if (!entries.length) return null;
                return (
                  <section key={group.id} className="rounded-[12px] border border-[var(--border)]">
                    <header className="border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2">
                      <h3 className="text-[12px] font-semibold tracking-[0.04em] text-[var(--text-secondary)] uppercase">
                        {group.title}
                      </h3>
                    </header>
                    <dl className="divide-y divide-[var(--border)]">
                      {entries.map(({ field, value }) => (
                        <div
                          key={field}
                          className="grid grid-cols-[132px_1fr] gap-3 px-3 py-2.5 text-[13px]"
                        >
                          <dt className="font-medium text-[var(--text-muted)]">{field}</dt>
                          <dd
                            className={cn(
                              'break-words text-[var(--text)]',
                              ['RawMatCode', 'UOM', 'HSNCode', 'Prefix', 'Weight', 'LeadTime'].includes(
                                field,
                              ) && 'numeric',
                            )}
                          >
                            {field === 'Inspection Reqired' ? (
                              <Badge tone={value.includes('Not') ? 'neutral' : 'warning'}>
                                {value}
                              </Badge>
                            ) : field === 'Description' ? (
                              <span className="leading-relaxed break-words whitespace-pre-wrap">
                                {value}
                              </span>
                            ) : (
                              value
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}

              {extraKeys.length > 0 ? (
                <section className="rounded-[12px] border border-[var(--border)]">
                  <header className="border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2">
                    <h3 className="text-[12px] font-semibold tracking-[0.04em] text-[var(--text-secondary)] uppercase">
                      Other fields
                    </h3>
                  </header>
                  <dl className="divide-y divide-[var(--border)]">
                    {extraKeys.map((field) => (
                      <div
                        key={field}
                        className="grid grid-cols-[132px_1fr] gap-3 px-3 py-2.5 text-[13px]"
                      >
                        <dt className="font-medium text-[var(--text-muted)]">{field}</dt>
                        <dd className="break-words text-[var(--text)]">
                          {formatValue(display?.[field])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
