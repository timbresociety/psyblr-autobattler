import { PHASES, PRIMITIVES, RECIPE_VERSION, type EffectRecipe } from './schema'

const HEX = /^#[0-9a-f]{6}$/i

/** Problems with a recipe, empty when it is valid (R11, R33). */
export function validateRecipe(recipe: EffectRecipe): string[] {
  const problems: string[] = []
  if (recipe.version !== RECIPE_VERSION) problems.push('wrong recipe version')
  if (!Array.isArray(recipe.palette) || recipe.palette.length !== 3 || !recipe.palette.every((c) => HEX.test(c))) problems.push('palette must be three hex colours')
  if (!(recipe.intensity > 0 && recipe.intensity <= 3)) problems.push('intensity must be in (0, 3]')
  if (!(recipe.charge >= 0 && recipe.charge <= 3)) problems.push('charge must be 0-3 s')
  if (!(recipe.linger >= 0 && recipe.linger <= 6)) problems.push('linger must be 0-6 s')
  if (!recipe.layers?.length) problems.push('no layers')
  for (const [i, layer] of (recipe.layers ?? []).entries()) {
    if (!(PRIMITIVES as readonly string[]).includes(layer.primitive)) problems.push(`layer ${i}: unknown primitive "${layer.primitive}"`)
    if (!(PHASES as readonly string[]).includes(layer.phase)) problems.push(`layer ${i}: unknown phase "${layer.phase}"`)
    if (!(layer.size > 0 && layer.size <= 3)) problems.push(`layer ${i}: size must be in (0, 3]`)
    if (layer.damaging && layer.size > 1) problems.push(`layer ${i}: a damaging layer cannot be drawn bigger than its hit area`)
    if (![0, 1, 2].includes(layer.color)) problems.push(`layer ${i}: colour must be 0, 1 or 2`)
  }
  return problems
}
