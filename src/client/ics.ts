import type { LedgerItem } from "@/shared/types";

const CRLF = "\r\n";

/** RFC 5545 text escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets must be folded. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  out.push(rest);
  return out.join(CRLF);
}

const compact = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso: string) => new Date(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** An .ics payment calendar: every milestone window, its PayPal payment-unlock day and each authorization expiry. */
export function buildIcs(projectTitle: string, items: LedgerItem[], now = new Date()): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PayPal MilestoneOS//Escrow schedule//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`${projectTitle} - escrow schedule`)}`];
  const event = (uid: string, start: string, end: string, summary: string, description: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@milestoneos`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(end)}`, `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(description)}`, "END:VEVENT");
  };
  for (const item of items) {
    const label = item.kind === "PROCUREMENT" ? "Equipment" : "Milestone";
    event(`${item.id}-work`, item.startDate, nextDay(item.endDate), `${label}: ${item.title}`, `$${item.amount.toFixed(2)} held in PayPal escrow. Status: ${item.status}.`);
    event(`${item.id}-unlock`, nextDay(item.endDate), nextDay(nextDay(item.endDate)), `Payment unlock: $${item.amount.toFixed(2)} for ${item.title}`, "Funds are released after the AI audit passes.");
    if (item.authorizationExpiresAt) {
      event(`${item.id}-auth`, item.authorizationExpiresAt, nextDay(item.authorizationExpiresAt), `PayPal authorization expires: ${item.title}`, "Capture or re-authorize before this date.");
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}
