import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { MealLogDto, MealScheduleDto, ReminderSettingsDto, WaterLogDto } from './wellness.dto';
import { WellnessService } from './wellness.service';

@Controller('api/wellness')
export class WellnessController {
  constructor(private readonly service: WellnessService) {}
  @Get('reminders') reminders(@CurrentUser() u: AuthUser) { return this.service.reminders(u.sub); }
  @Put('reminders') update(@CurrentUser() u: AuthUser, @Body() d: ReminderSettingsDto) { return this.service.updateReminders(u.sub, d); }
  @Post('reminder-schedules') schedule(@CurrentUser() u: AuthUser, @Body() d: MealScheduleDto) { return this.service.saveSchedule(u.sub, d); }
  @Patch('reminder-schedules/:id') editSchedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: Partial<MealScheduleDto>) { return this.service.updateSchedule(u.sub, Number(id), d); }
  @Get('today') today(@CurrentUser() u: AuthUser, @Query('startUtc') start?: string, @Query('endUtc') end?: string) { const e = end ? new Date(end) : new Date(); const s = start ? new Date(start) : new Date(e.getTime() - 86400000); return this.service.today(u.sub, s, e); }
  @Post('meals') meal(@CurrentUser() u: AuthUser, @Body() d: MealLogDto) { return this.service.addMeal(u.sub, d); }
  @Get('meals') meals(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('pageSize') size?: string) { return this.service.listMeals(u.sub, from, to, Number(page ?? 1), Number(size ?? 50)); }
  @Patch('meals/:id') editMeal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: Partial<MealLogDto>) { return this.service.updateMeal(u.sub, Number(id), d); }
  @Delete('meals/:id') removeMeal(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.deleteMeal(u.sub, Number(id)); }
  @Get('meal-glucose/:id') mealGlucose(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.mealGlucose(u.sub, Number(id)); }
  @Post('water') addWater(@CurrentUser() u: AuthUser, @Body() d: WaterLogDto) { return this.service.addWater(u.sub, d); }
  @Get('water') water(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.listWater(u.sub, from, to); }
  @Delete('water/:id') removeWater(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.deleteWater(u.sub, Number(id)); }
}
