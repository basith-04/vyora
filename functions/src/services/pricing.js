import { configurationError } from '../errors.js';

function validAmount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validatePricingConfiguration(pricing) {
  if (
    !pricing
    || !validAmount(pricing.ieee)
    || !validAmount(pricing.nonIeee)
    || !validAmount(pricing.accommodation?.nonAc)
    || !validAmount(pricing.accommodation?.ac)
  ) {
    throw configurationError('Registration pricing is not configured correctly.');
  }
  return pricing;
}

export function calculatePricing(participant, pricingInput) {
  const pricing = validatePricingConfiguration(pricingInput);
  const baseFee = participant.ieeeMember ? pricing.ieee : pricing.nonIeee;
  let stayFee = 0;

  if (!participant.isHosteller && participant.needsStay) {
    stayFee = participant.stayType === 'AC'
      ? pricing.accommodation.ac
      : pricing.accommodation.nonAc;
  }

  return {
    baseFee,
    stayFee,
    totalFee: baseFee + stayFee,
  };
}
