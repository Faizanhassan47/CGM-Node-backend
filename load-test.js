
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://aima.gms-world.com';
const API_PATH = __ENV.API_PATH || '/';

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '30s', target: 10 },
    { duration: '30s', target: 20 },
    { duration: '30s', target: 30 },
    { duration: '20s', target: 0 },
  ],

  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const url = `${BASE_URL}${API_PATH}`;

  const response = http.get(url, {
    timeout: '10s',
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(2);
}
