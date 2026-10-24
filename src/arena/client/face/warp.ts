/**
 * The geometry of fitting a photo to a face, ported from tools/blender/humanlib/face.py: a least-squares similarity
 * (scale, turn, shift) and a thin-plate spline that bends the photo so every landmark lands on its partner.
 */

export type Pt = readonly [number, number]

/** x' = a·x − b·y + tx, y' = b·x + a·y + ty: a scale and a turn (a, b) and a shift. */
export interface Similarity {
  a: number
  b: number
  tx: number
  ty: number
}

/** The similarity taking `src` onto `dst` in the least-squares sense (2D Umeyama, which never mirrors). */
export function similarity(src: readonly Pt[], dst: readonly Pt[]): Similarity {
  const n = src.length
  let msx = 0
  let msy = 0
  let mdx = 0
  let mdy = 0
  for (let i = 0; i < n; i++) {
    msx += src[i][0] / n
    msy += src[i][1] / n
    mdx += dst[i][0] / n
    mdy += dst[i][1] / n
  }
  let na = 0
  let nb = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - msx
    const sy = src[i][1] - msy
    const dx = dst[i][0] - mdx
    const dy = dst[i][1] - mdy
    na += sx * dx + sy * dy
    nb += sx * dy - sy * dx
    den += sx * sx + sy * sy
  }
  const a = den > 0 ? na / den : 1
  const b = den > 0 ? nb / den : 0
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) }
}

export const applySimilarity = (t: Similarity, [x, y]: Pt): [number, number] => [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty]

/** Solve A·X = B for X (n×n, n×m) by Gaussian elimination with partial pivoting. A and B are overwritten. */
export function solve(A: Float64Array[], B: Float64Array[]): Float64Array[] {
  const n = A.length
  const m = B[0].length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-14) throw new Error('singular system')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[B[col], B[pivot]] = [B[pivot], B[col]]
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      for (let c = 0; c < m; c++) B[r][c] -= f * B[col][c]
    }
  }
  const X = Array.from({ length: n }, () => new Float64Array(m))
  for (let r = n - 1; r >= 0; r--) {
    for (let c = 0; c < m; c++) {
      let s = B[r][c]
      for (let k = r + 1; k < n; k++) s -= A[r][k] * X[k][c]
      X[r][c] = s / A[r][r]
    }
  }
  return X
}

const U = (r: number) => (r > 0 ? r * r * Math.log(r) : 0)

/** A thin-plate spline taking each `src` point to its `dst` partner; `reg` relaxes it so noisy points can't fold it. */
export function tpsFit(src: readonly Pt[], dst: readonly Pt[], reg = 1e-3): (q: Pt) => [number, number] {
  const n = src.length
  const size = n + 3
  const A = Array.from({ length: size }, () => new Float64Array(size))
  const B = Array.from({ length: size }, () => new Float64Array(2))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U(Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1])) + (i === j ? reg : 0)
    A[i][n] = A[n][i] = 1
    A[i][n + 1] = A[n + 1][i] = src[i][0]
    A[i][n + 2] = A[n + 2][i] = src[i][1]
    B[i][0] = dst[i][0]
    B[i][1] = dst[i][1]
  }
  const coef = solve(A, B)
  return ([x, y]) => {
    let ox = coef[n][0] + coef[n + 1][0] * x + coef[n + 2][0] * y
    let oy = coef[n][1] + coef[n + 1][1] * x + coef[n + 2][1] * y
    for (let i = 0; i < n; i++) {
      const u = U(Math.hypot(x - src[i][0], y - src[i][1]))
      ox += coef[i][0] * u
      oy += coef[i][1] * u
    }
    return [ox, oy]
  }
}
