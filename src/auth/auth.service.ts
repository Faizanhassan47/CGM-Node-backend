import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { pbkdf2, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { EntityManager, Repository } from "typeorm";
import * as nodemailer from "nodemailer";
import { PatientProfile, User } from "../database/entities";
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SocialDto,
  VerifyResetDto,
} from "./auth.dto";
import { normalizeSql } from "../common/sql-helper";
import {
  buildEmailVerificationHtml,
  buildPasswordResetEmailHtml,
  buildWelcomeEmailHtml,
} from "../common/email-template";
import { circleLogoAttachment } from "../common/email-logo";

const pbkdf2Async = promisify(pbkdf2);
const PBKDF2_ITERATIONS = 100_000;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PatientProfile)
    private readonly profiles: Repository<PatientProfile>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async hash(password: string) {
    const salt = randomBytes(16);
    const derived = await pbkdf2Async(
      password,
      salt,
      PBKDF2_ITERATIONS,
      32,
      "sha256",
    );
    return `${salt.toString("base64")}.${derived.toString("base64")}`;
  }
  private async verify(password: string, encoded: string | null) {
    if (!encoded) return false;
    const [saltText, hashText, ...rest] = encoded.split(".");
    if (!saltText || !hashText || rest.length) return false;
    const expected = Buffer.from(hashText, "base64");
    const actual = await pbkdf2Async(
      password,
      Buffer.from(saltText, "base64"),
      PBKDF2_ITERATIONS,
      32,
      "sha256",
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private async anonymizeDeletedAccount(userId: number) {
    await this.users.manager.transaction((manager) =>
      this.anonymizeDeletedAccountWithManager(manager, userId),
    );
  }

  private async anonymizeDeletedAccountWithManager(
    manager: EntityManager,
    userId: number,
  ) {
    const deletedEmail = `deleted+${userId}@deleted.invalid`;
    await manager.query(
      normalizeSql(
        `UPDATE Users
           SET FullName=?, Email=?, PasswordHash=NULL, GoogleSubjectId=NULL,
               AppleSubjectId=NULL, LastLoginDeviceId=NULL,
               LastLoginDeviceInfo=NULL, ReferralCode=NULL, IsActive=0,
               TokenVersion=TokenVersion+1, UpdatedAt=UTC_TIMESTAMP()
           WHERE Id=?`,
        this.users.manager.connection,
      ),
      ["Deleted User", deletedEmail, userId],
    );
    await manager.query(
      normalizeSql(
        `UPDATE PatientProfile
           SET PhoneNumber=NULL, DateOfBirth=NULL, Gender=NULL,
               UpdatedAt=UTC_TIMESTAMP()
           WHERE UserId=?`,
        this.users.manager.connection,
      ),
      [userId],
    );
  }

  private async response(user: User, deviceId?: string) {
    const common = { sub: String(user.id), device_id: deviceId ?? "unknown" };
    const accessMinutes = this.config.get<number>("JWT_EXPIRY_MINUTES") ?? 60;
    const refreshDays =
      this.config.get<number>("REFRESH_TOKEN_EXPIRY_DAYS") ?? 30;
    const [profile, accessToken, refreshToken] = await Promise.all([
      this.profiles.findOneBy({ userId: user.id }),
      this.jwt.signAsync(
        {
          ...common,
          email: user.email,
          name: user.fullName,
          auth_provider: user.authProvider,
          email_verified: Boolean(user.emailVerified),
          role: "Patient",
          token_version: user.tokenVersion,
        },
        { expiresIn: `${accessMinutes}m` },
      ),
      this.jwt.signAsync(
        { ...common, token_type: "refresh", token_version: user.tokenVersion },
        { expiresIn: `${refreshDays}d` },
      ),
    ]);
    return {
      success: true,
      message: "Authentication successful.",
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + accessMinutes * 60_000),
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        authProvider: user.authProvider,
        hasPassword: Boolean(user.passwordHash),
        emailVerified: user.emailVerified,
        profileCompleted: profile?.profileCompleted ?? false,
        preferredGlucoseUnit: profile?.preferredGlucoseUnit ?? "mg/dL",
        referralCode: user.referralCode,
      },
    };
  }

  private async issueEmailVerificationCode(user: User) {
    const email = user.email.trim().toLowerCase();
    const otpNumber = (randomBytes(4).readUInt32BE(0) % 900000) + 100000;
    const otp = String(otpNumber);
    const token = randomBytes(32).toString("hex");

    await this.users.manager.query(
      normalizeSql(
        "UPDATE EmailVerificationRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Email=? AND IsUsed=0",
        this.users.manager.connection,
      ),
      [email],
    );
    await this.users.manager.query(
      normalizeSql(
        "INSERT INTO EmailVerificationRequests(UserId,Email,Token,OtpCode,ExpiresAt,IsUsed,CreatedAt) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),0,UTC_TIMESTAMP())",
        this.users.manager.connection,
      ),
      [user.id, email, token, otp],
    );

    // Don't block signup/login on SMTP latency; code is already stored.
    void this.sendEmailVerification(user.fullName, email, otp).catch(() => undefined);
    return otp;
  }

  private async sendEmailVerification(
    fullName: string,
    email: string,
    otp: string,
  ): Promise<void> {
    const fromName = (
      this.config.get<string>("SMTP_FROM_NAME") || "Circle CGM"
    ).replace(/"/g, "");
    const fromEmail =
      this.config.get<string>("SMTP_FROM_EMAIL") || "cgm@gms-world.co";

    try {
      const transporter = this.getMailTransporter();
      const logo = circleLogoAttachment();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `${otp} is your Circle verification code`,
        text: `Hello ${fullName},\n\nYour Circle email verification code is: ${otp}\n\nThis 6-digit code expires in 15 minutes. Never share it with anyone.\nIf you did not create a Circle account, ignore this email.\n\nBest regards,\nCircle Support`,
        html: buildEmailVerificationHtml({
          otp,
          recipientEmail: email,
          fullName,
          expiresInMinutes: 15,
        }),
        attachments: logo ? [logo] : [],
      });
      console.log(`[AUTH] Verification email delivered to ${email}`);
    } catch (err: any) {
      console.error(
        `[AUTH] Failed to deliver verification email to ${email}:`,
        err?.message || err,
      );
      throw err;
    }
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    console.log(`[AUTH] Register request received for: ${email}`);
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      if (!existing.emailVerified && existing.authProvider === "Email") {
        existing.fullName = dto.fullName.trim();
        existing.passwordHash = await this.hash(dto.password);
        await this.users.save(existing);
        const profile = await this.profiles.findOneBy({ userId: existing.id });
        if (profile) {
          profile.phoneNumber = dto.phoneNumber?.trim() || profile.phoneNumber;
          profile.dateOfBirth = dto.dateOfBirth ?? profile.dateOfBirth;
          profile.gender = dto.gender ?? profile.gender;
          profile.preferredGlucoseUnit =
            dto.preferredGlucoseUnit || profile.preferredGlucoseUnit;
          profile.profileCompleted = false;
          await this.profiles.save(profile);
        }
        try {
          await this.issueEmailVerificationCode(existing);
        } catch {
          // Still return verification-required so the app can show the code screen.
        }
        return {
          success: true,
          requiresEmailVerification: true,
          email,
          message:
            "Account pending verification. Enter the 6-digit code sent to your email.",
        };
      }
      throw new BadRequestException({
        message:
          "An account with this email already exists. Please log in instead.",
      });
    }

    const user = await this.users.save(
      this.users.create({
        fullName: dto.fullName.trim(),
        email,
        passwordHash: await this.hash(dto.password),
        authProvider: "Email",
        emailVerified: false,
        isActive: true,
        referralCode: randomBytes(8).toString("hex").toUpperCase(),
        tokenVersion: 0,
        createdAt: new Date(),
      }),
    );
    await this.profiles.save(
      this.profiles.create({
        userId: user.id,
        phoneNumber: dto.phoneNumber?.trim() || null,
        dateOfBirth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        preferredGlucoseUnit: dto.preferredGlucoseUnit,
        language: "English",
        theme: "System",
        // Force profile setup after email verification.
        profileCompleted: false,
        createdAt: new Date(),
      }),
    );

    try {
      await this.issueEmailVerificationCode(user);
    } catch {
      // Account exists; app can resend from the verification screen.
      console.error(`[AUTH] Verification email failed for ${email}`);
    }

    return {
      success: true,
      requiresEmailVerification: true,
      email,
      message:
        "Account created. Enter the 6-digit code we sent to your email.",
    };
  }

  async resendEmailVerification(dto: EmailDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findOneBy({ email });
    if (!user || !user.isActive) {
      return {
        success: true,
        message:
          "If the account exists, a verification code was sent to your email.",
      };
    }
    if (user.emailVerified) {
      return {
        success: true,
        message: "This email is already verified. You can sign in.",
        alreadyVerified: true,
      };
    }
    try {
      await this.issueEmailVerificationCode(user);
    } catch {
      // Generic response — do not leak SMTP failures to attackers.
    }
    return {
      success: true,
      requiresEmailVerification: true,
      email,
      message:
        "If the account exists, a verification code was sent to your email.",
    };
  }

  async verifyEmail(dto: VerifyResetDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const rows = await this.users.manager.query(
      normalizeSql(
        "SELECT Id,UserId FROM EmailVerificationRequests WHERE Email=? AND OtpCode=? AND IsUsed=0 AND ExpiresAt>UTC_TIMESTAMP() ORDER BY CreatedAt DESC LIMIT 1",
        this.users.manager.connection,
      ),
      [email, code],
    );
    if (!rows.length) {
      throw new BadRequestException({
        success: false,
        message: "Invalid or expired verification code.",
      });
    }
    const user = await this.users.findOneBy({ id: Number(rows[0].UserId) });
    if (!user || !user.isActive) {
      throw new BadRequestException({
        success: false,
        message: "User not found.",
      });
    }
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.users.manager.query(
      normalizeSql(
        "UPDATE EmailVerificationRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Id=?",
        this.users.manager.connection,
      ),
      [rows[0].Id],
    );
    void this.sendWelcomeEmail(user.fullName, user.email, user.referralCode);
    return this.response(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOneBy({
      email: dto.email.trim().toLowerCase(),
    });
    const passwordOk =
      !!user && (await this.verify(dto.password, user.passwordHash));
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        message: "Invalid email or password.",
      });
    }
    if (!user.isActive) {
      throw new UnauthorizedException({
        message:
          "This account is disabled. Contact support to reactivate it.",
      });
    }
    if (!user.emailVerified && user.authProvider === "Email") {
      try {
        await this.issueEmailVerificationCode(user);
      } catch {
        // App still opens verification UI.
      }
      throw new UnauthorizedException({
        message: "Please verify your email before signing in.",
        requiresEmailVerification: true,
        email: user.email,
      });
    }
    user.lastLoginAt = new Date();
    user.lastLoginDeviceId = dto.deviceId ?? null;
    user.lastLoginDeviceInfo = dto.deviceInfo ?? null;
    // Don't block token return on the last-login write (remote MySQL is slow).
    void this.users.save(user).catch(() => undefined);
    return this.response(user, dto.deviceId);
  }
  async refresh(dto: RefreshDto) {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        token_type: string;
        token_version: number;
        device_id?: string;
      }>(dto.refreshToken);
      if (payload.token_type !== "refresh") throw new Error();
      const user = await this.users.findOneBy({
        id: Number(payload.sub),
        isActive: true,
      });
      if (!user || user.tokenVersion !== Number(payload.token_version))
        throw new Error();
      return this.response(user, payload.device_id);
    } catch {
      throw new UnauthorizedException({
        message: "Invalid or expired refresh token.",
      });
    }
  }
  async logoutAll(userId: number) {
    await this.users.increment({ id: userId }, "tokenVersion", 1);
    return { message: "Logged out from all devices." };
  }
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const isSettingFirstPassword = !user.passwordHash;
    if (
      !isSettingFirstPassword &&
      (!dto.currentPassword ||
        !(await this.verify(dto.currentPassword, user.passwordHash)))
    )
      throw new BadRequestException({
        message: "Current password is incorrect.",
      });
    user.passwordHash = await this.hash(dto.newPassword);
    user.tokenVersion += 1;
    await this.users.save(user);
    return {
      message: isSettingFirstPassword
        ? "Password set successfully."
        : "Password changed successfully.",
      hasPassword: true,
    };
  }
  async social(dto: SocialDto) {
    console.log(
      `[AUTH-GOOGLE] Incoming social auth request: provider=${dto.provider}`,
    );
    if (dto.provider.toLowerCase() !== "google") {
      throw new BadRequestException({
        success: false,
        message: "This social provider is not supported.",
      });
    }

    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    if (!clientId) {
      console.error("[AUTH-GOOGLE] GOOGLE_CLIENT_ID is not configured in .env");
      throw new BadRequestException({
        success: false,
        message: "Google authentication is not configured.",
      });
    }

    let google: {
      aud: string;
      sub: string;
      email: string;
      email_verified: string | boolean;
      name?: string;
      picture?: string;
    };
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`,
      );
      const body = await response.json();
      if (!response.ok) {
        console.error("[AUTH-GOOGLE] Token validation endpoint failed:", body);
        throw new Error(
          body.error_description || body.error || "Token validation failed",
        );
      }
      google = body as typeof google;
      console.log(
        `[AUTH-GOOGLE] Verified Google Token: email=${google.email}, sub=${google.sub}, aud=${google.aud}`,
      );

      const extraAudiences = (this.config.get<string>("GOOGLE_CLIENT_IDS") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      const allowedAudiences = Array.from(new Set([clientId, ...extraAudiences]));

      const isAudValid = allowedAudiences.includes(google.aud);
      const isEmailVerified =
        String(google.email_verified).toLowerCase() === "true";

      if (!isAudValid) {
        console.error(
          `[AUTH-GOOGLE] Audience mismatch! Token aud: ${google.aud}, allowed:`,
          allowedAudiences,
        );
        throw new Error(`Google token audience mismatch: ${google.aud}`);
      }
      if (!isEmailVerified) {
        console.error(
          `[AUTH-GOOGLE] Email not verified by Google: ${google.email}`,
        );
        throw new Error("Google email is not verified");
      }
    } catch (err: any) {
      console.error("[AUTH-GOOGLE] Validation error:", err.message || err);
      throw new UnauthorizedException({
        success: false,
        message:
          err.message || "The Google sign-in token is invalid or expired.",
      });
    }

    const email = google.email.toLowerCase();
    let user = await this.users.findOne({ where: { googleSubjectId: google.sub } });
    if (!user) {
      const byEmail = await this.users.findOne({ where: { email } });
      if (byEmail) {
        // Do not silently absorb an email/password account into Google.
        if (byEmail.googleSubjectId && byEmail.googleSubjectId !== google.sub) {
          throw new ConflictException({
            success: false,
            message: "This email is linked to a different Google account.",
          });
        }
        if (!byEmail.googleSubjectId && byEmail.passwordHash) {
          throw new ConflictException({
            success: false,
            message:
              "An email/password account already exists for this address. Sign in with email, then link Google from profile.",
          });
        }
        user = byEmail;
      }
    }

    if (user && !user.isActive) {
      await this.anonymizeDeletedAccount(user.id);
      user = null;
    }

    if (!user) {
      console.log(`[AUTH-GOOGLE] Creating new user for ${email}...`);
      try {
        const resolvedName = (
          dto.fullName ||
          google.name ||
          email.split("@")[0]
        ).trim();

        user = await this.users.save(
          this.users.create({
            fullName: resolvedName,
            email,
            passwordHash: null,
            authProvider: "Google",
            googleSubjectId: google.sub,
            emailVerified: true,
            isActive: true,
            referralCode: randomBytes(8).toString("hex").toUpperCase(),
            tokenVersion: 0,
            createdAt: new Date(),
            lastLoginAt: new Date(),
            lastLoginDeviceId: dto.deviceId,
            lastLoginDeviceInfo: dto.deviceInfo,
          }),
        );

        const hasPatientInfo = Boolean(
          dto.phoneNumber?.trim() || dto.dateOfBirth,
        );

        await this.profiles.save(
          this.profiles.create({
            userId: user.id,
            phoneNumber: dto.phoneNumber?.trim() || null,
            dateOfBirth: dto.dateOfBirth ?? null,
            gender: dto.gender ?? null,
            profilePictureUrl: google.picture ?? null,
            preferredGlucoseUnit: dto.preferredGlucoseUnit || "mg/dL",
            language: "English",
            theme: "System",
            profileCompleted: hasPatientInfo,
            createdAt: new Date(),
          }),
        );

        console.log(
          `[AUTH-GOOGLE] User created successfully: id=${user.id}, email=${user.email}`,
        );
        // Only welcome users who actually finished sign-up. If the profile
        // step is still pending (user may cancel), the email is sent later
        // when the profile is completed.
        if (hasPatientInfo) {
          void this.sendWelcomeEmail(
            user.fullName,
            user.email,
            user.referralCode,
          );
        }
      } catch (dbErr: any) {
        console.error(
          "[AUTH-GOOGLE] DB save error while creating new user:",
          dbErr,
        );
        throw new BadRequestException({
          message: `Failed to create user account: ${dbErr.message}`,
        });
      }
    } else {
      console.log(
        `[AUTH-GOOGLE] Existing user logged in: id=${user.id}, email=${user.email}, isActive=${user.isActive}`,
      );
      if (user.googleSubjectId && user.googleSubjectId !== google.sub) {
        console.log(
          `[AUTH-GOOGLE] Updating googleSubjectId from ${user.googleSubjectId} to ${google.sub}`,
        );
      }
      Object.assign(user, {
        googleSubjectId: google.sub,
        emailVerified: true,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        lastLoginDeviceId: dto.deviceId ?? user.lastLoginDeviceId,
        lastLoginDeviceInfo: dto.deviceInfo ?? user.lastLoginDeviceInfo,
      });
      if (
        dto.fullName?.trim() &&
        (!user.fullName || user.fullName === email.split("@")[0])
      ) {
        user.fullName = dto.fullName.trim();
      }
      await this.users.save(user);

      // Update patient profile if additional info was provided during social login
      const profile = await this.profiles.findOneBy({ userId: user.id });
      if (profile) {
        const wasCompleted = profile.profileCompleted;
        let changed = false;
        if (dto.phoneNumber?.trim() && !profile.phoneNumber) {
          profile.phoneNumber = dto.phoneNumber.trim();
          changed = true;
        }
        if (dto.dateOfBirth && !profile.dateOfBirth) {
          profile.dateOfBirth = dto.dateOfBirth;
          changed = true;
        }
        if (dto.gender && !profile.gender) {
          profile.gender = dto.gender;
          changed = true;
        }
        if (dto.preferredGlucoseUnit && !profile.preferredGlucoseUnit) {
          profile.preferredGlucoseUnit = dto.preferredGlucoseUnit;
          changed = true;
        }
        if (google.picture && !profile.profilePictureUrl) {
          profile.profilePictureUrl = google.picture;
          changed = true;
        }
        if (dto.phoneNumber?.trim() || dto.dateOfBirth) {
          profile.profileCompleted = true;
          changed = true;
        }
        if (changed) {
          profile.updatedAt = new Date();
          await this.profiles.save(profile);
        }
        if (!wasCompleted && profile.profileCompleted) {
          void this.sendWelcomeEmail(
            user.fullName,
            user.email,
            user.referralCode,
          );
        }
      }
    }

    return this.response(user, dto.deviceId);
  }

  private getMailTransporter(): nodemailer.Transporter {
    const host = this.config.get<string>("SMTP_HOST") || "smtp.ipage.com";
    const port = Number(this.config.get<number>("SMTP_PORT")) || 465;
    const secure =
      this.config.get<string>("SMTP_SSL") === "true" || port === 465;
    const user = this.config.get<string>("SMTP_USER");
    const pass = this.config.get<string>("SMTP_PASS");

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      tls: {
        // Require valid certs in production; keep relaxed only when SMTP_TLS_INSECURE=true.
        rejectUnauthorized:
          this.config.get<string>("SMTP_TLS_INSECURE") === "true"
            ? false
            : this.config.get<string>("NODE_ENV") !== "production"
              ? false
              : true,
        servername: this.config.get<string>("SMTP_TLS_SERVERNAME") || host,
      },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 12_000,
    });
  }

  /** Sends the welcome email. Never throws; failures are logged. */
  async sendWelcomeEmail(
    fullName: string,
    email: string,
    familyCode?: string | null,
  ): Promise<void> {
    const fromName = (
      this.config.get<string>("SMTP_FROM_NAME") || "Circle CGM"
    ).replace(/"/g, "");
    const fromEmail =
      this.config.get<string>("SMTP_FROM_EMAIL") || "cgm@gms-world.co";
    const activeCode =
      familyCode || randomBytes(4).toString("hex").toUpperCase();

    try {
      const transporter = this.getMailTransporter();
      const logo = circleLogoAttachment();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Welcome to Circle! Your Family Code is ${activeCode}`,
        text: `Welcome to Circle, ${fullName}!\n\nYour account has been successfully created.\nYour Family & Caregiver Code is: ${activeCode}\nShare this code only with trusted family members, clinicians, or caregivers you want to invite.\n\nBest regards,\nCircle Support`,
        html: buildWelcomeEmailHtml({
          fullName,
          recipientEmail: email,
          familyCode: activeCode,
        }),
        attachments: logo ? [logo] : [],
      });
      console.log(
        `[WELCOME EMAIL] Welcome email successfully delivered to ${email}`,
      );
    } catch (err: any) {
      console.error(
        `[WELCOME EMAIL] Failed to deliver welcome email to ${email}:`,
        err?.message || err,
      );
    }
  }

  private async sendResetEmail(email: string, otp: string): Promise<void> {
    const fromName = (
      this.config.get<string>("SMTP_FROM_NAME") || "Circle CGM"
    ).replace(/"/g, "");
    const fromEmail =
      this.config.get<string>("SMTP_FROM_EMAIL") || "cgm@gms-world.co";

    try {
      const transporter = this.getMailTransporter();
      const logo = circleLogoAttachment();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `${otp} is your Circle password reset code`,
        text: `Hello,\n\nYour Circle password reset code is: ${otp}\n\nThis 6-digit verification code expires in 15 minutes. Never share it with anyone.\nIf you did not request a password reset, please ignore this email.\n\nBest regards,\nCircle Support`,
        html: buildPasswordResetEmailHtml({
          otp,
          recipientEmail: email,
          expiresInMinutes: 15,
        }),
        attachments: logo ? [logo] : [],
      });
      console.log(`[PASSWORD RESET] Email successfully sent to ${email}`);
    } catch (err: any) {
      console.error(
        `[PASSWORD RESET] Failed to deliver email to ${email}:`,
        err?.message || err,
      );
    }
  }

  async forgot(dto: EmailDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findOneBy({ email });
    if (!user || !user.isActive) {
      // Return consistent generic response to prevent account enumeration
      return {
        success: true,
        message:
          "If the account exists, reset instructions were sent to your email.",
      };
    }

    // Cryptographically secure 6-digit OTP
    const otpNumber = (randomBytes(4).readUInt32BE(0) % 900000) + 100000;
    const otp = String(otpNumber);
    const token = randomBytes(32).toString("hex");

    await this.users.manager.query(
      normalizeSql(
        "UPDATE PasswordResetRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Email=? AND IsUsed=0",
        this.users.manager.connection,
      ),
      [email],
    );
    await this.users.manager.query(
      normalizeSql(
        "INSERT INTO PasswordResetRequests(UserId,Email,Token,OtpCode,ExpiresAt,IsUsed,CreatedAt) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),0,UTC_TIMESTAMP())",
        this.users.manager.connection,
      ),
      [user.id, email, token, otp],
    );

    try {
      await this.sendResetEmail(email, otp);
    } catch (err: any) {
      console.error(
        `[AUTH] Failed to send reset email to ${email}:`,
        err?.message || err,
      );
    }

    return {
      success: true,
      message:
        "If the account exists, reset instructions were sent to your email.",
    };
  }

  async verifyReset(dto: VerifyResetDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const rows = await this.users.manager.query(
      normalizeSql(
        "SELECT Token FROM PasswordResetRequests WHERE Email=? AND OtpCode=? AND IsUsed=0 AND ExpiresAt>UTC_TIMESTAMP() ORDER BY CreatedAt DESC LIMIT 1",
        this.users.manager.connection,
      ),
      [email, code],
    );
    if (!rows.length) {
      throw new BadRequestException({
        success: false,
        message: "Invalid or expired reset code.",
      });
    }
    return {
      success: true,
      message: "Code verified successfully.",
      resetToken: rows[0].Token,
    };
  }

  async reset(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const tokenOrCode = (dto.tokenOrCode || dto.token || "").trim();
    if (!tokenOrCode) {
      throw new BadRequestException({
        success: false,
        message: "Reset token or code is required.",
      });
    }
    const rows = await this.users.manager.query(
      normalizeSql(
        "SELECT Id,UserId FROM PasswordResetRequests WHERE Email=? AND (Token=? OR OtpCode=?) AND IsUsed=0 AND ExpiresAt>UTC_TIMESTAMP() ORDER BY CreatedAt DESC LIMIT 1",
        this.users.manager.connection,
      ),
      [email, tokenOrCode, tokenOrCode],
    );
    if (!rows.length) {
      throw new BadRequestException({
        success: false,
        message: "Invalid or expired reset token/code.",
      });
    }
    const user = await this.users.findOneBy({ id: rows[0].UserId });
    if (!user)
      throw new BadRequestException({
        success: false,
        message: "User not found.",
      });
    user.passwordHash = await this.hash(dto.newPassword);
    user.tokenVersion += 1;
    await this.users.save(user);
    await this.users.manager.query(
      normalizeSql(
        "UPDATE PasswordResetRequests SET IsUsed=1,UsedAt=UTC_TIMESTAMP() WHERE Id=?",
        this.users.manager.connection,
      ),
      [rows[0].Id],
    );
    return { success: true, message: "Password reset successfully." };
  }
  async deleteAccount(userId: number) {
    console.log(`[AUTH] Disabling account for userId: ${userId}`);
    await this.users.manager.transaction(async (m) => {
      await m.query(
        normalizeSql(
          'UPDATE CGMDevices SET IsActive=0,ConnectionStatus="Disconnected",UpdatedAt=UTC_TIMESTAMP() WHERE UserId=?',
          this.users.manager.connection,
        ),
        [userId],
      );
      await m.query(
        normalizeSql(
          'UPDATE Sensors SET IsActive=0,Status="Stopped" WHERE UserId=? AND IsActive=1',
          this.users.manager.connection,
        ),
        [userId],
      );
      await m.query(
        normalizeSql(
          `UPDATE Users
             SET IsActive=0, TokenVersion=TokenVersion+1,
                 UpdatedAt=UTC_TIMESTAMP()
           WHERE Id=?`,
          this.users.manager.connection,
        ),
        [userId],
      );
    });
    console.log(`[AUTH] Account successfully disabled for userId: ${userId}`);
    return { success: true, message: "Account disabled successfully. Register again with this email and complete your details to reactivate it." };
  }
}
