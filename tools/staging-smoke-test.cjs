const baseUrl = (process.env.CGM_STAGING_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const password = process.env.CGM_FIXTURE_PASSWORD;

const users = {
  a: 'aima-staging-user-a@example.invalid',
  b: 'aima-staging-user-b@example.invalid',
};

if (!password) {
  throw new Error('Set CGM_FIXTURE_PASSWORD in the current PowerShell session.');
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { response, body };
}

async function login(email) {
  const { response, body } = await request('/api/Auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      rememberMe: false,
      deviceInfo: 'AIMA staging smoke test',
      deviceId: `staging-${email.slice(-10, -8)}`,
    }),
  });

  if (!response.ok || !body?.accessToken) {
    throw new Error(`Login failed for ${email}: HTTP ${response.status}`);
  }

  return body.accessToken;
}

async function activeSensor(token, label) {
  const { response, body } = await request('/api/Sensors/active', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok || !body?.id) {
    throw new Error(`Active sensor lookup failed for User ${label}: HTTP ${response.status}`);
  }

  return body;
}

function measurementsFor(sensor) {
  const activatedAt = Date.parse(sensor.activatedAt);
  const expiresAt = sensor.expiresAt ? Date.parse(sensor.expiresAt) : Number.POSITIVE_INFINITY;
  const latestAllowed = Math.min(Date.now() - 30_000, expiresAt - 1_000);
  const earliestAllowed = activatedAt + 1_000;

  if (!Number.isFinite(activatedAt) || latestAllowed <= earliestAllowed) {
    throw new Error('Sensor window is too short for five safe test timestamps; wait briefly and retry.');
  }

  const step = Math.max(1_000, Math.floor((latestAllowed - earliestAllowed) / 4));
  const first = latestAllowed - step * 4;
  if (first < earliestAllowed) {
    throw new Error('Could not allocate five timestamps inside the sensor window.');
  }

  return [105, 110, 115, 112, 108].map((glucoseValue, index) => ({
    sensorId: sensor.id,
    glucoseValue,
    measurementTime: new Date(first + step * index).toISOString(),
    batteryVoltageMv: 3000,
    deviceTemperatureC: 28,
    we1CurrentNa: 2.5,
    sequenceNumber: 1001 + index,
  }));
}

async function upload(token, sensorId, measurements) {
  return request('/api/Glucose/sync-bulk', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sensorId, measurements }),
  });
}

async function main() {
  const tokenA = await login(users.a);
  const tokenB = await login(users.b);
  const sensorA = await activeSensor(tokenA, 'A');
  const sensorB = await activeSensor(tokenB, 'B');
  const measurements = measurementsFor(sensorA);

  const first = await upload(tokenA, sensorA.id, measurements);
  if (!first.response.ok || first.body?.insertedCount !== 5) {
    throw new Error(`User A upload failed: HTTP ${first.response.status}`);
  }

  const duplicate = await upload(tokenA, sensorA.id, measurements);
  if (!duplicate.response.ok || duplicate.body?.insertedCount !== 0 || duplicate.body?.duplicateCount !== 5) {
    throw new Error(`Duplicate upload check failed: HTTP ${duplicate.response.status}`);
  }

  const crossUser = await upload(tokenB, sensorA.id, measurements);
  if (crossUser.response.ok) {
    throw new Error('Cross-user sensor authorization unexpectedly succeeded.');
  }

  const history = await request(`/api/Glucose/history?sensorId=${encodeURIComponent(sensorA.id)}&hours=24&pageSize=100`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  if (!history.response.ok || Number(history.body?.totalCount) < 5) {
    throw new Error(`History verification failed: HTTP ${history.response.status}`);
  }

  console.log(JSON.stringify({
    baseUrl,
    userA: { email: users.a, sensorId: sensorA.id, firstUpload: first.body, duplicateUpload: duplicate.body },
    userB: { email: users.b, sensorId: sensorB.id, crossUserStatus: crossUser.response.status },
    historyCount: history.body.totalCount,
    status: 'passed',
  }, null, 2));
}

main().catch((error) => {
  console.error(`Staging smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
