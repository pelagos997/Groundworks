export type PurchaseApprovalCommand = {
  quoteRef: string | null;
  deliveredTotalCents: number | null;
  poNumber: string | null;
  explicitRelease: boolean;
};

export function isQuoteStatusIntent(text: string) {
  return /\b(quote status|quotes? (?:are )?(?:back|received|ready)|best quote|vendor update|procurement status)\b/i.test(text);
}

export function isPurchaseApprovalIntent(text: string) {
  return /\b(approve|release|place)\b/i.test(text) && /\b(quote|purchase order|PO[-\s#])\b/i.test(text);
}

export function parsePurchaseApproval(text: string): PurchaseApprovalCommand {
  const quote = text.match(/\bquote(?:\s+(?:reference|ref|number|#))?[\s:#-]*([A-Z0-9][A-Z0-9-]{1,40})\b/i);
  const po = text.match(/\b(PO[-A-Z0-9]{3,32})\b/i);
  const money = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return {
    quoteRef: quote?.[1]?.toUpperCase() ?? null,
    deliveredTotalCents: money ? Math.round(Number(money[1].replaceAll(",", "")) * 100) : null,
    poNumber: po?.[1]?.toUpperCase() ?? null,
    explicitRelease: /\b(release|place)\s+(?:the\s+)?(?:purchase order|order|PO)\b/i.test(text),
  };
}
