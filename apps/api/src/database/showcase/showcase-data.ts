/**
 * Fictional but realistic data for the showcase hospitals (Step 2.1d). Every name here is invented:
 * the hospitals are not real, the doctors' registration numbers are not real, the phone numbers are
 * made from a fixed pattern and the Aadhaar-style identifiers are never stored. No name contains
 * Mock, Demo, Seed or Test.
 */

export type ShowcaseDoctor = {
  name: string;
  speciality: string;
  qualifications: string;
  department: string;
  /** Fee for a new visit and for a follow-up, in whole rupees. */
  newFee: number;
  followUpFee: number;
};

export type ShowcaseHospital = {
  code: string;
  name: string;
  slug: string;
  /** The header and footer lines of the printouts (fictional) and the colour of the logo mark. */
  contact: { address: string; phone: string; email: string; web: string; footer: string };
  logo: { name: string; colour: [number, number, number]; variant: 'CROSS' | 'HEART' };
  branches: Array<{ code: string; name: string; accessCode: string; isMain: boolean }>;
  superAdmin: string;
  admin: string;
  receptionists: string[];
  nurses: string[];
  doctors: ShowcaseDoctor[];
};

export const SHOWCASE_HOSPITALS: ShowcaseHospital[] = [
  {
    code: 'NANDAVANA',
    name: 'Nandavana Multispeciality Hospital',
    slug: 'nandavana',
    contact: {
      address: '14, Keshwapur Main Road, Hubballi, Karnataka 580023',
      phone: '0836 2255 0100',
      email: 'care@nandavana-hospital.example',
      web: 'www.nandavana-hospital.example',
      footer:
        'Open 24 hours. Emergency: 0836 2255 0111. Thank you for trusting us with your health.',
    },
    logo: { name: 'Nandavana mark', colour: [14, 116, 144], variant: 'CROSS' },
    branches: [
      { code: 'HUBBALLI', name: 'Hubballi Main', accessCode: 'nandavana-hubballi', isMain: true },
      { code: 'DHARWAD', name: 'Dharwad Clinic', accessCode: 'nandavana-dharwad', isMain: false },
    ],
    superAdmin: 'Ramesh Kulkarni',
    admin: 'Shobha Patil',
    receptionists: ['Anitha Gowda', 'Mohammed Irfan'],
    nurses: ['Sister Mercy Thomas', 'Kavitha Nayak'],
    doctors: [
      {
        name: 'Dr. Vinayak Hegde',
        speciality: 'General Medicine',
        qualifications: 'MBBS, MD (General Medicine)',
        department: 'General Medicine',
        newFee: 500,
        followUpFee: 250,
      },
      {
        name: 'Dr. Meenakshi Iyer',
        speciality: 'Paediatrics',
        qualifications: 'MBBS, DCH, MD (Paediatrics)',
        department: 'Paediatrics',
        newFee: 600,
        followUpFee: 300,
      },
      {
        name: 'Dr. Suresh Naik',
        speciality: 'Orthopaedics',
        qualifications: 'MBBS, MS (Orthopaedics)',
        department: 'Orthopaedics',
        newFee: 700,
        followUpFee: 350,
      },
      {
        name: 'Dr. Farhana Sheikh',
        speciality: 'Gynaecology',
        qualifications: 'MBBS, DGO, MS (OBG)',
        department: 'Gynaecology',
        newFee: 650,
        followUpFee: 300,
      },
      {
        name: 'Dr. Prakash Deshpande',
        speciality: 'ENT',
        qualifications: 'MBBS, MS (ENT)',
        department: 'ENT',
        newFee: 550,
        followUpFee: 275,
      },
    ],
  },
  {
    code: 'SAGARIKA',
    name: 'Sagarika Heart and Eye Centre',
    slug: 'sagarika',
    contact: {
      address: '42, Beach Road, Karwar, Karnataka 581301',
      phone: '08382 226 400',
      email: 'hello@sagarika-centre.example',
      web: 'www.sagarika-centre.example',
      footer: 'Heart and eye care by the sea. Appointments: 08382 226 401.',
    },
    logo: { name: 'Sagarika mark', colour: [153, 27, 27], variant: 'HEART' },
    branches: [
      { code: 'MANGALURU', name: 'Mangaluru Main', accessCode: 'sagarika-mangaluru', isMain: true },
      { code: 'UDUPI', name: 'Udupi Clinic', accessCode: 'sagarika-udupi', isMain: false },
    ],
    superAdmin: 'Lakshmi Prabhu',
    admin: "Joseph D'Souza",
    receptionists: ['Pooja Shetty', 'Abdul Rahim'],
    nurses: ['Sister Reshma Pinto', 'Deepa Bhat'],
    doctors: [
      {
        name: 'Dr. Narayan Rao',
        speciality: 'Cardiology',
        qualifications: 'MBBS, MD, DM (Cardiology)',
        department: 'Cardiology',
        newFee: 900,
        followUpFee: 450,
      },
      {
        name: 'Dr. Sunitha Kamath',
        speciality: 'Ophthalmology',
        qualifications: 'MBBS, MS (Ophthalmology)',
        department: 'Ophthalmology',
        newFee: 600,
        followUpFee: 300,
      },
      {
        name: 'Dr. Anil Menon',
        speciality: 'General Medicine',
        qualifications: 'MBBS, MD (General Medicine)',
        department: 'General Medicine',
        newFee: 500,
        followUpFee: 250,
      },
      {
        name: 'Dr. Rukmini Bhandary',
        speciality: 'Diabetology',
        qualifications: 'MBBS, MD, Diploma in Diabetology',
        department: 'Diabetology',
        newFee: 600,
        followUpFee: 300,
      },
    ],
  },
];

