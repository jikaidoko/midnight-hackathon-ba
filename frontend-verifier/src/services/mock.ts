import type { AuthorizedAccessService, VerificationService } from './contracts'
import type { AuthorizedReport, VerificationCondition, VerificationResult } from '../types/domain'
export const mockVerificationService: VerificationService = {
  async verifyCondition(condition: VerificationCondition): Promise<VerificationResult> {
    await new Promise(r => setTimeout(r, 700))
    return {
      requestId: 'VR-0182', status: 'verified', condition, value: true,
      privateFields: ['Identidad', 'Fechas', 'Contenido', 'Ubicación'],
      proof: { status: 'Valid', network: 'Midnight', circuit: 'report-history-threshold', proofId: '0x8e21...4fa9' }
    }
  }
}
const transcript = `Quiero dejar constancia de una situación que observé cerca de un río, en una localidad de la zona cordillerana. Durante los últimos días noté cambios en el color del agua y un olor inusual en un sector próximo a instalaciones utilizadas por terceros. También observé movimiento de vehículos y actividad en el lugar que, por lo que pude ver, podría estar vinculada con una empresa que opera en la zona. No puedo confirmar el origen de lo que está ocurriendo, pero considero importante que se revise porque podría tratarse de algún tipo de vertido o contaminación del río.`
export const mockAuthorizedAccessService: AuthorizedAccessService = {
  async getAuthorizedReport(_reportId: string): Promise<AuthorizedReport> {
    return {
      id: 'RP-0048', title: 'Posible contaminación de un río', status: 'sealed',
      shared: ['Relato de la denuncia', 'Evidencia adjunta'],
      private: ['Identidad', 'Ubicación exacta'], transcript,
      evidence: [
        {type:'image', label:'Fotografía · 2 archivos'},
        {type:'audio', label:'Audio · 01:34'},
        {type:'document', label:'Documento · 1 archivo'}
      ]
    }
  }
}
