/**
 * Payment numbering: 1st payment on bill "1500" → "1500";
 * 2nd → "1500-1"; 3rd → "1500-2"; same for INS-JAN → INS-JAN-1, etc.
 * `priorPaymentCount` = number of payments already applied to this bill before this one.
 */
export function paymentNumberForBill(
  billRef: string,
  priorPaymentCount: number,
): string {
  const ref = billRef.trim()
  if (!ref) return 'PAY'
  const n = priorPaymentCount + 1
  if (n <= 1) return ref
  return `${ref}-${n - 1}`
}
