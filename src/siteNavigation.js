export const publicSections = [
  { id: 'home', label: 'Home' },
  { id: 'program', label: 'Program' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'people', label: 'People' },
  { id: 'field', label: 'Field' },
  { id: 'register', label: 'Register' },
];

export const legacySectionRoutes = Object.fromEntries(
  publicSections.filter(({ id }) => id !== 'home').map(({ id }) => [`/${id}`, id]),
);
