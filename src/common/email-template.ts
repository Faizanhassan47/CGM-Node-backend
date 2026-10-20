import { CIRCLE_MARK_PNG_BASE64 } from "./circle-logo-base64";

/** Email-safe Circle templates using table layouts and inline styles. */
function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return value.replace(/[&<>'"]/g, (character) => entities[character]);
}

function emailShell(params: {
  previewText: string;
  title: string;
  subtitle: string;
  body: string;
  footer: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>${params.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#FCFAF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${params.previewText}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#FCFAF9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#FFFFFF;border:1px solid #F0E7E4;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(29,27,26,0.08);">
          <tr>
            <td align="center" style="background-color:#FF5A43;padding:30px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" valign="middle" style="width:72px;height:72px;background-color:#FFFFFF;border-radius:36px;padding:6px;box-sizing:border-box;">
                    <img src="${CIRCLE_MARK_PNG_BASE64}" alt="Circle" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:28px;object-fit:contain;margin:0 auto;" />
                  </td>
                </tr>
              </table>
              <h1 style="margin:16px 0 6px;color:#FFFFFF;font-size:24px;line-height:1.25;font-weight:750;letter-spacing:-0.3px;">${params.title}</h1>
              <p style="margin:0;color:#FFF3F0;font-size:13px;line-height:1.5;">${params.subtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 26px;">${params.body}</td>
          </tr>
          <tr>
            <td align="center" style="background-color:#FCFAF9;padding:20px 28px;border-top:1px solid #F0E7E4;">
              <p style="margin:0 0 4px;color:#8C8481;font-size:12px;line-height:1.5;">&copy; ${new Date().getFullYear()} Circle CGM Systems. All rights reserved.</p>
              <p style="margin:0;color:#A69E9B;font-size:11px;line-height:1.5;">${params.footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function buildPasswordResetEmailHtml(params: {
  otp: string;
  recipientEmail: string;
  expiresInMinutes?: number;
}): string {
  const expiresInMinutes = params.expiresInMinutes ?? 15;
  const safeOtp = escapeHtml(params.otp);
  const safeRecipientEmail = escapeHtml(params.recipientEmail);

  return emailShell({
    previewText: `Your Circle verification code is ${safeOtp}.`,
    title: "Reset your password",
    subtitle: "Secure account verification",
    footer: "This is an automated security email. Please do not reply.",
    body: `
      <p style="margin:0 0 14px;color:#1D1B1A;font-size:16px;line-height:1.6;font-weight:650;">Hello,</p>
      <p style="margin:0 0 24px;color:#6F6764;font-size:14px;line-height:1.65;">We received a request to reset the password for the Circle account linked to <strong style="color:#1D1B1A;">${safeRecipientEmail}</strong>. Enter the verification code below in the Circle app.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
        <tr>
          <td align="center" style="background-color:#FFF3F0;border:2px dashed #FF8065;border-radius:12px;padding:22px 16px;">
            <p style="margin:0 0 8px;color:#D93F2E;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:1.5px;">Verification code</p>
            <p style="margin:0;color:#1D1B1A;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;line-height:1.2;font-weight:800;letter-spacing:10px;padding-left:10px;">${safeOtp}</p>
            <p style="display:inline-block;margin:12px 0 0;background-color:#FFE5E0;color:#D93F2E;font-size:11px;font-weight:650;padding:5px 11px;border-radius:12px;">Expires in ${expiresInMinutes} minutes</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 18px;color:#6F6764;font-size:13px;line-height:1.65;">Never share this code. Circle support will never ask for your password or verification code.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFF9E6;border-left:3px solid #EAB308;border-radius:4px;">
        <tr><td style="padding:12px 14px;color:#7A5700;font-size:12px;line-height:1.55;"><strong>Did not request this?</strong> You can safely ignore this email. Your current password remains active.</td></tr>
      </table>`,
  });
}

export function buildWelcomeEmailHtml(params: {
  fullName: string;
  recipientEmail: string;
  familyCode: string;
}): string {
  const safeFullName = escapeHtml(params.fullName);
  const safeRecipientEmail = escapeHtml(params.recipientEmail);
  const safeFamilyCode = escapeHtml(params.familyCode);

  return emailShell({
    previewText: "Your Circle account is ready.",
    title: "Welcome to Circle",
    subtitle: "Continuous glucose monitoring, connected care",
    footer: "You received this email because you created a Circle account.",
    body: `
      <h2 style="margin:0 0 12px;color:#1D1B1A;font-size:19px;line-height:1.4;font-weight:750;">Hi ${safeFullName},</h2>
      <p style="margin:0 0 22px;color:#6F6764;font-size:14px;line-height:1.65;">Your Circle account for <strong style="color:#1D1B1A;">${safeRecipientEmail}</strong> is ready. Connect your CGM sensor to begin viewing glucose readings and alerts.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
        <tr>
          <td align="center" style="background-color:#FFF3F0;border:2px dashed #FF8065;border-radius:12px;padding:22px 18px;">
            <p style="margin:0 0 7px;color:#D93F2E;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:1.4px;">Family and caregiver code</p>
            <p style="margin:0;color:#1D1B1A;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:31px;line-height:1.3;font-weight:800;letter-spacing:6px;">${safeFamilyCode}</p>
            <p style="margin:10px auto 0;max-width:410px;color:#6F6764;font-size:12px;line-height:1.55;">Share this code only with trusted family members, clinicians, or caregivers you want to invite to your Family Circle.</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background-color:#FCFAF9;border:1px solid #F0E7E4;border-radius:10px;">
        <tr><td style="padding:18px 20px;">
          <p style="margin:0 0 10px;color:#1D1B1A;font-size:14px;font-weight:750;">Get started</p>
          <p style="margin:0 0 8px;color:#6F6764;font-size:13px;line-height:1.55;"><strong style="color:#1D1B1A;">1. Connect your sensor:</strong> Enable Bluetooth and follow the in-app pairing steps.</p>
          <p style="margin:0 0 8px;color:#6F6764;font-size:13px;line-height:1.55;"><strong style="color:#1D1B1A;">2. Set your ranges:</strong> Review your low and high glucose alert thresholds.</p>
          <p style="margin:0;color:#6F6764;font-size:13px;line-height:1.55;"><strong style="color:#1D1B1A;">3. Invite trusted people:</strong> Share your code when you are ready.</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">
        <tr><td style="padding:12px 14px;color:#166534;font-size:12px;line-height:1.55;"><strong>Need help?</strong> Contact Circle support for assistance with account setup or sensor pairing.</td></tr>
      </table>`,
  });
}
