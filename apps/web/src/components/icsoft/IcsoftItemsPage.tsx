'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckSquare,
  Filter,
  ListTree,
  Loader2,
  PackagePlus,
  Play,
  Search,
  Square,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { EmptyState, SkeletonRows } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { cn } from '@/lib/cn';
import { api, IcsoftCategory, IcsoftItemOption } from '@/lib/api';
import { ItemDetailDrawer } from '@/components/icsoft/ItemDetailDrawer';
import { DuplicateReviewPanel } from '@/components/sap/DuplicateReviewPanel';
import {
  DUPLICATE_OVERRIDE_MIN_REASON,
  DuplicateCheckResult,
} from '@kiswok/shared';

const ALL = 'ALL';

function toggleValue(list: string[], value: string, allToken = ALL): string[] {
  if (value === allToken) return [allToken];
  const withoutAll = list.filter((v) => v !== allToken);
  if (withoutAll.includes(value)) {
    const next = withoutAll.filter((v) => v !== value);
    return next.length ? next : [allToken];
  }
  return [...withoutAll, value];
}

export default function IcsoftItemsPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<IcsoftCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([ALL]);
  const [itemOptions, setItemOptions] = useState<IcsoftItemOption[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemMeta, setSelectedItemMeta] = useState<
    Record<number, IcsoftItemOption>
  >({});
  const [allItems, setAllItems] = useState(true);
  const [itemSearch, setItemSearch] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [error, setError] = useState('');
  const [hasRun, setHasRun] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [toast, setToast] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<IcsoftItemOption[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewResults, setReviewResults] = useState<
    Record<number, DuplicateCheckResult>
  >({});
  const [reviewReason, setReviewReason] = useState('');
  const [pendingAction, setPendingAction] = useState<null | 'queue' | 'grid'>(
    null,
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function finishEnqueue(
    ids: number[],
    action: 'queue' | 'grid',
    nextOverrides: Record<number, string> = overrides,
  ) {
    const overridePayload = ids
      .filter((id) => (nextOverrides[id] || '').trim().length >= DUPLICATE_OVERRIDE_MIN_REASON)
      .map((id) => ({ rawMatId: id, reason: nextOverrides[id].trim() }));
    const queued = await api.enqueuePipeline(ids, undefined, overridePayload);
    if (action === 'queue') {
      setToast(`${queued.data.length} item(s) queued for SAP · open SAP Item Creation`);
      return;
    }
    setLoadingGrid(true);
    try {
      setToast(
        `Batch of ${queued.data.length} item(s) ready · Extended vs Not yet shown in grid`,
      );
      const res = await api.icsoftGrid({
        selectedGrnTypes: selectedCategories,
        selectedRawMatIds: ids,
        allItems: false,
      });
      setRows(res.data);
      setHasRun(true);
      setDrawerOpen(false);
      setSelectedRowKey(null);
    } finally {
      setLoadingGrid(false);
    }
  }

  async function ensureDuplicatesThenEnqueue(action: 'queue' | 'grid') {
    if (allItems || selectedItemIds.length === 0) return;
    setQueueing(true);
    setError('');
    try {
      const res = await api.reviewDuplicates({ rawMatIds: selectedItemIds });
      const byId: Record<number, DuplicateCheckResult> = {};
      for (const row of res.data) {
        if (row.query.rawMatId != null) byId[row.query.rawMatId] = row;
      }
      setReviewResults((prev) => ({ ...prev, ...byId }));
      const blocked = selectedItemIds
        .filter((id) => {
          if (byId[id]?.verdict !== 'duplicate') return false;
          return (overrides[id] || '').trim().length < DUPLICATE_OVERRIDE_MIN_REASON;
        })
        .map(
          (id) =>
            selectedItemMeta[id] ||
            itemOptions.find((i) => i.rawMatId === id) ||
            null,
        )
        .filter((item): item is IcsoftItemOption => Boolean(item));
      if (blocked.length) {
        setPendingAction(action);
        setReviewQueue(blocked);
        setReviewIndex(0);
        setReviewReason(overrides[blocked[0].rawMatId] || '');
        setReviewOpen(true);
        return;
      }
      await finishEnqueue(selectedItemIds, action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQueueing(false);
    }
  }

  async function queueSelectedForSap() {
    await ensureDuplicatesThenEnqueue('queue');
  }

  async function openRowReview(item: IcsoftItemOption) {
    setPendingAction(null);
    setReviewQueue([item]);
    setReviewIndex(0);
    setReviewReason(overrides[item.rawMatId] || '');
    setReviewOpen(true);
    if (reviewResults[item.rawMatId]) return;
    setReviewLoading(true);
    setError('');
    try {
      const res = await api.reviewDuplicates({ rawMatId: item.rawMatId });
      const row = res.data[0];
      if (row) {
        setReviewResults((prev) => ({ ...prev, [item.rawMatId]: row }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewLoading(false);
    }
  }

  function closeReview() {
    setReviewOpen(false);
    setPendingAction(null);
    setReviewQueue([]);
    setReviewIndex(0);
    setReviewReason('');
  }

  async function confirmReview() {
    const current = reviewQueue[reviewIndex];
    if (!current) {
      closeReview();
      return;
    }
    const result = reviewResults[current.rawMatId];
    let nextOverrides = overrides;
    if (result?.verdict === 'duplicate') {
      if (reviewReason.trim().length < DUPLICATE_OVERRIDE_MIN_REASON) return;
      nextOverrides = { ...overrides, [current.rawMatId]: reviewReason.trim() };
      setOverrides(nextOverrides);
    }
    const nextIndex = reviewIndex + 1;
    if (pendingAction && nextIndex < reviewQueue.length) {
      const nextItem = reviewQueue[nextIndex];
      setReviewIndex(nextIndex);
      setReviewReason(nextOverrides[nextItem.rawMatId] || '');
      return;
    }
    const action = pendingAction;
    const ids = selectedItemIds;
    closeReview();
    if (action) {
      setQueueing(true);
      setError('');
      try {
        await finishEnqueue(ids, action, nextOverrides);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setQueueing(false);
      }
    }
  }

  const categoriesKeyRef = useRef('');

  useEffect(() => {
    setLoadingCats(true);
    api
      .icsoftCategories()
      .then((r) => setCategories(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingCats(false));
  }, []);

  // Reset item selection only when category scope changes — not on search.
  useEffect(() => {
    const key = [...selectedCategories].sort().join('|');
    if (categoriesKeyRef.current === key) return;
    categoriesKeyRef.current = key;
    setAllItems(true);
    setSelectedItemIds([]);
    setSelectedItemMeta({});
  }, [selectedCategories]);

  const loadItemOptions = useCallback(async () => {
    setLoadingItems(true);
    setError('');
    try {
      const res = await api.icsoftItemOptions(selectedCategories, itemSearch);
      setItemOptions(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingItems(false);
    }
  }, [selectedCategories, itemSearch]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadItemOptions();
    }, 200);
    return () => clearTimeout(t);
  }, [loadItemOptions]);

  const columns = useMemo(() => {
    if (!rows.length) return [] as string[];
    const preferred = [
      'Sl No',
      'RawMatCode',
      'RawMatName',
      'Mat Type',
      'SAP Extended',
      'SAP Pipeline',
      'SAP Item Code',
    ];
    const keys = Object.keys(rows[0]).filter((k) => k !== 'RawMatID');
    const rest = keys.filter((k) => !preferred.includes(k));
    return [...preferred.filter((k) => keys.includes(k)), ...rest];
  }, [rows]);

  const sapCounts = useMemo(() => {
    let extended = 0;
    let notYet = 0;
    for (const row of rows) {
      if (String(row['SAP Extended'] || '') === 'Extended') extended += 1;
      else notYet += 1;
    }
    return { extended, notYet };
  }, [rows]);

  const selectedRow = useMemo(() => {
    if (!selectedRowKey) return null;
    return (
      rows.find((r, idx) => String(r.RawMatID ?? idx) === selectedRowKey) || null
    );
  }, [rows, selectedRowKey]);

  /** Selected items hidden by the current search filter — keep them visible & checked. */
  const hiddenSelectedItems = useMemo(() => {
    if (allItems) return [] as IcsoftItemOption[];
    const visible = new Set(itemOptions.map((i) => i.rawMatId));
    return selectedItemIds
      .filter((id) => !visible.has(id))
      .map((id) => selectedItemMeta[id])
      .filter((item): item is IcsoftItemOption => Boolean(item));
  }, [allItems, itemOptions, selectedItemIds, selectedItemMeta]);

  const visibleIdsSelected =
    itemOptions.length > 0 &&
    !allItems &&
    itemOptions.every((i) => selectedItemIds.includes(i.rawMatId));

  function clearItemSelection() {
    setAllItems(true);
    setSelectedItemIds([]);
    setSelectedItemMeta({});
  }

  function toggleItemSelection(item: IcsoftItemOption) {
    setAllItems(false);
    setSelectedItemIds((prev) => {
      const isOn = prev.includes(item.rawMatId);
      const next = isOn ? prev.filter((x) => x !== item.rawMatId) : [...prev, item.rawMatId];
      setSelectedItemMeta((meta) => {
        if (isOn) {
          const { [item.rawMatId]: _removed, ...rest } = meta;
          return rest;
        }
        return { ...meta, [item.rawMatId]: item };
      });
      if (!next.length) {
        setAllItems(true);
        return [];
      }
      return next;
    });
  }

  function selectVisibleItems() {
    if (visibleIdsSelected) {
      // Deselect only currently visible rows; keep selections outside this filter.
      const visibleSet = new Set(itemOptions.map((i) => i.rawMatId));
      setSelectedItemIds((prev) => {
        const next = prev.filter((id) => !visibleSet.has(id));
        if (!next.length) {
          setAllItems(true);
          setSelectedItemMeta({});
          return [];
        }
        return next;
      });
      setSelectedItemMeta((meta) => {
        const next = { ...meta };
        for (const id of visibleSet) delete next[id];
        return next;
      });
      return;
    }

    setAllItems(false);
    setSelectedItemIds((prev) =>
      Array.from(new Set([...prev, ...itemOptions.map((i) => i.rawMatId)])),
    );
    setSelectedItemMeta((meta) => {
      const next = { ...meta };
      for (const item of itemOptions) next[item.rawMatId] = item;
      return next;
    });
  }

  function openRow(row: Record<string, unknown>, idx: number) {
    const key = String(row.RawMatID ?? idx);
    setSelectedRowKey(key);
    setDrawerOpen(true);
  }

  function colClass(col: string, kind: 'th' | 'td') {
    if (col === 'Sl No' || col === 'RawMatCode') return 'sticky-col';
    if (col === 'RawMatName') {
      return kind === 'th'
        ? 'min-w-[280px] w-[280px]'
        : 'min-w-[280px] w-[280px] max-w-[360px] whitespace-normal';
    }
    if (col === 'Description') {
      return kind === 'th'
        ? 'min-w-[420px] w-[420px]'
        : 'min-w-[420px] w-[420px] max-w-[520px] whitespace-normal';
    }
    return '';
  }

  async function runGrid() {
    if (!allItems && selectedItemIds.length > 0) {
      await ensureDuplicatesThenEnqueue('grid');
      return;
    }
    setLoadingGrid(true);
    setError('');
    try {
      const res = await api.icsoftGrid({
        selectedGrnTypes: selectedCategories,
        selectedRawMatIds: [],
        allItems: true,
      });
      setRows(res.data);
      setHasRun(true);
      setDrawerOpen(false);
      setSelectedRowKey(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingGrid(false);
    }
  }

  const categoryAll = selectedCategories.includes(ALL);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-[var(--text)]">
            IcSoft Items
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-secondary)]">
            Browse active ERP materials by Item Category and Item. Multi-select filters
            mirror the legacy master browser — then load the detail grid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={allItems || selectedItemIds.length === 0}
            loading={queueing}
            onClick={() => void queueSelectedForSap()}
            title="Add selected items to SAP Item Creation pending bucket"
          >
            <PackagePlus className="h-4 w-4" />
            Queue for SAP ({allItems ? 0 : selectedItemIds.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/sap-items')}
          >
            SAP Item Creation
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={loadingGrid || queueing}
            onClick={() => void runGrid()}
          >
            <Play className="h-4 w-4" />
            Go
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard
          label="Categories"
          value={String(categories.length)}
          delta="Active invent_grntype"
          tone="info"
        />
        <KpiCard
          label="Item options"
          value={String(itemOptions.length)}
          delta={loadingItems ? 'Loading…' : 'For selected category'}
          tone="neutral"
        />
        <KpiCard
          label="Selected items"
          value={allItems ? 'All' : String(selectedItemIds.length)}
          delta="Filter scope"
          tone="warning"
        />
        <KpiCard
          label="Extended"
          value={hasRun ? String(sapCounts.extended) : '—'}
          delta={hasRun ? 'Already in SAP master' : 'Run Go'}
          tone="success"
        />
        <KpiCard
          label="Not yet"
          value={hasRun ? String(sapCounts.notYet) : '—'}
          delta={hasRun ? 'Pending SAP extension' : 'Run Go'}
          tone={hasRun && sapCounts.notYet > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      {toast ? (
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-bg)] px-3 py-2 text-[13px] text-[var(--success)]">
          {toast}
        </div>
      ) : null}

      {/* Dual filter bar — modern take on legacy Item Category + Item */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between bg-[var(--selected)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <ListTree className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-[14px] font-semibold text-[var(--text)]">
                Item Category
              </h2>
            </div>
            <Badge tone="info">{categoryAll ? 'All' : `${selectedCategories.length} selected`}</Badge>
          </div>
          <CardBody className="p-0">
            <div className="scroll-panel max-h-[280px]">
              {loadingCats ? (
                <SkeletonRows rows={6} cols={1} />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  <li>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[var(--hover)]">
                      <input
                        type="checkbox"
                        checked={categoryAll}
                        onChange={() => setSelectedCategories([ALL])}
                      />
                      <span className="font-semibold text-[var(--text)]">All</span>
                    </label>
                  </li>
                  {categories.map((cat) => {
                    const checked =
                      !categoryAll && selectedCategories.includes(cat.grnType);
                    return (
                      <li key={`${cat.grnTypeId}-${cat.grnType}`}>
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[var(--hover)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedCategories((prev) =>
                                toggleValue(prev, cat.grnType),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                            {cat.grnType}
                          </span>
                          <span className="numeric text-[11px] text-[var(--text-muted)]">
                            {cat.subGrnTypeIds.length || '—'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardBody>
          <CardFooter>
            <span className="text-[12px] text-[var(--text-muted)]">
              Source: invent_grntype · active = Y
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedCategories([ALL])}
            >
              Reset
            </Button>
          </CardFooter>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between bg-[var(--selected)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-[14px] font-semibold text-[var(--text)]">Item</h2>
            </div>
            <Badge tone="info">
              {allItems ? 'All' : `${selectedItemIds.length} selected`}
            </Badge>
          </div>
          <div className="border-b border-[var(--border)] px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search code / name…"
                className="h-9 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] pr-3 pl-9 text-[13px] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>
          </div>
          <CardBody className="p-0">
            <div className="scroll-panel max-h-[280px]">
              {loadingItems ? (
                <div className="flex items-center gap-2 px-3 py-6 text-[13px] text-[var(--text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading items for selected categories…
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  <li>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[var(--hover)]">
                      <input
                        type="checkbox"
                        checked={allItems}
                        onChange={clearItemSelection}
                      />
                      <span className="font-semibold">All</span>
                    </label>
                  </li>
                  {hiddenSelectedItems.map((item) => (
                    <li
                      key={`selected-${item.rawMatId}`}
                      className="flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3 py-1.5 hover:bg-[var(--hover)]"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px]">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggleItemSelection(item)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="numeric font-medium">{item.rawMatCode}</span>
                          <span className="text-[var(--text-muted)]"> | </span>
                          <span>{item.rawMatName}</span>
                        </span>
                      </label>
                      <Badge tone="success">Selected</Badge>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                        onClick={() => void openRowReview(item)}
                      >
                        Review Duplicate Item
                      </button>
                    </li>
                  ))}
                  {itemOptions.length === 0 && hiddenSelectedItems.length === 0 ? (
                    <li className="px-3 py-6 text-[13px] text-[var(--text-muted)]">
                      No items for this category filter
                    </li>
                  ) : (
                    itemOptions.map((item) => {
                      const checked =
                        !allItems && selectedItemIds.includes(item.rawMatId);
                      return (
                        <li
                          key={item.rawMatId}
                          className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[var(--hover)]"
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleItemSelection(item)}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="numeric font-medium">{item.rawMatCode}</span>
                              <span className="text-[var(--text-muted)]"> | </span>
                              <span>{item.rawMatName}</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                            onClick={() => void openRowReview(item)}
                          >
                            Review Duplicate Item
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          </CardBody>
          <CardFooter>
            <span className="text-[12px] text-[var(--text-muted)]">
              GrnTypeId IN SubgrntypeIds · Active = Y
              {!allItems && selectedItemIds.length > 0
                ? ` · ${selectedItemIds.length} kept across search`
                : ''}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--primary)]"
              onClick={selectVisibleItems}
            >
              {visibleIdsSelected ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Select visible
            </button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Item master grid"
          description="Go loads the selected batch · SAP Extended / Not yet + pipeline stage are shown per row"
          actions={
            <Button
              size="sm"
              variant="primary"
              loading={loadingGrid || queueing}
              onClick={() => void runGrid()}
            >
              <Play className="h-4 w-4" />
              Go
            </Button>
          }
        />
        {!hasRun && !loadingGrid ? (
          <EmptyState
            icon={Play}
            title="Select items, then press Go"
            description="Choose Item Category and specific Items. Go creates the SAP pipeline batch and loads the master grid with Extended vs Not yet status."
            actionLabel="Run grid"
            onAction={() => void runGrid()}
          />
        ) : loadingGrid ? (
          <SkeletonRows rows={10} cols={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No rows returned"
            description="Widen category/item selection or verify ERP connectivity."
          />
        ) : (
          <div className="scroll-panel max-h-[min(640px,62vh)]">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col} className={cn(colClass(col, 'th'))}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const key = String(row.RawMatID ?? idx);
                  const selected = selectedRowKey === key && drawerOpen;
                  return (
                    <tr
                      key={key}
                      data-selected={selected}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected}
                      className="cursor-pointer"
                      onClick={() => openRow(row, idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openRow(row, idx);
                        }
                      }}
                    >
                      {columns.map((col) => {
                        const val = row[col];
                        const display =
                          val == null || val === ''
                            ? '—'
                            : typeof val === 'object'
                              ? JSON.stringify(val)
                              : String(val);
                        const numeric =
                          col === 'Sl No' ||
                          col === 'RawMatCode' ||
                          col === 'UOM' ||
                          col === 'Weight' ||
                          col === 'HSNCode' ||
                          col === 'Prefix' ||
                          col === 'SAP Item Code' ||
                          col === 'Mat Type';
                        return (
                          <td
                            key={col}
                            className={cn(colClass(col, 'td'), numeric && 'numeric')}
                            title={display}
                          >
                            {col === 'SAP Extended' ? (
                              <Badge
                                tone={display === 'Extended' ? 'success' : 'warning'}
                              >
                                {display}
                              </Badge>
                            ) : col === 'SAP Pipeline' ? (
                              <Badge
                                tone={
                                  display === '—'
                                    ? 'neutral'
                                    : display === 'Pending'
                                      ? 'warning'
                                      : display === 'Template created'
                                        ? 'success'
                                        : 'info'
                                }
                              >
                                {display}
                              </Badge>
                            ) : col === 'Inspection Reqired' ? (
                              <Badge
                                tone={
                                  display.includes('Not') ? 'neutral' : 'warning'
                                }
                              >
                                {display}
                              </Badge>
                            ) : col === 'Mat Type' ? (
                              <Badge>{display}</Badge>
                            ) : col === 'Description' ? (
                              <span className="line-clamp-3 leading-snug">{display}</span>
                            ) : col === 'RawMatName' ? (
                              <span className="line-clamp-2 font-medium leading-snug">
                                {display}
                              </span>
                            ) : (
                              display
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasRun ? (
          <CardFooter>
            <span className="text-[12px] text-[var(--text-muted)]">
              {rows.length} row(s) · Extended {sapCounts.extended} · Not yet{' '}
              {sapCounts.notYet} · click a row to open properties
            </span>
          </CardFooter>
        ) : null}
      </Card>

      <ItemDetailDrawer
        open={drawerOpen}
        row={selectedRow}
        onClose={() => setDrawerOpen(false)}
      />

      <DuplicateReviewPanel
        open={reviewOpen}
        loading={reviewLoading}
        itemCode={reviewQueue[reviewIndex]?.rawMatCode || ''}
        itemName={reviewQueue[reviewIndex]?.rawMatName || ''}
        result={
          reviewQueue[reviewIndex]
            ? reviewResults[reviewQueue[reviewIndex].rawMatId] || null
            : null
        }
        reason={reviewReason}
        onReasonChange={setReviewReason}
        requireOverride={Boolean(pendingAction) || reviewResults[reviewQueue[reviewIndex]?.rawMatId || -1]?.verdict === 'duplicate'}
        queuePosition={
          reviewQueue.length > 1
            ? { index: reviewIndex, total: reviewQueue.length }
            : null
        }
        onClose={closeReview}
        onConfirm={() => void confirmReview()}
      />
    </div>
  );
}
