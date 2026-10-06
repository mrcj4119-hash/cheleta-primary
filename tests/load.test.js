import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

process.env.CHELETA_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'load-test-only-secret';

const { app } = await import('../server.js');
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const agent = new http.Agent({ keepAlive: true, maxSockets: 200, maxTotalSockets: 200 });

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@cheleta.test', password: 'admin123', role: 'ADMIN' })
  });
  assert.equal(loginResponse.status, 200, 'load-test admin account should authenticate');
  const { data: { token } } = await loginResponse.json();
  const latencies = [];
  const started = performance.now();

  const responses = await Promise.all(Array.from({ length: 10_000 }, () => new Promise((resolve, reject) => {
    const requestStarted = performance.now();
    const request = http.request(`${baseUrl}/api/dashboard`, {
      agent,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60_000
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          latencies.push(performance.now() - requestStarted);
          resolve({ status: response.statusCode, success: result.success });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Load-test request timed out.')));
    request.on('error', reject);
    request.end();
  })));

  const elapsedMs = performance.now() - started;
  const sortedLatencies = latencies.sort((left, right) => left - right);
  const percentile = (value) => sortedLatencies[Math.ceil(sortedLatencies.length * value) - 1];
  const failed = responses.filter((response) => response.status !== 200 || !response.success).length;
  console.log(JSON.stringify({
    requests: responses.length,
    failed,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Math.round(responses.length / (elapsedMs / 1000)),
    latencyMs: {
      p50: Math.round(percentile(0.5)),
      p95: Math.round(percentile(0.95)),
      p99: Math.round(percentile(0.99)),
      max: Math.round(sortedLatencies[sortedLatencies.length - 1])
    },
    maxOpenConnections: 200,
    note: '10,000 concurrent authenticated dashboard requests multiplexed over 200 keep-alive connections against one local Express process with in-memory SQLite; not a multi-instance production capacity certification.'
  }, null, 2));
  assert.equal(failed, 0, 'all 10,000 authenticated dashboard requests should succeed');
} finally {
  agent.destroy();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
