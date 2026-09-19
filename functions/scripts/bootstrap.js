import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_CONFIGURATION,
  SYSTEM_DOCUMENTS,
} from '../src/config/constants.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const documents = [
  [
    db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity),
    { ...DEFAULT_CONFIGURATION.capacity, updatedAt: FieldValue.serverTimestamp() },
  ],
  [
    db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.registrationConfig),
    { ...DEFAULT_CONFIGURATION.registration, updatedAt: FieldValue.serverTimestamp() },
  ],
  ...Object.entries(DEFAULT_CONFIGURATION.workshops).map(([workshopId, workshop]) => [
    db.collection(COLLECTIONS.workshops).doc(workshopId),
    {
      ...workshop,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  ]),
];

const results = await db.runTransaction(async (transaction) => {
  const snapshots = await transaction.getAll(...documents.map(([reference]) => reference));
  return snapshots.map((snapshot, index) => {
    if (snapshot.exists) return { path: snapshot.ref.path, status: 'preserved' };
    transaction.create(documents[index][0], documents[index][1]);
    return { path: snapshot.ref.path, status: 'created' };
  });
});

for (const result of results) {
  console.log(`${result.status.toUpperCase()}: ${result.path}`);
}