/** Indian first and last names from different regions. */
export const FIRST_NAMES_M = [
  'Praveen',
  'Basavaraj',
  'Mahesh',
  'Ravi',
  'Santosh',
  'Manjunath',
  'Arun',
  'Venkatesh',
  'Karthik',
  'Suresh',
  'Rajesh',
  'Anand',
  'Imran',
  'Faisal',
  'Gopal',
  'Harish',
  'Vikram',
  'Amit',
  'Sandeep',
  'Nikhil',
  'Ganesh',
  'Prasad',
  'Mohan',
  'Satish',
  'Dinesh',
  'Ajay',
  'Rohit',
  'Sanjay',
  'Naveen',
  'Girish',
];
export const FIRST_NAMES_F = [
  'Savitha',
  'Lakshmi',
  'Anjali',
  'Meera',
  'Kavya',
  'Shruti',
  'Pooja',
  'Divya',
  'Sunita',
  'Rekha',
  'Fatima',
  'Ayesha',
  'Priya',
  'Radha',
  'Geetha',
  'Nandini',
  'Sneha',
  'Swati',
  'Uma',
  'Vasanthi',
  'Padma',
  'Jyothi',
  'Bhavana',
  'Mamatha',
  'Roshni',
  'Deepika',
  'Shilpa',
  'Asha',
  'Neha',
  'Pallavi',
];
export const LAST_NAMES = [
  'Patil',
  'Kulkarni',
  'Hegde',
  'Naik',
  'Gowda',
  'Shetty',
  'Bhat',
  'Rao',
  'Reddy',
  'Nair',
  'Iyer',
  'Menon',
  'Pillai',
  'Sharma',
  'Verma',
  'Gupta',
  'Joshi',
  'Desai',
  'Shah',
  'Banerjee',
  'Das',
  'Khan',
  'Sheikh',
  'Ansari',
  "D'Souza",
  'Fernandes',
  'Pinto',
  'Kamath',
  'Prabhu',
  'Bhandary',
  'Jadhav',
  'Pawar',
  'Singh',
  'Chauhan',
  'Mishra',
  'Nayak',
  'Acharya',
  'Hiremath',
  'Angadi',
  'Mallya',
];
export const RELATIVE_PREFIX = ['S/O', 'D/O', 'W/O'];

export const CITIES: Array<{ city: string; state: string; pin: string; areas: string[] }> = [
  {
    city: 'Hubballi',
    state: 'Karnataka',
    pin: '580020',
    areas: ['Vidyanagar', 'Keshwapur', 'Gokul Road', 'Unkal', 'Navanagar'],
  },
  {
    city: 'Dharwad',
    state: 'Karnataka',
    pin: '580001',
    areas: ['Saptapur', 'Jubilee Circle', 'Kalyan Nagar', 'Hosayellapur'],
  },
  {
    city: 'Mangaluru',
    state: 'Karnataka',
    pin: '575001',
    areas: ['Kadri', 'Bejai', 'Hampankatta', 'Kodialbail', 'Surathkal'],
  },
  {
    city: 'Udupi',
    state: 'Karnataka',
    pin: '576101',
    areas: ['Manipal', 'Kunjibettu', 'Malpe', 'Indrali'],
  },
  { city: 'Belagavi', state: 'Karnataka', pin: '590001', areas: ['Tilakwadi', 'Shahapur', 'Camp'] },
];

