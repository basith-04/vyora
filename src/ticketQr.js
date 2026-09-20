import QRCode from 'qrcode';

export function renderTicketQr(ticketPayload) {
  if (typeof ticketPayload !== 'string' || !/^vyora26:t:[A-Za-z0-9_-]{43}$/.test(ticketPayload)) {
    throw new Error('The ticket payload is invalid.');
  }
  return QRCode.toDataURL(ticketPayload, {
    errorCorrectionLevel: 'H',
    width: 420,
    margin: 3,
    color: { dark: '#071c2cff', light: '#fffdf5ff' },
  });
}
