export type ReportStatus = 'draft' | 'sealed' | 'shared'

export interface IdentityResult {
  recognized: boolean
  displayName: string
  privateId: string
}

export interface DraftReport {
  transcript: string
  duration: string
  attachments: string[]
}

export interface SealedReport extends DraftReport {
  id: string
  title: string
  status: ReportStatus
  sealedAt: string
  commitment: string
}

export interface DisclosureSelection {
  content: boolean
  evidence: boolean
  location: boolean
  identity: boolean
}
