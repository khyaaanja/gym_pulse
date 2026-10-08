/**
 * Nepal phone normalisation.
 * Mobile: 10 digits starting 96/97/98 (NTC, Ncell, SmartCell…). Landline: area code + number (e.g. 01-4XXXXXX).
 * Returns E.164-less local form ("98XXXXXXXX") or null when the value can't be a Nepal number.
 */
export function normalizeNepalPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00977")) digits = digits.slice(5);
  else if (digits.startsWith("977") && digits.length > 10) digits = digits.slice(3);
  digits = digits.replace(/\D/g, "");
  if (/^9[678]\d{8}$/.test(digits)) return digits;
  // Landlines: 0 + area code (1–2 digits) + 6–7 digit number
  if (/^0\d{7,9}$/.test(digits)) return digits;
  return null;
}

export function isNepalMobile(phone: string | null | undefined): boolean {
  return !!phone && /^9[678]\d{8}$/.test(phone);
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone.length > 4 ? `${phone.slice(0, 3)}${"•".repeat(Math.max(0, phone.length - 5))}${phone.slice(-2)}` : phone;
}

export function whatsappLink(phone: string, message: string): string | null {
  if (!isNepalMobile(phone)) return null;
  return `https://wa.me/977${phone}?text=${encodeURIComponent(message)}`;
}
