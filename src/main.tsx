import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost — and, from protocol
   2.59.0, the error reporter, so a page that fails tells the host why. */
import 'kehikot-module-protocol/client'
/* The page's whole entry (protocol 2.70.0): StrictMode, and ReportErrors around it, so a render that
   throws is said to the host; a missing root is said too, rather than left blank. */
import { mountPage } from 'kehikot-module-protocol/client/mount'
import { App } from './app.tsx'
import { keepFramesComing } from './view/frames.ts'

/* Before anything on this page asks for a frame. WebKit serves a framed page
   one animation frame every ten seconds in some states, and xterm draws only
   inside one; from here on a frame that is owed is drawn from a one-shot
   timer instead. `src/view/frames.ts` is Terminal's, with its measurements. */
keepFramesComing()

mountPage('root', <App />)
