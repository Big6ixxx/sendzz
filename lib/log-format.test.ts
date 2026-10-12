import { describe, expect, it } from 'vitest';
import { compactErrorArgs, formatError, logPrefix, originOf } from './log-format';

// The trace from the production log that prompted this: every frame a minified chunk.
const PROD_STACK = `Error: We couldn't complete that request. Please try again shortly.
    at e.request (.next/server/chunks/ssr/lib_ramp_index_ts_0k8fx0x._.js:1:724)
    at async k.getRates (.next/server/chunks/ssr/lib_ramp_index_ts_0k8fx0x._.js:1:5395)
    at async Object.isOnRampAvailable (.next/server/chunks/ssr/lib_ramp_index_ts_0k8fx0x._.js:1:11691)
    at async G (.next/server/chunks/ssr/lib_actions_ramp_ts_075v1a4._.js:3:853)
    at async l (.next/server/chunks/ssr/16yv_next_dist_1c1tacs._.js:1:10953)`;

describe('originOf', () => {
  it('names the first readable frame of our code by function and source file', () => {
    expect(originOf(PROD_STACK)).toBe('request, lib/ramp/index.ts');
  });

  it('skips framework frames and falls back to the file when the name is minified', () => {
    const stack = `Error: x
    at async l (.next/server/chunks/ssr/16yv_next_dist_1c1tacs._.js:1:10953)
    at async G (.next/server/chunks/ssr/lib_actions_ramp_ts_075v1a4._.js:3:853)`;
    expect(originOf(stack)).toBe('lib/actions/ramp.ts');
  });

  it('reads development paths as they are', () => {
    const stack = `Error: x
    at getRates (/Users/me/sendzz/lib/ramp/providers/paycrest.ts:319:22)`;
    expect(originOf(stack)).toBe('getRates, lib/ramp/providers/paycrest.ts');
  });

  it('returns null when there is nothing legible', () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf('Error: x\n    at node:internal/process/task_queues:95:5')).toBeNull();
  });
});

describe('formatError', () => {
  it('collapses an error to one line with its status and origin', () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    err.stack = PROD_STACK.replace(/^Error: .*$/m, 'Error: Not found');
    const line = formatError(err);
    expect(line).toBe('Error: Not found (HTTP 404) [at request, lib/ramp/index.ts]');
    expect(line).not.toContain('\n');
  });

  it('includes the cause', () => {
    const err = new Error('Order failed', { cause: new Error('timeout') });
    err.stack = 'Error: Order failed';
    expect(formatError(err)).toBe('Error: Order failed (cause: timeout)');
  });
});

describe('compactErrorArgs', () => {
  it('only touches Error arguments', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom';
    expect(compactErrorArgs(['[Ramp] failed:', err, { a: 1 }, 3])).toEqual(['[Ramp] failed:', 'Error: boom', { a: 1 }, 3]);
  });
});

describe('logPrefix', () => {
  const at = new Date('2026-10-12T14:18:40.845Z');

  it('stamps the UTC time and the level', () => {
    expect(logPrefix('error', at)).toBe('2026-10-12T14:18:40.845Z ERROR');
    expect(logPrefix('warn', at)).toBe('2026-10-12T14:18:40.845Z WARN ');
    expect(logPrefix('log', at)).toBe('2026-10-12T14:18:40.845Z INFO ');
    expect(logPrefix('info', at)).toBe('2026-10-12T14:18:40.845Z INFO ');
  });
});
