import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ValidationError,
  ValidationPipe,
  type ValidationPipeOptions,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterPatientDto, UpdatePatientDto } from './dto/register-patient.dto';
import { PatientFieldErrorCode, type PatientFieldErrors } from './patient-field-error.codes';
import { patientFieldErrorsBody } from './patient-validation.exception';

/** Map DTO property names to form-config / fieldErrors keys. */
const DTO_PROP_TO_FIELD_KEY: Record<string, string> = {
  name: 'name',
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  ageYears: 'ageYears',
  ageMonths: 'ageMonths',
  ageDays: 'ageDays',
  phone: 'phone',
  email: 'email',
  addressStreet: 'address_street',
  addressCross: 'address_cross',
  addressArea: 'address_area',
  addressCity: 'address_city',
  addressState: 'address_state',
  addressPincode: 'address_pincode',
  customFieldValues: 'customFieldValues',
};

const PATIENT_DTO_FIELD_ERRORS = Symbol('hospigo.patientDtoFieldErrors');
const PATIENT_DTO_MESSAGES = Symbol('hospigo.patientDtoMessages');

export type PatientDtoValidationAttach = {
  fieldErrors: PatientFieldErrors;
  messages: string[];
};

type BodyWithDtoErrors = object & {
  [PATIENT_DTO_FIELD_ERRORS]?: PatientFieldErrors;
  [PATIENT_DTO_MESSAGES]?: string[];
};

function isPatientBodyDto(metatype?: unknown): boolean {
  return metatype === RegisterPatientDto || metatype === UpdatePatientDto;
}

/** Walk class-validator errors into codes + Nest-style message strings. */
export function collectPatientDtoFieldErrors(
  errors: ValidationError[],
): PatientDtoValidationAttach {
  const messages: string[] = [];
  const fieldErrors: PatientFieldErrors = {};

  const walk = (errs: ValidationError[]): void => {
    for (const err of errs) {
      if (err.constraints) {
        for (const text of Object.values(err.constraints)) {
          messages.push(text);
        }
        const key = DTO_PROP_TO_FIELD_KEY[err.property] ?? err.property;
        const isRequired = Object.keys(err.constraints).some((c) =>
          /isNotEmpty|isDefined|minLength|arrayNotEmpty/i.test(c),
        );
        // One code per field: first wins (parent before nested).
        if (!(key in fieldErrors)) {
          fieldErrors[key] = isRequired
            ? PatientFieldErrorCode.REQUIRED
            : PatientFieldErrorCode.INVALID;
        }
      }
      if (err.children?.length) {
        walk(err.children);
      }
    }
  };
  walk(errors);

  return { fieldErrors, messages };
}

/**
 * ValidationPipe exceptionFactory for non-patient bodies (and soft-pipe fallback):
 * keeps `message` as a string[] and adds `fieldErrors` with codes only.
 */
export function patientDtoValidationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const { fieldErrors, messages } = collectPatientDtoFieldErrors(errors);
  return new BadRequestException(
    patientFieldErrorsBody(fieldErrors, messages.length ? messages : ['Validation failed']),
  );
}

/** Read and clear soft-validation attachments from a patient body DTO instance. */
export function takePatientDtoErrors(body: object): PatientDtoValidationAttach {
  const tagged = body as BodyWithDtoErrors;
  const fieldErrors = tagged[PATIENT_DTO_FIELD_ERRORS] ?? {};
  const messages = tagged[PATIENT_DTO_MESSAGES] ?? [];
  delete tagged[PATIENT_DTO_FIELD_ERRORS];
  delete tagged[PATIENT_DTO_MESSAGES];
  return { fieldErrors, messages };
}

/**
 * Global ValidationPipe that soft-validates Register/Update patient bodies:
 * class-validator errors are attached (not thrown) so the service can merge them
 * with phone/pincode/age-or-DOB checks into one 400.
 */
@Injectable()
export class HospigoValidationPipe extends ValidationPipe {
  constructor(options?: ValidationPipeOptions) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: patientDtoValidationExceptionFactory,
      ...options,
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type !== 'body' || !isPatientBodyDto(metadata.metatype)) {
      return super.transform(value, metadata);
    }

    const metatype = metadata.metatype as new (...args: unknown[]) => object;
    const entity = plainToInstance(metatype as new () => object, value ?? {}, {
      enableImplicitConversion: true,
    });
    const errors = await validate(entity, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
    });
    const attached = collectPatientDtoFieldErrors(errors);
    const tagged = entity as BodyWithDtoErrors;
    tagged[PATIENT_DTO_FIELD_ERRORS] = attached.fieldErrors;
    tagged[PATIENT_DTO_MESSAGES] = attached.messages;
    return entity;
  }
}

/** Merge DTO fieldErrors with service-level codes; each field keeps one code (DTO wins). */
export function mergePatientFieldErrors(
  dtoErrors: PatientFieldErrors,
  serviceErrors: PatientFieldErrors,
): PatientFieldErrors {
  const merged: PatientFieldErrors = { ...dtoErrors };
  for (const [key, code] of Object.entries(serviceErrors)) {
    if (!(key in merged)) {
      merged[key] = code;
    }
  }
  return merged;
}
