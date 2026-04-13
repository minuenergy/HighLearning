import type { ReactNode } from 'react'
import WorkspaceShell from '@/components/workspace/WorkspaceShell'

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell role="student">{children}</WorkspaceShell>
}
