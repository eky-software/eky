import { scrypt } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const candidates = [2 ** 15, 2 ** 16, 2 ** 17];
const runsPerCandidate = 5;
const blockSize = 8;
const parallelization = 1;
const keyLength = 32;
const password = 'Eky synthetic benchmark password 2026!';
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

for (const cost of candidates) {
  const durations = [];
  let maximumTimerDelay = 0;
  const estimatedMemoryBytes = 128 * cost * blockSize;
  const maxmem = Math.max(
    128 * 1024 * 1024,
    estimatedMemoryBytes * 2,
  );

  for (let run = 0; run < runsPerCandidate; run += 1) {
    let previousTick = performance.now();
    const timer = setInterval(() => {
      const currentTick = performance.now();
      maximumTimerDelay = Math.max(
        maximumTimerDelay,
        currentTick - previousTick - 10,
      );
      previousTick = currentTick;
    }, 10);
    const startedAt = performance.now();
    const key = await deriveKey(cost, maxmem);
    durations.push(performance.now() - startedAt);
    key.fill(0);
    clearInterval(timer);
  }

  durations.sort((first, second) => first - second);
  const median = durations[Math.floor(durations.length / 2)];
  process.stdout.write(
    JSON.stringify({
      N: cost,
      estimatedMemoryMiB: estimatedMemoryBytes / 1024 / 1024,
      maxEventLoopDelayMs: Number(maximumTimerDelay.toFixed(1)),
      maxmemMiB: maxmem / 1024 / 1024,
      medianMs: Number(median.toFixed(1)),
      p: parallelization,
      r: blockSize,
      runs: runsPerCandidate,
    }) + '\n',
  );
}

function deriveKey(cost, maxmem) {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        N: cost,
        maxmem,
        p: parallelization,
        r: blockSize,
      },
      (error, key) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}
