import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ImagePicker } from '@/components/images/image-picker';
import { LogoCard } from '@/components/images/logo-card';
import { MyProfileForm } from '@/components/doctors/my-profile-form';
import { DoctorsList } from '@/components/settings/doctors-list';
import { staffCopy } from '@/config/staff-copy';
import type { BrandingResponse, ImageLimits, ImageMeta } from '@/lib/images/types';
import type { DoctorProfile, MyProfileResponse } from '@/lib/doctors/types';

const uploadLogoMock = jest.fn();
const removeLogoMock = jest.fn();
jest.mock('@/lib/images/client', () => ({
  uploadLogo: (...a: unknown[]) => uploadLogoMock(...a),
  removeLogo: (...a: unknown[]) => removeLogoMock(...a),
  uploadPicture: jest.fn(),
  removePicture: jest.fn(),
}));
const uploadMineMock = jest.fn();
const removeMineMock = jest.fn();
const uploadDoctorMock = jest.fn();
const removeDoctorMock = jest.fn();
jest.mock('@/lib/doctors/client', () => ({
  saveMyProfile: jest.fn(),
  saveDoctorProfile: jest.fn(),
  uploadMySignature: (...a: unknown[]) => uploadMineMock(...a),
  removeMySignature: (...a: unknown[]) => removeMineMock(...a),
  uploadDoctorSignature: (...a: unknown[]) => uploadDoctorMock(...a),
  removeDoctorSignature: (...a: unknown[]) => removeDoctorMock(...a),
}));

const p = staffCopy.pictures;
const limits: ImageLimits = {
  maxBytes: 1_048_576,
  maxSidePx: 4000,
  minSidePx: 16,
  types: ['image/png', 'image/jpeg', 'image/webp'],
};
const meta = (over: Partial<ImageMeta> = {}): ImageMeta => ({
  id: 'img1',
  contentType: 'image/png',
  byteSize: 20_480,
  width: 240,
  height: 80,
  createdAt: '2026-11-25T10:00:00.000Z',
  ...over,
});
const png = (name = 'a.png', type = 'image/png', size = 2000) => {
  const f = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
const refused = (over: Record<string, unknown>) => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  field: 'file',
  ...over,
});

beforeEach(() => {
  [
    uploadLogoMock,
    removeLogoMock,
    uploadMineMock,
    removeMineMock,
    uploadDoctorMock,
    removeDoctorMock,
  ].forEach((m) => m.mockReset());
});

