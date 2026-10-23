/// <reference lib="webworker" />
import { handleGateMessage, handleSliceMessage, type GateRequest, type SliceRequest } from './gate-protocol'

// The balance gate runs hundreds of fights; doing it here keeps the creator responsive (KTD7). A pool of these workers
// shares each measurement: every worker plays some turns of the field and sends back its score.
self.onmessage = (event: MessageEvent<GateRequest | SliceRequest>) => {
  const data = event.data
  self.postMessage('slice' in data ? handleSliceMessage(data) : handleGateMessage(data))
}
