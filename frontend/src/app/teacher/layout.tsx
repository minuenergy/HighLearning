import type { ReactNode } from 'react'
import WorkspaceShell from '@/components/workspace/WorkspaceShell'

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell role="teacher">{children}</WorkspaceShell>
}
