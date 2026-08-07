import type { DisclosureService, IdentityService, ReportService } from './contracts'
import type { DisclosureSelection, DraftReport, SealedReport } from '../types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const demoReport: SealedReport = {
  id: 'demo-001',
  title: 'Denuncia por situación ocurrida el 7 de agosto',
  status: 'sealed',
  sealedAt: '7 de agosto · 13:42',
  commitment: '0x74a8...91cf',
  duration: '01:34',
  transcript: 'Quiero dejar constancia de una situación que ocurrió hoy por la mañana. Al llegar al lugar observé una situación que considero importante registrar y acompañar con evidencia.',
  attachments: ['Foto · 2 archivos', 'Ubicación agregada'],
}

export class MockIdentityService implements IdentityService {
  async authenticateVoice() {
    await wait(1500)
    return { recognized: true, displayName: 'Sofía', privateId: 'mn_add...4f2a' }
  }
}

export class MockReportService implements ReportService {
  async sealReport(report: DraftReport) {
    await wait(2100)
    return { ...demoReport, ...report }
  }
  async getReport() { return demoReport }
  async getReports() {
    return [
      demoReport,
      { ...demoReport, id: 'demo-002', title: 'Reporte 2', status: 'shared' as const, sealedAt: 'Hace 1 semana' },
      { ...demoReport, id: 'demo-003', title: 'Reporte 3', status: 'draft' as const, sealedAt: 'Ayer' },
    ]
  }
}

export class MockDisclosureService implements DisclosureService {
  async authorize(_reportId: string, _selection: DisclosureSelection) {
    await wait(900)
    return { authorized: true as const, recipient: 'Autoridad Ambiental' }
  }
}

export const identityService = new MockIdentityService()
export const reportService = new MockReportService()
export const disclosureService = new MockDisclosureService()
