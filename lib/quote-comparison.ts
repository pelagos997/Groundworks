export type ComparableQuote = {
  id: string;
  vendorName: string;
  vendorQuoteRef: string;
  deliveredTotalCents: number;
  earliestDeliveryAt: string;
  validUntil: string;
  status: string;
};

export function rankQuotes<T extends ComparableQuote>(quotes: T[], requiredOnSiteAt: string) {
  const current = quotes.filter((quote) => quote.status === "qualified" && quote.validUntil >= new Date().toISOString());
  const onTime = current.filter((quote) => comparableDate(quote.earliestDeliveryAt) <= comparableDate(requiredOnSiteAt));
  const pool = onTime.length ? onTime : current;
  return [...pool].sort((left, right) => {
    if (left.deliveredTotalCents !== right.deliveredTotalCents) return left.deliveredTotalCents - right.deliveredTotalCents;
    return comparableDate(left.earliestDeliveryAt).localeCompare(comparableDate(right.earliestDeliveryAt));
  });
}

export function quoteSummary<T extends ComparableQuote>(quotes: T[], requiredOnSiteAt: string) {
  const ranked = rankQuotes(quotes, requiredOnSiteAt);
  if (!ranked.length) return "No qualified written quotes are available yet.";
  const best = ranked[0];
  const onTime = comparableDate(best.earliestDeliveryAt) <= comparableDate(requiredOnSiteAt);
  return `${best.vendorName} is the current ${onTime ? "best on-time" : "earliest available"} option at ${formatUsd(best.deliveredTotalCents)} delivered, arrival ${best.earliestDeliveryAt}, quote ${best.vendorQuoteRef}. Approval must repeat the vendor, quote reference, delivered total, and PO number.`;
}

export function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function comparableDate(value: string) {
  return value.replace(/\[[^\]]+\]$/, "");
}