describe('ImagePicker', () => {
  const setup = (over: Partial<Parameters<typeof ImagePicker>[0]> = {}) => {
    const onUpload = jest.fn().mockResolvedValue(null);
    const onRemove = jest.fn().mockResolvedValue(null);
    render(
      <ImagePicker
        image={null}
        limits={limits}
        canWrite
        alt="Logo"
        onUpload={onUpload}
        onRemove={onRemove}
        {...over}
      />,
    );
    return { onUpload, onRemove };
  };

  it('with no picture it says so and offers Choose; the rules come from the limits', () => {
    setup();
    expect(screen.getByText(p.picker.none)).toBeTruthy();
    expect(screen.getByRole('button', { name: p.picker.choose })).toBeTruthy();
    expect(screen.queryByRole('button', { name: p.picker.remove })).toBeNull();
    expect(screen.getByText(/up to 1 MB, from 16 to 4000 pixels/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('with a picture it shows it from the picture route, with its facts, and offers Replace and Remove', () => {
    setup({ image: meta() });
    const img = screen.getByRole('img', { name: 'Logo' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/staff/images/img1');
    expect(screen.getByText('240 × 80 pixels, 20 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: p.picker.replace })).toBeTruthy();
    expect(screen.getByRole('button', { name: p.picker.remove })).toBeTruthy();
  });

  it('a person who cannot change it sees the picture without any button, field or rules', () => {
    setup({ image: meta(), canWrite: false });
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText(/Logo: /)).toBeNull();
    expect(screen.queryByText(/up to 1 MB/)).toBeNull();
  });

  it('offers only picture files in the chooser', () => {
    setup();
    const input = screen.getByLabelText(`Logo: ${p.picker.chooseAria}`) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
  });

  it('sends the chosen file, then shows "Picture saved."', async () => {
    const { onUpload } = setup();
    const file = png();
    choose(`Logo: ${p.picker.chooseAria}`, file);
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(p.picker.saved));
  });

  it('shows the sentence the caller gives when the picture is refused, and keeps working', async () => {
    const { onUpload } = setup();
    onUpload.mockResolvedValueOnce('That is not a PNG, JPEG or WebP picture.');
    choose(`Logo: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'That is not a PNG, JPEG or WebP picture.',
      ),
    );
    choose(`Logo: ${p.picker.chooseAria}`, png());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not even send a file that is the wrong type, empty or too big, and says why', async () => {
    const { onUpload } = setup();
    choose(`Logo: ${p.picker.chooseAria}`, png('a.svg', 'image/svg+xml'));
    expect(screen.getByRole('alert').textContent).toBe(p.errors.NOT_AN_IMAGE);
    choose(`Logo: ${p.picker.chooseAria}`, png('a.png', 'image/png', 0));
    expect(screen.getByRole('alert').textContent).toBe(p.errors.EMPTY);
    choose(`Logo: ${p.picker.chooseAria}`, png('a.png', 'image/png', limits.maxBytes + 1));
    expect(screen.getByRole('alert').textContent).toBe(p.errors.TOO_BIG!.replace('{size}', '1 MB'));
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('Remove asks the caller and says "Picture removed."', async () => {
    const { onRemove } = setup({ image: meta() });
    fireEvent.click(screen.getByRole('button', { name: p.picker.remove }));
    await waitFor(() => expect(onRemove).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(p.picker.removed));
  });

  it('while sending, the buttons are off, and a second file is not sent at the same time', async () => {
    let finish: (v: string | null) => void = () => undefined;
    const { onUpload } = setup();
    onUpload.mockReturnValue(new Promise((r) => (finish = r)));
    choose(`Logo: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: p.picker.uploading })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: p.picker.uploading }).matches(':disabled')).toBe(
      true,
    );
    choose(`Logo: ${p.picker.chooseAria}`, png());
    expect(onUpload).toHaveBeenCalledTimes(1);
    finish(null);
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});

describe('LogoCard', () => {
  const branding = (over: Partial<BrandingResponse> = {}): BrandingResponse => ({
    logo: null,
    canWrite: true,
    limits,
    ...over,
  });

  it('a SuperAdmin chooses a logo, sees it at once, and can remove it', async () => {
    uploadLogoMock.mockResolvedValue({ ok: true, data: meta({ id: 'logo1' }) });
    removeLogoMock.mockResolvedValue({ ok: true, data: { logo: null } });
    render(<LogoCard initial={branding()} initialErrorCode={null} />);
    choose(`${p.logo.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe(
        '/api/staff/images/logo1',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: p.picker.remove }));
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    expect(removeLogoMock).toHaveBeenCalledTimes(1);
  });

  it('someone who may not change the logo sees a calm note and no buttons', () => {
    render(
      <LogoCard initial={branding({ canWrite: false, logo: meta() })} initialErrorCode={null} />,
    );
    expect(screen.getByText(p.logo.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows the refusal with the real reason and keeps the old logo', async () => {
    uploadLogoMock.mockResolvedValue(refused({ reason: 'TOO_SMALL' }));
    render(<LogoCard initial={branding({ logo: meta({ id: 'old' }) })} initialErrorCode={null} />);
    choose(`${p.logo.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        p.errors.TOO_SMALL!.replace('{min}', '16'),
      ),
    );
    expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe(
      '/api/staff/images/old',
    );
  });

  it('a refusal to switch a logo off by the API (not allowed) is shown in plain words', async () => {
    removeLogoMock.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
    render(<LogoCard initial={branding({ logo: meta() })} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: p.picker.remove }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden),
    );
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows an error instead of a blank card when it could not be loaded', () => {
    render(<LogoCard initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    render(<LogoCard initial={null} initialErrorCode={null} />);
    expect(screen.getAllByRole('alert')[1]!.textContent).toBe(p.logo.loadError);
  });
});

describe('the signature or stamp of a doctor', () => {
  const my = (over: Partial<MyProfileResponse> = {}): MyProfileResponse => ({
    id: 'dp1',
    code: 'DR1',
    name: 'Login Meena',
    printedName: null,
    printName: 'Login Meena',
    department: 'General',
    qualifications: 'MBBS',
    speciality: 'GP',
    registrationNo: 'R1',
    active: true,
    branches: ['Main Branch'],
    missing: [],
    signature: null,
    limits: {
      printedName: 80,
      qualifications: 150,
      speciality: 80,
      registrationNo: 40,
      department: 100,
    },
    images: limits,
    ...over,
  });

  it('My profile: a doctor uploads and removes their own; the profile is replaced by the answer', async () => {
    uploadMineMock.mockResolvedValue({ ok: true, data: my({ signature: meta({ id: 'sig1' }) }) });
    removeMineMock.mockResolvedValue({ ok: true, data: my() });
    render(<MyProfileForm initial={my()} initialErrorCode={null} />);
    expect(screen.getByText(p.signature.title)).toBeTruthy();
    choose(`${p.signature.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe(
        '/api/staff/images/sig1',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: p.picker.remove }));
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    expect(removeMineMock).toHaveBeenCalledTimes(1);
  });

  it('My profile: a refused picture shows its reason', async () => {
    uploadMineMock.mockResolvedValue(refused({ reason: 'NOT_AN_IMAGE' }));
    render(<MyProfileForm initial={my()} initialErrorCode={null} />);
    choose(`${p.signature.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(p.errors.NOT_AN_IMAGE));
  });

  const doctor = (over: Partial<DoctorProfile> = {}): DoctorProfile => ({
    id: 'd1',
    code: 'DR001',
    name: 'Login Meena',
    printedName: null,
    printName: 'Login Meena',
    department: 'General',
    qualifications: null,
    speciality: null,
    registrationNo: null,
    active: true,
    branches: ['Main Branch'],
    missing: [],
    signature: null,
    ...over,
  });
  const listOf = (items: DoctorProfile[]) => ({
    items,
    limits: {
      printedName: 80,
      qualifications: 150,
      speciality: 80,
      registrationNo: 40,
      department: 100,
    },
    images: limits,
    canWrite: true,
  });

  it('Doctors list: an Admin sees who has a signature and uploads for a doctor in the open panel', async () => {
    uploadDoctorMock.mockResolvedValue({
      ok: true,
      data: doctor({ signature: meta({ id: 'sigD' }) }),
    });
    render(
      <DoctorsList
        initial={listOf([
          doctor(),
          doctor({ id: 'd2', code: 'DR002', name: 'Login Anil', signature: meta() }),
        ])}
        initialErrorCode={null}
      />,
    );
    const first = screen.getAllByText('Login Meena')[0]!.closest('li') as HTMLElement;
    const second = screen.getAllByText('Login Anil')[0]!.closest('li') as HTMLElement;
    expect(within(first).queryByText(staffCopy.settings.doctors.signatureAdded)).toBeNull();
    expect(within(second).getByText(staffCopy.settings.doctors.signatureAdded)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: `Login Meena: ${staffCopy.settings.doctors.edit}` }),
    );
    choose(`Login Meena: ${p.signature.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() => expect(uploadDoctorMock).toHaveBeenCalledWith('d1', expect.any(File)));
    await waitFor(() =>
      expect(within(first).getByText(staffCopy.settings.doctors.signatureAdded)).toBeTruthy(),
    );
  });

  it('Doctors list: removing and a refusal both work from the panel', async () => {
    removeDoctorMock.mockResolvedValue({ ok: true, data: doctor() });
    render(
      <DoctorsList initial={listOf([doctor({ signature: meta() })])} initialErrorCode={null} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `Login Meena: ${staffCopy.settings.doctors.edit}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: p.picker.remove }));
    await waitFor(() => expect(removeDoctorMock).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    uploadDoctorMock.mockResolvedValue({ ok: false, status: 404, code: 'SETTINGS_NOT_FOUND' });
    choose(`Login Meena: ${p.signature.alt}: ${p.picker.chooseAria}`, png());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        staffCopy.settings.settingsErrors.notFound,
      ),
    );
  });
});
