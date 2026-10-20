import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyTestRedirect } from './send'

const msg = (to: string | string[]) => ({ to, subject: 'Your code', html: '<body>x</body>', text: 'x' })

afterEach(() => {
  delete process.env.EMAIL_TEST_REDIRECT
  delete process.env.EMAIL_SUBJECT_TAG
  delete process.env.EMAIL_DIRECT_ALLOW
})

describe('applyTestRedirect', () => {
  it('is a no-op with nothing configured', () => {
    assert.deepEqual(applyTestRedirect(msg('a@x.com')), msg('a@x.com'))
  })

  it('tags the subject of every message', () => {
    process.env.EMAIL_SUBJECT_TAG = 'AMC v2'
    assert.equal(applyTestRedirect(msg('a@x.com')).subject, '[AMC v2] Your code')
  })

  it('redirects and tags a customer message', () => {
    process.env.EMAIL_TEST_REDIRECT = 'tester@x.com'
    process.env.EMAIL_SUBJECT_TAG = 'AMC v2'
    process.env.EMAIL_DIRECT_ALLOW = 'staff@x.com'
    const out = applyTestRedirect(msg('client@y.com'))
    assert.equal(out.to, 'tester@x.com')
    assert.equal(out.subject, '[AMC v2] [test → client@y.com] Your code')
  })

  it('delivers to an allowed address for real, still tagged', () => {
    process.env.EMAIL_TEST_REDIRECT = 'tester@x.com'
    process.env.EMAIL_SUBJECT_TAG = 'AMC v2'
    process.env.EMAIL_DIRECT_ALLOW = 'Staff@X.com, other@x.com'
    const out = applyTestRedirect(msg('staff@x.com'))
    assert.equal(out.to, 'staff@x.com')
    assert.equal(out.subject, '[AMC v2] Your code')
  })

  it('delivers to anyone on an allowed domain, but not a lookalike', () => {
    process.env.EMAIL_TEST_REDIRECT = 'tester@x.com'
    process.env.EMAIL_DIRECT_ALLOW = '@vfxnow.com'
    assert.equal(applyTestRedirect(msg('new.hire@vfxnow.com')).to, 'new.hire@vfxnow.com')
    assert.equal(applyTestRedirect(msg('a@evilvfxnow.com')).to, 'tester@x.com')
    assert.equal(applyTestRedirect(msg('a@vfxnow.com.au')).to, 'tester@x.com')
  })

  it('redirects the whole message if any recipient is not allowed', () => {
    process.env.EMAIL_TEST_REDIRECT = 'tester@x.com'
    process.env.EMAIL_DIRECT_ALLOW = 'staff@x.com'
    assert.equal(applyTestRedirect(msg(['staff@x.com', 'client@y.com'])).to, 'tester@x.com')
  })
})

describe('resolveLogo', () => {
  const html = '<td><img src="cid:vfxnow-logo" width="96" alt="VFXnow"></td>'
  it('replaces the image with a wordmark when no URL is set', async () => {
    const { resolveLogo } = await import('./send')
    assert.equal(resolveLogo(html), '<td>VFXnow</td>')
  })
  it('points the image at EMAIL_LOGO_URL when set', async () => {
    const { resolveLogo } = await import('./send')
    process.env.EMAIL_LOGO_URL = 'https://x.io/l.png'
    assert.match(resolveLogo(html), /src="https:\/\/x\.io\/l\.png"/)
    delete process.env.EMAIL_LOGO_URL
  })
})
