import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @MinLength(6) password!: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() preferredGlucoseUnit = 'mg/dL';
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
  @IsOptional() @IsBoolean() rememberMe = false;
  @IsOptional() @IsString() deviceInfo?: string;
  @IsOptional() @IsString() deviceId?: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
export class ChangePasswordDto { @IsString() currentPassword!: string; @MinLength(6) newPassword!: string; }
export class SocialDto { @IsString() idToken!: string; @IsString() provider!: string; @IsOptional() @IsString() fullName?:string; @IsOptional() @IsString() deviceInfo?:string; @IsOptional() @IsString() deviceId?:string; }
export class EmailDto { @IsEmail() email!:string; }
export class VerifyResetDto extends EmailDto { @IsString() code!:string; }
export class ResetPasswordDto extends EmailDto {
  @IsOptional() @IsString() tokenOrCode?: string;
  @IsOptional() @IsString() token?: string;
  @MinLength(6) newPassword!: string;
}
