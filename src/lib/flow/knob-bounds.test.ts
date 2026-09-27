import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowOrderKnobsProblem } from './knob-bounds'

test('stored knobs within bounds pass, blanks are fine', () => {
  assert.equal(flowOrderKnobsProblem({ flowMarginPct: 30, flowRecoverByMonth: 12, flowStepPct: null }, 24), null)
  assert.equal(flowOrderKnobsProblem({}, 12), null)
})

test('an out-of-range knob is refused with its label', () => {
  assert.match(flowOrderKnobsProblem({ flowMarginPct: -5 }, 12)!, /Margin %/)
  assert.match(flowOrderKnobsProblem({ flowLifeMonths: 2.5 }, 12)!, /whole number/)
  assert.match(flowOrderKnobsProblem({ flowFinancePct: Number.NaN }, 12)!, /Finance %/)
})

test('a stored decimal reads as its number', () => {
  const decimal = { toString: () => '101', valueOf: () => 101 }
  assert.match(flowOrderKnobsProblem({ flowFinancePct: decimal }, 12)!, /Finance %/)
})

test('recover-by month later than the term is refused', () => {
  assert.match(flowOrderKnobsProblem({ flowRecoverByMonth: 9 }, 6)!, /later than the term/)
  assert.equal(flowOrderKnobsProblem({ flowRecoverByMonth: 6 }, 6), null)
  assert.equal(flowOrderKnobsProblem({ flowRecoverByMonth: 9 }, null), null)
})
