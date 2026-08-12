import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';

import {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  pickOpencodePath,
  wingetOpencodeLink,
} from './opencode-path.js';

test('isWindowsPeExecutable accepts MZ header and rejects stubs', () => {
  const files = new Map([
    ['C:\\pe.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
    ['C:\\stub.exe', Buffer.from('echo "Error: postinstall"')],
    ['C:\\empty.exe', Buffer.alloc(0)],
  ]);
  const io = {
    existsSync: (p) => files.has(p),
    readHeader: (p) => files.get(p) ?? Buffer.alloc(0),
  };
  assert.equal(isWindowsPeExecutable('C:\\pe.exe', io), true);
  assert.equal(isWindowsPeExecutable('C:\\stub.exe', io), false);
  assert.equal(isWindowsPeExecutable('C:\\empty.exe', io), false);
  assert.equal(isWindowsPeExecutable('C:\\missing.exe', io), false);
});

test('npmOpencodeSiblingExe maps shim prefix to package bin', () => {
  assert.equal(
    npmOpencodeSiblingExe('C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd'),
    join('C:\\Users\\me\\AppData\\Roaming\\npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
  );
});

test('wingetOpencodeLink builds the Links shim path', () => {
  assert.equal(
    wingetOpencodeLink('C:\\Users\\me\\AppData\\Local'),
    join('C:\\Users\\me\\AppData\\Local', 'Microsoft', 'WinGet', 'Links', 'opencode.exe'),
  );
  assert.equal(wingetOpencodeLink(undefined), null);
});

test('pickOpencodePath skips npm postinstall stub and prefers WinGet PE', () => {
  const npmCmd = 'C:\\npm\\opencode.cmd';
  const npmShim = 'C:\\npm\\opencode';
  const npmStub = join('C:\\npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  const winget = join('C:\\Local', 'Microsoft', 'WinGet', 'Links', 'opencode.exe');
  const pe = new Set([winget]);
  const picked = pickOpencodePath([npmShim, npmCmd], {
    localAppData: 'C:\\Local',
    existsSync: (p) => p === npmStub || p === winget,
    isPe: (p) => pe.has(p),
  });
  assert.equal(picked, winget);
});

test('pickOpencodePath prefers a PE .exe from where.exe over later candidates', () => {
  const winget = 'C:\\Local\\Microsoft\\WinGet\\Links\\opencode.exe';
  const picked = pickOpencodePath(
    ['C:\\npm\\opencode', 'C:\\npm\\opencode.cmd', winget],
    {
      localAppData: 'C:\\Local',
      isPe: (p) => p === winget,
    },
  );
  assert.equal(picked, winget);
});

test('pickOpencodePath uses npm sibling when it is a real PE', () => {
  const npmCmd = 'C:\\npm\\opencode.cmd';
  const sibling = join('C:\\npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  const picked = pickOpencodePath([npmCmd], {
    localAppData: 'C:\\Local',
    isPe: (p) => p === sibling,
  });
  assert.equal(picked, sibling);
});

test('pickOpencodePath falls back to .cmd when no PE is available', () => {
  const npmCmd = 'C:\\npm\\opencode.cmd';
  const picked = pickOpencodePath([npmCmd], {
    localAppData: 'C:\\Local',
    isPe: () => false,
  });
  assert.equal(picked, npmCmd);
});
