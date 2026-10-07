import { vi } from 'vitest';

/**
 * Way2API "Vehicle RC Text + PDF" responses, for suites that must exercise the
 * real adapter without ever spending a paid lookup. `fetch` is the only seam:
 * stubbing it runs the real route, guard, service, normaliser and storage code.
 */

/** The plate the success envelope describes, unless overridden. */
export const RC_FIXTURE_PLATE = 'UP32AB1234';

/** The provider's documented success envelope, with a plausible RC record. */
export function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message: '',
    message_code: 'OK',
    order_id: 'W2A1739512345abcdef01',
    data: {
      order_id: 'W2A1739512345abcdef01',
      result: {
        rc_number: RC_FIXTURE_PLATE,
        registration_date: '2022-03-20',
        rc_status: 'ACTIVE',
        less_info: false,
        latest_by: '2026-08-11',
        owner_name: 'SNEHA MOHANTY',
        father_name: '',
        owner_number: '1',
        masked_name: false,
        mobile_number: '',
        present_address: 'Jagatsinghapur, 754119',
        permanent_address: 'Jagatsinghapur, 754119',
        vehicle_category: 'LMV',
        vehicle_category_description: 'Motor Car(LMV)',
        vehicle_chasi_number: 'ME1AB1234C5678901',
        vehicle_engine_number: 'G3AB1C234567',
        maker_description: 'MARUTI SUZUKI INDIA LTD',
        maker_model: 'SWIFT VXI',
        variant: null,
        body_type: 'SALOON',
        fuel_type: 'PETROL',
        color: 'PEARL ARCTIC WHITE',
        norms_type: 'BHARAT STAGE VI',
        manufacturing_date: '1/2022',
        manufacturing_date_formatted: '2022-01',
        cubic_capacity: '1197.00',
        no_cylinders: '4',
        seat_capacity: '5',
        sleeper_capacity: '0',
        standing_capacity: '0',
        wheelbase: '2450',
        unladen_weight: '875',
        vehicle_gross_weight: '1355',
        registered_at: 'LUCKNOW RTO, Uttar Pradesh',
        rto_code: '',
        fit_up_to: '2037-03-19',
        tax_upto: '2037-03-19',
        tax_paid_upto: '2037-03-19',
        financed: true,
        financer: 'EXAMPLE CAPITAL LTD',
        insurance_company: 'Example General Insurance Co. Ltd.',
        insurance_policy_number: '3410/12345678/000/00',
        insurance_upto: '2029-03-18',
        pucc_number: 'UP12345678901234',
        pucc_upto: '2026-11-02',
        permit_number: '',
        permit_type: '',
        permit_issue_date: null,
        permit_valid_from: null,
        permit_valid_upto: null,
        national_permit_number: '',
        national_permit_upto: null,
        national_permit_issued_by: null,
        non_use_status: null,
        non_use_from: null,
        non_use_to: null,
        blacklist_status: '',
        noc_details: '',
        challan_details: null,
        response_metadata: {
          masked_chassis: false,
          masked_engine: false,
          masked_owner_name: false,
        },
        pdf_url: 'https://docs.way2api.test/upload/rc2_1786426531.pdf',
        ...overrides,
      },
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal but structurally valid PDF, so magic-byte detection passes. */
export function pdfResponse(): Response {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n', 'latin1');
  return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
}

/** A call to either Way2API RC service; `WAY2API_RC_SERVICE` decides which. */
export function isRcLookupCall(input: unknown): boolean {
  return String(input).includes('/api/v1/rc/');
}

/** Answers the RC endpoint with `envelope` and any PDF fetch with a real PDF. */
export function stubProvider(envelope: unknown, options: { pdfOk?: boolean } = {}) {
  const { pdfOk = true } = options;
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    void init;
    if (isRcLookupCall(input)) return jsonResponse(envelope);
    return pdfOk ? pdfResponse() : new Response('nope', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
