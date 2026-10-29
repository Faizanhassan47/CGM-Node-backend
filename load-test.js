
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const TOKENS = (__ENV.AUTH_TOKENS || __ENV.AUTH_TOKEN || '').split(',').map((value) => value.trim()).filter(Boolean);
const SENSOR_IDS = (__ENV.SENSOR_IDS || __ENV.SENSOR_ID || '').split(',').map((value) => Number(value.trim())).filter(Boolean);
const SENSOR_START_MS = Date.parse(__ENV.SENSOR_START_UTC || '');
const SENSOR_END_MS = Date.parse(__ENV.SENSOR_END_UTC || '');
const API_PATH = '/api/Glucose/sync-bulk';
const successfulReadings = new Counter('successful_readings');
const uploadErrors = new Rate('upload_errors');

if (!BASE_URL || !TOKENS.length || !SENSOR_IDS.length || TOKENS.length !== SENSOR_IDS.length || !Number.isFinite(SENSOR_START_MS) || !Number.isFinite(SENSOR_END_MS)) {
  throw new Error('Set BASE_URL, matching AUTH_TOKENS/AUTH_TOKEN and SENSOR_IDS/SENSOR_ID, SENSOR_START_UTC and SENSOR_END_UTC.');
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
      startRate: Number(__ENV.RATE || 1),
      timeUnit: '1s',
      stages: [
        { duration: __ENV.DURATION || '1m', target: Number(__ENV.RATE || 1) },
        { duration: '10s', target: 0 },
      ],
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
  const sensorIndex = iteration % SENSOR_IDS.length;
  const sensorId = SENSOR_IDS[sensorIndex];
  const token = TOKENS[sensorIndex];
  const sensorIteration = Math.floor(iteration / SENSOR_IDS.length);
  const firstMeasurementMs = SENSOR_START_MS + (sensorIteration * 5 * 60_000);
  const lastMeasurementMs = firstMeasurementMs + (4 * 60_000);

  if (lastMeasurementMs >= SENSOR_END_MS || lastMeasurementMs > Date.now() - 300_000) {
    throw new Error('Generated timestamp leaves the configured sensor session or is too recent.');
  }

  const batchId = `${exec.scenario.name}-${iteration}`;
  const measurements = Array.from({ length: 5 }, (_, index) => ({
    sensorId,
    glucoseValue: 100 + ((iteration + index) % 30),
    measurementTime: new Date(firstMeasurementMs + (index * 60_000)).toISOString(),
    batteryVoltageMv: 3000,
    deviceTemperatureC: 28,
    we1CurrentNa: 2.5,
    sequenceNumber: (sensorIteration * 5) + index,
  }));

  const response = http.post(`${BASE_URL}${API_PATH}`, JSON.stringify({
    sensorId,
    measurements,
  }), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Load-Test-Batch': batchId,
    },
    timeout: '10s',
  });

  if (response.status < 200 || response.status >= 300) {
    uploadErrors.add(1);
    let message = 'Unknown error';
    try {
      message = response.json('message') || message;
    } catch (_) {
      // Keep diagnostics limited to status when the response is not JSON.
    }
    console.error(`[UPLOAD FAILED] status=${response.status} message=${message}`);
  } else {
    uploadErrors.add(0);
    try {
      successfulReadings.add(Number(response.json('insertedCount') || 0));
    } catch (_) {
      // The response check below records malformed success responses.
    }
  }

  check(response, {
    'status is successful': (r) => r.status >= 200 && r.status < 300,
    'response is JSON': (r) => String(r.headers['Content-Type'] || '').includes('json'),
  });
}
