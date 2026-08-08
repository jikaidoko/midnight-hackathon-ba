import type { ReactNode } from 'react'
export default function StatusChip({children, tone='lavender'}:{children:ReactNode;tone?:'lavender'|'cream'|'neutral'}){
 return <span className={`chip chip-${tone}`}>{children}</span>
}
