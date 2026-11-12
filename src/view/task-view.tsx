import { useEffect, useState } from 'react'
import { answered, ask } from 'kehikot-module-protocol/client'
import { Cover } from 'kehikot-module-protocol/client/react'

import type { NamedPlace } from '../../record.ts'
import { TerminalView } from './terminal-view.tsx'

/**
 * One conversation on its own: `agent.tasks`' view (protocol 2.88.0), `/app?session=<id>`, which
 * Kehikot frames in a dialog of its own while one of its tasks runs — with no greeting, so no place
 * and no project from the host. The server says where the conversation runs (`/api/tasks/view`),
 * and the view attaches to it like any view of a running session: nothing is started here, and a
 * conversation this module does not run is said, not opened.
 */

/** The conversation the address names, or null when it names none. */
export function taskSession(search: string): string | null {
  const id = new URLSearchParams(search).get('session') ?? ''
  return /^ses_[0-9A-Za-z]{10,64}$/.test(id) ? id : null
}

interface Where {
  projectPath: string
  projectId: string | null
  place: NamedPlace
}

export function TaskView({ session, theme, onDrawn }: { session: string; theme: 'light' | 'dark'; onDrawn?: () => void }) {
  const [where, setWhere] = useState<Where | null | 'asking'>('asking')
  const [why, setWhy] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    void ask<{ view: Where | null }>('./api/tasks/view', { query: { session }, ticket: true })
      .then((said) => {
        if (!gone) setWhere(answered(said).view)
      })
      .catch((error: unknown) => {
        if (gone) return
        setWhy(error instanceof Error ? error.message : String(error))
        setWhere(null)
      })
    return () => {
      gone = true
    }
  }, [session])

  if (where === 'asking') return <div className="h-full" data-task-view="asking" />
  if (!where) {
    return (
      <div className="flex h-full items-center justify-center p-4" data-task-view="none">
        <Cover state="empty" name="OpenCode">
          {why ?? 'This conversation is not running in OpenCode here.'}
        </Cover>
      </div>
    )
  }
  const kehikko = where.place.kehikko
  return (
    <div className="h-full" data-task-view={session}>
      <TerminalView
        theme={theme}
        shown
        onDrawn={onDrawn}
        target={{
          what: 'session',
          projectPath: where.projectPath,
          ...(where.projectId ? { projectId: where.projectId } : {}),
          place: { epic: where.place.epic, parts: where.place.parts, kehikko, kehikkoName: where.place.kehikkoName ?? '' },
          session,
        }}
      />
    </div>
  )
}
