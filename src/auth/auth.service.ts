import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { PatientProfile, User } from '../database/entities';
import { ChangePasswordDto, EmailDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, SocialDto, VerifyResetDto } from './auth.dto';
import { normalizeSql } from '../common/sql-helper';
import { buildPasswordResetEmailHtml, buildWelcomeEmailHtml } from '../common/email-template';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PatientProfile) private readonly profiles: Repository<PatientProfile>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) { }

  private hash(password: string) {
    const salt = randomBytes(16);
    return `${salt.toString('base64')}.${pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('base64')}`;
  }
  private verify(password: string, encoded: string | null) {
    if (!encoded) return false;
    const [saltText, hashText, ...rest] = encoded.split('.');
    if (!saltText || !hashText || rest.length) return false;
    const expected = Buffer.from(hashText, 'base64');
    const actual = pbkdf2Sync(password, Buffer.from(saltText, 'base64'), 100_000, 32, 'sha256');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  private async response(user: User, deviceId?: string) {
    const profile = await this.profiles.findOneBy({ userId: user.id });
    const common = { sub: String(user.id), device_id: deviceId ?? 'unknown' };
    const accessMinutes = this.config.get<number>('JWT_EXPIRY_MINUTES') ?? 60;
    const refreshDays = this.config.get<number>('REFRESH_TOKEN_EXPIRY_DAYS') ?? 30;
    const accessToken = await this.jwt.signAsync({ ...common, email: user.email, name: user.fullName, auth_provider: user.authProvider, role: 'Patient' }, { expiresIn: `${accessMinutes}m` });
    const refreshToken = await this.jwt.signAsync({ ...common, token_type: 'refresh', token_version: user.tokenVersion }, { expiresIn: `${refreshDays}d` });
    return { success: true, message: 'Authentication successful.', accessToken, refreshToken, expiresAt: new Date(Date.now() + accessMinutes * 60_000), user: { id: user.id, fullName: user.fullName, email: user.email, authProvider: user.authProvider, emailVerified: user.emailVerified, profileCompleted: profile?.profileCompleted ?? false, preferredGlucoseUnit: profile?.preferredGlucoseUnit ?? 'mg/dL', referralCode: user.referralCode } };
  }
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    console.log(`[AUTH] Register request received for: ${email}`);
    let existing = await this.users.findOne({ where: { email } });
    if (existing) {
      if (existing.isActive) {
        throw new BadRequestException({ message: 'An account with this email already exists. Please log in instead.' });
      } else {
        throw new UnauthorizedException({ message: 'This account has been deleted or deactivated. Please contact support.' });
      }
    }

    const user = await this.users.save(this.users.create({ fullName: dto.fullName.trim(), email, passwordHash: this.hash(dto.password), authProvider: 'Email', emailVerified: true, isActive: true, referralCode: randomBytes(5).toString('hex').toUpperCase(), tokenVersion: 0, createdAt: new Date() }));
    await this.profiles.save(this.profiles.create({ userId: user.id, phoneNumber: dto.phoneNumber ?? null, preferredGlucoseUnit: dto.preferredGlucoseUnit, language: 'English', theme: 'System', profileCompleted: true, createdAt: new Date() }));
    try {
      await this.sendWelcomeEmail(user.fullName, user.email, user.referralCode);
    } catch (err: any) {
      console.error(`[AUTH] Failed to send welcome email to ${email}:`, err?.message || err);
    }
    return this.response(user);
  }
  async login(dto: LoginDto) {
    const user = await this.users.findOneBy({ email: dto.email.trim().toLowerCase() });
    if (!user || !this.verify(dto.password, user.passwordHash)) {
      throw new UnauthorizedException({ message: 'Invalid email or password.' });
    }
    if (!user.isActive) {
      throw new UnauthorizedException({
        message: 'This account has been deleted or deactivated. Please contact support.',
      });
    }
    user.lastLoginAt = new Date();
    user.lastLoginDeviceId = dto.deviceId ?? null;
    user.lastLoginDeviceInfo = dto.deviceInfo ?? null;
    await this.users.save(user);
    return this.response(user, dto.deviceId);
  }
  async refresh(dto: RefreshDto) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; token_type: string; token_version: number; device_id?: string }>(dto.refreshToken);
      if (payload.token_type !== 'refresh') throw new Error();
      const user = await this.users.findOneBy({ id: Number(payload.sub), isActive: true });
      if (!user || user.tokenVersion !== Number(payload.token_version)) throw new Error();
      return this.response(user, payload.device_id);
    } catch { throw new UnauthorizedException({ message: 'Invalid or expired refresh token.' }); }
  }
  async logoutAll(userId: number) { await this.users.increment({ id: userId }, 'tokenVersion', 1); return { message: 'Logged out from all devices.' }; }
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (!this.verify(dto.currentPassword, user.passwordHash)) throw new BadRequestException({ message: 'Current password is incorrect.' });
    user.passwordHash = this.hash(dto.newPassword); user.tokenVersion += 1; await this.users.save(user);
    return { message: 'Password changed successfully.' };
  }
  async social(dto: SocialDto) {
    console.log(`[AUTH-GOOGLE] Incoming social auth request: provider=${dto.provider}`);
    if (dto.provider.toLowerCase() !== 'google') {
      throw new BadRequestException({ success: false, message: 'This social provider is not supported.' });
    }

    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      console.error('[AUTH-GOOGLE] GOOGLE_CLIENT_ID is not configured in .env');
      throw new BadRequestException({ success: false, message: 'Google authentication is not configured.' });
    }

    let google: { aud: string; sub: string; email: string; email_verified: string | boolean; name?: string };
    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`);
      const body = await response.json();
      if (!response.ok) {
        console.error('[AUTH-GOOGLE] Token validation endpoint failed:', body);
        throw new Error(body.error_description || body.error || 'Token validation failed');
      }
      google = body as typeof google;
      console.log(`[AUTH-GOOGLE] Verified Google Token: email=${google.email}, sub=${google.sub}, aud=${google.aud}`);

      const allowedAudiences = [
        clientId,
        '203000957883-r5lchnrp5e9mq03dt95fb0qg64io5hrg.apps.googleusercontent.com',
        '203000957883-58esulhtj8lnvvfu07bmilkks96bqju8.apps.googleusercontent.com',
      ];

      const isAudValid = allowedAudiences.includes(google.aud);
      const isEmailVerified = String(google.email_verified).toLowerCase() === 'true';

      if (!isAudValid) {
        console.error(`[AUTH-GOOGLE] Audience mismatch! Token aud: ${google.aud}, allowed:`, allowedAudiences);
        throw new Error(`Google token audience mismatch: ${google.aud}`);
      }
      if (!isEmailVerified) {
        console.error(`[AUTH-GOOGLE] Email not verified by Google: ${google.email}`);
        throw new Error('Google email is not verified');
      }
    } catch (err: any) {
      console.error('[AUTH-GOOGLE] Validation error:', err.message || err);
      throw new UnauthorizedException({
        success: false,
        message: err.message || 'The Google sign-in token is invalid or expired.',
      });
    }

    const email = google.email.toLowerCase();
    let user = await this.users.findOne({ where: [{ googleSubjectId: google.sub }, { email }] });

    if (!user) {
      console.log(`[AUTH-GOOGLE] Creating new user for ${email}...`);
      try {
        user = await this.users.save(
          this.users.create({
            fullName: (google.name || dto.fullName || email.split('@')[0]).trim(),
            email,
            passwordHash: null,
            authProvider: 'Google',
            googleSubjectId: google.sub,
            emailVerified: true,
            isActive: true,
            referralCode: randomBytes(5).toString('hex').toUpperCase(),
            tokenVersion: 0,
            createdAt: new Date(),
            lastLoginAt: new Date(),
            lastLoginDeviceId: dto.deviceId,
            lastLoginDeviceInfo: dto.deviceInfo,
          }),
        );

        await this.profiles.save(
          this.profiles.create({
            userId: user.id,
            preferredGlucoseUnit: 'mg/dL',
            language: 'English',
            theme: 'System',
            profileCompleted: false,
            createdAt: new Date(),
          }),
        );

        console.log(`[AUTH-GOOGLE] User created successfully: id=${user.id}, email=${user.email}`);
        this.sendWelcomeEmail(user.fullName, user.email, user.referralCode).catch((e) => {
          console.warn('[AUTH-GOOGLE] Welcome email error:', e.message);
        });
      } catch (dbErr: any) {
        console.error('[AUTH-GOOGLE] DB save error while creating new user:', dbErr);
        throw new BadRequestException({ message: `Failed to create user account: ${dbErr.message}` });
      }
    } else {
      console.log(`[AUTH-GOOGLE] Existing user logged in: id=${user.id}, email=${user.email}, isActive=${user.isActive}`);
      if (!user.isActive) {
        throw new UnauthorizedException({
          message: 'This account has been deleted or deactivated. Please contact support.',
        });
      }
      if (user.googleSubjectId && user.googleSubjectId !== google.sub) {
        console.log(`[AUTH-GOOGLE] Updating googleSubjectId from ${user.googleSubjectId} to ${google.sub}`);
      }
      Object.assign(user, {
        googleSubjectId: google.sub,
        emailVerified: true,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        lastLoginDeviceId: dto.deviceId ?? user.lastLoginDeviceId,
        lastLoginDeviceInfo: dto.deviceInfo ?? user.lastLoginDeviceInfo,
      });
      await this.users.save(user);
    }

    return this.response(user, dto.deviceId);
  }


  private getMailTransporter(): nodemailer.Transporter {
    const host = this.config.get<string>('SMTP_HOST') || 'smtp.ipage.com';
    const port = Number(this.config.get<number>('SMTP_PORT')) || 465;
    const secure = this.config.get<string>('SMTP_SSL') === 'true' || port === 465;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15000,
    });
  }

  private async sendWelcomeEmail(fullName: string, email: string, familyCode?: string | null): Promise<void> {
    const fromName = (this.config.get<string>('SMTP_FROM_NAME') || 'GlucoTrack CGM Platform').replace(/"/g, '');
    const fromEmail = this.config.get<string>('SMTP_FROM_EMAIL') || 'cgm@gms-world.co';
    const activeCode = familyCode || randomBytes(4).toString('hex').toUpperCase();

    try {
      const transporter = this.getMailTransporter();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Welcome to Aima! Your Family Code is ${activeCode}`,
        text: `Welcome to Aima, ${fullName}!\n\nYour account has been successfully created.\nYour Family & Caregiver Code is: ${activeCode}\nShare this code with your family members and caregivers so they can follow your glucose readings in real-time.\n\nBest regards,\nGlucoTrack Support`,
        html: buildWelcomeEmailHtml({
          fullName,
          recipientEmail: email,
          familyCode: activeCode,
        }),
      });
      console.log(`[WELCOME EMAIL] Welcome email successfully delivered to ${email}`);
    } catch (err: any) {
      console.error(`[WELCOME EMAIL] Failed to deliver welcome email to ${email}:`, err?.message || err);
    }
  }

  private async sendResetEmail(email: string, otp: string): Promise<void> {
    const fromName = (this.config.get<string>('SMTP_FROM_NAME') || 'GlucoTrack CGM Platform').replace(/"/g, '');
    const fromEmail = this.config.get<string>('SMTP_FROM_EMAIL') || 'cgm@gms-world.co';

    try {
      const transporter = this.getMailTransporter();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `${otp} is your Aima Password Reset Code`,
        text: `Hello,\n\nYour password reset code is: ${otp}\n\nThis 6-digit verification code expires in 15 minutes.\nIf you did not request a password reset, please ignore this email.\n\nBest regards,\nAima Support`,
        html: buildPasswordResetEmailHtml({
          otp,
          recipientEmail: email,
          expiresInMinutes: 15,
        }),
      });
      console.log(`[PASSWORD RESET] Email successfully sent to ${email}`);
    } catch (err: any) {
      console.error(`[PASSWORD RESET] Failed to deliver email to ${email}:`, err?.message || err);
    }
  }

  async forgot(dto: EmailDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findOneBy({ email });
    if (!user || !user.isActive) {
      // Return consistent generic response to prevent account enumeration
      return {
        success: true,
        message: 'If the account exists, reset instructions were sent to your email.',
      };
    }

    // Cryptographically secure 6-digit OTP
    const otpNumber = (randomBytes(4).readUInt32BE(0) % 900000) + 100000;
    const otp = String(otpNumber);
    const token = randomBytes(32).toString('hex');

    await this.users.manager.query(
      normalizeSql('UPDATE PasswordResetRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Email=? AND IsUsed=0', this.users.manager.connection),
      [email],
    );
    await this.users.manager.query(
      normalizeSql('INSERT INTO PasswordResetRequests(UserId,Email,Token,OtpCode,ExpiresAt,IsUsed,CreatedAt) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),0,UTC_TIMESTAMP())', this.users.manager.connection),
      [user.id, email, token, otp],
    );

    try {
      await this.sendResetEmail(email, otp);
    } catch (err: any) {
      console.error(`[AUTH] Failed to send reset email to ${email}:`, err?.message || err);
    }

    return {
      success: true,
      message: 'If the account exists, reset instructions were sent to your email.',
    };
  }

  async verifyReset(dto: VerifyResetDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const rows = await this.users.manager.query(
      normalizeSql('SELECT Token FROM PasswordResetRequests WHERE Email=? AND OtpCode=? AND IsUsed=0 AND ExpiresAt>UTC_TIMESTAMP() ORDER BY CreatedAt DESC LIMIT 1', this.users.manager.connection),
      [email, code],
    );
    if (!rows.length) {
      throw new BadRequestException({ success: false, message: 'Invalid or expired reset code.' });
    }
    return { success: true, message: 'Code verified successfully.', resetToken: rows[0].Token };
  }

  async reset(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const tokenOrCode = (dto.tokenOrCode || dto.token || '').trim();
    if (!tokenOrCode) {
      throw new BadRequestException({ success: false, message: 'Reset token or code is required.' });
    }
    const rows = await this.users.manager.query(
      normalizeSql('SELECT Id,UserId FROM PasswordResetRequests WHERE Email=? AND (Token=? OR OtpCode=?) AND IsUsed=0 AND ExpiresAt>UTC_TIMESTAMP() ORDER BY CreatedAt DESC LIMIT 1', this.users.manager.connection),
      [email, tokenOrCode, tokenOrCode],
    );
    if (!rows.length) {
      throw new BadRequestException({ success: false, message: 'Invalid or expired reset token/code.' });
    }
    const user = await this.users.findOneBy({ id: rows[0].UserId });
    if (!user) throw new BadRequestException({ success: false, message: 'User not found.' });
    user.passwordHash = this.hash(dto.newPassword);
    user.tokenVersion += 1;
    await this.users.save(user);
    await this.users.manager.query(
      normalizeSql('UPDATE PasswordResetRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Id=?', this.users.manager.connection),
      [rows[0].Id],
    );
    return { success: true, message: 'Password reset successfully.' };
  }
  async deleteAccount(userId: number) {
    console.log(`[AUTH] Deleting account for userId: ${userId}`);
    await this.users.manager.transaction(async m => {
      await m.query(
        normalizeSql('UPDATE Users SET IsActive=0,TokenVersion=TokenVersion+1,UpdatedAt=UTC_TIMESTAMP() WHERE Id=?', this.users.manager.connection),
        [userId],
      );
      await m.query(
        normalizeSql('UPDATE CGMDevices SET IsActive=0,ConnectionStatus="Disconnected",UpdatedAt=UTC_TIMESTAMP() WHERE UserId=?', this.users.manager.connection),
        [userId],
      );
      await m.query(
        normalizeSql('UPDATE Sensors SET IsActive=0,Status="Stopped" WHERE UserId=? AND IsActive=1', this.users.manager.connection),
        [userId],
      );
    });
    console.log(`[AUTH] Account successfully deleted for userId: ${userId}`);
    return { success: true, message: 'Account deleted successfully.' };
  }
}
