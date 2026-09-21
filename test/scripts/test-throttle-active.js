'use strict';
const assert = require('assert');
const ThrottleMonitor = require('../../src/main/throttle');

const monitor = new ThrottleMonitor({
  powerMonitor: { getSystemIdleTime: () => 0 },
  overrides: { cpuHighWater: 999, cpuLowWater: 999 }
});
monitor._sample();
assert.strictEqual(monitor.state, 'running', 'active user must not block indexing');
console.log('PASS: active-user indexing remains running');
