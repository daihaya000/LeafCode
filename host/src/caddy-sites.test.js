import test from 'node:test';
import assert from 'node:assert/strict';
import { isIpv4Literal, isPlaceholderHost, syncCaddySiteAddresses } from './caddy-sites.js';

const BASE = `{
	admin localhost:2019
}

https://localhost:8443, https://127.0.0.1:8443, https://192.168.0.102:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

:8080 {
	handle {
		redir https://{host}:8443{uri} 302
	}
}
`;

test('isIpv4Literal accepts dotted quads and rejects hostnames', () => {
  assert.equal(isIpv4Literal('192.168.0.102'), true);
  assert.equal(isIpv4Literal('10.0.0.1'), true);
  assert.equal(isIpv4Literal('localhost'), false);
  assert.equal(isIpv4Literal('webui.example.com'), false);
  assert.equal(isIpv4Literal('999.1.1.1'), false);
  assert.equal(isIpv4Literal('192.168.0'), false);
  assert.equal(isIpv4Literal('01.2.3.4'), false);
});

test('adds a newly appeared LAN IP while keeping loopback entries', () => {
  const result = syncCaddySiteAddresses(BASE, ['192.168.0.102', '192.168.0.193']);
  assert.equal(result.changed, true);
  assert.match(
    result.text,
    /^https:\/\/localhost:8443, https:\/\/127\.0\.0\.1:8443, https:\/\/192\.168\.0\.102:8443, https:\/\/192\.168\.0\.193:8443 \{$/m,
  );
});

test('replaces a stale IP when DHCP hands out a different address', () => {
  const result = syncCaddySiteAddresses(BASE, ['192.168.0.50']);
  assert.equal(result.changed, true);
  assert.doesNotMatch(result.text, /192\.168\.0\.102/);
  assert.match(result.text, /https:\/\/192\.168\.0\.50:8443/);
  // Loopback must survive so the host browser keeps working.
  assert.match(result.text, /https:\/\/localhost:8443/);
  assert.match(result.text, /https:\/\/127\.0\.0\.1:8443/);
});

test('is a no-op when the listed IPs already match', () => {
  const result = syncCaddySiteAddresses(BASE, ['192.168.0.102']);
  assert.equal(result.changed, false);
  assert.equal(result.text, BASE);
});

test('preserves user-authored hostnames', () => {
  const withHost = BASE.replace(
    'https://192.168.0.102:8443 {',
    'https://192.168.0.102:8443, https://my-desktop:8443 {',
  );
  const result = syncCaddySiteAddresses(withHost, ['192.168.0.77']);
  assert.equal(result.changed, true);
  assert.match(result.text, /https:\/\/my-desktop:8443/);
  assert.match(result.text, /https:\/\/192\.168\.0\.77:8443/);
  assert.doesNotMatch(result.text, /192\.168\.0\.102/);
});

test('keeps a custom port', () => {
  const custom = BASE.replaceAll(':8443', ':9443');
  const result = syncCaddySiteAddresses(custom, ['10.1.2.3']);
  assert.equal(result.changed, true);
  assert.match(result.text, /https:\/\/10\.1\.2\.3:9443/);
  assert.doesNotMatch(result.text, /https:\/\/10\.1\.2\.3:8443/);
});

test('never blanks the list when no addresses are detected', () => {
  const result = syncCaddySiteAddresses(BASE, []);
  assert.equal(result.changed, false);
  assert.equal(result.text, BASE);
});

test('leaves a Caddyfile without an https site block untouched', () => {
  const onlyHttp = ':8080 {\n\treverse_proxy 127.0.0.1:3000\n}\n';
  const result = syncCaddySiteAddresses(onlyHttp, ['192.168.0.5']);
  assert.equal(result.changed, false);
  assert.equal(result.text, onlyHttp);
});

test('does not touch the global options block', () => {
  const result = syncCaddySiteAddresses(BASE, ['192.168.0.193']);
  assert.match(result.text, /\{\r?\n\tadmin localhost:2019\r?\n\}/);
});

test('ignores non-IPv4 junk in the detected address list', () => {
  const result = syncCaddySiteAddresses(BASE, ['not-an-ip', '192.168.0.9']);
  assert.equal(result.changed, true);
  assert.doesNotMatch(result.text, /not-an-ip/);
  assert.match(result.text, /https:\/\/192\.168\.0\.9:8443/);
});

test('drops the example-hostname placeholder from the site line', () => {
  const withPlaceholder = BASE.replace(
    'https://192.168.0.102:8443 {',
    'https://example-hostname:8443, https://192.168.0.102:8443 {',
  );
  const result = syncCaddySiteAddresses(withPlaceholder, ['192.168.0.102']);
  assert.equal(result.changed, true);
  assert.doesNotMatch(result.text, /example-hostname/);
  assert.match(result.text, /https:\/\/localhost:8443/);
  assert.match(result.text, /https:\/\/192\.168\.0\.102:8443/);
});

test('isPlaceholderHost rejects real hostnames', () => {
  assert.equal(isPlaceholderHost('example-hostname'), true);
  assert.equal(isPlaceholderHost('EXAMPLE-HOSTNAME'), true);
  assert.equal(isPlaceholderHost('my-desktop'), false);
  assert.equal(isPlaceholderHost('webui.example.com'), false);
});
