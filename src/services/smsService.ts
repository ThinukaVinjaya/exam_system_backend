import { logger } from '../utils/logger.js';

/**
 * Message sender is disabled for this platform.
 * All functions return safe no-op results without connecting to external SMS gateways.
 */

export function formatPhoneForTextLk(phone?: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-()+]/g, '');
  if (cleaned.startsWith('07') && cleaned.length === 10) return '94' + cleaned.slice(1);
  if (cleaned.startsWith('947') && cleaned.length === 11) return cleaned;
  if (cleaned.startsWith('7') && cleaned.length === 9) return '94' + cleaned;
  if (/^94[0-9]{9}$/.test(cleaned)) return cleaned;
  return null;
}

export async function sendSingleSms(
  recipientPhone: string,
  messageText: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  logger.info(`[SMS] Message sender is disabled. Message skipped for ${recipientPhone}.`);
  return { success: true, data: { status: 'disabled' } };
}

export function buildMcqRankSmsMessage(params: any): string {
  return '';
}

export function buildFullPaperRankSmsMessage(params: any): string {
  return '';
}

export async function sendQuizTop100Sms(
  quizId: any,
  force = false
): Promise<{ sentCount: number; failedCount: number; skippedCount: number; totalCandidates: number }> {
  logger.info(`[SMS] Automated message sender is disabled.`);
  return { sentCount: 0, failedCount: 0, skippedCount: 0, totalCandidates: 0 };
}

export async function sendFullPaperTop100Sms(
  quizId: any,
  force = false
): Promise<{ sentCount: number; failedCount: number; skippedCount: number; totalCandidates: number }> {
  logger.info(`[SMS] Automated message sender is disabled.`);
  return { sentCount: 0, failedCount: 0, skippedCount: 0, totalCandidates: 0 };
}

export async function sendSampleRealSms(
  phoneNumber: string,
  options?: any
): Promise<{ success: boolean; messageText: string; data?: any; error?: string }> {
  return {
    success: true,
    messageText: 'Message sender is disabled.',
    data: { status: 'disabled' },
  };
}

export async function getTextLkBalance(): Promise<any> {
  return {
    status: 'disabled',
    balance: 0,
    currency: 'LKR',
  };
}
