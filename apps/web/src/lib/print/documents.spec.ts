import { staffCopy } from '@/config/staff-copy';
import type { ConsultationResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import type { VisitView } from '@/lib/opd/types';
import type { PatientDetail } from '@/lib/patients/types';
import { prescriptionItems, receiptItems, slipItems } from './documents';
import type { PrintItem } from './types';

// The fields each document can show, in the API's order (PRINT_FIELDS of print-template.rules.ts).
const API_FIELDS = {
  REGISTRATION_SLIP: [
    'hospitalName',
    'uhid',
    'patientName',
    'age',
    'gender',
    'phone',
    'address',
    'registeredOn',
    'branchName',
  ],
  RECEIPT: [
    'hospitalName',
    'billNumber',
    'receiptNumber',
    'token',
    'patientName',
    'uhid',
    'doctorName',
    'visitDate',
    'branchName',
    'lines',
    'total',
    'paid',
    'refunded',
    'paymentModes',
    'referenceNo',
  ],
  PRESCRIPTION: [
    'hospitalName',
    'patientName',
    'uhid',
    'age',
    'gender',
    'visitDate',
    'token',
    'doctorName',
    'doctorDepartment',
    'doctorQualifications',
    'doctorSpeciality',
    'doctorRegistrationNo',
    'doctorSignature',
    'vitals',
    'complaints',
    'diagnosis',
    'medicines',
    'tests',
    'advice',
    'followUpDate',
  ],
} as const;

const get = (items: PrintItem[], key: string): PrintItem => {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`no item ${key}`);
  return found;
};
const textOf = (items: PrintItem[], key: string) => {
  const item = get(items, key);
  return 'text' in item ? item.text : '';
};

const visit: VisitView = {
  id: 'v1',
  status: 'WAITING',
  visitType: 'NEW',
  visitDate: '2026-11-20',
  branch: { id: 'b1', name: 'Main Branch' },
  patient: { id: 'p1', uhid: 'HSP-0001', name: 'Asha Rao' },
  doctor: { id: 'd1', code: 'DR1', name: 'Dr Meena' },
  previousVisitId: null,
  token: { date: '2026-11-20', no: 7, label: 'T-007' },
  queuedAt: null,
  createdAt: '2026-11-20T04:00:00.000Z',
  bill: {
    id: 'bill1',
    billNumber: '2627/00012',
    billType: 'CONSULTATION',
    billDate: '2026-11-20T04:00:00.000Z',
    subtotalPaise: 60_000,
    taxPaise: 0,
    totalPaise: 60_000,
    paidPaise: 60_000,
    refundedPaise: 10_000,
    paymentStatus: 'PAID',
    lines: [
      {
        lineNo: 1,
        kind: 'CONSULTATION',
        code: 'DR1',
        description: 'Dr Meena',
        quantity: 1,
        unitPricePaise: 50_000,
        taxPaise: 0,
        lineTotalPaise: 50_000,
        pricingNote: null,
      },
      {
        lineNo: 2,
        kind: 'REGISTRATION',
        code: 'REG',
        description: 'Registration',
        quantity: 1,
        unitPricePaise: 10_000,
        taxPaise: 0,
        lineTotalPaise: 10_000,
        pricingNote: null,
      },
    ],
    payments: [
      {
        id: 'pay1',
        receiptNumber: 'R-1',
        amountPaise: 40_000,
        paymentMode: { code: 'CASH', name: 'Cash' },
        referenceNo: null,
        paidAt: '2026-11-20T04:00:00.000Z',
      },
      {
        id: 'pay2',
        receiptNumber: 'R-1',
        amountPaise: 20_000,
        paymentMode: { code: 'UPI', name: 'UPI' },
        referenceNo: 'UTR123',
        paidAt: '2026-11-20T04:00:00.000Z',
      },
    ],
  },
};

describe('the hospital name', () => {
  it('is the first value of every document', () => {
    expect(textOf(receiptItems(visit, 'Demo Hospital'), 'hospitalName')).toBe('Demo Hospital');
    expect(receiptItems(visit, 'Demo Hospital')[0]!.key).toBe('hospitalName');
  });
});

