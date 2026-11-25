
import { EnvTable } from '../environment/EnvTable'

import { type A, useCall } from '../../shared/api'
import { BrandSymbol, Modal } from '../../shared/ui'

export function Onboarding({ onDone, go }: { onDone: () => void; go: (p: string, a?: A) => void }) {
  const env = useCall<A[]>('env:detect'); const ok = env.data?.filter((t) => t.status === 'connected').length
  return (
    <Modal wide bare title="Welcome to SkillDock" onClose={onDone} footer={<><button onClick={() => { onDone(); go('marketplace') }}>Browse the marketplace</button><button className="primary" onClick={onDone}>Continue</button></>}>
      <div className="welcome">
        <div className="welcome-hero">
          <BrandSymbol height={56} />
          <h2>Your AI ecosystem. One control center.</h2>
          <p className="tagline">Dock your skills. Unlock your AI.</p>
          <p>The open-source desktop control center for AI skills, MCP servers, plugins and agent workflows.</p>
          <ul className="principles"><li><b>Transparent.</b> Every source, permission and risk is shown before anything changes.</li><li><b>In your control.</b> Backups and approvals come first; nothing runs behind your back.</li><li><b>Local-first.</b> No account, no telemetry. Your setup stays on this device.</li></ul>
        </div>
        <div className="welcome-body">
          <p>This first scan is <b>read-only</b>: it checks a few tools and which Claude folders exist. Nothing is installed or changed.</p>
          <p className="note">{ok === undefined ? 'Scanning…' : `${ok} of ${env.data?.length} components found. Anything missing is optional, and you can rescan from Overview.`}</p>
          <EnvTable />
        </div>
      </div>
    </Modal>
  )
}
