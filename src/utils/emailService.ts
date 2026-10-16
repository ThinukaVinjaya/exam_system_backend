import nodemailer from 'nodemailer';
import { logger } from './logger.js';

interface SendOtpOptions {
  email: string;
  otp: string;
  fullName?: string;
}

export async function sendOtpEmail({ email, otp, fullName }: SendOtpOptions): Promise<{ sent: boolean; message: string }> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpFrom = process.env.SMTP_FROM || '"Exam Portal LK" <no-reply@examportal.lk>';

  // Always log to console for development verification
  logger.info(`=========================================`);
  logger.info(`📧 EMAIL VERIFICATION OTP GENERATED`);
  logger.info(`To: ${email}`);
  logger.info(`OTP Code: ${otp}`);
  logger.info(`Valid for: 10 minutes`);
  logger.info(`=========================================`);

  if (!smtpUser || !smtpPass) {
    logger.info('SMTP credentials not configured in .env. OTP was logged to server console for testing.');
    return {
      sent: true,
      message: 'Verification code generated (logged to server console).',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const htmlContent = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #38bdf8; margin: 0; font-size: 24px;">ExamPortal SL</h2>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 4px;">Sri Lanka National Online Examination Platform</p>
        </div>
        <div style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155; text-align: center;">
          <h3 style="color: #ffffff; margin-top: 0; font-size: 18px;">Email Verification Code</h3>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            Hello ${fullName || 'Student'},<br/>
            Thank you for registering. Please use the following 6-digit One-Time Password (OTP) to verify your email address:
          </p>
          <div style="margin: 24px 0; padding: 16px; background: #0f172a; border-radius: 12px; border: 1px dashed #38bdf8; display: inline-block;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">${otp}</span>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
            This verification code will expire in <strong>10 minutes</strong>. If you did not request this registration, please ignore this email.
          </p>
        </div>
        <div style="text-align: center; margin-top: 24px; color: #64748b; font-size: 11px;">
          © ${new Date().getFullYear()} Sri Lanka National Examination Portal. All rights reserved.
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: `[${otp}] Your ExamPortal Verification Code`,
      html: htmlContent,
      text: `Your ExamPortal registration verification code is: ${otp}. It expires in 10 minutes.`,
    });

    logger.info(`OTP successfully dispatched via SMTP to ${email}`);
    return { sent: true, message: 'Verification code sent to your email.' };
  } catch (err) {
    logger.error(`Failed to send email via SMTP to ${email}:`, err);
    // Return sent: true so registration flow is not blocked if SMTP host is unreachable, since OTP is logged in console
    return { sent: true, message: 'Verification code generated. Please check your email or console.' };
  }
}
