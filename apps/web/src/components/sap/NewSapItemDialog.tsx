'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PackagePlus, Search, X } from 'lucide-react';
import {
  DUPLICATE_OVERRIDE_MIN_REASON,
  DuplicateCheckResult,
  isServiceProduct,
  plantsForProductType,
} from '@kiswok/shared';
import { api, duplicateConflictResults, SapPipelineEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { DuplicateReviewPanel } from '@/components/sap/DuplicateReviewPanel';
import { cn } from '@/lib/cn';

type Lookups = Awaited<ReturnType<typeof api.lookups>>['data'];

const OTHER_HSN = '__OTHER__';

const FALLBACK_UOMS = [
  { value: 'EA', label: 'EA — Each' },
  { value: 'KGM', label: 'KGM — Kilogram' },
  { value: 'MTR', label: 'MTR — Metre' },
  { value: 'LTR', label: 'LTR — Litre' },
  { value: 'SET', label: 'SET — Set' },
  { value: 'BOX', label: 'BOX — Box' },
  { value: 'HR', label: 'HR — Hour' },
  { value: 'DAY', label: 'DAY — Day' },
];

const SERVICE_UOMS = new Set(['EA', 'HR', 'DAY', 'MON', 'AU']);
const STOCK_UOMS = new Set(['EA', 'KGM', 'MTR', 'LTR', 'SET', 'BOX', 'MTK', 'MMT', 'TON']);

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function uniqueOptions<T extends { value: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const key = o.value.trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function FilterSelect({
  label,
  required,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const unique = uniqueOptions(options);
    const term = q.trim().toLowerCase();
    const pinned = unique.filter((o) => o.value.startsWith('__'));
    const rest = unique.filter((o) => !o.value.startsWith('__'));
    const rows = term
      ? rest.filter(
          (o) =>
            o.value.toLowerCase().includes(term) ||
            o.label.toLowerCase().includes(term),
        )
      : rest;
    return [...pinned, ...rows.slice(0, 200)];
  }, [options, q]);

  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <span className="font-medium text-[var(--text)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${label.toLowerCase()}…`}
        disabled={disabled}
        className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-[var(--hover)] px-2.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] disabled:opacity-50"
      />
      <select
        value={value}
        required={required && value !== OTHER_HSN}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 text-[14px] text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {value && !filtered.some((o) => o.value === value) && value !== OTHER_HSN ? (
          <option value={value}>{value}</option>
        ) : null}
        {filtered.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="text-[12px] text-[var(--text-muted)]">{hint}</span> : null}
    </div>
  );
}

function MultiCheck({
  label,
  required,
  values,
  onChange,
  options,
  hint,
  disabled,
}: {
  label: string;
  required?: boolean;
  values: string[];
  onChange: (next: string[]) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const unique = uniqueOptions(options);
    const term = q.trim().toLowerCase();
    if (!term) return unique;
    return unique.filter(
      (o) =>
        o.value.toLowerCase().includes(term) ||
        o.label.toLowerCase().includes(term),
    );
  }, [options, q]);

  return (
    <div className={cn('flex flex-col gap-1.5 text-[13px]', disabled && 'opacity-55')}>
      <span className="font-medium text-[var(--text)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
        {values.length ? (
          <span className="ml-1.5 font-normal text-[var(--text-muted)]">{values.length} selected</span>
        ) : null}
      </span>
      {options.length > 8 ? (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          disabled={disabled}
          className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-[var(--hover)] px-2.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none"
        />
      ) : null}
      <div className="max-h-36 overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-2 py-1.5">
        {filtered.length ? (
          filtered.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-[var(--hover)]">
              <input
                type="checkbox"
                disabled={disabled}
                checked={values.includes(o.value)}
                onChange={() => onChange(toggleValue(values, o.value))}
              />
              <span>{o.label}</span>
            </label>
          ))
        ) : (
          <p className="px-1 py-2 text-[12px] text-[var(--text-muted)]">No matches</p>
        )}
      </div>
      {hint ? <span className="text-[12px] text-[var(--text-muted)]">{hint}</span> : null}
    </div>
  );
}