describe('receiptItems', () => {
  it('has exactly the receipt fields of the API, in the API order, each with a caption', () => {
    const items = receiptItems(visit, 'Demo Hospital');
    expect(items.map((i) => i.key)).toEqual([...API_FIELDS.RECEIPT]);
    for (const item of items) {
      expect({ key: item.key, label: item.label }).toEqual({
        key: item.key,
        label: staffCopy.print.fields[item.key],
      });
    }
  });

  it('writes money from whole paise and shows a split receipt number once', () => {
    const items = receiptItems(visit, 'Demo Hospital');
    expect(textOf(items, 'receiptNumber')).toBe('R-1');
    expect(textOf(items, 'total')).toContain('600');
    expect(textOf(items, 'refunded')).toContain('100');
    const lines = get(items, 'lines');
    expect('pairs' in lines && lines.pairs.map((p) => p[1].replace(/\D/g, ''))).toEqual([
      '50000',
      '10000',
    ]);
    const modes = get(items, 'paymentModes');
    expect('pairs' in modes && modes.pairs.map((p) => p[0])).toEqual(['Cash', 'UPI']);
    const refs = get(items, 'referenceNo');
    expect('lines' in refs && refs.lines).toEqual(['UPI: UTR123']);
  });

  it('leaves the refunded text empty when nothing was returned, and copes with no bill', () => {
    const none = receiptItems(
      {
        ...visit,
        bill: { ...visit.bill!, refundedPaise: 0 },
      },
      'Demo Hospital',
    );
    expect(textOf(none, 'refunded')).toBe('');
    const noBill = receiptItems({ ...visit, bill: null, token: null }, 'Demo Hospital');
    expect(textOf(noBill, 'total')).toBe('');
    expect(textOf(noBill, 'billNumber')).toBe('');
    expect(textOf(noBill, 'token')).toBe('');
  });

  it('explains a free follow-up line', () => {
    const items = receiptItems(
      {
        ...visit,
        bill: {
          ...visit.bill!,
          lines: [{ ...visit.bill!.lines![0]!, pricingNote: 'FOLLOW_UP_FREE' }],
        },
      },
      'Demo Hospital',
    );
    const lines = get(items, 'lines');
    expect('pairs' in lines && lines.pairs[0]![0]).toContain(staffCopy.opd.receipt.freeFollowUp);
  });
});

const patient: PatientDetail = {
  id: 'p1',
  uhid: 'HSP-0001',
  name: 'Asha Rao',
  gender: 'F',
  dateOfBirth: null,
  ageYears: 34,
  dobIsEstimated: false,
  phone: ' 9876543210 ',
  email: null,
  addressStreet: '12 Lake Road',
  addressCross: null,
  addressArea: '  ',
  addressCity: 'Mysuru',
  addressState: 'Karnataka',
  addressPincode: '570001',
  registeredBranchId: 'b1',
  isActive: true,
  customFieldValues: [],
};

describe('slipItems', () => {
  it('has exactly the slip fields of the API in order and joins only the address parts that exist', () => {
    const items = slipItems(patient, 'Main Branch', 'Demo Hospital');
    expect(items.map((i) => i.key)).toEqual([...API_FIELDS.REGISTRATION_SLIP]);
    expect(textOf(items, 'address')).toBe('12 Lake Road, Mysuru, Karnataka, 570001');
    expect(textOf(items, 'phone')).toBe('9876543210');
    expect(textOf(items, 'branchName')).toBe('Main Branch');
    expect(textOf(items, 'age')).toBe('34');
  });

  it('prints nothing for what the patient does not have', () => {
    const items = slipItems(
      {
        ...patient,
        phone: null,
        gender: null,
        ageYears: null,
        addressStreet: null,
        addressCity: null,
        addressState: null,
        addressPincode: null,
      },
      null,
      'Demo Hospital',
    );
    for (const key of ['phone', 'gender', 'age', 'address', 'branchName', 'registeredOn']) {
      expect({ key, value: textOf(items, key) }).toEqual({ key, value: '' });
    }
  });
});

const consultation: ConsultationResponse = {
  visit: {
    id: 'v1',
    status: 'COMPLETED',
    visitDate: '2026-11-20',
    token: { date: '2026-11-20', no: 7, label: 'T-007' },
    queuedAt: null,
    consultationStartedAt: null,
    completedAt: null,
    patient: { id: 'p1', uhid: 'HSP-0001', name: 'Asha Rao', gender: 'F', ageYears: 34 },
    doctor: { id: 'd1', code: 'DR1', name: 'Dr Meena' },
  },
  doctorDetails: {
    name: 'Dr Meena',
    printedName: 'Dr. M. Rao',
    printName: 'Dr. M. Rao',
    department: 'Medicine',
    qualifications: 'MBBS, MD',
    speciality: 'General Medicine',
    registrationNo: 'KMC/12345',
    signatureImageId: null,
    fromCompletedCopy: true,
  },
  consultation: {
    id: 'n1',
    status: 'COMPLETED',
    complaints: 'Fever 3 days',
    diagnosis: 'Viral fever',
    advice: 'Rest and fluids',
    followUpDate: '2026-11-27',
    completedAt: null,
    createdAt: '2026-11-20T04:00:00.000Z',
    updatedAt: '2026-11-20T04:30:00.000Z',
  },
  prescription: [
    {
      lineNo: 2,
      medicineId: null,
      medicineName: 'Cough syrup',
      isUnlisted: true,
      dose: '5 ml',
      frequency: 'night',
      duration: '5 days',
      instructions: 'after food',
    },
    {
      lineNo: 1,
      medicineId: 'm1',
      medicineName: 'Paracetamol 500',
      isUnlisted: false,
      dose: '1 tab',
      frequency: 'TDS',
      duration: '3 days',
      instructions: null,
    },
  ],
  addenda: [],
};

