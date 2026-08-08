// index.ts — which implementation the screens get.
//
// One switch, read once, from an explicit `VITE_MN_MODE=chain`. Not inferred
// from whether the other variables happen to be set: "some config is present"
// is not a statement of intent, and the failure mode of guessing is a demo
// silently running on mocks in front of an audience that was told it was live.
//
// Screens import from here and never from `mock` or `midnight` directly, so
// which one is running is a build decision rather than something scattered
// across ten files.

import { loadConfig, useChain } from '../midnight/config'
import { buildProviders } from '../midnight/providers'
import {
  ChainCredentialService,
  ChainOversightFeed,
  ChainReporterFeed,
  ChainReportingService,
  ChainResponseService,
} from '../midnight/adapters'
import type {
  CredentialService,
  DisclosureService,
  IdentityService,
  OversightFeed,
  ReporterFeed,
  ReportingService,
  ResponseService,
} from './contracts'
import {
  chain as mockChain,
  credentialService as mockCredential,
  disclosureService as mockDisclosure,
  identityService as mockIdentity,
  oversightFeed as mockOversight,
  reporterFeed as mockFeed,
  reportingService as mockReporting,
  responseService as mockResponses,
} from './mock'

export const CHAIN_MODE = useChain()

interface Services {
  reporterFeed: ReporterFeed
  reportingService: ReportingService
  credentialService: CredentialService
  disclosureService: DisclosureService
  identityService: IdentityService
  oversightFeed: OversightFeed
  responseService: ResponseService
  /**
   * Human-readable label for a case commitment.
   *
   * On chain a case is 32 bytes and nothing else — no title, no description.
   * Anything readable is off-chain data keyed by the commitment, and this
   * project has no such source yet, so chain mode shows the commitment itself
   * rather than inventing a name for it.
   */
  titleOf(caseCommitment: string): string
}

function chainServices(): Services {
  const config = loadConfig()
  const providers = buildProviders(config)
  return {
    reporterFeed: new ChainReporterFeed(providers, config),
    reportingService: new ChainReportingService(providers, config),
    credentialService: new ChainCredentialService(providers, config),
    // Public state, no secret, no wallet. Readable here for the same reason it
    // is readable by anyone: that is the accountability claim.
    oversightFeed: new ChainOversightFeed(providers, config),
    responseService: new ChainResponseService(providers, config),
    // Neither of these has a circuit. They are the same demo stand-ins in both
    // modes, and both say so on screen.
    disclosureService: mockDisclosure,
    identityService: mockIdentity,
    titleOf: (caseCommitment) => `Caso ${caseCommitment.slice(0, 8)}…`,
  }
}

function mockServices(): Services {
  return {
    reporterFeed: mockFeed,
    reportingService: mockReporting,
    credentialService: mockCredential,
    oversightFeed: mockOversight,
    responseService: mockResponses,
    disclosureService: mockDisclosure,
    identityService: mockIdentity,
    titleOf: (caseCommitment) => mockChain.titleOf(caseCommitment),
  }
}

const services: Services = CHAIN_MODE ? chainServices() : mockServices()

export const reporterFeed = services.reporterFeed
export const reportingService = services.reportingService
export const credentialService = services.credentialService
export const disclosureService = services.disclosureService
export const identityService = services.identityService
export const oversightFeed = services.oversightFeed
export const responseService = services.responseService
export const titleOf = services.titleOf
