"use client";

import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz, type ColDef, type GridApi, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { AlertTriangle, Copy, Download, Layers, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Pill, ScoreBar } from "./ui";
import { authAgeDays, authNeedsReauth, copyText, fmtMoney, STATUS_META } from "@/client/helpers";
import { AUTH_EXPIRY_DAYS, type LedgerItem } from "@/shared/types";

ModuleRegistry.registerModules([AllCommunityModule]);

type ItemRow = LedgerItem & { __group?: undefined; __total?: undefined };
interface GroupRow {
  id: string;
  __group: true;
  label: string;
  subtotal: number;
  count: number;
  __total?: undefined;
}
interface TotalRow {
  id: string;
  __total: true;
  budget: number;
  authorized: number;
  released: number;
  __group?: undefined;
}
type Row = ItemRow | GroupRow | TotalRow;

export interface LedgerHandlers {
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onFund: (item: LedgerItem) => void;
  onAudit: (item: LedgerItem) => void;
  onReceipt: (item: LedgerItem) => void;
  onPurchase: (item: LedgerItem) => void;
  onChooseProduct: (item: LedgerItem) => void;
  busyIds: Set<string>;
}

interface Props extends LedgerHandlers {
  items: LedgerItem[];
  selectedId: string | null;
  onAmountEdit: (item: LedgerItem, amount: number) => Promise<void>;
}

const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#0b1220",
  foregroundColor: "#e5e7eb",
  headerBackgroundColor: "#111a2e",
  oddRowBackgroundColor: "#0d1526",
  borderColor: "#26335a",
  accentColor: "#0070BA",
  fontSize: 13,
});

function handlersOf(p: ICellRendererParams<Row>): LedgerHandlers {
  return p.context as LedgerHandlers;
}

function NameCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__total) {
    return d?.__total ? <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Totals</span> : null;
  }
  const h = handlersOf(p);
  return (
    <div className="flex flex-col items-start gap-1 py-1 leading-tight">
      <button className="text-left font-medium text-white hover:text-pp-sky hover:underline" onClick={() => h.onInspect(d.id)}>
        {d.title}
      </button>
      {d.kind === "SERVICE" ? (
        <Pill className="bg-pp-blue/20 text-sky-300 ring-pp-blue/50">SERVICE ESCROW</Pill>
      ) : (
        <Pill className="bg-emerald-500/20 text-emerald-300 ring-emerald-400/40">CHANNEL3 PRODUCT</Pill>
      )}
    </div>
  );
}

function PayeeCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__total) return null;
  return <span className="truncate text-xs text-slate-300">{d.payee}</span>;
}

function StatusCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group) return null;
  if (d.__total) {
    return (
      <div className="text-[11px] leading-tight text-slate-300">
        <div>
          Authorized (held): <b className="text-blue-300">{fmtMoney(d.authorized)}</b>
        </div>
        <div>
          Released: <b className="text-emerald-300">{fmtMoney(d.released)}</b>
        </div>
      </div>
    );
  }
  const meta = STATUS_META[d.status];
  const age = authAgeDays(d);
  const warn = authNeedsReauth(d);
  return (
    <div className="flex flex-col items-start gap-1 py-1">
      <Pill className={meta.className}>{meta.label}</Pill>
      {warn && age !== null && (
        <Pill className="bg-amber-500/20 text-amber-300 ring-amber-400/50">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Auth expires in {Math.max(0, Math.ceil(AUTH_EXPIRY_DAYS - age))}d
        </Pill>
      )}
      {d.paymentError && <span className="max-w-[170px] truncate text-[10px] text-red-300" title={d.paymentError}>{d.paymentError}</span>}
    </div>
  );
}

function ScoreCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__total || d.auditScore === null) return <span className="text-xs text-slate-500">-</span>;
  return <ScoreBar score={d.auditScore} compact />;
}

function RefLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] leading-4">
      <span className="w-12 shrink-0 text-slate-500">{label}</span>
      <code className="truncate font-mono text-slate-200" title={value}>{value}</code>
      <button onClick={() => copyText(value)} aria-label={`Copy ${label}`} className="shrink-0 text-slate-500 hover:text-white">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

function RefsCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__total) return null;
  const r = d.paypal;
  if (!r.orderId && !r.authorizationId) return <span className="text-xs text-slate-500">Not funded yet</span>;
  return (
    <div className="w-full py-1">
      <RefLine label="Order" value={r.orderId} />
      <RefLine label="Auth" value={r.authorizationId} />
      <RefLine label="Capture" value={r.captureId} />
      <RefLine label="Payout" value={r.payoutBatchId} />
      {d.simulatedAuth && <span className="text-[9px] uppercase tracking-wider text-slate-500">sandbox simulation</span>}
    </div>
  );
}

function ActionsCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__total) return null;
  const h = handlersOf(p);
  const busy = h.busyIds.has(d.id) || d.isProcessingPayment;
  const reauth = authNeedsReauth(d);
  const buttons: React.ReactNode[] = [];

  if (d.kind === "SERVICE") {
    if (["PENDING_FUNDING", "DRAFT"].includes(d.status)) {
      buttons.push(<Button key="f" size="xs" loading={busy} onClick={() => h.onFund(d)}>1. Fund Escrow (PayPal)</Button>);
    }
    if (reauth) buttons.push(<Button key="r" size="xs" variant="warn" loading={busy} onClick={() => h.onFund(d)}>Re-Authorize via PayPal</Button>);
    if (["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"].includes(d.status) && d.paypal.authorizationId) {
      buttons.push(<Button key="a" size="xs" variant="success" loading={busy} onClick={() => h.onAudit(d)}>2. Submit Work & Run AI Audit</Button>);
    }
    if (d.status === "CAPTURED" && d.paymentError) {
      buttons.push(<Button key="rp" size="xs" variant="warn" loading={busy} onClick={() => h.onPurchase(d)}>Retry Payout</Button>);
    }
  } else {
    if (d.status === "DRAFT") buttons.push(<Button key="c" size="xs" onClick={() => h.onChooseProduct(d)}>Choose Product</Button>);
    if (d.status === "READY_TO_ORDER") buttons.push(<Button key="f" size="xs" loading={busy} onClick={() => h.onFund(d)}>1. Fund Escrow (PayPal)</Button>);
    if (reauth) buttons.push(<Button key="r" size="xs" variant="warn" loading={busy} onClick={() => h.onFund(d)}>Re-Authorize via PayPal</Button>);
    if (d.status === "AUTHORIZED" && !reauth) buttons.push(<Button key="p" size="xs" variant="success" loading={busy} onClick={() => h.onPurchase(d)}>2. Confirm Purchase</Button>);
  }
  if (["PAID_OUT", "CAPTURED", "REFUNDED"].includes(d.status) && !(d.status === "CAPTURED" && d.paymentError)) {
    buttons.push(<Button key="v" size="xs" variant="outline" onClick={() => h.onReceipt(d)}>3. View Receipt</Button>);
  }
  if (buttons.length === 0) buttons.push(<Button key="i" size="xs" variant="ghost" onClick={() => h.onInspect(d.id)}>Details</Button>);
  return <div className="flex flex-col items-start gap-1 py-1">{buttons}</div>;
}

function GroupRowRenderer(p: ICellRendererParams<Row>) {
  const d = p.data as GroupRow | undefined;
  if (!d) return null;
  return (
    <div className="flex h-full items-center gap-3 bg-ink-700/60 px-4 text-xs font-semibold uppercase tracking-wider text-slate-300">
      <Layers className="h-3.5 w-3.5" aria-hidden /> {d.label}
      <span className="font-normal normal-case text-slate-400">
        {d.count} row(s) - {fmtMoney(d.subtotal)}
      </span>
    </div>
  );
}

const refsText = (d: LedgerItem) =>
  [d.paypal.orderId && `Order ${d.paypal.orderId}`, d.paypal.authorizationId && `Auth ${d.paypal.authorizationId}`, d.paypal.captureId && `Capture ${d.paypal.captureId}`, d.paypal.payoutBatchId && `Payout ${d.paypal.payoutBatchId}`]
    .filter(Boolean)
    .join(" | ");

