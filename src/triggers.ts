import type { Claim, Ophelix, TestHelpersClaimsSimulateReturnParams } from '@ophelix/node'

type ReturnScenario = TestHelpersClaimsSimulateReturnParams['scenario']

/** Ce qu'une étape a fait, pour l'afficher : la route appelée et l'objet qu'elle rend. */
export type Step = (route: string, id: string, detail?: string) => void

export interface TriggerOptions {
  /** Le scénario de la carte Vitale, `vitale_ok` par défaut. */
  vitale: string
  /** Le scénario de la carte CPS, `cps_doctor` par défaut. */
  cps: string
  /** La date des soins, AAAA-MM-JJ, le jour même par défaut. */
  serviceDate: string
}

export interface Trigger {
  /** Le type d'événement qu'on veut recevoir : c'est le nom sous lequel on le déclenche. */
  event: string
  description: string
  run: (ophelix: Ophelix, options: TriggerOptions, step: Step) => Promise<void>
}

/**
 * Une facture de test au brouillon, faite comme le guide de démarrage : une CPS, une carte Vitale,
 * une consultation au prix demandé. Rien que des routes publiques du mode test.
 */
async function draftClaim(ophelix: Ophelix, options: TriggerOptions, step: Step): Promise<Claim> {
  const practitioner = await ophelix.practitioners.create({ card: options.cps })
  step('POST /v1/practitioners', practitioner.id, options.cps)
  const coverage = await ophelix.coverages.create({ source: 'vitale_card', card: options.vitale })
  step('POST /v1/coverages', coverage.id, options.vitale)
  const claim = await ophelix.claims.create({
    practitioner: practitioner.id,
    patient: coverage.patient,
    third_party_amo: true,
    context: { care_pathway: 'treating_doctor', common_law_accident: false },
    lines: [{ nomenclature: 'ngap', code: 'ZC', service_date: options.serviceDate, unit_price_cents: 2650 }],
  })
  step('POST /v1/claims', claim.id, claim.status)
  return claim
}

async function readyClaim(ophelix: Ophelix, options: TriggerOptions, step: Step): Promise<Claim> {
  const claim = await draftClaim(ophelix, options, step)
  const validation = await ophelix.claims.validate(claim.id)
  step(`POST /v1/claims/${claim.id}/validate`, claim.id, validation.valid ? 'valide' : 'invalide')
  const ready = await ophelix.claims.finalize(claim.id)
  step(`POST /v1/claims/${claim.id}/finalize`, ready.id, ready.status)
  return ready
}

async function securedClaim(ophelix: Ophelix, options: TriggerOptions, step: Step): Promise<Claim> {
  const ready = await readyClaim(ophelix, options, step)
  const secured = await ophelix.claims.secure(ready.id)
  step(`POST /v1/claims/${ready.id}/secure`, secured.id, secured.status)
  return secured
}

/** Un retour simulé sur la facture : accusé, paiement ou rejet, comme le guide Cartes de test. */
async function simulateReturn(ophelix: Ophelix, claim: Claim, scenario: ReturnScenario, step: Step): Promise<Claim> {
  const returned = await ophelix.testHelpers.claims.simulateReturn(claim.id, { scenario })
  step(`POST /v1/test-helpers/claims/${claim.id}/returns`, returned.id, `${scenario} → ${returned.status}`)
  return returned
}

function afterAcknowledgment(scenario: ReturnScenario): Trigger['run'] {
  return async (ophelix, options, step) => {
    const acknowledged = await simulateReturn(ophelix, await securedClaim(ophelix, options, step), 'arl_positive', step)
    await simulateReturn(ophelix, acknowledged, scenario, step)
  }
}

const acknowledged: Trigger['run'] = async (ophelix, options, step) => {
  await simulateReturn(ophelix, await securedClaim(ophelix, options, step), 'arl_positive', step)
}

export const TRIGGERS: Trigger[] = [
  {
    event: 'practitioner.created',
    description: 'Un praticien lu sur une carte CPS de test',
    run: async (ophelix, options, step) => {
      const practitioner = await ophelix.practitioners.create({ card: options.cps })
      step('POST /v1/practitioners', practitioner.id, options.cps)
    },
  },
  {
    event: 'coverage.retrieved',
    description: 'Un patient et ses droits, lus sur une carte Vitale de test',
    run: async (ophelix, options, step) => {
      const coverage = await ophelix.coverages.create({ source: 'vitale_card', card: options.vitale })
      step('POST /v1/coverages', coverage.id, options.vitale)
    },
  },
  { event: 'claim.created', description: 'Une facture au brouillon', run: async (...args) => void (await draftClaim(...args)) },
  { event: 'claim.ready', description: 'Une facture validée et finalisée', run: async (...args) => void (await readyClaim(...args)) },
  {
    event: 'claim.canceled',
    description: 'Une facture finalisée, puis annulée',
    run: async (ophelix, options, step) => {
      const ready = await readyClaim(ophelix, options, step)
      const canceled = await ophelix.claims.cancel(ready.id)
      step(`POST /v1/claims/${ready.id}/cancel`, canceled.id, canceled.status)
    },
  },
  { event: 'claim.secured', description: 'Une facture signée', run: async (...args) => void (await securedClaim(...args)) },
  { event: 'claim.batched', description: 'Une facture mise en lot, avec son accusé positif', run: acknowledged },
  { event: 'claim.transmitted', description: 'Une facture transmise, avec son accusé positif', run: acknowledged },
  { event: 'claim.acknowledged', description: 'Une facture dont le lot a un accusé positif', run: acknowledged },
  { event: 'batch.created', description: 'Un lot ouvert pour une facture signée, avec son accusé positif', run: acknowledged },
  { event: 'batch.sent', description: 'Un lot envoyé, avec son accusé positif', run: acknowledged },
  { event: 'batch.acknowledged', description: 'Un lot à l’accusé positif', run: acknowledged },
  {
    event: 'batch.failed',
    description: 'Un lot à l’accusé négatif qui désigne la facture : elle passe à rejected',
    run: async (ophelix, options, step) => {
      await simulateReturn(ophelix, await securedClaim(ophelix, options, step), 'arl_negative', step)
    },
  },
  { event: 'claim.paid', description: 'Une facture payée', run: afterAcknowledgment('payment') },
  {
    event: 'remittance.received',
    description: 'Un retour de paiement de la caisse, pour une facture payée',
    run: afterAcknowledgment('payment'),
  },
  {
    event: 'claim.adjusted',
    description: 'Une facture payée, puis régularisée par la caisse',
    run: async (ophelix, options, step) => {
      const acknowledged = await simulateReturn(ophelix, await securedClaim(ophelix, options, step), 'arl_positive', step)
      await simulateReturn(ophelix, await simulateReturn(ophelix, acknowledged, 'payment', step), 'regularization', step)
    },
  },
  { event: 'claim.partially_paid', description: 'Une facture payée à moitié', run: afterAcknowledgment('partial_payment') },
  { event: 'claim.rejected', description: 'Une facture rejetée par la caisse', run: afterAcknowledgment('rejection') },
]

export function findTrigger(event: string): Trigger | undefined {
  return TRIGGERS.find(trigger => trigger.event === event)
}
