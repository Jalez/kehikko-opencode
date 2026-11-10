import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost — and, from protocol
   2.59.0, the error reporter, so a page that fails tells the host why. */
import 'kehikot-module-protocol/client'
import { ReportErrors } from 'kehikot-module-protocol/client/react'
import { App } from './app.tsx'
import { keepFramesComing } from './view/frames.ts'

/* Before anything on this page asks for a frame. WebKit serves a framed page
   one animation frame every ten seconds in some states, and xterm draws only
   inside one; from here on a frame that is owed is drawn from a one-shot
   timer instead. `src/view/frames.ts` is Terminal's, with its measurements. */
keepFramesComing()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ReportErrors>
        <App />
      </ReportErrors>
    </StrictMode>,
  )
}
