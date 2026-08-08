export type VerificationStatus = 'pending' | 'verified' | 'not_verified' | 'error'
export type RequestKind = 'private_verification' | 'authorized_access'
export type VerificationCondition = {
  metric: 'sealed_reports'
  operator: 'gte' | 'eq' | 'lt'
  threshold: number
}
export type VerificationResult = {
  requestId: string
  status: VerificationStatus
  condition: VerificationCondition
  value: boolean
  privateFields: string[]
  proof?: { status: string; network: string; circuit: string; proofId: string }
}
export type AuthorizedReport = {
  id: string
  title: string
  status: 'sealed'
  shared: string[]
  private: string[]
  transcript: string
  evidence: { type: string; label: string }[]
}
