export type GlucoseAlertHit = {
  type: string;
  title: string;
  severity: 'Critical' | 'Warning';
};

export function asBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function minutesOfDay(time: Date, clock: string, fallback: string): number {
  const [hours, minutes] = String(clock || fallback).split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function isSleepWindow(time: Date, bedTime: string, wakeTime: string): boolean {
  const curMinutes = time.getHours() * 60 + time.getMinutes();
  const bedMinutes = minutesOfDay(time, bedTime, '22:00');
  const wakeMinutes = minutesOfDay(time, wakeTime, '07:00');
  if (bedMinutes > wakeMinutes) {
    return curMinutes >= bedMinutes || curMinutes <= wakeMinutes;
  }
  return curMinutes >= bedMinutes && curMinutes <= wakeMinutes;
}

const SEVERITY_RANK: Record<string, number> = {
  UrgentLow: 5,
  NocturnalHypo: 4,
  UrgentHigh: 3,
  LowGlucose: 2,
  HighGlucose: 1,
};

export function rankAlert(type: string): number {
  return SEVERITY_RANK[type] ?? 0;
}

export function evaluateGlucoseAlert(input: {
  value: number;
  time: Date;
  targetLow: number;
  targetHigh: number;
  urgentLow: number;
  urgentHigh: number;
  bedTime: string;
  wakeTime: string;
  nightLow: number;
  nightAlertsEnabled: boolean;
  criticalAlertsEnabled: boolean;
}): GlucoseAlertHit | null {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return null;

  const sleeping = isSleepWindow(input.time, input.bedTime, input.wakeTime);

  if (sleeping && input.nightAlertsEnabled && value < input.nightLow) {
    if (input.criticalAlertsEnabled) {
      return {
        type: 'NocturnalHypo',
        title: 'Urgent nocturnal low glucose',
        severity: 'Critical',
      };
    }
  }

  if (value <= input.urgentLow) {
    if (input.criticalAlertsEnabled) {
      return {
        type: 'UrgentLow',
        title: 'Critical urgent low glucose',
        severity: 'Critical',
      };
    }
    if (value < input.targetLow) {
      return { type: 'LowGlucose', title: 'Low glucose', severity: 'Warning' };
    }
  } else if (value < input.targetLow) {
    return {
      type: 'LowGlucose',
      title: 'Low glucose',
      severity: value <= input.urgentLow + 10 ? 'Critical' : 'Warning',
    };
  } else if (value >= input.urgentHigh) {
    if (input.criticalAlertsEnabled) {
      return {
        type: 'UrgentHigh',
        title: 'Critical urgent high glucose',
        severity: 'Critical',
      };
    }
    if (value > input.targetHigh) {
      return { type: 'HighGlucose', title: 'High glucose', severity: 'Warning' };
    }
  } else if (value > input.targetHigh) {
    return {
      type: 'HighGlucose',
      title: 'High glucose',
      severity: value >= input.urgentHigh - 20 ? 'Critical' : 'Warning',
    };
  }

  return null;
}

export function pickDominantAlert<T extends { type: string; time: Date }>(
  items: T[],
): T | null {
  if (!items.length) return null;
  return [...items].sort((a, b) => {
    const rankDelta = rankAlert(b.type) - rankAlert(a.type);
    if (rankDelta !== 0) return rankDelta;
    return b.time.getTime() - a.time.getTime();
  })[0];
}
