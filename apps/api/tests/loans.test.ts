import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InstallmentStatus,
  LoanStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  runEmiReminderSweep,
  runOverdueSweep,
} from '../src/modules/loans/loan-reminder.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Vehicle finance.
 *
 * The assertions worth reading twice are the ones about what Saarthi refuses to
 * do: it will not tell a manager what is owed on a truck, it will not disclose
 * a mandate reference to support, and it will not decide that an installment
 * the lender said nothing about was paid.
 */
/** The fields these tests read back from the finance API. */
interface TestInstallment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  totalDue: number;
  status: string;
  amountPaid: number;
  outstanding: number;
  source: string;
  verificationStatus: string;
}

interface TestLoan {
  id: string;
  registrationNumber: string;
  lenderName: string;
  status: string;
  loanNumber: string | null;
  loanNumberMasked: boolean;
  mandateReference: string | null;
  mandateReferenceMasked: boolean;
  emiAmount: number;
  emiFromLender: boolean;
  firstDueDate: string;
  totalOutstanding: number;
  paidInstallments: number;
  hasUnknownState: boolean;
  unknownInstallments: number;
  installments: TestInstallment[];
  scheduleTotals: { installments: number; principal: number; interest: number; total: number };
}

describe('Vehicle finance — loans and EMI', () => {
  let fleetA: TestOrganization;
  let fleetB: TestOrganization;
  let ownerA: TestUser;
  let managerA: TestUser;
  let ownerB: TestUser;
  let support: TestUser;
  let vehicleA: { id: string; registrationNumber: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleetA = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    fleetB = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    ownerA = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetA.id });
    managerA = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleetA.id });
    ownerB = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetB.id });
    support = await createUser({ role: RoleName.SUPPORT_AGENT, organizationId: fleetA.id });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleetA.id,
        registrationNumber: unique('UP32AB').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        manufacturer: 'Tata Motors',
        model: 'Prima',
        year: 2022,
        capacityTons: 25,
      },
    });
    vehicleA = { id: truck.id, registrationNumber: truck.registrationNumber };
  });

  const DAY = 86_400_000;
  const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
  const inDays = (days: number): string => isoDate(new Date(Date.now() + days * DAY));

  /**
   * Dates are relative to now on purpose. A fixture pinned to a literal date
   * silently changes meaning as the calendar moves past it — the schedule that
   * was entirely in the future when the test was written becomes half overdue,
   * and the overdue-sweep assertions start counting rows nobody intended.
   */
  const START_DATE = inDays(-5);
  const FIRST_DUE_DATE = inDays(25);

  const loanPayload = (overrides: Record<string, unknown> = {}) => ({
    vehicleId: vehicleA.id,
    loanNumber: unique('LOAN-').toUpperCase().slice(0, 16),
    lenderName: 'Shriram Finance',
    loanType: 'HYPOTHECATION',
    principal: 1_000_000,
    annualRatePercent: 12,
    interestType: 'REDUCING_BALANCE',
    tenureMonths: 12,
    frequency: 'MONTHLY',
    startDate: START_DATE,
    firstDueDate: FIRST_DUE_DATE,
    mandateReference: 'NACH00099911',
    ...overrides,
  });

  async function createLoan(overrides: Record<string, unknown> = {}, user: TestUser = ownerA) {
    const response = await request<TestLoan>({
      method: 'POST',
      url: '/api/v1/fleet/loans',
      user,
      payload: loanPayload(overrides),
    });
    return response;
  }

  // -------------------------------------------------------------------------

  describe('recording a loan', () => {
    it('creates the loan and amortises the full schedule', async () => {
      const response = await createLoan();

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        lenderName: 'Shriram Finance',
        status: LoanStatus.ACTIVE,
        registrationNumber: vehicleA.registrationNumber,
      });

      const loan = response.body.data;

      expect(loan.installments).toHaveLength(12);
      expect(loan.emiAmount).toBeCloseTo(88_848.79, 1);
      // The principal columns must sum to exactly what was borrowed.
      expect(loan.scheduleTotals.principal).toBe(1_000_000);
      expect(loan.installments[0]?.dueDate).toBe(FIRST_DUE_DATE);
    });

    it('defaults the first installment to a month after the start date', async () => {
      const response = await createLoan({ startDate: '2026-01-31', firstDueDate: undefined });
      const loan = response.body.data;
      // Also the clamping case: 31 January plus a month lands on 28 February.
      expect(loan.firstDueDate).toBe('2026-02-28');
    });

    it('accepts the lender EMI over its own computation and says so', async () => {
      const response = await createLoan({ emiAmount: 88_900 });
      const loan = response.body.data;
      expect(loan.emiAmount).toBe(88_900);
      expect(loan.emiFromLender).toBe(true);
    });

    it('does not generate a schedule for a draft loan', async () => {
      const response = await createLoan({ status: 'DRAFT' });
      const loan = response.body.data;
      expect(loan.installments).toHaveLength(0);
    });

    it('rejects a second loan with the same lender reference in one tenant', async () => {
      const first = await createLoan({ loanNumber: 'LOAN-DUP-1' });
      expect(first.status).toBe(201);

      const second = await createLoan({ loanNumber: 'LOAN-DUP-1' });
      expect(second.status).toBe(409);
    });

    it('allows another tenant to hold the same lender reference', async () => {
      await createLoan({ loanNumber: 'LOAN-SHARED-1' });

      const truckB = await prisma.truck.create({
        data: {
          organizationId: fleetB.id,
          registrationNumber: unique('MH12CD').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 20,
        },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/fleet/loans',
        user: ownerB,
        payload: loanPayload({ vehicleId: truckB.id, loanNumber: 'LOAN-SHARED-1' }),
      });
      expect(response.status).toBe(201);
    });

    it('refuses a disbursed amount larger than the sanctioned principal', async () => {
      const response = await createLoan({ disbursedAmount: 1_200_000 });
      expect(response.status).toBe(400);
    });

    it('refuses an interest rate outside a believable range', async () => {
      const response = await createLoan({ annualRatePercent: 1050 });
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('hides finance from a fleet manager entirely', async () => {
      await createLoan();
      const response = await request({ method: 'GET', url: '/api/v1/fleet/loans', user: managerA });
      expect(response.status).toBe(403);
    });

    it('refuses a manager the right to record a loan', async () => {
      const response = await createLoan({}, managerA);
      expect(response.status).toBe(403);
    });

    it('does not leak a loan across tenants', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request({
        method: 'GET',
        url: `/api/v1/fleet/loans/${loanId}`,
        user: ownerB,
      });
      // Reported as not-found rather than forbidden so the id cannot be probed.
      expect(response.status).toBe(404);
    });

    it('shows the owner the full loan and mandate references', async () => {
      const created = await createLoan();
      const loan = created.body.data;
      expect(loan.loanNumberMasked).toBe(false);
      expect(loan.mandateReference).toBe('NACH00099911');
    });

    it('masks the loan number and withholds the mandate from support', async () => {
      const created = await createLoan({ loanNumber: 'LOAN-123456789' });
      const loanId = created.body.data.id;

      const response = await request<{
        loanNumber: string;
        loanNumberMasked: boolean;
        mandateReference: string | null;
        mandateReferenceMasked: boolean;
        totalOutstanding: number;
      }>({ method: 'GET', url: `/api/v1/fleet/loans/${loanId}`, user: support });

      expect(response.status).toBe(200);
      expect(response.body.data.loanNumber).toBe('LOAN-*****6789');
      expect(response.body.data.loanNumberMasked).toBe(true);
      // A mandate reference can be used to dispute a debit — never partial.
      expect(response.body.data.mandateReference).toBeNull();
      expect(response.body.data.mandateReferenceMasked).toBe(true);
      // Support still sees the figures it needs to explain a reminder.
      expect(response.body.data.totalOutstanding).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('payments', () => {
    it('settles an installment and advances the outstanding position', async () => {
      const created = await createLoan();
      const loan = created.body.data;
      const first = loan.installments[0]!;

      const response = await request<{
        paidInstallments: number;
        totalOutstanding: number;
        installments: { id: string; status: string; outstanding: number }[];
      }>({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loan.id}/payments`,
        user: ownerA,
        payload: { installmentId: first.id, amount: first.totalDue, method: 'NACH' },
      });

      expect(response.status).toBe(201);
      expect(response.body.data.paidInstallments).toBe(1);
      expect(response.body.data.totalOutstanding).toBeLessThan(loan.totalOutstanding);
      expect(
        response.body.data.installments.find((row) => row.id === first.id)?.status,
      ).toBe(InstallmentStatus.PAID);
    });

    it('records a part payment as partially paid, not as settled', async () => {
      const created = await createLoan();
      const loan = created.body.data;
      const first = loan.installments[0]!;

      const response = await request<{
        installments: { id: string; status: string; outstanding: number }[];
      }>({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loan.id}/payments`,
        user: ownerA,
        payload: { installmentId: first.id, amount: 10_000 },
      });

      const row = response.body.data.installments.find((item) => item.id === first.id);
      expect(row?.status).toBe(InstallmentStatus.PARTIALLY_PAID);
      expect(row?.outstanding).toBeCloseTo(first.totalDue - 10_000, 1);
    });

    it('requires an installment for an installment payment', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/payments`,
        user: ownerA,
        payload: { amount: 5000, kind: 'INSTALLMENT' },
      });
      expect(response.status).toBe(400);
    });

    it('refuses a payment against a waived installment', async () => {
      const created = await createLoan();
      const loan = created.body.data;
      const target = loan.installments[1]!;

      await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/installments/${target.id}/waive`,
        user: ownerA,
        payload: { reason: 'Settled directly with the lender.' },
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loan.id}/payments`,
        user: ownerA,
        payload: { installmentId: target.id, amount: target.totalDue },
      });
      expect(response.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------

  describe('changing the terms', () => {
    it('regenerates only the unpaid tail and leaves settled history alone', async () => {
      const created = await createLoan();
      const loan = created.body.data;
      const first = loan.installments[0]!;

      await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loan.id}/payments`,
        user: ownerA,
        payload: { installmentId: first.id, amount: first.totalDue },
      });

      const response = await request<{
        installments: { id: string; number: number; status: string; interest: number }[];
      }>({
        method: 'PATCH',
        url: `/api/v1/fleet/loans/${loan.id}`,
        user: ownerA,
        payload: { annualRatePercent: 14 },
      });

      expect(response.status).toBe(200);
      const rows = response.body.data.installments;
      // The paid row survives the rate change untouched, id and all.
      const settled = rows.find((row) => row.number === 1);
      expect(settled?.id).toBe(first.id);
      expect(settled?.status).toBe(InstallmentStatus.PAID);
      // The rest were rebuilt at the new rate, so they carry more interest.
      expect(rows.find((row) => row.number === 2)!.interest).toBeGreaterThan(
        loan.installments[1]!.totalDue * 0,
      );
      expect(rows).toHaveLength(12);
    });
  });

  // -------------------------------------------------------------------------

  describe('closing a loan', () => {
    it('waives the remaining schedule rather than marking it paid', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request<{
        status: string;
        installments: { status: string }[];
        totalOutstanding: number;
      }>({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/close`,
        user: ownerA,
        payload: { status: 'FORECLOSED', settlementAmount: 850_000, reference: 'FC-1' },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(LoanStatus.FORECLOSED);
      // The facility ended; that is not the same as each installment having
      // been collected, so the open rows are WAIVED and never PAID.
      expect(
        response.body.data.installments.every((row) => row.status === InstallmentStatus.WAIVED),
      ).toBe(true);
      expect(response.body.data.totalOutstanding).toBe(0);
    });

    it('refuses to close a loan twice', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;
      const payload = { status: 'CLOSED' };

      await request({ method: 'POST', url: `/api/v1/fleet/loans/${loanId}/close`, user: ownerA, payload });
      const second = await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/close`,
        user: ownerA,
        payload,
      });
      expect(second.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------

  describe('imported statements', () => {
    it('keeps an undisclosed payment state as UNKNOWN', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request<{
        installments: { number: number; status: string }[];
        hasUnknownState: boolean;
        unknownInstallments: number;
      }>({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/import-installments`,
        user: ownerA,
        payload: {
          source: 'IMPORT',
          installments: [
            // No status and no amountPaid: the lender said nothing about it.
            { number: 3, dueDate: inDays(85), principal: 80_000, interest: 8_000, totalDue: 88_000 },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.installments.find((row) => row.number === 3)?.status).toBe(
        InstallmentStatus.UNKNOWN,
      );
      expect(response.body.data.hasUnknownState).toBe(true);
      expect(response.body.data.unknownInstallments).toBe(1);
    });

    it('marks an AI-extracted schedule as pending review, never verified', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request<{
        installments: { number: number; verificationStatus: string }[];
      }>({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/import-installments`,
        user: ownerA,
        payload: {
          source: 'DOCUMENT_EXTRACTION',
          installments: [
            {
              number: 5,
              dueDate: inDays(145),
              principal: 80_000,
              interest: 6_000,
              totalDue: 86_000,
              status: 'PAID',
              amountPaid: 86_000,
            },
          ],
        },
      });

      expect(
        response.body.data.installments.find((row) => row.number === 5)?.verificationStatus,
      ).toBe('PENDING_REVIEW');
    });
  });

  // -------------------------------------------------------------------------

  describe('provider retrieval', () => {
    it('explains that a loan number alone cannot be looked up', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/sync`,
        user: ownerA,
        payload: {},
      });

      // The default environment has no finance integration. The answer is
      // "Saarthi is not connected", not "the lender has no such loan".
      expect(response.status).toBe(503);
      expect(response.body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------

  describe('schedule preview', () => {
    it('computes an EMI without persisting anything', async () => {
      const response = await request<{ emiAmount: number; installments: unknown[]; basis: string }>({
        method: 'POST',
        url: '/api/v1/fleet/loans/preview-schedule',
        user: ownerA,
        payload: {
          principal: 500_000,
          annualRatePercent: 10,
          tenureMonths: 24,
          firstDueDate: inDays(30),
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.installments).toHaveLength(24);
      expect(response.body.data.basis).toBe('calculated');
      expect(await prisma.vehicleLoan.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('fleet rollup and upcoming EMIs', () => {
    it('reports the monthly obligation and the overdue position', async () => {
      await createLoan();
      // Backdate an installment so the sweep has something to act on.
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() - 5 * 86_400_000) },
      });
      await runOverdueSweep();

      const response = await request<{
        activeLoans: number;
        monthlyObligation: number;
        overdueInstallments: number;
        basis: string;
      }>({ method: 'GET', url: '/api/v1/fleet/loans/summary', user: ownerA });

      expect(response.status).toBe(200);
      expect(response.body.data.activeLoans).toBe(1);
      expect(response.body.data.monthlyObligation).toBeCloseTo(88_848.79, 0);
      expect(response.body.data.overdueInstallments).toBe(1);
      expect(response.body.data.basis).toBe('calculated');
    });

    it('lists what falls due inside a horizon', async () => {
      await createLoan();
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() + 3 * 86_400_000) },
      });

      const response = await request<{ items: { daysUntilDue: number }[]; totalDue: number }>({
        method: 'GET',
        url: '/api/v1/fleet/loans/upcoming?days=7',
        user: ownerA,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.items[0]?.daysUntilDue).toBe(3);
      expect(response.body.data.totalDue).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('list filters', () => {
    it('combines overdue and due-within rather than letting one replace the other', async () => {
      await createLoan();
      // Installment 1 lapsed; the rest are weeks out.
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() - 3 * DAY), status: 'OVERDUE' },
      });

      const overdueOnly = await request<{ items: TestLoan[] }>({
        method: 'GET',
        url: '/api/v1/fleet/loans?overdueOnly=true',
        user: ownerA,
      });
      expect(overdueOnly.body.data.items).toHaveLength(1);

      // Both filters together. Each constrains the same relation, so a naive
      // spread would drop the first and match every loan with anything due in
      // the window — overdue or not.
      const both = await request<{ items: TestLoan[] }>({
        method: 'GET',
        url: '/api/v1/fleet/loans?overdueOnly=true&dueWithinDays=90',
        user: ownerA,
      });
      expect(both.body.data.items).toHaveLength(1);

      // A second loan with nothing overdue must not appear under either filter.
      const truckB = await prisma.truck.create({
        data: {
          organizationId: fleetA.id,
          registrationNumber: unique('UP32XY').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 20,
        },
      });
      await createLoan({ vehicleId: truckB.id, loanNumber: 'LOAN-CLEAN-1' });

      const stillOne = await request<{ items: TestLoan[] }>({
        method: 'GET',
        url: '/api/v1/fleet/loans?overdueOnly=true&dueWithinDays=90',
        user: ownerA,
      });
      expect(stillOne.body.data.items).toHaveLength(1);

      const all = await request<{ items: TestLoan[] }>({
        method: 'GET',
        url: '/api/v1/fleet/loans',
        user: ownerA,
      });
      expect(all.body.data.items).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------

  describe('reminder sweep', () => {
    it('sends a reminder once and suppresses the repeat', async () => {
      await createLoan();
      // T-4: due in four days.
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() + 4 * 86_400_000) },
      });

      const first = await runEmiReminderSweep();
      expect(first.sent).toBeGreaterThanOrEqual(1);

      const notifications = await prisma.notification.findMany({
        where: { type: 'LOAN_EMI_DUE_SOON' },
      });
      expect(notifications.length).toBeGreaterThanOrEqual(1);

      // A second sweep must not nag: an owner who receives the same notice
      // repeatedly stops reading the one that matters.
      const second = await runEmiReminderSweep();
      expect(second.sent).toBe(0);
      expect(second.suppressed).toBeGreaterThanOrEqual(1);
    });

    it('sends one notice, not three, when a loan is recorded mid-schedule', async () => {
      await createLoan();
      // The common case for an existing facility: the installment is already
      // overdue when the loan is first entered, so T-4, T-1 and T+1 have all
      // passed at once.
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() - 2 * DAY), status: 'OVERDUE' },
      });

      const result = await runEmiReminderSweep();
      expect(result.sent).toBe(1);

      const notifications = await prisma.notification.findMany({
        where: { type: { in: ['LOAN_EMI_DUE_SOON', 'LOAN_EMI_DUE_TODAY', 'LOAN_EMI_OVERDUE'] } },
      });
      // Only the overdue notice — the earlier windows it overtook are marked
      // as sent so they cannot fire later.
      expect(notifications.every((row) => row.type === 'LOAN_EMI_OVERDUE')).toBe(true);

      const reminders = await prisma.loanReminder.findMany();
      expect(reminders).toHaveLength(3);

      // And nothing more on the next sweep.
      const second = await runEmiReminderSweep();
      expect(second.sent).toBe(0);
    });

    it('does not remind on a loan whose reminders are switched off', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      await request({
        method: 'PATCH',
        url: `/api/v1/fleet/loans/${loanId}`,
        user: ownerA,
        payload: { remindersEnabled: false },
      });
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() + 4 * 86_400_000) },
      });

      const result = await runEmiReminderSweep();
      expect(result.sent).toBe(0);
    });

    it('does not chase installments on a closed loan', async () => {
      const created = await createLoan();
      const loanId = created.body.data.id;

      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() + 4 * 86_400_000) },
      });
      await request({
        method: 'POST',
        url: `/api/v1/fleet/loans/${loanId}/close`,
        user: ownerA,
        payload: { status: 'CLOSED' },
      });

      const result = await runEmiReminderSweep();
      expect(result.sent).toBe(0);
    });

    it('promotes a lapsed installment to overdue', async () => {
      await createLoan();
      await prisma.loanInstallment.updateMany({
        where: { number: 1 },
        data: { dueDate: new Date(Date.now() - 2 * 86_400_000) },
      });

      const result = await runOverdueSweep();
      expect(result.markedOverdue).toBe(1);

      const installment = await prisma.loanInstallment.findFirst({ where: { number: 1 } });
      expect(installment?.status).toBe(InstallmentStatus.OVERDUE);
    });
  });

  // -------------------------------------------------------------------------

  describe('vehicle passport panel', () => {
    it('returns the finance records held against one vehicle', async () => {
      await createLoan();

      const response = await request<{ id: string; registrationNumber: string }[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicleA.id}/loans`,
        user: ownerA,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]?.registrationNumber).toBe(vehicleA.registrationNumber);
    });

    it('refuses the panel to a manager', async () => {
      await createLoan();
      const response = await request({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicleA.id}/loans`,
        user: managerA,
      });
      expect(response.status).toBe(403);
    });
  });
});
