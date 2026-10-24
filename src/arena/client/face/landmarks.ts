/**
 * MediaPipe face mesh landmark sets (478 points with irises), the same ones tools/blender/humanlib/face.py uses for the
 * demo heroes' faces, so a photo face in the game is fitted exactly as the offline pipeline fits a portrait.
 */

export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
export const EYES = [33, 133, 159, 145, 160, 158, 153, 144, 362, 263, 386, 374, 385, 387, 380, 373]
export const NOSE = [1, 2, 4, 5, 6, 168, 98, 327, 48, 278, 129, 358]
export const LIPS = [61, 291, 0, 17, 13, 14, 37, 267, 84, 314, 40, 270, 91, 321]
export const BROWS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]
export const CHIN = [152, 199, 175]

const unique = (...sets: number[][]) => [...new Set(sets.flat())].sort((a, b) => a - b)

/** The oval's top runs along the hairline, which hair and photos draw freely; the fit uses the face below it. */
export const FIT = unique(FACE_OVAL.slice(5, -5), EYES, NOSE, LIPS, CHIN)
/** Every point the warp pins: the fit, the brows and the whole oval. */
export const WARP = unique(FIT, BROWS, FACE_OVAL)

/** Cheeks and forehead, where skin is sampled (face.py `skin_sample`). */
export const SKIN_SAMPLES = [50, 280, 151, 205, 425]
/** Iris centres and rims (refined landmarks 468 to 477). */
export const IRISES = [
  { centre: 468, rim: [469, 470, 471, 472] },
  { centre: 473, rim: [474, 475, 476, 477] },
]
export const LANDMARK_COUNT = 478
