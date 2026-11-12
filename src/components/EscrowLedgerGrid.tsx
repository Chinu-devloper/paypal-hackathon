"use client";

import { AllCommunityModule, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz, type ColDef, type DataTypeDefinition, type GridApi, type ICellRendererParams, type IHeaderParams, type IRowNode, type PostSortRowsParams, type RowSelectionOptions } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Circle, Columns3, Copy, Download, Filter, Info, Layers, ListFilter, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Pill, ScoreBar } from "./ui";
import { authAgeDays, authNeedsReauth, copyText, fmtDateTime, fmtMoney, STATUS_META } from "@/client/helpers";
import { useTheme } from "@/client/theme";
import { cn } from "@/shared/cn";
import { AUTH_EXPIRY_DAYS, type ItemStatus, type LedgerItem } from "@/shared/types";

ModuleRegistry.registerModules([AllCommunityModule]);

type ItemRow = LedgerItem & { __group?: undefined; __total?: undefined; __detail?: undefined };
interface GroupRow {
  id: string;
  __group: true;
  label: string;
  subtotal: number;
  count: number;
  __total?: undefined;
  __detail?: undefined;
}
interface TotalRow {
  id: string;
  __total: true;
  budget: number;
  authorized: number;
  released: number;
  __group?: undefined;
  __detail?: undefined;
}
/** Full-width row rendered under an expanded ledger row (master/detail without Enterprise). */
interface DetailRow {
  id: string;
  __detail: true;
  item: LedgerItem;
  __group?: undefined;
  __total?: undefined;
}
type Row = ItemRow | GroupRow | TotalRow | DetailRow;

const isItemRow = (d: Row | undefined): d is ItemRow => !!d && !d.__group && !d.__total && !d.__detail;

const DETAIL_HEIGHT = 215;
const ROW_HEIGHT = 104;

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

interface GridContext extends LedgerHandlers {
  expanded: Set<string>;
  onToggleDetail: (id: string) => void;
}

interface Props extends LedgerHandlers {
  items: LedgerItem[];
  selectedId: string | null;
  onAmountEdit: (item: LedgerItem, amount: number) => Promise<void>;
}

const sharedParams = { accentColor: "#0070BA", fontSize: 13, headerFontWeight: 600, borderRadius: 10, wrapperBorderRadius: 0 };

const THEMES = {
  dark: themeQuartz.withPart(colorSchemeDark).withParams({
    ...sharedParams,
    backgroundColor: "#0b1220",
    foregroundColor: "#e5e7eb",
    headerBackgroundColor: "#111a2e",
    oddRowBackgroundColor: "#0d1526",
    rowHoverColor: "rgba(0, 156, 222, 0.08)",
    borderColor: "#26335a",
  }),
  light: themeQuartz.withPart(colorSchemeLight).withParams({
    ...sharedParams,
    backgroundColor: "#ffffff",
    foregroundColor: "#1e293b",
    headerBackgroundColor: "#f1f5fb",
    oddRowBackgroundColor: "#f8fafd",
    rowHoverColor: "rgba(0, 112, 186, 0.06)",
    borderColor: "#dbe4f3",
  }),
};

type Chip = "all" | "held" | "released" | "attention" | "unfunded";

const CHIPS: Array<{ key: Chip; label: string }> = [
  { key: "all", label: "All" },
  { key: "held", label: "In escrow" },
  { key: "released", label: "Released" },
  { key: "attention", label: "Needs attention" },
  { key: "unfunded", label: "Not funded" },
];

const IN_ESCROW: ItemStatus[] = ["AUTHORIZED", "AI_AUDITING"];
const RELEASED: ItemStatus[] = ["CAPTURED", "PAID_OUT"];
const UNFUNDED: ItemStatus[] = ["DRAFT", "PENDING_FUNDING", "READY_TO_ORDER"];

