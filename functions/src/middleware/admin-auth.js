import { AppError } from '../errors.js';
import { COLLECTIONS } from '../config/constants.js';

const ADMIN_ROLES = new Set(['ADMIN', 'COORDINATOR']);

export function createAdminAuthorization({ auth, db }) {
  return async function authorizeAdmin(request, response, next) {
    try {
      const header = request.get('authorization');
      const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
      if (!match) {
        throw new AppError('ADMIN_AUTH_REQUIRED', 'A valid staff session is required.', 401);
      }

      let decoded;
      try {
        decoded = await auth.verifyIdToken(match[1]);
      } catch {
        throw new AppError('ADMIN_TOKEN_INVALID', 'The staff session is invalid or expired.', 401);
      }

      const snapshot = await db.collection(COLLECTIONS.admins).doc(decoded.uid).get();
      const profile = snapshot.exists ? snapshot.data() : null;
      if (!profile || profile.active !== true || !ADMIN_ROLES.has(profile.role)) {
        throw new AppError('ADMIN_ACCESS_DENIED', 'This account is not authorized for VYORA staff access.', 403);
      }

      request.admin = {
        uid: decoded.uid,
        name: profile.name,
        email: profile.email || decoded.email || null,
        role: profile.role,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdminRole(request, response, next) {
  if (request.admin?.role !== 'ADMIN') {
    next(new AppError('FORBIDDEN', 'Administrator access is required for this operation.', 403));
    return;
  }
  next();
}