export const SYMPTOMS = [
  'Fever and body ache since two days',
  'Cough and cold with sore throat',
  'Headache and dizziness',
  'Stomach pain and loose motions',
  'Pain in the knee while walking',
  'Breathlessness on climbing stairs',
  'Itching and skin rash',
  'High blood sugar, routine check',
  'Chest discomfort since morning',
  'Ear pain and blocked nose',
  'Back pain for one week',
  'Weakness and loss of appetite',
  'Child with fever and cough',
  'Routine antenatal check',
  'Blurred vision in the evening',
];

export const DIAGNOSES = [
  'Viral fever',
  'Upper respiratory tract infection',
  'Acute gastroenteritis',
  'Type 2 diabetes mellitus',
  'Essential hypertension',
  'Osteoarthritis of the knee',
  'Allergic dermatitis',
  'Acute otitis media',
  'Migraine',
  'Lumbar spondylosis',
  'Anaemia',
  'Bronchial asthma',
  'Refractive error',
  'Normal antenatal visit',
];

export const ADVICE = [
  'Rest, plenty of fluids, review if fever persists beyond three days.',
  'Avoid cold drinks and oily food. Review after one week.',
  'Regular walking, reduce salt, review with blood tests in one month.',
  'Hot fomentation and physiotherapy exercises.',
  'Steam inhalation twice a day, complete the course of medicines.',
  'Review with reports.',
];

export const MEDICINES: Array<{ code: string; name: string; composition: string; form: string }> = [
  {
    code: 'PARA500',
    name: 'Paracetamol 500 mg',
    composition: 'Paracetamol 500 mg',
    form: 'Tablet',
  },
  { code: 'DOLO650', name: 'Dolo 650', composition: 'Paracetamol 650 mg', form: 'Tablet' },
  {
    code: 'AZI500',
    name: 'Azithromycin 500 mg',
    composition: 'Azithromycin 500 mg',
    form: 'Tablet',
  },
  {
    code: 'AMOXCLAV',
    name: 'Amoxicillin and Clavulanate 625',
    composition: 'Amoxicillin 500 mg + Clavulanic acid 125 mg',
    form: 'Tablet',
  },
  { code: 'CETRIZ10', name: 'Cetirizine 10 mg', composition: 'Cetirizine 10 mg', form: 'Tablet' },
  {
    code: 'PANTO40',
    name: 'Pantoprazole 40 mg',
    composition: 'Pantoprazole 40 mg',
    form: 'Tablet',
  },
  { code: 'ORS', name: 'ORS powder', composition: 'Oral rehydration salts', form: 'Sachet' },
  { code: 'METF500', name: 'Metformin 500 mg', composition: 'Metformin 500 mg', form: 'Tablet' },
  { code: 'AMLO5', name: 'Amlodipine 5 mg', composition: 'Amlodipine 5 mg', form: 'Tablet' },
  { code: 'TELMI40', name: 'Telmisartan 40 mg', composition: 'Telmisartan 40 mg', form: 'Tablet' },
  {
    code: 'ATORVA10',
    name: 'Atorvastatin 10 mg',
    composition: 'Atorvastatin 10 mg',
    form: 'Tablet',
  },
  { code: 'IBU400', name: 'Ibuprofen 400 mg', composition: 'Ibuprofen 400 mg', form: 'Tablet' },
  { code: 'DICLO50', name: 'Diclofenac 50 mg', composition: 'Diclofenac 50 mg', form: 'Tablet' },
  {
    code: 'CALD3',
    name: 'Calcium and Vitamin D3',
    composition: 'Calcium 500 mg + Vitamin D3 250 IU',
    form: 'Tablet',
  },
  {
    code: 'BCOMP',
    name: 'B-Complex with Vitamin C',
    composition: 'Vitamin B complex + Vitamin C',
    form: 'Capsule',
  },
  { code: 'ASPIRIN75', name: 'Aspirin 75 mg', composition: 'Aspirin 75 mg', form: 'Tablet' },
  {
    code: 'COUGHSYR',
    name: 'Cough syrup (expectorant)',
    composition: 'Ambroxol + Guaifenesin',
    form: 'Syrup',
  },
  {
    code: 'SALBUT',
    name: 'Salbutamol inhaler',
    composition: 'Salbutamol 100 mcg',
    form: 'Inhaler',
  },
  { code: 'MONTEL10', name: 'Montelukast 10 mg', composition: 'Montelukast 10 mg', form: 'Tablet' },
  { code: 'FOLIC5', name: 'Folic acid 5 mg', composition: 'Folic acid 5 mg', form: 'Tablet' },
  {
    code: 'IRON',
    name: 'Iron and Folic acid',
    composition: 'Ferrous ascorbate + Folic acid',
    form: 'Tablet',
  },
  {
    code: 'OFLOX',
    name: 'Ofloxacin eye drops',
    composition: 'Ofloxacin 0.3 percent',
    form: 'Eye drops',
  },
  {
    code: 'CARBOXY',
    name: 'Carboxymethylcellulose eye drops',
    composition: 'Carboxymethylcellulose 0.5 percent',
    form: 'Eye drops',
  },
  {
    code: 'NASAL',
    name: 'Xylometazoline nasal drops',
    composition: 'Xylometazoline 0.1 percent',
    form: 'Nasal drops',
  },
  {
    code: 'CLOBET',
    name: 'Clobetasol cream',
    composition: 'Clobetasol propionate 0.05 percent',
    form: 'Cream',
  },
  { code: 'DOMPER', name: 'Domperidone 10 mg', composition: 'Domperidone 10 mg', form: 'Tablet' },
  { code: 'LOPERA', name: 'Loperamide 2 mg', composition: 'Loperamide 2 mg', form: 'Capsule' },
  { code: 'GLIMEP1', name: 'Glimepiride 1 mg', composition: 'Glimepiride 1 mg', form: 'Tablet' },
  { code: 'CLOPID75', name: 'Clopidogrel 75 mg', composition: 'Clopidogrel 75 mg', form: 'Tablet' },
  {
    code: 'METOP25',
    name: 'Metoprolol 25 mg',
    composition: 'Metoprolol succinate 25 mg',
    form: 'Tablet',
  },
];

