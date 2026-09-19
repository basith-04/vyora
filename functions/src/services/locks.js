import { createHash } from 'node:crypto';

function hashIdentifier(kind, value) {
  return createHash('sha256').update(`${kind}:${value}`, 'utf8').digest('hex');
}

export function duplicateLockIds(participant) {
  return [
    `email_${hashIdentifier('email', participant.email)}`,
    `phone_${hashIdentifier('phone', participant.phone)}`,
  ];
}
