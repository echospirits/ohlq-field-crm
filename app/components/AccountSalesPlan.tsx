import {
  readPipelineStages,
  effectivePipelineStage,
} from "../../lib/crm/pipelineStages";
import { RecordPicker } from "./RecordPicker";
import { prisma } from "../../lib/prisma";
import { requireCrmActor } from "../../lib/crm/auth";
import { readSalesPlan } from "../../lib/crm/pipeline";
import type { CrmAccount } from "../../lib/crm/activity";
import { saveSalesPlanAction } from "../pipeline/actions";
import { CrmForm } from "./CrmForm";
export async function AccountSalesPlan({ account }: { account: CrmAccount }) {
  const { actor } = await requireCrmActor();
  const overlay = await prisma.organizationAccountOverlay.findUnique({
    where: {
      organizationId_accountType_externalAccountId: {
        organizationId: actor.organizationId,
        accountType: account.accountType,
        externalAccountId: account.accountId,
      },
    },
  });
  const plan = readSalesPlan(overlay?.salesPlan);
  const org = await prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { crmPreferences: true },
    }),
    stages = readPipelineStages(org.crmPreferences).stages;
  const stage = effectivePipelineStage(stages, overlay?.salesPlan, overlay?.salesStatus ?? null);
  const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const hasPlan = Object.values(plan).some((value) => value !== null && value !== '');
  return (
    <section className="account-plan-summary" aria-label="Account plan">
      <div className="section-heading"><h3>Account plan</h3>{plan.estimatedRevenue !== null || plan.estimatedVolume !== null ? <small className="muted">Planning estimates · not recorded revenue</small> : null}</div>
      {hasPlan ? <dl className="read-summary account-plan-facts">
        {stage ? <div><dt>Stage</dt><dd>{stage.name}</dd></div> : null}
        {plan.objectives ? <div className="account-plan-objective"><dt>Objective</dt><dd>{plan.objectives}</dd></div> : null}
        {plan.products ? <div><dt>Target products</dt><dd>{plan.products}</dd></div> : null}
        {plan.estimatedRevenue !== null ? <div><dt>Revenue estimate</dt><dd>{money(plan.estimatedRevenue)}</dd></div> : null}
        {plan.estimatedVolume !== null ? <div><dt>Bottles estimate</dt><dd>{plan.estimatedVolume.toLocaleString('en-US')}</dd></div> : null}
        {plan.probability !== null ? <div><dt>Probability</dt><dd>{plan.probability}%</dd></div> : null}
        {plan.expectedCloseDate ? <div><dt>Expected close</dt><dd>{plan.expectedCloseDate}</dd></div> : null}
        {plan.competitors ? <div><dt>Competitors</dt><dd>{plan.competitors}</dd></div> : null}
        {plan.objections ? <div><dt>Objections</dt><dd>{plan.objections}</dd></div> : null}
        {plan.placementEvidence ? <div><dt>Placement evidence</dt><dd>{plan.placementEvidence}</dd></div> : null}
      </dl> : <p className="muted">No account plan recorded.</p>}
      <details className="compact-details account-plan-editor">
      <summary>{hasPlan ? 'Edit account plan' : 'Add account plan'}</summary>
      <CrmForm action={saveSalesPlanAction} submitLabel="Save account plan">
        <input name="accountType" type="hidden" value={account.accountType} />
        <input name="accountId" type="hidden" value={account.accountId} />
        <input
          name="version"
          type="hidden"
          value={overlay?.salesPlanVersion ?? 0}
        />
        {stages.length ? (
          <RecordPicker
            name="stageKey"
            label="Detailed sales stage"
            defaultValue={
              effectivePipelineStage(
                stages,
                overlay?.salesPlan,
                overlay?.salesStatus ?? null,
              )?.id ?? ""
            }
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="No detailed stage recorded"
          />
        ) : null}
        <label>
          Objectives
          <textarea
            name="objectives"
            maxLength={4000}
            defaultValue={plan.objectives}
          />
        </label>
        <label>
          Target products
          <input
            name="products"
            maxLength={2000}
            defaultValue={plan.products}
          />
        </label>
        <div className="form-grid">
          <label>
            Estimated revenue (USD)
            <input
              name="estimatedRevenue"
              type="number"
              min="0"
              max="20000000"
              step="0.01"
              defaultValue={plan.estimatedRevenue ?? ""}
            />
          </label>
          <label>
            Estimated bottles
            <input
              name="estimatedVolume"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={plan.estimatedVolume ?? ""}
            />
          </label>
          <label>
            Probability (%)
            <input
              name="probability"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={plan.probability ?? ""}
            />
          </label>
          <label>
            Expected close date
            <input
              name="expectedCloseDate"
              type="date"
              defaultValue={plan.expectedCloseDate}
            />
          </label>
        </div>
        <label>
          Competitors
          <input
            name="competitors"
            maxLength={2000}
            defaultValue={plan.competitors}
          />
        </label>
        <label>
          Objections
          <textarea
            name="objections"
            maxLength={2000}
            defaultValue={plan.objections}
          />
        </label>
        <label>
          Placement evidence
          <textarea
            name="placementEvidence"
            maxLength={2000}
            defaultValue={plan.placementEvidence}
            placeholder="What was verified, when, and by whom? A commitment alone is not verified placement."
          />
        </label>
      </CrmForm>
      </details>
    </section>
  );
}
