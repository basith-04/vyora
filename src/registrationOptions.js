export const registrationOptions = {
  prices: { ieee: 399, nonIeee: 799 },
  accommodation: { nonAc: 250, ac: 300 },
};

export const hostels = [
  { id: 'SANJOSE', label: 'Sanjose' },
  { id: 'SANTHOME', label: 'Santhome' },
  { id: 'HOLY_CROSS', label: 'Holy Cross' },
  { id: 'ALPHONSA', label: 'Alphonsa' },
  { id: 'PG_HOUSE_NEAR_COLLEGE', label: 'PG/House Near College' },
];

export const workshops = [
  { id: 'data-science', number: '01', title: 'DATA SCIENCE AND ANALYTICS USING PYTHON', accent: 'orange' },
  { id: 'ai-ml-data', number: '02', title: 'AI / ML / DATA', accent: 'blue' },
  { id: 'github-ai', number: '03', title: 'GITHUB × AI', accent: 'green' },
];

export const years = [
  { id: 1, number: '01', label: 'FIRST YEAR' },
  { id: 2, number: '02', label: 'SECOND YEAR' },
  { id: 3, number: '03', label: 'THIRD YEAR' },
  { id: 4, number: '04', label: 'FOURTH YEAR' },
];

export const departmentClasses = Object.freeze({
  ADS: Object.freeze(['ADS A', 'ADS B']),
  CSE: Object.freeze(['CSE A', 'CSE B', 'CSE C', 'CSE D']),
  CSD: Object.freeze(['CSD']),
  CSBS: Object.freeze(['CSBS']),
  'CS & CY': Object.freeze(['CS & CY']),
  ECE: Object.freeze(['ECE']),
  'ME/CE': Object.freeze(['ME/CE']),
  EEE: Object.freeze(['EEE']),
  AEI: Object.freeze(['AEI']),
});
