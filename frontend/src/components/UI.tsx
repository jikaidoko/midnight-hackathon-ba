import type { ReactNode } from 'react'
import { Lock, CheckCircle2, ArrowUpRight, Pencil } from 'lucide-react'
import type { ReportStatus } from '../types'

export function PrimaryButton({ children, onClick, disabled=false }: { children: ReactNode; onClick?:()=>void; disabled?:boolean }) {
  return <button className="btn primary" onClick={onClick} disabled={disabled}>{children}</button>
}
export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick?:()=>void }) {
  return <button className="btn secondary" onClick={onClick}>{children}</button>
}
export function StatusChip({ status }: { status: ReportStatus | 'private' | 'verified' }) {
  const map = {
    draft: [<Pencil size={12}/>, 'Borrador'],
    sealed: [<CheckCircle2 size={12}/>, 'Sellado'],
    shared: [<ArrowUpRight size={12}/>, 'Compartido'],
    private: [<Lock size={12}/>, 'Privado'],
    verified: [<CheckCircle2 size={12}/>, 'Verificado'],
  } as const
  return <span className={`status ${status}`}>{map[status][0]} {map[status][1]}</span>
}
export function Card({ children, tone='glass', className='' }: { children: ReactNode; tone?: 'glass'|'cream'|'lavender'|'pink'|'ice'|'white'; className?: string }) {
  return <div className={`card ${tone} ${className}`}>{children}</div>
}
