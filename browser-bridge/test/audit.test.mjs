import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditLog } from '../broker/audit.mjs';

test('keeps a bounded metadata-only audit ring', () => {
  const audit = new AuditLog({ capacity: 2, now: () => 123 });
  audit.record({ commandId: 'cmd_1', tool: 'browser_snapshot', origin: 'https://example.com', outcome: 'succeeded' });
  audit.record({ commandId: 'cmd_2', tool: 'browser_click', origin: 'https://example.com', outcome: 'denied' });
  audit.record({ commandId: 'cmd_3', tool: 'browser_scroll', origin: 'https://example.com', outcome: 'succeeded' });

  assert.deepEqual(audit.list().map((entry) => entry.commandId), ['cmd_2', 'cmd_3']);
  assert.equal(audit.list()[0].timestamp, 123);
});

test('rejects event payloads that could retain page data or credentials', () => {
  const audit = new AuditLog();
  assert.throws(() => audit.record({ commandId: 'cmd_1', tool: 'browser_type', origin: 'https://x', outcome: 'succeeded', text: 'secret' }));
  assert.throws(() => audit.record({ commandId: 'cmd_1', tool: 'browser_snapshot', origin: 'https://x', outcome: 'succeeded', screenshot: 'data:image/png' }));
});
