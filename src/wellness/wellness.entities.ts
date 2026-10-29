import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('WellnessReminderSettings')
@Unique('uq_wellness_settings_user', ['userId'])
export class WellnessReminderSettings {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'MealEnabled', default: true }) mealEnabled!: boolean;
  @Column({ name: 'WaterEnabled', default: true }) waterEnabled!: boolean;
  @Column({ name: 'WaterIntervalMinutes', type: 'int', default: 120 }) waterIntervalMinutes!: number;
  @Column({ name: 'DailyWaterGoalMl', type: 'int', nullable: true }) dailyWaterGoalMl!: number | null;
  @Column({ name: 'QuietHoursEnabled', default: true }) quietHoursEnabled!: boolean;
  @Column({ name: 'QuietStart', length: 5, default: '22:00' }) quietStart!: string;
  @Column({ name: 'QuietEnd', length: 5, default: '07:00' }) quietEnd!: string;
  @Column({ name: 'TimeZoneId', length: 80, default: 'Asia/Karachi' }) timeZoneId!: string;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}

@Entity('MealReminderSchedules')
export class MealReminderSchedule {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'MealType', length: 40 }) mealType!: string;
  @Column({ name: 'CustomName', type: 'varchar', length: 100, nullable: true }) customName!: string | null;
  @Column({ name: 'ReminderTime', length: 5 }) reminderTime!: string;
  @Column({ name: 'DaysOfWeek', length: 20, default: '0,1,2,3,4,5,6' }) daysOfWeek!: string;
  @Column({ name: 'Enabled', default: true }) enabled!: boolean;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}

@Entity('MealLogs')
@Unique('uq_meal_logs_client_event', ['userId', 'clientEventId'])
export class MealLog {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'MealType', length: 40 }) mealType!: string;
  @Column({ name: 'FoodDescription', type: 'text' }) foodDescription!: string;
  @Column({ name: 'CarbohydratesGrams', type: 'decimal', precision: 8, scale: 2, nullable: true }) carbohydratesGrams!: string | null;
  @Column({ name: 'PhotoUrl', type: 'varchar', length: 500, nullable: true }) photoUrl!: string | null;
  @Column({ name: 'Notes', type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'OccurredAtUtc', type: 'datetime' }) occurredAtUtc!: Date;
  @Column({ name: 'ClientEventId', length: 100 }) clientEventId!: string;
  @Column({ name: 'DeletedAt', type: 'datetime', nullable: true }) deletedAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}

@Entity('WaterIntakeLogs')
@Unique('uq_water_logs_client_event', ['userId', 'clientEventId'])
export class WaterIntakeLog {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'AmountMl', type: 'int' }) amountMl!: number;
  @Column({ name: 'OccurredAtUtc', type: 'datetime' }) occurredAtUtc!: Date;
  @Column({ name: 'ClientEventId', length: 100 }) clientEventId!: string;
  @Column({ name: 'DeletedAt', type: 'datetime', nullable: true }) deletedAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}
