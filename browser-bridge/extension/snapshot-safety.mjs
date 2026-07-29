const SENSITIVE_AUTOCOMPLETE = new Set([
  'one-time-code', 'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
]);
const SENSITIVE_NAME = /(?:pass(?:word)?|otp|one.?time|verification|cvv|cvc|card.?number)/i;

export function isSensitiveControl({ type = '', autocomplete = '', name = '', id = '', ariaLabel = '' } = {}) {
  return String(type).toLowerCase() === 'password'
    || SENSITIVE_AUTOCOMPLETE.has(String(autocomplete).toLowerCase())
    || SENSITIVE_NAME.test(`${name} ${id} ${ariaLabel}`);
}

export function sanitizeText(value, maxLength = 512) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function createOpaqueRef(snapshotGeneration, sequence) {
  if (!Number.isSafeInteger(snapshotGeneration) || snapshotGeneration < 1 || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('Invalid snapshot reference');
  }
  return `ref_${snapshotGeneration}_${sequence}`;
}