export const DOSES = ['1 tablet', '1 capsule', '5 ml', '2 drops', '1 sachet', '1 puff'];
export const FREQUENCIES = [
  'Once a day',
  'Twice a day',
  'Three times a day',
  'At night',
  'Before food',
];
export const DURATIONS = ['3 days', '5 days', '7 days', '10 days', '15 days', '1 month'];

/** Laboratory and imaging tests with their price in whole rupees. */
export const TESTS: Array<{ code: string; name: string; price: number }> = [
  { code: 'CBC', name: 'Complete blood count', price: 300 },
  { code: 'HB', name: 'Haemoglobin', price: 120 },
  { code: 'ESR', name: 'ESR', price: 100 },
  { code: 'FBS', name: 'Fasting blood sugar', price: 80 },
  { code: 'PPBS', name: 'Post-meal blood sugar', price: 80 },
  { code: 'HBA1C', name: 'HbA1c', price: 450 },
  { code: 'LIPID', name: 'Lipid profile', price: 600 },
  { code: 'LFT', name: 'Liver function test', price: 650 },
  { code: 'KFT', name: 'Kidney function test', price: 600 },
  { code: 'TSH', name: 'Thyroid stimulating hormone', price: 350 },
  { code: 'URINE', name: 'Urine routine', price: 120 },
  { code: 'STOOL', name: 'Stool routine', price: 120 },
  { code: 'WIDAL', name: 'Widal test', price: 250 },
  { code: 'DENGUE', name: 'Dengue NS1 antigen', price: 700 },
  { code: 'MALARIA', name: 'Malaria parasite', price: 300 },
  { code: 'CRP', name: 'C-reactive protein', price: 450 },
  { code: 'VITD', name: 'Vitamin D', price: 1100 },
  { code: 'B12', name: 'Vitamin B12', price: 900 },
  { code: 'ECG', name: 'ECG', price: 250 },
  { code: 'ECHO', name: '2D Echo', price: 1800 },
  { code: 'TMT', name: 'Treadmill test', price: 1500 },
  { code: 'XRAYCH', name: 'X-ray chest', price: 400 },
  { code: 'XRAYKN', name: 'X-ray knee', price: 450 },
  { code: 'USGAB', name: 'Ultrasound abdomen', price: 900 },
  { code: 'OCT', name: 'OCT retina', price: 1200 },
  { code: 'PTA', name: 'Pure tone audiometry', price: 500 },
];
