
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = 'https://aima.gms-world.com';

const statusCodes = new Counter('response_codes');

export const options = {
    vus: 30,
    duration: '60s',
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<1500'],
    },
};

export default function () {
    const response = http.get(`${BASE_URL}/`, {
        timeout: '10s',
    });

    // Track HTTP status codes
    statusCodes.add(1, {
        code: String(response.status),
    });

    // Display errors
    if (response.status !== 200) {
        console.error(
            `HTTP ${response.status} | ` +
            `Response: ${String(response.body || '').slice(0, 150)}`
        );
    }

    // Verify response
    check(response, {
        'HTTP status is 200': (r) => r.status === 200,
    });

    // Simulate user waiting
    sleep(2);
}
