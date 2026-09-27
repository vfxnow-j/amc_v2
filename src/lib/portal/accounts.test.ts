import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AccountPutBodySchema,
  DEFAULT_SITE_MARKER,
  assertRelinkAllowed,
  mapAccountResponse,
  planSiteReplacement,
  portalOriginAccountId,
  portalOriginMarker,
  sitesDefaultError,
} from './accounts'

/** zod v4's thrown message is the issues array, not the string "ZodError". */
function isZodError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ZodError'
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

test('a minimal body validates: company only', () => {
  const body = AccountPutBodySchema.parse({ company: 'Acme VFX' })
  assert.equal(body.company, 'Acme VFX')
  assert.equal(body.contact_email, undefined)
  assert.equal(body.verification_level, undefined)
  assert.equal(body.sites, undefined)
})

test('company is required', () => {
  assert.throws(() => AccountPutBodySchema.parse({}), isZodError)
  assert.throws(() => AccountPutBodySchema.parse({ company: '' }), isZodError)
})

test('contact fields are optional and null collapses to undefined', () => {
  const body = AccountPutBodySchema.parse({ company: 'Acme', contact_email: null, contact_phone: undefined })
  assert.equal(body.contact_email, undefined)
  assert.equal(body.contact_phone, undefined)
})

test('verification_level only accepts the three contract values', () => {
  for (const level of ['none', 'id_verified', 'agreement_and_coi']) {
    assert.doesNotThrow(() => AccountPutBodySchema.parse({ company: 'Acme', verification_level: level }))
  }
  assert.throws(() => AccountPutBodySchema.parse({ company: 'Acme', verification_level: 'trusted' }), isZodError)
})

test('sites: a well-formed set with exactly one default validates', () => {
  const body = AccountPutBodySchema.parse({
    company: 'Acme',
    sites: [
      { external_site_id: 'a', label: 'HQ', address: '1 Main St', is_default: true },
      { external_site_id: 'b', label: 'Annex', is_default: false },
    ],
  })
  assert.equal(body.sites?.length, 2)
  assert.equal(body.sites?.[1].address, null, 'omitted address collapses to null')
})

test('sites: zero defaults, two defaults, and duplicate ids all fail validation', () => {
  const noDefault = { company: 'Acme', sites: [{ external_site_id: 'a', label: 'HQ', is_default: false }] }
  const twoDefaults = {
    company: 'Acme',
    sites: [
      { external_site_id: 'a', label: 'HQ', is_default: true },
      { external_site_id: 'b', label: 'Annex', is_default: true },
    ],
  }
  const dup = {
    company: 'Acme',
    sites: [
      { external_site_id: 'a', label: 'HQ', is_default: true },
      { external_site_id: 'a', label: 'Again', is_default: false },
    ],
  }
  assert.throws(() => AccountPutBodySchema.parse(noDefault), isZodError)
  assert.throws(() => AccountPutBodySchema.parse(twoDefaults), isZodError)
  assert.throws(() => AccountPutBodySchema.parse(dup), isZodError)
})

test('an empty sites array is allowed (clears sites, no default required)', () => {
  const body = AccountPutBodySchema.parse({ company: 'Acme', sites: [] })
  assert.deepEqual(body.sites, [])
})

// ---------------------------------------------------------------------------
// sitesDefaultError (the rule the zod schema and the panel both lean on)
// ---------------------------------------------------------------------------

test('sitesDefaultError: empty is fine, one default is fine', () => {
  assert.equal(sitesDefaultError([]), null)
  assert.equal(sitesDefaultError([{ is_default: true }, { is_default: false }]), null)
})

test('sitesDefaultError: zero or many defaults are named', () => {
  assert.match(sitesDefaultError([{ is_default: false }]) ?? '', /exactly one/i)
  assert.match(sitesDefaultError([{ is_default: true }, { is_default: true }]) ?? '', /only one/i)
})

// ---------------------------------------------------------------------------
// Sites replace-set (pure)
// ---------------------------------------------------------------------------

