import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricing } from '../../src/services/pricing.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';

const pricing = DEFAULT_CONFIGURATION.registration.pricing;

for (const [membership, baseFee] of [[true, 399], [false, 799]]) {
  const label = membership ? 'IEEE' : 'non-IEEE';

  test(`${label} without paid stay`, () => {
    assert.deepEqual(calculatePricing({
      ieeeMember: membership,
      isHosteller: true,
      needsStay: false,
      stayType: null,
    }, pricing), { baseFee, stayFee: 0, totalFee: baseFee });
  });

  test(`${label} with NON_AC stay`, () => {
    assert.deepEqual(calculatePricing({
      ieeeMember: membership,
      isHosteller: false,
      needsStay: true,
      stayType: 'NON_AC',
    }, pricing), { baseFee, stayFee: 250, totalFee: baseFee + 250 });
  });

  test(`${label} with AC stay`, () => {
    assert.deepEqual(calculatePricing({
      ieeeMember: membership,
      isHosteller: false,
      needsStay: true,
      stayType: 'AC',
    }, pricing), { baseFee, stayFee: 300, totalFee: baseFee + 300 });
  });
}
