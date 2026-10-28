
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const TOKEN = __ENV.AUTH_TOKEN || '';
const SENSOR_ID = Number(__ENV.SENSOR_ID || 0);
const SENSOR_START_MS = Date.parse(__ENV.SENSOR_START_UTC || '');
const SENSOR_END_MS = Date.parse(__ENV.SENSOR_END_UTC || '');
const API_PATH = '/api/Glucose/sync-bulk';

if (!BASE_URL || !TOKEN || !SENSOR_ID || !Number.isFinite(SENSOR_START_MS) || !Number.isFinite(SENSOR_END_MS)) {
  throw new Error('Set BASE_URL, AUTH_TOKEN, SENSOR_ID, SENSOR_START_UTC and SENSOR_END_UTC.');
}

if (/aima\.gms-world\.com/i.test(BASE_URL)) {
  throw new Error('Refusing to run the load test against production.');
}

if (SENSOR_END_MS <= SENSOR_START_MS) {
  throw new Error('SENSOR_END_UTC must be after SENSOR_START_UTC.');
}

export const options = {
  scenarios: {
    glucose_sync_rate: {
      executor: 'ramping-arrival-rate',
      startRate: Number(__ENV.START_RATE || 1),
      timeUnit: '1s',
      stages: JSON.parse(__ENV.STAGES || '[{"duration":"20s","target":1},{"duration":"30s","target":0}]'),
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 20),
      maxVUs: Number(__ENV.MAX_VUS || 200),
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const iteration = exec.scenario.iterationInTest;
  const firstMeasurementMs = SENSOR_START_MS + (iteration * 5 * 60_000);
  const lastMeasurementMs = firstMeasurementMs + (4 * 60_000);

  if (lastMeasurementMs >= SENSOR_END_MS || lastMeasurementMs > Date.now() - 300_000) {
    throw new Error('Generated timestamp leaves the configured sensor session or is too recent.');
  }

  const batchId = `${exec.scenario.name}-${iteration}`;
  const measurements = Array.from({ length: 5 }, (_, index) => ({
    sensorId: SENSOR_ID,
    glucoseValue: 100 + ((__VU + __ITER + index) % 30),
    measurementTime: new Date(firstMeasurementMs + (index * 60_000)).toISOString(),
    batteryVoltageMv: 3000,
    deviceTemperatureC: 28,
    we1CurrentNa: 2.5,
    sequenceNumber: (iteration * 5) + index,
  }));

  const response = http.post(`${BASE_URL}${API_PATH}`, JSON.stringify({
    sensorId: SENSOR_ID,
    measurements,
  }), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-Load-Test-Batch': batchId,
    },
    timeout: '10s',
  });

  check(response, {
    'status is successful': (r) => r.status >= 200 && r.status < 300,
    'response is JSON': (r) => String(r.headers['Content-Type'] || '').includes('json'),
  });
}
