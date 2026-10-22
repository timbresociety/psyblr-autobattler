/// <reference lib="webworker" />
import { handleGateMessage, type GateRequest } from './gate-protocol'

// The balance gate runs hundreds of fights; doing it here keeps the creator responsive (KTD7).
self.onmessage = (event: MessageEvent<GateRequest>) => {
  self.postMessage(handleGateMessage(event.data))
}
