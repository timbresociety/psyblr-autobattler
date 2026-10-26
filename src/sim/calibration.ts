import { AI_CALIBRATION_VERSION } from '../arena/ai/calibration.js'
import { ENGINE_CALIBRATION_VERSION } from '../arena/engine/calibration.js'

/**
 * The versions a gate result is stamped with (KTD6). The balance model is the 3D arena engine fighting with the demo
 * AI, so a change to either calibration marks every stored build stale and it is re-checked on its next use.
 */
export const CALIBRATION_VERSION = ENGINE_CALIBRATION_VERSION
export { AI_CALIBRATION_VERSION }
