/**
 * Generates responsive, medical-grade branded HTML email templates for Aima.
 */
export function buildPasswordResetEmailHtml(params: {
  otp: string;
  recipientEmail: string;
  expiresInMinutes?: number;
}): string {
  const { otp, recipientEmail, expiresInMinutes = 15 } = params;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Aima Password Reset Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8F9FE; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F8F9FE; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #FFFFFF; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 20px rgba(94, 53, 177, 0.08); border: 1px solid #ECEAF4;" cellspacing="0" cellpadding="0">
          
          <!-- Top Gradient Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #5E35B1 0%, #7E57C2 100%); padding: 32px 24px; text-align: center;">
              <table role="presentation" align="center" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 56px; height: 56px; background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; text-align: center; vertical-align: middle;">
                    <span style="font-size: 26px; line-height: 56px;">🔒</span>
                  </td>
                </tr>
              </table>
              <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 16px 0 6px 0; letter-spacing: -0.3px;">
                Reset Your Password
              </h1>
              <p style="color: rgba(255, 255, 255, 0.9); font-size: 13px; margin: 0;">
                Aima
              </p>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 32px 28px 24px 28px;">
              <p style="color: #2D3436; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello,
              </p>
              <p style="color: #636E72; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                We received a request to reset the password for your Aima account linked to <strong style="color: #2D3436;">${recipientEmail}</strong>. Use the 6-digit verification code below to proceed:
              </p>

              <!-- 6-Digit OTP Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td align="center" style="background-color: #F7F5FC; border: 2px dashed #7E57C2; border-radius: 14px; padding: 22px 16px;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #5E35B1; margin-bottom: 8px;">
                      Verification Code
                    </div>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #3B2A68; padding-left: 10px;">
                      ${otp}
                    </div>
                    <div style="margin-top: 10px;">
                      <span style="display: inline-block; background-color: #ECE7F8; color: #5E35B1; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 12px;">
                        ⏱️ Expires in ${expiresInMinutes} minutes
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Instructions -->
              <p style="color: #636E72; font-size: 13.5px; line-height: 1.6; margin: 0 0 18px 0;">
                Enter this code in your Aima mobile application to create a new password. For security, never share this code with anyone.
              </p>

              <!-- Security Notice Callout -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FFF9E6; border-left: 3px solid #F1C40F; border-radius: 4px; padding: 12px 14px; margin: 0 0 20px 0;">
                <tr>
                  <td style="color: #7F6000; font-size: 12px; line-height: 1.5;">
                    <strong>Didn't request this?</strong> If you did not ask to reset your password, you can safely ignore this email. Your current password remains active.
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFAFD; padding: 20px 28px; border-top: 1px solid #ECEAF4; text-align: center;">
              <p style="color: #A0AEC0; font-size: 12px; line-height: 1.5; margin: 0 0 4px 0;">
                &copy; ${new Date().getFullYear()} Aima CGM Systems. All rights reserved.
              </p>
              <p style="color: #B2BEC3; font-size: 11px; margin: 0;">
                This is an automated security email. Please do not reply directly.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generates responsive branded Welcome Email for newly registered patients.
 */
export function buildWelcomeEmailHtml(params: {
  fullName: string;
  recipientEmail: string;
  familyCode: string;
}): string {
  const { fullName, recipientEmail, familyCode } = params;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Aima</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8F9FE; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F8F9FE; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #FFFFFF; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 20px rgba(94, 53, 177, 0.08); border: 1px solid #ECEAF4;" cellspacing="0" cellpadding="0">
          
          <!-- Top Gradient Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #5E35B1 0%, #7E57C2 100%); padding: 36px 24px; text-align: center;">
              <table role="presentation" align="center" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 60px; height: 60px; background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; text-align: center; vertical-align: middle;">
                    <span style="font-size: 30px; line-height: 60px;">🩸</span>
                  </td>
                </tr>
              </table>
              <h1 style="color: #FFFFFF; font-size: 24px; font-weight: 700; margin: 16px 0 6px 0; letter-spacing: -0.3px;">
                Welcome to Aima!
              </h1>
              <p style="color: rgba(255, 255, 255, 0.9); font-size: 14px; margin: 0;">
                Your Connected Continuous Glucose Monitoring Platform
              </p>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 32px 28px 24px 28px;">
              <h2 style="color: #2D3436; font-size: 18px; font-weight: 700; margin: 0 0 12px 0;">
                Hi ${fullName},
              </h2>
              <p style="color: #636E72; font-size: 14.5px; line-height: 1.6; margin: 0 0 20px 0;">
                Thank you for joining Aima. Your account has been successfully created with <strong style="color: #2D3436;">${recipientEmail}</strong>. You are now ready to track your glucose levels with real-time BLE sensor telemetry and instant alerts.
              </p>

              <!-- Family / Caregiver Code Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td align="center" style="background-color: #F7F5FC; border: 2px dashed #7E57C2; border-radius: 16px; padding: 24px 18px;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #5E35B1; margin-bottom: 6px;">
                      👨‍👩‍👧‍👦 Your Family & Caregiver Code
                    </div>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #3B2A68; padding: 6px 0;">
                      ${familyCode}
                    </div>
                    <div style="color: #7E72A2; font-size: 12.5px; line-height: 1.5; margin-top: 8px; max-width: 400px;">
                      Share this unique code with family members, doctors, or caregivers so they can join your <strong>Family Circle</strong> and view your glucose alerts in real-time.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Quick Start Steps -->
              <div style="background-color: #FAFAFD; border-radius: 14px; padding: 18px 20px; margin-bottom: 24px; border: 1px solid #ECEAF4;">
                <div style="font-size: 13.5px; font-weight: 700; color: #2D3436; margin-bottom: 12px;">
                  🚀 Quick Start Guide:
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding: 6px 0; font-size: 13px; color: #636E72; line-height: 1.5;">
                      <strong>1. Pair Sensor:</strong> Turn on Bluetooth in the app to connect your CGM sensor transmitter.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 13px; color: #636E72; line-height: 1.5;">
                      <strong>2. Set Target Ranges:</strong> Configure your personalized High and Low glucose alert thresholds.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 13px; color: #636E72; line-height: 1.5;">
                      <strong>3. Invite Caregivers:</strong> Have family members enter your Family Code in their app to follow your readings.
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Assistance Callout -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #E8F8F0; border-left: 3px solid #00B894; border-radius: 4px; padding: 12px 14px;">
                <tr>
                  <td style="color: #007A5A; font-size: 12.5px; line-height: 1.5;">
                    💡 <strong>Need Help?</strong> Our support team is here to assist with device pairing or account setup anytime.
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFAFD; padding: 22px 28px; border-top: 1px solid #ECEAF4; text-align: center;">
              <p style="color: #A0AEC0; font-size: 12px; line-height: 1.5; margin: 0 0 4px 0;">
                &copy; ${new Date().getFullYear()} Aima CGM Systems. All rights reserved.
              </p>
              <p style="color: #B2BEC3; font-size: 11px; margin: 0;">
                You received this email because you created an account with Aima.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