export function NewSapItemDialog({
  open,
  onClose,
  onCreated,
  initialDescription,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (entry: SapPipelineEntry) => void;
  initialDescription?: string;
}) {
  const { user } = useAuth();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [deptId, setDeptId] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [justification, setJustification] = useState('');

  const [productType, setProductType] = useState('ZRAW');
  const [description, setDescription] = useState('');
  const [productGroup, setProductGroup] = useState('');
  const [hsnPick, setHsnPick] = useState('');
  const [hsnOther, setHsnOther] = useState('');
  const [baseUom, setBaseUom] = useState('EA');
  const [plants, setPlants] = useState<string[]>([...plantsForProductType('ZRAW')]);
  const [slocs, setSlocs] = useState<string[]>(['MXST']);
  const [proposedCode, setProposedCode] = useState('');

  const [dupLoading, setDupLoading] = useState(false);
  const [dupLive, setDupLive] = useState<DuplicateCheckResult | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupReason, setDupReason] = useState('');
  const [dupResult, setDupResult] = useState<DuplicateCheckResult | null>(null);

  const service = isServiceProduct(productType);
  const hsnCode = hsnPick === OTHER_HSN ? hsnOther.replace(/\D/g, '') : hsnPick;

  useEffect(() => {
    if (!open) return;
    setError('');
    setName(user?.name || '');
    setEmpCode(user?.EmpCode || '');
    setLoginId(user?.loginId || '');
    setEmail(user?.Email || '');
    setDeptId(user?.DeptId != null ? String(user.DeptId) : '');
    setLocationIds(user?.LocationId != null ? [String(user.LocationId)] : []);
    setJustification('');
    setProductType('ZRAW');
    setDescription(initialDescription?.trim() || '');
    setProductGroup('');
    setHsnPick('');
    setHsnOther('');
    setBaseUom('EA');
    setPlants([...plantsForProductType('ZRAW')]);
    setSlocs(['MXST']);
    setProposedCode('');
    setDupOpen(false);
    setDupReason('');
    setDupResult(null);
    setDupLive(null);
  }, [open, user, initialDescription]);

  useEffect(() => {
    if (!open || lookups) return;
    setLoadingLookups(true);
    api
      .lookups()
      .then((r) => setLookups(r.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingLookups(false));
  }, [open, lookups]);

  const allowedPlants = useMemo(() => plantsForProductType(productType), [productType]);

  const plantOptions = useMemo(() => {
    const fromLookups = (lookups?.plants || []).filter((p) => allowedPlants.includes(p.value));
    return fromLookups.length
      ? fromLookups
      : allowedPlants.map((p) => ({ value: p, label: p }));
  }, [allowedPlants, lookups]);

  const slocOptions = useMemo(() => {
    const rows = lookups?.storageLocationOptions?.length
      ? lookups.storageLocationOptions
      : (lookups?.storageLocations || ['MXST']).map((s) => ({ value: s, label: s }));
    const unique = new Map<string, { value: string; label: string }>();
    for (const row of rows) {
      if (!unique.has(row.value)) unique.set(row.value, { value: row.value, label: row.label });
    }
    if (!unique.has('MXST')) unique.set('MXST', { value: 'MXST', label: 'MXST — Main stores' });
    return [...unique.values()];
  }, [lookups]);

  const uomOptions = useMemo(() => {
    const all = lookups?.uoms?.length ? lookups.uoms : FALLBACK_UOMS;
    const allowed = service ? SERVICE_UOMS : STOCK_UOMS;
    const filtered = all.filter((u) => allowed.has(u.value));
    return [{ value: '', label: 'Select UoM' }, ...(filtered.length ? filtered : all)];
  }, [lookups, service]);

  const hsnOptions = useMemo(() => {
    const rows = lookups?.hsnCodes || [];
    const kind = service ? 'SAC' : 'HSN';
    const matched = rows.filter((h) => String(h.kind || 'HSN').toUpperCase() === kind);
    const list = matched.length ? matched : rows;
    return [...list, { value: OTHER_HSN, label: `Other — ${kind} not in the list` }];
  }, [lookups, service]);

  const departmentOptions = useMemo(() => {
    const rows = lookups?.departments || [];
    if (user?.DeptId != null && !rows.some((d) => d.value === String(user.DeptId))) {
      return [{ value: String(user.DeptId), label: `Your department` }, ...rows];
    }
    return rows;
  }, [lookups, user]);

  const locationOptions = useMemo(() => {
    const rows = lookups?.locations || [];
    if (user?.LocationId != null && !rows.some((d) => d.value === String(user.LocationId))) {
      return [{ value: String(user.LocationId), label: 'Your location' }, ...rows];
    }
    return rows;
  }, [lookups, user]);

  useEffect(() => {
    setPlants([...allowedPlants]);
  }, [allowedPlants]);

  useEffect(() => {
    if (service) {
      setSlocs([]);
      if (!SERVICE_UOMS.has(baseUom)) setBaseUom('EA');
      return;
    }
    if (!slocs.length) setSlocs(['MXST']);
    if (!STOCK_UOMS.has(baseUom)) setBaseUom('EA');
  }, [service, slocs.length, baseUom]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !dupOpen) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dupOpen]);

  useEffect(() => {
    if (!open) return;
    const text = description.trim();
    if (text.length < 8) {
      setDupLive(null);
      return;
    }
    const t = window.setTimeout(() => {
      setDupLoading(true);
      api
        .reviewDuplicates({
          description: text,
          hsn: hsnCode || undefined,
          uom: baseUom || undefined,
        })
        .then((r) => setDupLive(r.data[0] || null))
        .catch(() => setDupLive(null))
        .finally(() => setDupLoading(false));
    }, 450);
    return () => window.clearTimeout(t);
  }, [open, description, hsnCode, baseUom]);

  async function submit(overrideReason?: string) {
    setError('');
    const dept = Number(deptId);
    const locIds = locationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
    const deptRow = departmentOptions.find((d) => d.value === deptId);
    const locNames = locationOptions
      .filter((l) => locationIds.includes(l.value))
      .map((l) => l.label);
    if (!name.trim() || !empCode.trim() || !loginId.trim() || !email.trim()) {
      setError('Requester name, employee code, login, and email are mandatory.');
      return;
    }
    if (!Number.isFinite(dept) || !deptRow) {
      setError('Select a department by name.');
      return;
    }
    if (!locIds.length) {
      setError('Select at least one location by name.');
      return;
    }
    if (justification.trim().length < 8) {
      setError('Business justification is mandatory (at least 8 characters).');
      return;
    }
    if (!productType || description.trim().length < 8 || !productGroup || !hsnCode || !baseUom || !plants.length) {
      setError('Complete all mandatory item fields before submitting.');
      return;
    }
    if (!service && !slocs.length) {
      setError('Select at least one storage location. MXST is the default for stock items.');
      return;
    }
    const liveVerdict = dupLive?.verdict || 'none';
    const reason = (overrideReason || dupReason).trim();
    if (liveVerdict === 'duplicate' && reason.length < DUPLICATE_OVERRIDE_MIN_REASON) {
      setDupResult(dupLive);
      setDupOpen(true);
      setError('This description matches an existing SAP material. Confirm it is not a duplicate.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createManualItem({
        requester: {
          name: name.trim(),
          empCode: empCode.trim(),
          loginId: loginId.trim(),
          email: email.trim(),
          deptId: dept,
          deptName: deptRow.label,
          locationId: locIds[0],
          locationName: locNames[0],
          locationIds: locIds,
          locationNames: locNames,
          justification: justification.trim(),
        },
        productType,
        description: description.trim(),
        productGroup,
        hsnCode,
        hsnOther: hsnPick === OTHER_HSN,
        baseUom,
        plants,
        storageLocations: service ? [] : slocs,
        locationIds: locIds,
        proposedCode: proposedCode.trim() || undefined,
        duplicateOverrideReason: reason || undefined,
      });
      onCreated(res.data);
      onClose();
    } catch (e) {
      const blocked = duplicateConflictResults(e);
      if (blocked.length) {
        setDupResult(blocked[0]);
        setDupReason(justification.trim());
        setDupOpen(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  if (!open) return null;

  const liveMatches = dupLive?.matches || [];
  const liveVerdict = dupLive?.verdict || 'none';

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-[rgba(17,24,39,0.42)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-sap-item-title"
        className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      >
        <form
          onSubmit={onSubmit}
          className="relative my-4 w-full max-w-[920px] rounded-[16px] border border-[var(--border)] bg-[var(--card)] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                New item code request
              </p>
              <h2 id="new-sap-item-title" className="mt-0.5 flex items-center gap-2 text-[20px] font-semibold text-[var(--text)]">
                <PackagePlus className="h-5 w-5 text-[var(--primary)]" />
                Create SAP item
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] text-[var(--text-secondary)]">
                Choose department and location by name. Plants, locations, and storage locations can be multi-selected. Description is checked against live SAP materials as you type.
              </p>
            </div>
            <Button type="button" variant="icon" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-5 px-5 py-4">
            {error ? (
              <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
                {error}
              </div>
            ) : null}
            {loadingLookups ? (
              <p className="text-[13px] text-[var(--text-muted)]">Loading departments, locations, HSN, and plants…</p>
            ) : null}

            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                1. Requester
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  label="Employee code"
                  required
                  value={empCode}
                  onChange={(e) => setEmpCode(e.target.value)}
                  hint={!user?.EmpCode ? 'Not on the session token — enter your EmpCode' : undefined}
                />
                <Input label="Login ID" required value={loginId} onChange={(e) => setLoginId(e.target.value)} />
                <Input
                  label="Email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Select
                  label="Department"
                  required
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  options={[
                    { value: '', label: departmentOptions.length ? 'Select department' : 'Department list unavailable' },
                    ...departmentOptions,
                  ]}
                />
                <MultiCheck
                  label="Location"
                  required
                  values={locationIds}
                  onChange={setLocationIds}
                  options={locationOptions}
                  hint="Company / unit names. Select every location where this item will be used."
                />
                <label className="flex flex-col gap-1.5 text-[13px] sm:col-span-2">
                  <span className="font-medium text-[var(--text)]">
                    Business justification
                    <span className="ml-0.5 text-[var(--danger)]">*</span>
                  </span>
                  <textarea
                    required
                    minLength={8}
                    rows={3}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Why this code is needed, where it will be used, and who requested it."
                    className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                  />
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                2. Material identity
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Material type"
                  required
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  options={
                    lookups?.productTypes?.length
                      ? lookups.productTypes
                      : [{ value: 'ZRAW', label: 'ZRAW - RAW MATERIAL' }]
                  }
                />
                <Select
                  label="Base unit of measure"
                  required
                  value={baseUom}
                  onChange={(e) => setBaseUom(e.target.value)}
                  options={uomOptions}
                />
                <label className="flex flex-col gap-1.5 text-[13px] sm:col-span-2">
                  <span className="font-medium text-[var(--text)]">
                    Description
                    <span className="ml-0.5 text-[var(--danger)]">*</span>
                  </span>
                  <textarea
                    required
                    minLength={8}
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="SAP short description — make it unique and searchable."
                    className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                  />
                </label>
                <div className="sm:col-span-2 rounded-[10px] border border-[var(--border)] bg-[var(--hover)] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-[var(--text-muted)]" />
                    <p className="text-[13px] font-medium text-[var(--text)]">Duplicate check</p>
                    {dupLoading ? (
                      <span className="text-[12px] text-[var(--text-muted)]">Checking live SAP descriptions…</span>
                    ) : description.trim().length < 8 ? (
                      <span className="text-[12px] text-[var(--text-muted)]">Type at least 8 characters to compare</span>
                    ) : liveVerdict === 'duplicate' ? (
                      <Badge tone="danger">Likely duplicate</Badge>
                    ) : liveVerdict === 'similar' ? (
                      <Badge tone="warning">Similar items</Badge>
                    ) : (
                      <Badge tone="success">No close match</Badge>
                    )}
                  </div>
                  {liveVerdict === 'duplicate' || liveVerdict === 'similar' ? (
                    <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                      {liveMatches.slice(0, 6).map((m) => (
                        <li key={`${m.product}-${m.score}`} className="rounded-[8px] bg-[var(--card)] px-2.5 py-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="numeric text-[12px] font-semibold text-[var(--text)]">{m.product}</p>
                            <span className="text-[11px] text-[var(--text-muted)]">{m.score}</span>
                          </div>
                          <p className="text-[12px] leading-snug text-[var(--text-secondary)]">{m.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {liveVerdict === 'duplicate' ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--danger)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Create is blocked until you confirm this is not the same material.
                    </p>
                  ) : null}
                </div>
                <FilterSelect
                  label="Material group"
                  required
                  value={productGroup}
                  onChange={setProductGroup}
                  options={lookups?.materialGroups || []}
                  placeholder="Select material group"
                  hint={
                    lookups?.masters?.materialGroups
                      ? `${lookups.masters.materialGroups} groups in master`
                      : 'Shared material-group master'
                  }
                />
                <div>
                  <FilterSelect
                    label={service ? 'SAC' : 'HSN'}
                    required
                    value={hsnPick}
                    onChange={setHsnPick}
                    options={hsnOptions}
                    placeholder={service ? 'Select SAC from list' : 'Select HSN from list'}
                    hint={service ? 'SAC from the Kiswok list, or Other' : 'HSN from the Kiswok list, or Other'}
                  />
                  {hsnPick === OTHER_HSN ? (
                    <div className="mt-2">
                      <Input
                        label={service ? 'Other SAC' : 'Other HSN'}
                        required
                        value={hsnOther}
                        onChange={(e) => setHsnOther(e.target.value)}
                        hint="Enter the code if it is missing from the shared list."
                      />
                    </div>
                  ) : null}
                </div>
                <MultiCheck
                  label="Plant"
                  required
                  values={plants}
                  onChange={setPlants}
                  options={plantOptions}
                  hint={
                    service
                      ? 'Service extends to 1001 and 2001–2006. Uncheck plants that do not apply.'
                      : 'Stock items use 2001–2006. Select every plant that must receive this material.'
                  }
                />
                <MultiCheck
                  label="Storage location"
                  required={!service}
                  disabled={service}
                  values={service ? [] : slocs}
                  onChange={setSlocs}
                  options={service ? [{ value: '', label: 'Not applicable for ZSRV' }] : slocOptions}
                  hint={
                    service
                      ? 'Service items have no storage location.'
                      : 'MXST is required unless you only need a specific shop sloc as well.'
                  }
                />
                <Input
                  label="Proposed temporary code"
                  value={proposedCode}
                  onChange={(e) => setProposedCode(e.target.value.toUpperCase())}
                  hint="Optional. Leave blank to auto-assign NEW + date."
                  maxLength={18}
                />
              </div>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              <PackagePlus className="h-4 w-4" />
              Create request
            </Button>
          </div>
        </form>
      </div>

      <DuplicateReviewPanel
        open={dupOpen}
        loading={submitting}
        itemCode={proposedCode || 'NEW'}
        itemName={description}
        result={dupResult}
        reason={dupReason}
        onReasonChange={setDupReason}
        requireOverride
        onClose={() => setDupOpen(false)}
        onConfirm={() => {
          if (dupReason.trim().length < DUPLICATE_OVERRIDE_MIN_REASON) return;
          setDupOpen(false);
          void submit(dupReason.trim());
        }}
      />
    </>
  );
}
