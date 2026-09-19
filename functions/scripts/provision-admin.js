import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const uid = option('uid');
const name = option('name')?.trim();
const role = option('role')?.toUpperCase();

if (!uid || !name || !['ADMIN', 'COORDINATOR'].includes(role)) {
  console.error('Usage: npm run provision-admin -- --uid <firebase-uid> --name "Name" --role ADMIN|COORDINATOR');
  process.exitCode = 1;
} else {
  if (getApps().length === 0) initializeApp();
  const authUser = await getAuth().getUser(uid);
  if (!authUser.email) throw new Error('The Firebase Authentication user must have an email address.');

  const db = getFirestore();
  const reference = db.collection('admins').doc(uid);
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) {
      throw new Error(`Admin ${uid} already exists; refusing to overwrite it.`);
    }
    const now = Timestamp.now();
    transaction.create(reference, {
      name,
      email: authUser.email.toLowerCase(),
      role,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  console.log(`Provisioned ${role} access for Firebase user ${uid}.`);
}
