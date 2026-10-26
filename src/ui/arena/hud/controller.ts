import type { ArenaController } from '../../../arena/client/match-view.js'

/** The slice of a live match the HUD reads: hooks for events and frames, where heroes were drawn, the camera. */
export type HudController = Pick<ArenaController, 'hooks' | 'camera' | 'positions' | 'arena' | 'views'>
