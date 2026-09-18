export const registrationConfig = {
  prices: { ieee: 399, nonIeee: 799 },
  payment: { upiId: null, payeeName: null, qrAsset: null },
  maxPaymentProofBytes: 5 * 1024 * 1024,
};

export const workshops = [
  { id: 'data-science-python', number: '01', title: 'DATA SCIENCE AND ANALYTICS USING PYTHON', accent: 'orange' },
  { id: 'ai-ml-data', number: '02', title: 'AI / ML / DATA', accent: 'blue' },
  { id: 'github-ai', number: '03', title: 'GITHUB × AI', accent: 'green' },
];

export const years = [
  { id: 'first', number: '01', label: 'FIRST YEAR' },
  { id: 'second', number: '02', label: 'SECOND YEAR' },
  { id: 'third', number: '03', label: 'THIRD YEAR' },
  { id: 'fourth', number: '04', label: 'FOURTH YEAR' },
];
