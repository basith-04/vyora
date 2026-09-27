export const GENDER_OPTIONS = Object.freeze([{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }]);
export const FOOD_OPTIONS = Object.freeze([{ value: 'VEG', label: 'Veg' }, { value: 'NON_VEG', label: 'Non-Veg' }]);
export const HEALTH_NOTE_MAX_LENGTH = 300;
export function completionErrors(input) {
  const errors = {};
  if (typeof input.registrationId !== 'string' || !input.registrationId.trim() || input.registrationId.length > 80) errors.registrationId = 'Enter your Registration ID.';
  if (!GENDER_OPTIONS.some(({ value }) => value === input.gender)) errors.gender = 'Select Male or Female.';
  if (!FOOD_OPTIONS.some(({ value }) => value === input.foodPreference)) errors.foodPreference = 'Select Veg or Non-Veg.';
  if (typeof input.healthSafetyConcern !== 'boolean') errors.healthSafetyConcern = 'Select No or Yes.';
  if (input.healthSafetyConcern === true && (typeof input.healthSafetyNote !== 'string' || !input.healthSafetyNote.trim() || input.healthSafetyNote.length > HEALTH_NOTE_MAX_LENGTH)) errors.healthSafetyNote = `Enter a short description (maximum ${HEALTH_NOTE_MAX_LENGTH} characters).`;
  return errors;
}
