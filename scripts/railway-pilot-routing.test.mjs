import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFor } from './railway-pilot-routing.mjs';
test('portal uses its own hostname; public API paths remain behind the BFF', () => {
  assert.equal(targetFor('staff.example.com', '/', 'portal.example.com'), 3100);
  assert.equal(targetFor('PORTAL.example.com:443', '/login', 'portal.example.com'), 3102);
  assert.equal(targetFor('staff.example.com', '/api/v1/users', undefined), 3100);
  assert.equal(targetFor('portal.example.com.attacker.test', '/', 'portal.example.com'), 3100);
});