function chipMatches(chip: Chip, i: LedgerItem): boolean {
  switch (chip) {
    case "held":
      return IN_ESCROW.includes(i.status) && !authNeedsReauth(i);
    case "released":
      return RELEASED.includes(i.status) && !i.paymentError;
    case "attention":
      return i.status === "REVISION_NEEDED" || i.status === "SECURITY_FLAGGED" || authNeedsReauth(i) || Boolean(i.paymentError);
    case "unfunded":
      return UNFUNDED.includes(i.status);
    default:
      return true;
  }
}

const TOGGLEABLE_COLUMNS = [
  { id: "payee", label: "Payee / Merchant" },
  { id: "score", label: "AI Audit Score" },
  { id: "refs", label: "PayPal Reference IDs" },
];
const HIDDEN_COLUMNS_KEY = "mos-ledger-hidden-columns";

function handlersOf(p: ICellRendererParams<Row>): GridContext {
  return p.context as GridContext;
}

const USD_TYPE: DataTypeDefinition<Row> = {
  baseDataType: "number",
  extendsDataType: "number",
  valueFormatter: (p) => (typeof p.value === "number" ? fmtMoney(p.value) : ""),
};

const HEADER_INFO = {
  name: "A unit of work (service escrow) or an equipment item sourced through Channel3. Click the arrow to expand it for acceptance criteria and the PayPal escrow timeline.",
  payee: "Who gets paid when the item is released: the freelancer's PayPal email for services, or the merchant for products.",
  amount: "The amount held in PayPal escrow for this item. You can edit it by double-clicking until the item is funded.",
  status: "Where the item sits in the flow: Draft, Authorized (held), AI auditing, Captured, Paid out. Hover a status pill for its exact meaning.",
  score: "The AI auditor's score out of 100. 80 or more releases the funds automatically; 50 to 79 offers a partial settlement; anything lower, or a prompt-injection attempt, keeps the funds locked.",
  refs: "IDs PayPal returned for the order, authorization, capture and payout. Use the copy icon to copy one. Sandbox simulation is marked when no live PayPal call was made.",
  actions: "The next step for this row: 1. Fund, 2. Audit, 3. Receipt. A button only appears when that step is available.",
} as const;

const STATUS_HELP: Record<ItemStatus, string> = {
  DRAFT: "Created but not funded yet.",
  PENDING_FUNDING: "Waiting for the client to authorize payment in PayPal.",
  READY_TO_ORDER: "Product approved; waiting for the PayPal checkout.",
  AUTHORIZED: "Funds are authorized and held in escrow. Nothing has been captured.",
  AI_AUDITING: "The AI auditor is checking the deliverable against the acceptance criteria.",
  REVISION_NEEDED: "Score below 80. Funds stay locked until the listed fixes are made.",
  SECURITY_FLAGGED: "A prompt-injection attempt was detected. Payment is blocked and an alert was logged.",
  CAPTURED: "Audit passed and the held funds were captured.",
  PAID_OUT: "Captured and paid out to the payee.",
  REFUNDED: "The captured payment was refunded.",
  VOIDED: "The authorization was voided and the held funds went back to the client.",
};

