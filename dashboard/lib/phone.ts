// Pretty-print a stored phone number for display.
//
// Numbers are stored raw (e.g. "919372515088") — a variable-length country
// code followed by the 10-digit local number. We always treat the last 10
// digits as the local number (grouped 5 + space + 5) and whatever precedes
// them as the country code, shown with a leading "+". This keeps the grouping
// correct regardless of how many digits the country code has.
export function formatPhone(raw: string): string {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return raw.trim(); // too short to group — leave as-is
  const local = digits.slice(-10);
  const cc = digits.slice(0, -10); // "" when the number is exactly 10 digits
  const grouped = `${local.slice(0, 5)} ${local.slice(5)}`;
  return cc ? `+${cc} ${grouped}` : grouped;
}