export function EscrowLedgerGrid(props: Props) {
  const { items, selectedId, onAmountEdit } = props;
  const apiRef = useRef<GridApi<Row> | null>(null);
  const [filter, setFilter] = useState("");
  const [grouped, setGrouped] = useState(false);

  const rowData = useMemo<Row[]>(() => {
    if (!grouped) return items as ItemRow[];
    const out: Row[] = [];
    for (const [kind, label] of [["SERVICE", "Service Escrow"], ["PROCUREMENT", "Channel3 Procurement"]] as const) {
      const rows = items.filter((i) => i.kind === kind);
      if (rows.length === 0) continue;
      out.push({ id: `__g_${kind}`, __group: true, label, subtotal: rows.reduce((s, r) => s + r.amount, 0), count: rows.length });
      out.push(...(rows as ItemRow[]));
    }
    return out;
  }, [items, grouped]);

  const pinned = useMemo<TotalRow[]>(() => {
    const authorized = items.filter((i) => ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"].includes(i.status)).reduce((s, i) => s + i.amount, 0);
    const released = items.filter((i) => ["CAPTURED", "PAID_OUT"].includes(i.status)).reduce((s, i) => s + (i.capturedAmount ?? i.amount), 0);
    return [{ id: "__total", __total: true, budget: items.reduce((s, i) => s + i.amount, 0), authorized, released }];
  }, [items]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: "Milestone / Item Name", colId: "name", valueGetter: (p) => (p.data && !p.data.__group && !p.data.__total ? p.data.title : ""), cellRenderer: NameCell, flex: 2.2, minWidth: 250, filter: "agTextColumnFilter" },
      { headerName: "Payee / Merchant", colId: "payee", valueGetter: (p) => (p.data && !p.data.__group && !p.data.__total ? p.data.payee : ""), cellRenderer: PayeeCell, flex: 1.4, minWidth: 170 },
      {
        headerName: "Amount (USD)",
        colId: "amount",
        valueGetter: (p) => (p.data?.__total ? p.data.budget : p.data && !p.data.__group ? p.data.amount : null),
        valueFormatter: (p) => (typeof p.value === "number" ? fmtMoney(p.value) : ""),
        valueParser: (p) => Number(String(p.newValue).replace(/[$,\s]/g, "")),
        valueSetter: () => false,
        editable: (p) => !!p.data && !p.data.__group && !p.data.__total && p.data.kind === "SERVICE" && ["DRAFT", "PENDING_FUNDING"].includes(p.data.status),
        cellClass: "font-semibold tabular-nums",
        type: "numericColumn",
        filter: "agNumberColumnFilter",
        flex: 1,
        minWidth: 120,
        tooltipValueGetter: (p) => (p.data?.__total ? "Total budget" : "Double-click to edit unfunded milestone amounts"),
      },
      { headerName: "Escrow Status", colId: "status", valueGetter: (p) => (p.data && !p.data.__group && !p.data.__total ? STATUS_META[p.data.status].label : ""), cellRenderer: StatusCell, flex: 1.5, minWidth: 190 },
      { headerName: "AI Audit Score", colId: "score", valueGetter: (p) => (p.data && !p.data.__group && !p.data.__total ? p.data.auditScore : null), cellRenderer: ScoreCell, flex: 1, minWidth: 120, filter: "agNumberColumnFilter" },
      { headerName: "PayPal Reference IDs", colId: "refs", valueGetter: (p) => (p.data && !p.data.__group && !p.data.__total ? refsText(p.data) : ""), cellRenderer: RefsCell, flex: 2, minWidth: 250 },
      { headerName: "Actions", colId: "actions", cellRenderer: ActionsCell, flex: 1.6, minWidth: 210, sortable: false, filter: false, pinned: "right" },
    ],
    [],
  );

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.refreshCells({ force: true });
    api.redrawRows();
    const node = selectedId ? api.getRowNode(selectedId) : null;
    if (node) api.ensureNodeVisible(node, "middle");
  }, [items, selectedId, grouped, props.busyIds]);

  const exportCsv = () =>
    apiRef.current?.exportDataAsCsv({
      fileName: `milestoneos-cfo-audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: ["name", "payee", "amount", "status", "score", "refs"],
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Quick search milestones, payees, IDs, statuses..."
            aria-label="Quick search ledger"
            className="w-full rounded-md border border-ink-600 bg-ink-800 py-2 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-pp-blue focus:outline-none"
          />
        </div>
        <Button variant={grouped ? "primary" : "outline"} size="sm" onClick={() => setGrouped((g) => !g)} aria-pressed={grouped}>
          <Layers className="h-3.5 w-3.5" /> Group by type
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> Export CFO Audit Log
        </Button>
      </div>
      <div className="ag-theme-milestone overflow-hidden rounded-xl border border-ink-600/60" style={{ height: Math.min(680, 160 + rowData.length * 106) }}>
        <AgGridReact<Row>
          theme={theme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          getRowId={(p) => p.data.id}
          context={props as LedgerHandlers}
          quickFilterText={filter}
          pinnedBottomRowData={pinned}
          rowHeight={104}
          isFullWidthRow={(p) => !!p.rowNode.data?.__group}
          fullWidthCellRenderer={GroupRowRenderer}
          getRowStyle={(p) => (p.data && p.data.id === selectedId ? { background: "rgba(0,112,186,0.22)", boxShadow: "inset 3px 0 0 #009CDE" } : undefined)}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          onRowClicked={(e) => e.data && !e.data.__group && !e.data.__total && props.onSelect(e.data.id)}
          onCellEditingStopped={(e) => {
            const d = e.data;
            if (!d || d.__group || d.__total || e.colDef.colId !== "amount") return;
            const next = Number(e.newValue);
            const original = items.find((i) => i.id === d.id);
            if (!original || !Number.isFinite(next) || next === original.amount) return;
            void onAmountEdit(original, next);
          }}
          stopEditingWhenCellsLoseFocus
          suppressCellFocus
          tooltipShowDelay={400}
          overlayNoRowsTemplate="No ledger rows yet"
        />
      </div>
    </div>
  );
}
