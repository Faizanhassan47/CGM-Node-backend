import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { Repository } from "typeorm";
import { AuthUser, CurrentUser } from "../common/auth-user";
import { PatientProfile, User } from "../database/entities";
import { AuthService } from "../auth/auth.service";
import { StorageService } from "../common/storage.service";

class ProfileDto {
  @IsString() fullName!: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional()
  @IsIn(["Male", "Female", "Other", "Prefer not to say"])
  gender?: string;
  @IsOptional() @IsString() profilePictureUrl?: string;
  @IsOptional() @IsString() preferredGlucoseUnit?: string;
  @IsOptional() @IsString() theme = "System";
  @IsOptional() @IsString() language = "English";
  @IsOptional() @IsNumber() targetLow?: number;
  @IsOptional() @IsNumber() targetHigh?: number;
  @IsOptional() @IsNumber() urgentLowThreshold?: number;
  @IsOptional() @IsNumber() urgentHighThreshold?: number;
  @IsOptional() @IsString() bedTime?: string;
  @IsOptional() @IsString() wakeTime?: string;
  @IsOptional() @IsNumber() nightLowThreshold?: number;
  @IsOptional() @IsNumber() nightHighThreshold?: number;
  @IsOptional() @IsBoolean() nightAlertsEnabled?: boolean;
}

@Controller("api/Profile")
export class ProfileController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(PatientProfile)
    private profiles: Repository<PatientProfile>,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}

  private async get(userId: number) {
    const [user, profile] = await Promise.all([
      this.users.findOneBy({ id: userId }),
      this.profiles.findOneBy({ userId }),
    ]);
    if (!user || !profile)
      throw new NotFoundException({ message: "Profile not found." });
    return { user, profile };
  }

  private view(user: User, p: PatientProfile) {
    return {
      fullName: user.fullName,
      email: user.email,
      authProvider: user.authProvider,
      hasPassword: Boolean(user.passwordHash),
      phoneNumber: p.phoneNumber,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      profilePictureUrl: p.profilePictureUrl,
      preferredGlucoseUnit: p.preferredGlucoseUnit,
      profileCompleted: p.profileCompleted,
      theme: p.theme,
      language: p.language,
      targetLow: Number(p.targetLow ?? 90.0),
      targetHigh: Number(p.targetHigh ?? 130.0),
      urgentLowThreshold: Number(p.urgentLowThreshold ?? 55.0),
      urgentHighThreshold: Number(p.urgentHighThreshold ?? 250.0),
      bedTime: p.bedTime ?? "22:00",
      wakeTime: p.wakeTime ?? "07:00",
      nightLowThreshold: Number(p.nightLowThreshold ?? 70.0),
      nightHighThreshold: Number(p.nightHighThreshold ?? 160.0),
      nightAlertsEnabled: p.nightAlertsEnabled ?? true,
      referralCode: user.referralCode ?? "",
    };
  }

  @Post("picture")
  @UseInterceptors(FileInterceptor("file"))
  async uploadPicture(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException({ message: "No file provided for upload." });
    }
    const ext = file.originalname.split(".").pop() || "jpg";
    const key = `avatars/user_${u.sub}_${Date.now()}.${ext}`;
    const url = await this.storage.uploadFile(key, file.buffer, file.mimetype);

    const { user, profile } = await this.get(u.sub);
    profile.profilePictureUrl = url;
    profile.updatedAt = new Date();
    user.profilePictureUrl = url;
    user.updatedAt = new Date();
    await Promise.all([this.profiles.save(profile), this.users.save(user)]);

    return {
      profilePictureUrl: url,
      profile: this.view(user, profile),
    };
  }

  @Get()
  async read(@CurrentUser() u: AuthUser) {
    const { user, profile } = await this.get(u.sub);
    return this.view(user, profile);
  }

  @Put()
  async update(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    const { user, profile } = await this.get(u.sub);
    const wasCompleted = profile.profileCompleted;
    Object.assign(profile, {
      phoneNumber:
        dto.phoneNumber !== undefined
          ? dto.phoneNumber.trim() || null
          : profile.phoneNumber,
      dateOfBirth:
        dto.dateOfBirth !== undefined
          ? dto.dateOfBirth || null
          : profile.dateOfBirth,
      gender: dto.gender !== undefined ? dto.gender || null : profile.gender,
      profilePictureUrl:
        dto.profilePictureUrl !== undefined
          ? dto.profilePictureUrl || null
          : profile.profilePictureUrl,
      preferredGlucoseUnit:
        dto.preferredGlucoseUnit ?? profile.preferredGlucoseUnit ?? "mg/dL",
      theme: dto.theme,
      language: dto.language,
      targetLow:
        dto.targetLow != null ? dto.targetLow : (profile.targetLow ?? 90.0),
      targetHigh:
        dto.targetHigh != null ? dto.targetHigh : (profile.targetHigh ?? 130.0),
      urgentLowThreshold:
        dto.urgentLowThreshold != null
          ? dto.urgentLowThreshold
          : (profile.urgentLowThreshold ?? 55.0),
      urgentHighThreshold:
        dto.urgentHighThreshold != null
          ? dto.urgentHighThreshold
          : (profile.urgentHighThreshold ?? 250.0),
      bedTime: dto.bedTime ?? profile.bedTime ?? "22:00",
      wakeTime: dto.wakeTime ?? profile.wakeTime ?? "07:00",
      nightLowThreshold:
        dto.nightLowThreshold != null
          ? dto.nightLowThreshold
          : (profile.nightLowThreshold ?? 70.0),
      nightHighThreshold:
        dto.nightHighThreshold != null
          ? dto.nightHighThreshold
          : (profile.nightHighThreshold ?? 160.0),
      nightAlertsEnabled:
        dto.nightAlertsEnabled != null
          ? dto.nightAlertsEnabled
          : (profile.nightAlertsEnabled ?? true),
      profileCompleted: true,
      updatedAt: new Date(),
    });
    Object.assign(user, {
      fullName: dto.fullName.trim(),
      updatedAt: new Date(),
    });
    await Promise.all([this.profiles.save(profile), this.users.save(user)]);
    if (!wasCompleted) {
      void this.auth.sendWelcomeEmail(
        user.fullName,
        user.email,
        user.referralCode,
      );
    }
    return this.view(user, profile);
  }
}
