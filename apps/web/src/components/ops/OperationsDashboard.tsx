'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Download,
  PackagePlus,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';

const ACTIVITY = [
  { t: '15:22', msg: 'Batch 6fe9ea9f exported · 1 ZRAW line · IRON0003', tone: 'success' as const },
  { t: '15:18', msg: 'Wizard defaults applied from IcSoft CONGEDB0032', tone: 'info' as const },
  { t: '14:55', msg: 'Mock ERP mode active · set USE_MOCK_ERP=false for live SQL', tone: 'warning' as const },
  { t: '14:40', msg: 'Gold template loaded · Product ZRAW · S/4HANA Cloud 2602', tone: 'neutral' as const },
];

const QUEUE = [
  { code: 'IRON0003', name: 'STEEL SCRAP-C.I. (HIGH SULPHUR)', matType: 'ZRAW', plant: '20AA', sloc: 'MXST', uom: 'KGM' },
  { code: 'CONGEDB0032', name: 'DRILL BIT 10MM X 116 FLUTE LENGTH (T/S)', matType: 'ZCON', plant: '2001', sloc: 'WUNM', uom: 'EA' },
  { code: 'FNDCHEM0001', name: 'BORIC ACID', matType: 'ZRAW', plant: '20AA', sloc: '1001', uom: 'KGM' },
  { code: 'RMDIIR0007', name: 'STEEL SCRAP D.I.(CHALLA/GITTY)', matType: 'ZRAW', plant: '20AA', sloc: 'MXST', uom: 'KGM' },
];

export default function OperationsDashboard() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-[var(--text)]">Operations</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Enterprise control surface for Kiswok Internal V3 · SAP migration first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary">
            <Clock3 className="h-4 w-4" />
            Last sync 2m ago
          </Button>
          <Link href="/master-data-tracking">
            <Button size="sm" variant="primary">
              <PackagePlus className="h-4 w-4" />
              New SAP item
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Pending SAP loads" value="128" delta="+14 vs yesterday" tone="warning" icon={<PackagePlus className="h-4 w-4" />} />
        <KpiCard label="Committed today" value="37" delta="+12% throughput" tone="success" icon={<ShieldCheck className="h-4 w-4" />} />
        <KpiCard label="Export jobs" value="9" delta="2 running" tone="info" icon={<Download className="h-4 w-4" />} />
        <KpiCard label="Validation fails" value="4" delta="Needs HSN / SLoc" tone="danger" icon={<Activity className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader
            title="Migration throughput"
            description="Committed lines by hour (sample)"
            actions={<Badge tone="info">Live preview</Badge>}
          />
          <CardBody>
            <div className="grid h-44 grid-cols-12 items-end gap-1.5">
              {[42, 55, 38, 70, 62, 88, 74, 95, 68, 80, 58, 72].map((h, i) => (
                <div key={i} className="flex h-full flex-col justify-end gap-1">
                  <div
                    className="rounded-t-md bg-[var(--primary)]/80"
                    style={{ height: `${h}%` }}
                    title={`${h} lines`}
                  />
                  <span className="numeric text-center text-[10px] text-[var(--text-muted)]">
                    {8 + i}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Quick actions" description="Fewest clicks to value" />
          <CardBody className="space-y-2">
            {[
              { href: '/master-data-tracking', label: 'Master Data Tracking', hint: 'Find · duplicate · progress' },
              { href: '/sap-items', label: 'Open SAP Item Studio', hint: 'Select → wizard → export' },
              { href: '/sap-items?tab=batch', label: 'Resume last batch', hint: 'Inline grid edit' },
            ].map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center justify-between rounded-[10px] border border-[var(--border)] px-3 py-2.5 hover:bg-[var(--hover)]"
              >
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--text)]">{a.label}</span>
                  <span className="text-[12px] text-[var(--text-muted)]">{a.hint}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-muted)]" />
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader
            title="Candidate queue snapshot"
            description="Realistic sample of IcSoft → SAP backlog"
            actions={
              <Link href="/sap-items">
                <Button size="sm" variant="secondary">
                  Open studio
                </Button>
              </Link>
            }
          />
          <div className="scroll-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Mat Type</th>
                  <th>Plant</th>
                  <th>SLoc</th>
                  <th>UoM</th>
                </tr>
              </thead>
              <tbody>
                {QUEUE.map((row) => (
                  <tr key={row.code}>
                    <td className="numeric font-semibold">{row.code}</td>
                    <td className="max-w-[320px] truncate">{row.name}</td>
                    <td className="numeric">{row.matType}</td>
                    <td className="numeric">{row.plant}</td>
                    <td className="numeric">{row.sloc}</td>
                    <td className="numeric">{row.uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Recent activity" description="Audit trail" />
          <CardBody className="space-y-3">
            {ACTIVITY.map((a) => (
              <div key={a.t + a.msg} className="flex gap-3 border-b border-[var(--border)] pb-2 last:border-0">
                <span className="numeric w-10 shrink-0 text-[12px] text-[var(--text-muted)]">{a.t}</span>
                <div>
                  <Badge tone={a.tone}>{a.tone}</Badge>
                  <p className="mt-1 text-[13px] text-[var(--text)]">{a.msg}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
