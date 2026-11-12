"use client";

import dynamic from "next/dynamic";
import { Component, useState, type ReactNode } from "react";
import { MilestoneTimeline } from "./MilestoneTimeline";
import { Banner } from "./ui";
import type { LedgerItem } from "@/shared/types";

interface Props {
  items: LedgerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onFund: (item: LedgerItem) => void;
  onAudit: (item: LedgerItem) => void;
  onReceipt: (item: LedgerItem) => void;
}

const BryntumTimeline = dynamic(() => import("./BryntumTimeline"), {
  ssr: false,
  loading: () => <div className="flex h-[560px] items-center justify-center text-sm text-slate-400">Loading Bryntum Gantt...</div>,
});

class Boundary extends Component<{ onFail: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onFail(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Bryntum Gantt with the built-in timeline as a fallback if the library fails to load or render. */
export function TimelineView(props: Props) {
  const [failure, setFailure] = useState<string | null>(null);
  const fail = (e: unknown) => setFailure(e instanceof Error ? e.message : "Bryntum Gantt could not be loaded");

  if (failure) {
    return (
      <div className="flex flex-col gap-3">
        <Banner tone="warn">Bryntum Gantt unavailable ({failure}). Showing the built-in timeline.</Banner>
        <MilestoneTimeline {...props} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-400">
        Bryntum Gantt: milestone schedule, finish-to-start dependencies, PayPal payment-unlock milestones and authorization-expiry deadlines. Click a task to inspect it, or right-click it to fund escrow, run the AI audit or open the receipt.
      </p>
      <Boundary onFail={fail}>
        <BryntumTimeline {...props} onError={fail} />
      </Boundary>
    </div>
  );
}
