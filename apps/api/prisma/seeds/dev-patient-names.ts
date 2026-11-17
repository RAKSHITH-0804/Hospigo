/** Fake first/last names for development patient seed only — nothing real. */
export const DEV_SEED_FIRST_NAMES = [
  'Aarav',
  'Diya',
  'Kabir',
  'Meera',
  'Rohan',
  'Ananya',
  'Vikram',
  'Isha',
  'Arjun',
  'Neha',
  'Sahil',
  'Pooja',
  'Nikhil',
  'Kavya',
  'Aditya',
  'Sneha',
  'Rahul',
  'Priya',
  'Aman',
  'Nisha',
] as const;

export const DEV_SEED_LAST_NAMES = [
  'Sharma',
  'Patel',
  'Reddy',
  'Nair',
  'Gupta',
  'Iyer',
  'Khan',
  'Das',
  'Joshi',
  'Mehta',
  'Chopra',
  'Pillai',
  'Bose',
  'Verma',
  'Rao',
] as const;

export const DEV_SEED_AREAS = [
  'Lakeview',
  'Market Cross',
  'Station Road',
  'Green Park',
  'Temple Street',
] as const;

export const DEV_SEED_CITIES = ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi'] as const;

export const DEV_SEED_STATES = ['Karnataka', 'Tamil Nadu', 'Kerala'] as const;

export const DEV_SEED_GENDERS = ['M', 'F', 'O'] as const;

/** Target fake patients per demo hospital. */
export const DEV_SEED_PATIENT_TARGET = 60;

/** Spread created_at over this many days (inclusive of today). */
export const DEV_SEED_CREATED_AT_DAYS = 30;
