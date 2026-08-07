import type { AuthorizedReport, VerificationCondition, VerificationResult } from '../types/domain'
export interface VerificationService {
  verifyCondition(condition: VerificationCondition): Promise<VerificationResult>
}
export interface AuthorizedAccessService {
  getAuthorizedReport(reportId: string): Promise<AuthorizedReport>
}
