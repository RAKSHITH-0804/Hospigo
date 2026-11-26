/** What the settings API answers (Step 7b). The API checks every value; these are only the shapes. */

export type OpdRules = {
  followUpFreeDays: number;
  repeatVisitFreeHours: number;
  /** Default paper of new documents (A4 or A5). */
  defaultPrintPaper?: 'A4' | 'A5';
  /** Offer the patient card print button after payment. */
  patientCardAutoPrint?: boolean;
  paperChoices?: readonly ('A4' | 'A5')[];
  persisted: boolean;
  limits: {
    followUpFreeDays: { min: number; max: number };
    repeatVisitFreeHours: { min: number; max: number };
  };
};

export type FieldSection = 'PERSONAL' | 'CONTACT' | 'ADDRESS' | 'RELATIVE' | 'OTHER';
export const FIELD_SECTIONS: readonly FieldSection[] = [
  'PERSONAL',
  'CONTACT',
  'ADDRESS',
  'RELATIVE',
  'OTHER',
];

export type CustomDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN';
export const CUSTOM_DATA_TYPES: readonly CustomDataType[] = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN'];

export type BuiltinField = {
  key: string;
  label: string;
  section: FieldSection;
  dataType: string;
  isEnabled: boolean;
  isRequired: boolean;
  canDisable: boolean;
  alwaysRequired: boolean;
  sortOrder: number;
};

export type FieldOption = { id: string; label: string; sortOrder: number; isActive: boolean };

export type CustomField = {
  id: string;
  code: string;
  label: string;
  section: FieldSection;
  dataType: CustomDataType;
  isEnabled: boolean;
  isRequired: boolean;
  sortOrder: number;
  options: FieldOption[];
};

export type PatientFieldsResponse = {
  builtin: BuiltinField[];
  custom: CustomField[];
  limits: { maxCustomFields: number; labelMax: number; maxOptions: number };
};

export type UhidBlockType =
  | 'FIXED_TEXT'
  | 'BRANCH_CODE'
  | 'FINANCIAL_YEAR'
  | 'CALENDAR_YEAR'
  | 'SEPARATOR'
  | 'RUNNING_NUMBER';

export const UHID_BLOCK_TYPES: readonly UhidBlockType[] = [
  'FIXED_TEXT',
  'SEPARATOR',
  'BRANCH_CODE',
  'FINANCIAL_YEAR',
  'CALENDAR_YEAR',
  'RUNNING_NUMBER',
];

export type UhidBlock = {
  blockType: UhidBlockType;
  textValue: string | null;
  fyStyle: 'SHORT' | 'LONG' | null;
  minWidth: number | null;
};

export type UhidResetRule = 'NEVER' | 'FINANCIAL_YEAR';

export type UhidFormat = {
  resetRule: UhidResetRule;
  fyStartMonth: number;
  blocks: UhidBlock[];
};

export type UhidFormatResponse = {
  configured: boolean;
  effectiveFrom: string | null;
  format: UhidFormat | null;
  example: string | null;
  next: string | null;
  branchCode: string;
  limits: {
    maxBlocks: number;
    maxTextLength: number;
    minWidthMin: number;
    minWidthMax: number;
    maxExampleLength: number;
    fyStartMonthMin: number;
    fyStartMonthMax: number;
    fyStartMonthDefault: number;
  };
};
