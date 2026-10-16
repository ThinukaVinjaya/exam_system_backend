export function isValidSriLankanPhone(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // Matches:
  // 0712345678 (10 digits)
  // +94712345678 (12 chars)
  // 94712345678 (11 digits)
  const regex = /^(?:0|94|\+94)?7[0-9]{8}$/;
  return regex.test(cleaned);
}

export function normalizeSriLankanPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+94')) {
    return '0' + cleaned.slice(3);
  }
  if (cleaned.startsWith('94')) {
    return '0' + cleaned.slice(2);
  }
  if (cleaned.startsWith('7') && cleaned.length === 9) {
    return '0' + cleaned;
  }
  return cleaned;
}
