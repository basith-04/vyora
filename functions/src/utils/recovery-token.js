import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function readRecoveryToken(request) {
  const token = request.get('x-registration-token');
  if (!token || !TOKEN_PATTERN.test(token)) {
    throw new AppError(
      'INVALID_RECOVERY_TOKEN',
      'A valid registration recovery token is required.',
      400,
    );
  }
  return token;
}

export function hashRecoveryToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