/** Tooltip rendered in a portal so the grid header's overflow clipping cannot cut it off. */
function InfoButton({ title, text }: { title: string; text: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: r.bottom + 8 });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`About ${title}`}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) setPos(null);
          else show();
        }}
        onKeyDown={(e) => e.key === "Escape" && setPos(null)}
        className="shrink-0 rounded-full p-0.5 text-slate-500 transition hover:bg-pp-sky/15 hover:text-pp-sky focus:outline-none focus-visible:ring-2 focus-visible:ring-pp-sky"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {pos &&
        createPortal(
          <div id={id} role="tooltip" style={{ left: pos.x, top: pos.y }} className="pointer-events-none fixed z-[80] w-64 -translate-x-1/2 animate-scale-in rounded-xl border border-white/10 bg-ink-900 p-3 text-xs font-normal leading-relaxed text-slate-300 [box-shadow:var(--pop-shadow)]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white">{title}</div>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Column header with sort indicator, an info popover and the filter menu button. */
function InfoHeader(p: IHeaderParams<Row> & { info?: string }) {
  const [sort, setSort] = useState(p.column.getSort());
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setSort(p.column.getSort());
    p.column.addEventListener("sortChanged", update);
    return () => p.column.removeEventListener("sortChanged", update);
  }, [p.column]);
  return (
    <div className="flex w-full items-center gap-1">
      <button type="button" disabled={!p.enableSorting} onClick={(e) => p.progressSort(e.shiftKey)} className="flex min-w-0 items-center gap-1 text-left font-semibold">
        <span className="truncate">{p.displayName}</span>
        {sort === "asc" && <ArrowUp className="h-3 w-3 shrink-0 text-pp-sky" aria-label="sorted ascending" />}
        {sort === "desc" && <ArrowDown className="h-3 w-3 shrink-0 text-pp-sky" aria-label="sorted descending" />}
      </button>
      {p.info && <InfoButton title={p.displayName} text={p.info} />}
      {p.enableFilterButton && (
        <button ref={menuRef} type="button" aria-label={`Filter ${p.displayName}`} onClick={() => menuRef.current && p.showFilter(menuRef.current)} className="ml-auto shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white">
          <ListFilter className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function NameCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!isItemRow(d)) {
    return d?.__total ? <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Totals</span> : null;
  }
  const h = handlersOf(p);
  const open = h.expanded.has(d.id);
  return (
    <div className="flex items-start gap-1.5 py-1 leading-tight">
      <button
        onClick={() => h.onToggleDetail(d.id)}
        aria-expanded={open}
        aria-label={open ? "Collapse milestone details" : "Expand milestone details"}
        className="mt-0.5 rounded p-0.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-90")} aria-hidden />
      </button>
      <div className="flex flex-col items-start gap-1">
        <button className="text-left font-medium text-white hover:text-pp-sky hover:underline" onClick={() => h.onInspect(d.id)}>
          {d.title}
        </button>
        {d.kind === "SERVICE" ? (
          <Pill className="bg-pp-blue/20 text-sky-300 ring-pp-blue/50">SERVICE ESCROW</Pill>
        ) : (
          <Pill className="bg-emerald-500/20 text-emerald-300 ring-emerald-400/40">CHANNEL3 PRODUCT</Pill>
        )}
      </div>
    </div>
  );
}

function PayeeCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!isItemRow(d)) return null;
  return <span className="truncate text-xs text-slate-300">{d.payee}</span>;
}

function StatusCell(p: ICellRendererParams<Row>) {
  const d = p.data;
  if (!d || d.__group || d.__detail) return null;
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
      <span title={STATUS_HELP[d.status]}><Pill className={meta.className}>{meta.label}</Pill></span>
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
  if (!d || !isItemRow(d) || d.auditScore === null) return <span className="text-xs text-slate-500">-</span>;
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
  if (!isItemRow(d)) return null;
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
  if (!isItemRow(d)) return null;
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
  return <div className="flex w-full flex-col items-stretch gap-1.5 py-1 [&>button]:w-full">{buttons}</div>;
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

function Step({ done, title, detail }: { done: boolean; title: string; detail?: string }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", done ? "text-emerald-400" : "text-slate-600")} aria-hidden />
      <div className="min-w-0 leading-tight">
        <div className={cn("text-xs font-medium", done ? "text-white" : "text-slate-500")}>{title}</div>
        {detail && <code className="block truncate font-mono text-[10px] text-slate-400" title={detail}>{detail}</code>}
      </div>
    </li>
  );
}

