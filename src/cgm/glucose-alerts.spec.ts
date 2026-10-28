import { evaluateGlucoseAlert, pickDominantAlert } from './glucose-alerts';

const base = {
  time: new Date('2026-10-28T12:00:00'),
  targetLow: 90,
  targetHigh: 130,
  urgentLow: 55,
  urgentHigh: 250,
  bedTime: '22:00',
  wakeTime: '07:00',
  nightLow: 70,
  nightAlertsEnabled: true,
  criticalAlertsEnabled: true,
};

describe('evaluateGlucoseAlert', () => {
  it('returns urgent low for critical hypoglycemia', () => {
    expect(evaluateGlucoseAlert({ ...base, value: 48 })?.type).toBe('UrgentLow');
  });

  it('falls back to warning low when critical alerts are off', () => {
    expect(
      evaluateGlucoseAlert({ ...base, value: 48, criticalAlertsEnabled: false })?.type,
    ).toBe('LowGlucose');
  });

  it('returns null in range', () => {
    expect(evaluateGlucoseAlert({ ...base, value: 110 })).toBeNull();
  });

  it('picks the most severe alert in a batch', () => {
    const picked = pickDominantAlert([
      { type: 'HighGlucose', time: new Date('2026-10-28T12:01:00') },
      { type: 'UrgentLow', time: new Date('2026-10-28T11:00:00') },
    ]);
    expect(picked?.type).toBe('UrgentLow');
  });
});
