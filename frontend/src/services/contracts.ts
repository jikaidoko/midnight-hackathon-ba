import type { DisclosureSelection, DraftReport, IdentityResult, SealedReport } from '../types'

export interface IdentityService {
  authenticateVoice(): Promise<IdentityResult>
}

export interface ReportService {
  sealReport(report: DraftReport): Promise<SealedReport>
  getReport(id: string): Promise<SealedReport>
  getReports(): Promise<SealedReport[]>
}

export interface DisclosureService {
  authorize(reportId: string, selection: DisclosureSelection): Promise<{ authorized: true; recipient: string }>
}