function DetailRowRenderer(p: ICellRendererParams<Row>) {
  const d = p.data as DetailRow | undefined;
  if (!d) return null;
  const { item, item: { paypal: refs, lastAudit: audit } } = d;
  const results = new Map((audit?.criteria ?? []).map((c) => [c.criterion, c]));
  const expiry = item.authorizationExpiresAt ? fmtDateTime(item.authorizationExpiresAt) : null;

  return (
    <div className="grid h-full grid-cols-1 gap-6 overflow-auto bg-ink-900/40 px-6 py-4 md:grid-cols-3" style={{ boxShadow: "inset 3px 0 0 #009CDE" }}>
      <section aria-label="Acceptance criteria">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Acceptance criteria</h4>
        {item.acceptanceCriteria.length === 0 ? (
          <p className="text-xs text-slate-500">No criteria on this item.</p>
        ) : (
          <ul className="space-y-1.5">
            {item.acceptanceCriteria.map((c) => {
              const r = results.get(c);
              return (
                <li key={c} className="flex items-start gap-2 text-xs leading-snug text-slate-200">
                  {r ? (
                    <span className={cn("mt-px w-9 shrink-0 rounded px-1 text-center text-[10px] font-semibold tabular-nums ring-1 ring-inset", r.pass ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40" : "bg-red-500/15 text-red-300 ring-red-400/40")}>{r.score}</span>
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                  )}
                  <span>{c}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="PayPal escrow timeline">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">PayPal escrow timeline</h4>
        <ol className="space-y-2">
          <Step done={Boolean(refs.orderId)} title="Order created (Orders v2)" detail={refs.orderId} />
          <Step done={Boolean(refs.authorizationId)} title="Funds authorized and held" detail={refs.authorizationId} />
          <Step done={Boolean(audit && audit.verdict === "APPROVED")} title={audit ? `AI audit: ${audit.score}/${audit.threshold} (${audit.verdict.replace("_", " ").toLowerCase()})` : "AI audit"} />
          <Step done={Boolean(refs.captureId)} title="Captured" detail={refs.captureId} />
          <Step done={Boolean(refs.payoutBatchId)} title="Paid out (Payouts)" detail={refs.payoutBatchId} />
        </ol>
        {expiry && !refs.captureId && <p className="mt-2 text-[11px] text-amber-300">Authorization expires {expiry}</p>}
      </section>

      <section aria-label="Audit findings">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Latest audit</h4>
        {!audit ? (
          <p className="text-xs text-slate-500">No deliverable has been audited yet.</p>
        ) : (
          <div className="space-y-2 text-xs text-slate-200">
            <p className="text-[11px] text-slate-400">{fmtDateTime(audit.at)} via {audit.engine}</p>
            {audit.revisionChecklist.length > 0 && (
              <ol className="list-decimal space-y-1 pl-4">
                {audit.revisionChecklist.slice(0, 4).map((r) => <li key={r}>{r}</li>)}
              </ol>
            )}
            {audit.injectionFindings.length > 0 && <p className="text-red-300">Prompt-injection blocked: {audit.injectionFindings.length} finding(s).</p>}
            {audit.settlementOffer && <p className="text-violet-300">Settlement offer: {fmtMoney(audit.settlementOffer.amount)} now, {fmtMoney(audit.settlementOffer.holdback)} back to client.</p>}
            {audit.verdict === "APPROVED" && <p className="text-emerald-300">Approved for autonomous release.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function FullWidthRenderer(p: ICellRendererParams<Row>) {
  return p.data?.__detail ? <DetailRowRenderer {...p} /> : <GroupRowRenderer {...p} />;
}

const refsText = (d: LedgerItem) =>
  [d.paypal.orderId && `Order ${d.paypal.orderId}`, d.paypal.authorizationId && `Auth ${d.paypal.authorizationId}`, d.paypal.captureId && `Capture ${d.paypal.captureId}`, d.paypal.payoutBatchId && `Payout ${d.paypal.payoutBatchId}`]
    .filter(Boolean)
    .join(" | ");

export function EscrowLedgerGrid(props: Props) {
  const { items, selectedId, onAmountEdit } = props;
  const apiRef = useRef<GridApi<Row> | null>(null);
  const theme = useTheme();
  const [filter, setFilter] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [chip, setChip] = useState<Chip>("all");
  const [hidden, setHidden] = useState<string[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [floatingFilters, setFloatingFilters] = useState(false);
  const [picked, setPicked] = useState<LedgerItem[]>([]);
  const chipRef = useRef(chip);
  chipRef.current = chip;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setHidden(stored.filter((s): s is string => typeof s === "string"));
    } catch {
      // Ignore corrupt saved layout and keep every column visible.
    }
  }, []);

  const toggleColumn = (id: string) =>
    setHidden((cur) => {
      const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
      window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(next));
      return next;
    });

  const chipCounts = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.key, items.filter((i) => chipMatches(c.key, i)).length])) as Record<Chip, number>, [items]);

  const doesExternalFilterPass = (node: IRowNode<Row>) => {
    const d = node.data;
    if (!d || d.__total) return true;
    if (d.__group) {
      const kind = d.id.replace("__g_", "");
      return itemsRef.current.some((i) => i.kind === kind && chipMatches(chipRef.current, i));
    }
    if (d.__detail) return chipMatches(chipRef.current, d.item);
    return chipMatches(chipRef.current, d);
  };

  useEffect(() => {
    apiRef.current?.onFilterChanged();
  }, [chip, items]);

  const toggleDetail = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rowData = useMemo<Row[]>(() => {
    const withDetail = (rows: ItemRow[]): Row[] => rows.flatMap((r): Row[] => (expanded.has(r.id) ? [r, { id: `${r.id}__detail`, __detail: true, item: r }] : [r]));
    if (!grouped) return withDetail(items as ItemRow[]);
    const out: Row[] = [];
    for (const [kind, label] of [["SERVICE", "Service Escrow"], ["PROCUREMENT", "Channel3 Procurement"]] as const) {
      const rows = items.filter((i) => i.kind === kind);
      if (rows.length === 0) continue;
      out.push({ id: `__g_${kind}`, __group: true, label, subtotal: rows.reduce((s, r) => s + r.amount, 0), count: rows.length });
      out.push(...withDetail(rows as ItemRow[]));
    }
    return out;
  }, [items, grouped, expanded]);

  // Keep every detail row glued under its parent after the user sorts.
  const postSortRows = (p: PostSortRowsParams<Row>) => {
    const details = new Map<string, IRowNode<Row>>();
    const rest: IRowNode<Row>[] = [];
    for (const n of p.nodes) {
      if (n.data?.__detail) details.set(n.data.item.id, n);
      else rest.push(n);
    }
    if (details.size === 0) return;
    p.nodes.splice(0, p.nodes.length, ...rest.flatMap((n) => {
      const d = n.data && isItemRow(n.data) ? details.get(n.data.id) : undefined;
      return d ? [n, d] : [n];
    }));
  };

  const pinned = useMemo<TotalRow[]>(() => {
    const authorized = items.filter((i) => ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"].includes(i.status)).reduce((s, i) => s + i.amount, 0);
    const released = items.filter((i) => ["CAPTURED", "PAID_OUT"].includes(i.status)).reduce((s, i) => s + (i.capturedAmount ?? i.amount), 0);
    return [{ id: "__total", __total: true, budget: items.reduce((s, i) => s + i.amount, 0), authorized, released }];
  }, [items]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: "Milestone / Item Name", colId: "name", headerComponentParams: { info: HEADER_INFO.name }, valueGetter: (p) => (isItemRow(p.data) ? p.data.title : ""), cellRenderer: NameCell, flex: 2.2, minWidth: 250, filter: "agTextColumnFilter" },
      { headerName: "Payee / Merchant", colId: "payee", headerComponentParams: { info: HEADER_INFO.payee }, hide: hidden.includes("payee"), valueGetter: (p) => (isItemRow(p.data) ? p.data.payee : ""), cellRenderer: PayeeCell, flex: 1.4, minWidth: 170 },
      {
        headerName: "Amount (USD)",
        colId: "amount",
        headerComponentParams: { info: HEADER_INFO.amount },
        cellDataType: "usd",
        valueGetter: (p) => (p.data?.__total ? p.data.budget : isItemRow(p.data) ? p.data.amount : null),
        valueParser: (p) => Number(String(p.newValue).replace(/[$,\s]/g, "")),
        valueSetter: () => false,
        editable: (p) => isItemRow(p.data) && p.data.kind === "SERVICE" && ["DRAFT", "PENDING_FUNDING"].includes(p.data.status),
        cellClass: "font-semibold tabular-nums",
        type: "numericColumn",
        filter: "agNumberColumnFilter",
        flex: 1,
        minWidth: 160,
        tooltipValueGetter: (p) => (p.data?.__total ? "Total budget" : "Double-click to edit unfunded milestone amounts"),
      },
      { headerName: "Escrow Status", colId: "status", headerComponentParams: { info: HEADER_INFO.status }, valueGetter: (p) => (isItemRow(p.data) ? STATUS_META[p.data.status].label : ""), cellRenderer: StatusCell, flex: 1.5, minWidth: 190 },
      { headerName: "AI Audit Score", colId: "score", headerComponentParams: { info: HEADER_INFO.score }, hide: hidden.includes("score"), valueGetter: (p) => (isItemRow(p.data) ? p.data.auditScore : null), cellRenderer: ScoreCell, flex: 1, minWidth: 160, filter: "agNumberColumnFilter" },
      { headerName: "PayPal Reference IDs", colId: "refs", headerComponentParams: { info: HEADER_INFO.refs }, hide: hidden.includes("refs"), valueGetter: (p) => (isItemRow(p.data) ? refsText(p.data) : ""), cellRenderer: RefsCell, flex: 2, minWidth: 250 },
      { headerName: "Actions", colId: "actions", headerComponentParams: { info: HEADER_INFO.actions }, cellRenderer: ActionsCell, flex: 1.6, minWidth: 210, sortable: false, filter: false, pinned: "right" },
    ],
    [hidden],
  );

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.refreshCells({ force: true });
    api.redrawRows();
    const node = selectedId ? api.getRowNode(selectedId) : null;
    if (node) api.ensureNodeVisible(node, "middle");
  }, [items, selectedId, grouped, expanded, props.busyIds]);

  const exportCsv = (onlySelected = false) =>
    apiRef.current?.exportDataAsCsv({
      fileName: `milestoneos-${onlySelected ? "selection" : "cfo-audit-log"}-${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: ["name", "payee", "amount", "status", "score", "refs"],
      onlySelected,
    });

  const rowSelection = useMemo<RowSelectionOptions<Row>>(
    () => ({ mode: "multiRow", enableClickSelection: false, selectAll: "filtered", hideDisabledCheckboxes: true, isRowSelectable: (n) => isItemRow(n.data) }),
    [],
  );
  const dataTypeDefinitions = useMemo(() => ({ usd: USD_TYPE }), []);
  const context: GridContext = { ...props, expanded, onToggleDetail: toggleDetail };

  const visible = items.filter((i) => chipMatches(chip, i));
  const expandedVisible = visible.filter((i) => expanded.has(i.id)).length;
  const gridHeight = Math.min(860, 170 + (visible.length + (grouped ? 2 : 0)) * (ROW_HEIGHT + 2) + expandedVisible * DETAIL_HEIGHT);
  const pickedTotal = picked.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Quick search milestones, payees, IDs, statuses..."
            aria-label="Quick search ledger"
            className="w-full rounded-lg border border-white/10 bg-ink-800/70 py-2 pl-9 pr-3 text-sm text-white backdrop-blur placeholder:text-slate-500 transition focus:border-pp-sky focus:outline-none focus:ring-2 focus:ring-pp-sky/30"
          />
        </div>
        <Button variant={grouped ? "primary" : "outline"} size="sm" onClick={() => setGrouped((g) => !g)} aria-pressed={grouped}>
          <Layers className="h-3.5 w-3.5" /> Group by type
        </Button>
        <div className="relative">
          <Button variant={showColumns ? "primary" : "outline"} size="sm" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns} aria-haspopup="menu">
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </Button>
          {showColumns && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-56 animate-scale-in rounded-xl border border-white/10 bg-ink-900/95 p-2 text-xs backdrop-blur-xl [box-shadow:var(--pop-shadow)]">
              {TOGGLEABLE_COLUMNS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-slate-200 hover:bg-white/10">
                  <input type="checkbox" className="accent-sky-500" checked={!hidden.includes(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}
                </label>
              ))}
              <button
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setHidden([]);
                  window.localStorage.removeItem(HIDDEN_COLUMNS_KEY);
                }}
              >
                <RotateCcw className="h-3 w-3" /> Reset layout
              </button>
            </div>
          )}
        </div>
        <Button variant={floatingFilters ? "primary" : "outline"} size="sm" onClick={() => setFloatingFilters((v) => !v)} aria-pressed={floatingFilters}>
          <Filter className="h-3.5 w-3.5" /> Column filters
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportCsv()}>
          <Download className="h-3.5 w-3.5" /> Export CFO Audit Log
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter ledger by state">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            aria-pressed={chip === c.key}
            onClick={() => setChip(c.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition duration-200 active:scale-95",
              chip === c.key ? "border-pp-sky/60 bg-pp-sky/15 text-sky-300" : "border-white/10 text-slate-400 hover:border-white/25 hover:text-white",
            )}
          >
            {c.label}
            <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", chip === c.key ? "bg-pp-sky/25" : "bg-white/10")}>{chipCounts[c.key]}</span>
          </button>
        ))}
      </div>
      {picked.length > 0 && (
        <div className="flex animate-fade-up flex-wrap items-center gap-3 rounded-xl border border-pp-sky/30 bg-pp-sky/10 px-4 py-2 text-xs text-slate-200" role="status">
          <span className="font-semibold text-white">{picked.length} selected</span>
          <span>Total <b className="tabular-nums text-sky-300">{fmtMoney(pickedTotal)}</b></span>
          <span className="ml-auto flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={() => exportCsv(true)}><Download className="h-3 w-3" /> Export selected</Button>
            <Button size="xs" variant="ghost" onClick={() => apiRef.current?.deselectAll()}><X className="h-3 w-3" /> Clear</Button>
          </span>
        </div>
      )}
      <div className="ag-theme-milestone overflow-hidden rounded-2xl border border-white/10 [box-shadow:var(--card-shadow)]" style={{ height: gridHeight }}>
        <AgGridReact<Row>
          theme={THEMES[theme]}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: floatingFilters, enableCellChangeFlash: true, headerComponent: InfoHeader }}
          dataTypeDefinitions={dataTypeDefinitions}
          rowSelection={rowSelection}
          onSelectionChanged={(e) => setPicked(e.api.getSelectedRows().filter(isItemRow))}
          postSortRows={postSortRows}
          getRowId={(p) => p.data.id}
          context={context}
          quickFilterText={filter}
          isExternalFilterPresent={() => chipRef.current !== "all"}
          doesExternalFilterPass={doesExternalFilterPass}
          pinnedBottomRowData={pinned}
          getRowHeight={(p) => (p.data?.__detail ? DETAIL_HEIGHT : ROW_HEIGHT)}
          isFullWidthRow={(p) => !!p.rowNode.data?.__group || !!p.rowNode.data?.__detail}
          fullWidthCellRenderer={FullWidthRenderer}
          getRowStyle={(p) => (p.data && p.data.id === selectedId ? { background: "rgba(0,112,186,0.22)", boxShadow: "inset 3px 0 0 #009CDE" } : undefined)}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          onRowClicked={(e) => isItemRow(e.data) && props.onSelect(e.data.id)}
          onCellEditingStopped={(e) => {
            const d = e.data;
            if (!isItemRow(d) || e.colDef.colId !== "amount") return;
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
