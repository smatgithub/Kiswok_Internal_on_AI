'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ClipboardList,
  Loader2,
  PackagePlus,
  Search,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DuplicateCheckResult, DuplicateMatch, SapPipelineEntry, SapSourceItem } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NewSapItemDialog } from '@/components/sap/NewSapItemDialog';
import { cn } from '@/lib/cn';

const ACK_KEY = 'kiswok-mdt-acked-created';
const POLL_MS = 15000;

const TRACK_STEPS = [
  { id: 'requested', label: 'Requested' },
  { id: 'processing', label: 'In process' },
  { id: 'template', label: 'Template ready' },
  { id: 'exported', label: 'Sent to SAP' },
  { id: 'created', label: 'Created in SAP' },
] as const;

function ackStore(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function persistAck(ids: Set<string>) {
  window.localStorage.setItem(ACK_KEY, JSON.stringify([...ids]));
}

function createdKey(entry: SapPipelineEntry): string | null {
  const code = entry.sapItemCode?.trim() || entry.alreadyInSap?.sapCode?.trim();
  if (!code) return null;
  return `${entry.id}:${code}`;
}

function isMine(entry: SapPipelineEntry, loginId?: string, empCode?: string | null) {
  const login = loginId?.trim().toLowerCase();
  const emp = empCode?.trim().toLowerCase();
  const rb = entry.requestedBy;
  if (!rb) return false;
  if (login && rb.loginId?.trim().toLowerCase() === login) return true;
  if (emp && rb.empCode?.trim().toLowerCase() === emp) return true;
  return false;
}

function stepIndex(entry: SapPipelineEntry): number {
  if (entry.sapItemCode || entry.alreadyInSap?.sapCode) return 4;
  if (entry.stage === 'exported') return 3;
  if (entry.stage === 'committed') return 2;
  return 1;
}

function statusCopy(entry: SapPipelineEntry): { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' } {
  if (entry.sapItemCode || entry.alreadyInSap?.sapCode) {
    return { label: 'Created in SAP', tone: 'success' };
  }
  if (entry.stage === 'exported') return { label: 'Sent to SAP', tone: 'info' };
  if (entry.stage === 'committed') return { label: 'Template ready', tone: 'info' };
  return { label: 'In process', tone: 'warning' };
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MasterDataTracking() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [dup, setDup] = useState<DuplicateCheckResult | null>(null);
  const [candidates, setCandidates] = useState<SapSourceItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [entries, setEntries] = useState<SapPipelineEntry[]>([]);
  const [loadingTrack, setLoadingTrack] = useState(true);
  const [trackError, setTrackError] = useState('');

  const [requestOpen, setRequestOpen] = useState(false);
  const [seedDescription, setSeedDescription] = useState('');
  const [justCreated, setJustCreated] = useState<SapPipelineEntry | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAcked(ackStore());
  }, []);

  const loadTrack = useCallback(async () => {
    try {
      const res = await api.listPipeline();
      setEntries(res.data || []);
      setTrackError('');
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : 'Could not load request progress.');
    } finally {
      setLoadingTrack(false);
    }
  }, []);

  useEffect(() => {
    void loadTrack();
    const t = window.setInterval(() => void loadTrack(), POLL_MS);
    return () => window.clearInterval(t);
  }, [loadTrack]);

  const mine = useMemo(
    () =>
      entries
        .filter((e) => isMine(e, user?.loginId, user?.EmpCode))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries, user],
  );

  const createdNotices = useMemo(() => {
    return mine.filter((e) => {
      const key = createdKey(e);
      return Boolean(key) && !acked.has(key as string);
    });
  }, [mine, acked]);

  async function runFind(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 3) {
      setSearchError('Enter at least 3 characters of the item description or code.');
      return;
    }
    setSearching(true);
    setSearchError('');
    setHasSearched(true);
    try {
      const dupRes = await api.reviewDuplicates({ description: q, rawMatCode: q, limit: 8 });
      setDup(dupRes.data?.[0] || null);
      setSearching(false);
      const candRes = await api.search(q).catch(() => ({ data: [] as SapSourceItem[] }));
      setCandidates(candRes.data || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Duplicate check failed.');
      setDup(null);
      setCandidates([]);
      setSearching(false);
    }
  }

  function openRequest(description: string) {
    setSeedDescription(description.trim());
    setRequestOpen(true);
  }

  function acknowledge(entry: SapPipelineEntry) {
    const key = createdKey(entry);
    if (!key) return;
    const next = new Set(acked);
    next.add(key);
    setAcked(next);
    persistAck(next);
  }

  function acknowledgeAll() {
    const next = new Set(acked);
    for (const e of createdNotices) {
      const key = createdKey(e);
      if (key) next.add(key);
    }
    setAcked(next);
    persistAck(next);
  }

  const verdict = dup?.verdict || 'none';
  const matches = dup?.matches || [];
  const canRequest =
    hasSearched &&
    !searching &&
    query.trim().length >= 3 &&
    verdict !== 'duplicate';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-[var(--text)]">
            Master Data Tracking
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-secondary)]">
            Find an existing SAP item, confirm it is not a duplicate, raise a new
            code request if needed, and follow it until SAP creation is confirmed.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => openRequest(query)}>
          <PackagePlus className="h-4 w-4" />
          Request new item
        </Button>
      </div>

      {justCreated ? (
        <div
          className="flex items-start justify-between gap-3 rounded-[12px] border border-[color-mix(in_srgb,var(--info)_35%,var(--border))] bg-[var(--info-bg)] px-4 py-3"
          role="status"
        >
          <div className="flex gap-2">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-[var(--info)]" />
            <div>
              <p className="text-[14px] font-semibold text-[var(--text)]">
                Request accepted
              </p>
              <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text)]">{justCreated.icsoftCode}</span>
                {' — '}
                {justCreated.rawMatName}. It is now in process. You will get an
                intimation on this page when the SAP item code is created.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--hover)]"
            aria-label="Dismiss request accepted notice"
            onClick={() => setJustCreated(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {createdNotices.length ? (
        <div
          className="rounded-[12px] border border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[var(--success-bg)] px-4 py-3"
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2">
              <Bell className="mt-0.5 h-5 w-5 shrink-0 text-[var(--success)]" />
              <div>
                <p className="text-[14px] font-semibold text-[var(--text)]">
                  Item created in SAP
                </p>
                <ul className="mt-1 space-y-1 text-[13px] text-[var(--text-secondary)]">
                  {createdNotices.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium text-[var(--text)]">{e.rawMatName || e.icsoftCode}</span>
                      {' is created as SAP code '}
                      <span className="numeric font-semibold text-[var(--success)]">
                        {e.sapItemCode || e.alreadyInSap?.sapCode}
                      </span>
                      <button
                        type="button"
                        className="ml-2 text-[12px] font-medium text-[var(--primary)] underline-offset-2 hover:underline"
                        onClick={() => acknowledge(e)}
                      >
                        Mark as read
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={acknowledgeAll}>
              Dismiss all
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-[12px] text-[var(--text-muted)]">
        <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1">
          1. Find item
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1">
          2. Check duplicate
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1">
          3. Track progress
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1">
          4. Created intimation
        </span>
      </div>

      <Card>
        <CardHeader
          title="Find item"
          description="Search by description or existing code. The same search checks live SAP materials for duplicates."
        />
        <CardBody className="space-y-4">
          <form onSubmit={runFind} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                label="Item description or code"
                placeholder="Example: STEEL SCRAP-C.I. or 1000002133"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                hint="Minimum 3 characters. Use the wording stores / purchase would search in SAP."
              />
            </div>
            <Button type="submit" variant="primary" loading={searching} className="sm:mb-0.5">
              <Search className="h-4 w-4" />
              Find & check duplicate
            </Button>
          </form>
          {searchError ? (
            <p className="text-[13px] text-[var(--danger)]">{searchError}</p>
          ) : null}

          {searching ? (
            <p className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking existing SAP descriptions…
            </p>
          ) : null}

          {hasSearched && !searching ? (
            <div className="space-y-4">
              <DuplicateBlock verdict={verdict} matches={matches} catalogCount={dup?.catalog.products} />

              {candidates.length ? (
                <div>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    Also in IcSoft
                  </p>
                  <ul className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)]">
                    {candidates.slice(0, 8).map((row) => (
                      <li key={row.RawMatID} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div>
                          <p className="text-[13px] font-medium text-[var(--text)]">
                            {row.Rawmatname || row.IcsoftCode}
                          </p>
                          <p className="text-[12px] text-[var(--text-muted)]">
                            {row.IcsoftCode}
                            {row.sap_item_code ? ` · SAP ${row.sap_item_code}` : ' · No SAP code yet'}
                            {row.grntype ? ` · ${row.grntype}` : ''}
                          </p>
                        </div>
                        {row.sap_item_code ? (
                          <Badge tone="success">Already in SAP</Badge>
                        ) : (
                          <Badge tone="warning">Not yet in SAP</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {verdict === 'duplicate' ? (
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Do not raise a new request. Use the SAP code above in purchase / stores.
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-[var(--border)] px-3 py-3">
                  <p className="text-[13px] text-[var(--text-secondary)]">
                    {verdict === 'similar'
                      ? 'Nearby items exist. Request a new code only if none of them is the same material.'
                      : 'No close SAP match. You can request a new item code.'}
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canRequest}
                    onClick={() => openRequest(query)}
                  >
                    Request new item
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="My request progress"
          description="Requests you raised. This list refreshes every 15 seconds until SAP creation is confirmed."
          actions={
            <Button size="sm" variant="ghost" onClick={() => void loadTrack()}>
              Refresh
            </Button>
          }
        />
        <CardBody className="p-0">
          {loadingTrack ? (
            <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your requests…
            </p>
          ) : trackError ? (
            <p className="px-4 py-8 text-[13px] text-[var(--danger)]">{trackError}</p>
          ) : mine.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
              You have no item-code requests yet. Find the item first. If it is not a
              duplicate, request a new code from this page.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {mine.map((entry) => (
                <RequestRow key={entry.id} entry={entry} onAck={() => acknowledge(entry)} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <NewSapItemDialog
        open={requestOpen}
        initialDescription={seedDescription}
        onClose={() => setRequestOpen(false)}
        onCreated={(entry) => {
          setJustCreated(entry);
          setRequestOpen(false);
          void loadTrack();
        }}
      />
    </div>
  );
}

function DuplicateBlock({
  verdict,
  matches,
  catalogCount,
}: {
  verdict: DuplicateCheckResult['verdict'];
  matches: DuplicateMatch[];
  catalogCount?: number;
}) {
  const tone =
    verdict === 'duplicate' ? 'danger' : verdict === 'similar' ? 'warning' : 'success';
  const title =
    verdict === 'duplicate'
      ? 'Likely duplicate — item already exists'
      : verdict === 'similar'
        ? 'Similar items found — review before requesting'
        : 'No close match in SAP';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        {catalogCount != null ? (
          <span className="text-[12px] text-[var(--text-muted)]">
            Checked against {catalogCount.toLocaleString()} SAP materials
          </span>
        ) : null}
      </div>
      {matches.length ? (
        <ul className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)]">
          {matches.map((m) => (
            <li key={`${m.product}-${m.score}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
              <div>
                <p className="numeric text-[13px] font-semibold text-[var(--text)]">{m.product}</p>
                <p className="text-[13px] text-[var(--text-secondary)]">{m.description}</p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {[m.productType, m.productGroup, m.uom, m.hsn ? `HSN ${m.hsn}` : null, m.reason]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Badge tone={m.score >= 88 ? 'danger' : 'warning'}>{m.score}%</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--text-secondary)]">
          Nothing close enough to block a new request.
        </p>
      )}
    </div>
  );
}

function RequestRow({
  entry,
  onAck,
}: {
  entry: SapPipelineEntry;
  onAck: () => void;
}) {
  const current = stepIndex(entry);
  const status = statusCopy(entry);
  const sapCode = entry.sapItemCode || entry.alreadyInSap?.sapCode || null;
  const created = current >= 4;

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--text)]">
            {entry.rawMatName || entry.icsoftCode}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Request {entry.icsoftCode}
            {entry.productType ? ` · ${entry.productType}` : ''}
            {' · updated '}
            {formatWhen(entry.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {created && sapCode ? (
            <span className="numeric text-[13px] font-semibold text-[var(--success)]">{sapCode}</span>
          ) : null}
        </div>
      </div>

      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TRACK_STEPS.map((step, idx) => {
          const done = idx <= current;
          const active = idx === current;
          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  done
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--hover)] text-[var(--text-muted)]',
                )}
              >
                {done && idx < current ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
              </span>
              <span
                className={cn(
                  'text-[12px] font-medium',
                  active ? 'text-[var(--text)]' : done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {created && sapCode ? (
        <p className="mt-3 rounded-[8px] bg-[var(--success-bg)] px-3 py-2 text-[13px] text-[var(--text)]">
          Intimation: this item is created in SAP as <strong className="numeric">{sapCode}</strong>.
          <button
            type="button"
            className="ml-2 font-medium text-[var(--primary)] underline-offset-2 hover:underline"
            onClick={onAck}
          >
            Mark as read
          </button>
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          Master data is working this request. You do not need to re-submit. This page
          will show the SAP code when creation is complete.
        </p>
      )}
    </li>
  );
}
