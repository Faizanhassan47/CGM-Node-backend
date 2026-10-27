import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ReminderSettingsDto {
  @IsOptional() @IsBoolean() mealEnabled?: boolean;
  @IsOptional() @IsBoolean() waterEnabled?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(720) waterIntervalMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20000) dailyWaterGoalMl?: number | null;
  @IsOptional() @IsBoolean() quietHoursEnabled?: boolean;
  @IsOptional() @IsString() @Length(5, 5) quietStart?: string;
  @IsOptional() @IsString() @Length(5, 5) quietEnd?: string;
  @IsOptional() @IsString() @Length(1, 80) timeZoneId?: string;
}
export class MealScheduleDto { @IsString() @Length(1, 40) mealType!: string; @IsOptional() @IsString() @Length(1, 100) customName?: string; @IsString() @Length(5, 5) reminderTime!: string; @IsString() daysOfWeek!: string; @IsBoolean() enabled!: boolean; }
export class MealLogDto { @IsString() @Length(1, 40) mealType!: string; @IsString() @Length(1, 4000) foodDescription!: string; @IsOptional() @IsNumber() @Min(0) @Max(1000) carbohydratesGrams?: number; @IsOptional() @IsString() @Max(2000) notes?: string; @IsDateString() occurredAtUtc!: string; @IsString() @Length(1, 100) clientEventId!: string; }
export class WaterLogDto { @IsInt() @Min(1) @Max(10000) amountMl!: number; @IsDateString() occurredAtUtc!: string; @IsString() @Length(1, 100) clientEventId!: string; }
