import upiQr from '../assets/payment/upiQr.png';
import { registrationOptions } from './registrationOptions.js';

export { hostels, workshops, years } from './registrationOptions.js';

export const registrationConfig = {
  ...registrationOptions,
  payment: { upiId: null, payeeName: null, qrAsset: upiQr },
};
