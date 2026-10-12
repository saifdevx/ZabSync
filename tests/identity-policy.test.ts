import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUniversityIdentity,
  universityRollNumber,
  type VerifiedIdentity,
} from '../server/auth.js';
import { ALLOWED_EMAIL_DOMAIN, loadConfig, makeTestConfig } from '../server/config.js';
import { createTestApp } from './helpers.js';

test('verified university addresses allow students and teachers, including uppercase domain spelling', () => {
  assert.equal(ALLOWED_EMAIL_DOMAIN, 'szabist-isb.pk');
  for (const email of [
    '2412345@szabist-isb.pk',
    'lecturer.ahmed@szabist-isb.pk',
    'student@SZABIST-ISB.PK',
  ]) {
    const accepted = assertUniversityIdentity({
      uid: 'a-provider-verified-user',
      email,
      email_verified: true,
    });
    assert.equal(accepted.id, 'a-provider-verified-user');
    assert.equal(accepted.email.split('@')[1], 'szabist-isb.pk');
  }
});

test('domain lookalikes, subdomains, suffixes and malformed addresses are rejected', () => {
  for (const email of [
    'student@gmail.com',
    'student@sub.szabist-isb.pk',
    'student@szabist-isb.pk.attacker.example',
    'student@fakeszabist-isb.pk',
    'student@szabist-isb.com',
    'student@szabist-isb.pk@attacker.example',
    'student-szabist-isb.pk',
    '@szabist-isb.pk',
    '',
  ]) {
    assert.throws(
      () => assertUniversityIdentity({ uid: 'verified-user', email, email_verified: true }),
      { code: 'university_email_required' },
      `The exact university-domain restriction must reject ${JSON.stringify(email)}.`,
    );
  }
});

test('matching university email without verified-mailbox proof is rejected', () => {
  for (const identity of [
    { uid: 'student-id', email: 'student@szabist-isb.pk', email_verified: false },
    { uid: 'student-id', email: 'student@szabist-isb.pk' },
    { uid: 'student-id', email: 'student@szabist-isb.pk', email_verified: 'true' },
  ]) {
    assert.throws(() => assertUniversityIdentity(identity as VerifiedIdentity), {
      code: 'email_not_verified',
    });
  }
});

test('identity requires an immutable provider UID and an email address', () => {
  assert.throws(
    () =>
      assertUniversityIdentity({ uid: '', email: 'student@szabist-isb.pk', email_verified: true }),
    { code: 'invalid_identity' },
  );
  assert.throws(() => assertUniversityIdentity({ uid: 'student-id', email_verified: true }), {
    code: 'university_email_required',
  });
});

test('owner bootstrap has no default and an external address requires its exact pinned Firebase UID', () => {
  assert.equal(loadConfig({}).masterAdminEmail, null);
  assert.equal(loadConfig({}).masterAdminUid, null);
  assert.equal(
    loadConfig({ MASTER_ADMIN_EMAIL: 'OWNER@SZABIST-ISB.PK' }).masterAdminEmail,
    'owner@szabist-isb.pk',
  );
  assert.throws(
    () => loadConfig({ MASTER_ADMIN_EMAIL: 'owner@szabist-isb.pk.attacker.example' }),
    /MASTER_ADMIN_UID/,
  );
  assert.throws(() => loadConfig({ MASTER_ADMIN_EMAIL: 'owner@gmail.com' }), /MASTER_ADMIN_UID/);
  const external = loadConfig({
    MASTER_ADMIN_EMAIL: 'OWNER@GMAIL.COM',
    MASTER_ADMIN_UID: 'private-firebase-owner-uid',
  });
  assert.equal(external.masterAdminEmail, 'owner@gmail.com');
  assert.equal(external.masterAdminUid, 'private-firebase-owner-uid');
  assert.throws(() => loadConfig({ MASTER_ADMIN_UID: 'uid-without-email' }), /MASTER_ADMIN_EMAIL/);
  assert.throws(
    () => loadConfig({ MASTER_ADMIN_EMAIL: '*@gmail.com', MASTER_ADMIN_UID: 'some-uid' }),
    /MASTER_ADMIN_EMAIL/,
  );
  assert.throws(
    () => loadConfig({ MASTER_ADMIN_EMAIL: 'owner@gmail.com', MASTER_ADMIN_UID: 'x'.repeat(129) }),
    /MASTER_ADMIN_UID/,
  );
});

test('production refuses demo authentication at configuration and application startup', async (t) => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'demo' }),
    /demo.*production/i,
  );
  await assert.rejects(
    () =>
      createTestApp(t, {
        config: makeTestConfig({ nodeEnv: 'production', authMode: 'demo' }),
        seedDemo: false,
      }),
    /demo.*production/i,
  );
});

test('Firebase mode without server credentials refuses startup instead of falling back to demo', async (t) => {
  await assert.rejects(
    () =>
      createTestApp(t, {
        config: makeTestConfig({ authMode: 'firebase' }),
        seedDemo: false,
      }),
    /Firebase.*(credentials|FIREBASE_CLIENT_EMAIL|APPLICATION_DEFAULT)/i,
  );
});

test('the test token-verifier seam is forbidden in a production application', async (t) => {
  await assert.rejects(
    () =>
      createTestApp(t, {
        config: makeTestConfig({ nodeEnv: 'production', authMode: 'firebase' }),
        seedDemo: false,
        verifyFirebaseToken: async () => ({
          uid: 'must-not-be-accepted',
          email: 'owner@szabist-isb.pk',
          email_verified: true,
        }),
      }),
    /test|inject|verifier/i,
  );
});

test('roll numbers are display metadata derived only from a numeric exact-domain mailbox', () => {
  assert.equal(universityRollNumber('2412339@szabist-isb.pk'), '2412339');
  assert.equal(universityRollNumber('0012345@SZABIST-ISB.PK'), '0012345');
  for (const email of [
    'lecturer.ahmed@szabist-isb.pk',
    'student@szabist-isb.pk',
    '2412339@gmail.com',
    '2412339@sub.szabist-isb.pk',
    '2412339@szabist-isb.pk.attacker.example',
    '2412339@szabist-isb.pk@',
    '2412339@szabist-isb.pk@@',
    '2412339',
  ]) {
    assert.equal(universityRollNumber(email), null, email);
  }
});
