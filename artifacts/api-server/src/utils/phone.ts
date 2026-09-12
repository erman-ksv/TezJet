export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (digits.startsWith("8") && digits.length === 11) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.startsWith("7")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("7")) {
    const local = digits.slice(1);
    return `+7 ${local.slice(0, 3)} *** ** ${local.slice(-2)}`;
  }

  return normalized.length > 4
    ? `${normalized.slice(0, 3)} *** ** ${normalized.slice(-2)}`
    : "***";
}