describe('prescriptionItems', () => {
  it('has exactly the prescription fields of the API, in order', () => {
    expect(
      prescriptionItems({ consultation, hospitalName: 'Demo Hospital' }).map((i) => i.key),
    ).toEqual([...API_FIELDS.PRESCRIPTION]);
  });

  it('numbers the medicines in prescription order and adds the instructions', () => {
    const med = get(
      prescriptionItems({ consultation, hospitalName: 'Demo Hospital' }),
      'medicines',
    );
    expect('lines' in med && med.lines).toEqual([
      '1. Paracetamol 500 · 1 tab · TDS · 3 days',
      '2. Cough syrup · 5 ml · night · 5 days (after food)',
    ]);
  });

  it('prints the note, the patient and the follow-up date', () => {
    const items = prescriptionItems({ consultation, hospitalName: 'Demo Hospital' });
    expect(textOf(items, 'complaints')).toBe('Fever 3 days');
    expect(textOf(items, 'diagnosis')).toBe('Viral fever');
    expect(textOf(items, 'advice')).toBe('Rest and fluids');
    expect(textOf(items, 'followUpDate')).not.toBe('');
    expect(textOf(items, 'age')).toBe('34');
  });

  it('prints the doctor details of the consultation: the printed name, then qualifications, speciality and registration number', () => {
    const items = prescriptionItems({ consultation, hospitalName: 'Demo Hospital' });
    expect(textOf(items, 'doctorName')).toBe('Dr. M. Rao');
    expect(textOf(items, 'doctorDepartment')).toBe('Medicine');
    expect(textOf(items, 'doctorQualifications')).toBe('MBBS, MD');
    expect(textOf(items, 'doctorSpeciality')).toBe('General Medicine');
    expect(textOf(items, 'doctorRegistrationNo')).toBe('KMC/12345');
    // the signature or stamp picture waits for the image upload step
    expect(textOf(items, 'doctorSignature')).toBe('');
  });

  it('prints empty details as empty, and the login name when there is no printed name', () => {
    const bare: ConsultationResponse = {
      ...consultation,
      doctorDetails: {
        ...consultation.doctorDetails,
        printedName: null,
        printName: 'Dr Meena',
        department: null,
        qualifications: null,
        speciality: null,
        registrationNo: null,
      },
    };
    const items = prescriptionItems({ consultation: bare, hospitalName: 'Demo Hospital' });
    expect(textOf(items, 'doctorName')).toBe('Dr Meena');
    for (const key of [
      'doctorDepartment',
      'doctorQualifications',
      'doctorSpeciality',
      'doctorRegistrationNo',
      'doctorSignature',
    ]) {
      expect({ key, value: textOf(items, key) }).toEqual({ key, value: '' });
    }
  });

  it('adds vitals and billed or ordered tests when given, and not a test that was not taken', () => {
    const vitals = {
      fields: [
        { name: 'Temperature', value: 101.2, unit: 'F' },
        { name: 'Pulse', value: 88, unit: 'bpm' },
      ],
    } as unknown as VitalsResponse;
    const tests = {
      orders: [
        { name: 'CBC', status: 'BILLED' },
        { name: 'Urine routine', status: 'NOT_TAKEN' },
        { name: 'Dengue NS1', status: 'ORDERED' },
      ],
    } as unknown as VisitTestsResponse;
    const items = prescriptionItems({ consultation, vitals, tests, hospitalName: 'Demo Hospital' });
    const v = get(items, 'vitals');
    expect('lines' in v && v.lines).toEqual(['Temperature: 101.2 F', 'Pulse: 88 bpm']);
    const t = get(items, 'tests');
    expect('lines' in t && t.lines).toEqual(['CBC', 'Dengue NS1']);
  });

  it('copes with a note that does not exist', () => {
    const items = prescriptionItems({
      consultation: { ...consultation, consultation: null },
      hospitalName: 'Demo Hospital',
    });
    expect(textOf(items, 'complaints')).toBe('');
    expect(textOf(items, 'followUpDate')).toBe('');
  });
});