test('planSiteReplacement: nothing existing, nothing to delete', () => {
  assert.deepEqual(planSiteReplacement([], [{ external_site_id: 'a' }]), { toDelete: [] })
})

test('planSiteReplacement: keeps ids present in the incoming set, drops the rest', () => {
  const plan = planSiteReplacement(['a', 'b', 'c'], [{ external_site_id: 'a' }, { external_site_id: 'c' }])
  assert.deepEqual(plan.toDelete, ['b'])
})

test('planSiteReplacement: an empty incoming set deletes everything (sites: [] clears)', () => {
  assert.deepEqual(planSiteReplacement(['a', 'b'], []), { toDelete: ['a', 'b'] })
})

test('planSiteReplacement: same PUT twice deletes nothing the second time', () => {
  const incoming = [{ external_site_id: 'a' }, { external_site_id: 'b' }]
  const first = planSiteReplacement([], incoming)
  assert.deepEqual(first.toDelete, [])
  const second = planSiteReplacement(['a', 'b'], incoming)
  assert.deepEqual(second.toDelete, [])
})

// ---------------------------------------------------------------------------
// Response DTO: no unsafe keys, shape matches the contract
// ---------------------------------------------------------------------------

test('mapAccountResponse: shape matches the contract and carries no unsafe keys', () => {
  const dto = mapAccountResponse(
    'ext-1',
    { verificationLevel: 'id_verified', creditTier: 'standard' },
    [
      { externalSiteId: 'b', name: 'Annex', address: null, region: null },
      { externalSiteId: 'a', name: 'HQ', address: '1 Main St', region: DEFAULT_SITE_MARKER },
    ],
    true,
  )
  assert.deepEqual(dto, {
    portal_account_id: 'ext-1',
    verification_level: 'id_verified',
    credit_tier: 'standard',
    client_linked: true,
    sites: [
      { external_site_id: 'a', label: 'HQ', address: '1 Main St', is_default: true },
      { external_site_id: 'b', label: 'Annex', address: null, is_default: false },
    ],
  })
})

test('mapAccountResponse: exactly one is_default survives the mapper', () => {
  const dto = mapAccountResponse(
    'ext-1',
    { verificationLevel: 'none', creditTier: 'standard' },
    [
      { externalSiteId: 'a', name: 'HQ', address: null, region: DEFAULT_SITE_MARKER },
      { externalSiteId: 'b', name: 'Annex', address: null, region: null },
    ],
    false,
  )
  assert.equal(dto.sites.filter((s) => s.is_default).length, 1)
})

// ---------------------------------------------------------------------------
// Provenance marker (survives a re-link because it never lives on the
// portal_accounts row — see the file header in accounts.ts)
// ---------------------------------------------------------------------------

test('portalOriginMarker round-trips through portalOriginAccountId', () => {
  const notes = portalOriginMarker('pacc_123')
  assert.equal(portalOriginAccountId(notes), 'pacc_123')
})

test('portalOriginAccountId: null, empty and unrelated notes all read as no marker', () => {
  assert.equal(portalOriginAccountId(null), null)
  assert.equal(portalOriginAccountId(''), null)
  assert.equal(portalOriginAccountId('Called about a Flow renewal.'), null)
})

// ---------------------------------------------------------------------------
// Re-link refusal rule (pure)
// ---------------------------------------------------------------------------

test('assertRelinkAllowed: a target with no portal account is fine', () => {
  assert.doesNotThrow(() => assertRelinkAllowed({ portalAccount: null }, 'pc_1'))
})

test('assertRelinkAllowed: refuses a target already linked, same portal client', () => {
  assert.throws(
    () => assertRelinkAllowed({ portalAccount: { portalClientId: 'pc_1' } }, 'pc_1'),
    /already has a portal account for this portal client/,
  )
})

test('assertRelinkAllowed: refuses a target already linked to a different portal client too', () => {
  assert.throws(
    () => assertRelinkAllowed({ portalAccount: { portalClientId: 'pc_2' } }, 'pc_1'),
    /already has a portal account/,
  )
})
