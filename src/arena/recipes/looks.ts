import type { Build } from '../../charter/build.js'
import { elementLook, formsFor, type CastPose, type Charge, type Element, type Form, type SkillLook } from '../../charter/skill-look.js'
import { getTemplate, hasTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot, Delivery, Template } from '../../charter/types.js'

/**
 * Looks from words (R33): a skill nobody gave a look reads one from its name, its description and its template.
 * Famous moves are recognised whole, so a skill called Kamehameha fires a white and sky-blue wave from the hip, while
 * the preset names stay generic ("Energy wave"). Anything else reads an element and a form from its words. The first
 * matching entry wins in every list, so the specific words sit above the general ones.
 */

type Move = Partial<SkillLook> & Pick<SkillLook, 'element'>

const MOVES: { words: RegExp; look: Move }[] = [
  { words: /kamehameha|kame hame ha/i, look: { element: 'energy', palette: ['#f4fdff', '#59c7ff', '#1e7bff'], form: 'wave', pose: 'hip', charge: 'gather', impact: 'dome' } },
  { words: /galic?k gun/i, look: { element: 'energy', palette: ['#fff0fb', '#d36bff', '#7a1fd1'], form: 'crackle', pose: 'palms', charge: 'crackle', impact: 'burst' } },
  { words: /special beam cannon|makankosappo/i, look: { element: 'energy', palette: ['#fffbd6', '#ffe14d', '#8a3dff'], form: 'drill', pose: 'fingers', charge: 'point', impact: 'pierce' } },
  { words: /final flash/i, look: { element: 'energy', palette: ['#ffffff', '#fff27a', '#ffc21a'], form: 'wave', pose: 'palms', charge: 'crackle', impact: 'dome', intensity: 1.6 } },
  { words: /masenko/i, look: { element: 'energy', palette: ['#fffbd6', '#ffe14d', '#ff9a00'], form: 'wave', pose: 'overhead', charge: 'gather', impact: 'burst' } },
  { words: /death beam/i, look: { element: 'shadow', palette: ['#fff0fb', '#ff5ad6', '#8a1f7a'], form: 'laser', pose: 'fingers', charge: 'point', impact: 'pierce' } },
  { words: /spirit bomb|genki ?dama/i, look: { element: 'energy', palette: ['#e8fbff', '#59c7ff', '#ffffff'], form: 'orb', pose: 'overhead', charge: 'sky', impact: 'dome', intensity: 1.8 } },
  { words: /big bang attack/i, look: { element: 'energy', palette: ['#ffffff', '#7fd6ff', '#2a6cff'], form: 'orb', pose: 'palm', impact: 'dome' } },
  { words: /destructo disc|kienzan/i, look: { element: 'energy', palette: ['#fffbd6', '#ffe14d', '#ff9a00'], form: 'disc', pose: 'overhead', impact: 'pierce' } },
  { words: /hadou?ken/i, look: { element: 'energy', palette: ['#e8fbff', '#4fb2ff', '#1e5bff'], form: 'orb', pose: 'palms', impact: 'burst' } },
  { words: /hollow purple/i, look: { element: 'cosmic', palette: ['#ffffff', '#b46bff', '#5a1fd1'], form: 'orb', pose: 'fingers', charge: 'crackle', impact: 'dome' } },
  { words: /domain expansion|infinite void/i, look: { element: 'cosmic', palette: ['#ffffff', '#b46bff', '#120018'], form: 'dome', pose: 'fingers', charge: 'sky' } },
  { words: /unibeam/i, look: { element: 'tech', palette: ['#ffffff', '#9ae8ff', '#2ab4ff'], form: 'wave', pose: 'cross', impact: 'burst' } },
  { words: /repulsor/i, look: { element: 'tech', palette: ['#ffffff', '#9ae8ff', '#2ab4ff'], form: 'orb', pose: 'palm', impact: 'burst' } },
  { words: /force lightning|sith lightning/i, look: { element: 'lightning', palette: ['#ffffff', '#c9b3ff', '#6a4dff'], form: 'crackle', pose: 'palms', charge: 'crackle' } },
  { words: /expecto patronum|patronus/i, look: { element: 'light', palette: ['#ffffff', '#d6ecff', '#9ab8ff'], form: 'stream', pose: 'palm', impact: 'dome' } },
  { words: /avada kedavra|killing curse/i, look: { element: 'poison', palette: ['#e8ffe8', '#3dff6a', '#0a7a2a'], form: 'laser', pose: 'fingers', impact: 'pierce' } },
  { words: /getsuga|tensh[oō]/i, look: { element: 'shadow', palette: ['#ffffff', '#5ad6ff', '#141a3a'], form: 'crescent', pose: 'swing' } },
  { words: /great fireball|fire ?ball jutsu|katon/i, look: { element: 'fire', palette: ['#fff1a8', '#ff7a1a', '#c21f00'], form: 'breath', pose: 'breath' } },
  { words: /amaterasu/i, look: { element: 'fire', palette: ['#ff9a9a', '#2a0a12', '#000000'], impact: 'burst', trail: 'smoke' } },
  { words: /chidori|raikiri/i, look: { element: 'lightning', palette: ['#ffffff', '#9ad8ff', '#3a7bff'], form: 'thrust', charge: 'crackle', impact: 'pierce' } },
  { words: /rasengan/i, look: { element: 'wind', palette: ['#ffffff', '#7ad0ff', '#2a6cff'], form: 'punch', pose: 'palm', charge: 'gather', impact: 'dome' } },
  { words: /gatling|ora ora|muda muda/i, look: { element: 'energy', palette: ['#fff1e8', '#ff5a3d', '#c21f00'], form: 'flurry' } },
  { words: /gomu gomu|gum[- ]gum|red hawk/i, look: { element: 'fire', palette: ['#fff1e8', '#ff5a3d', '#c21f00'], form: 'punch', impact: 'burst' } },
  { words: /serious punch|one punch/i, look: { element: 'energy', palette: ['#ffffff', '#ffe58a', '#ff3d3d'], form: 'punch', impact: 'dome', intensity: 1.6 } },
  { words: /falcon punch/i, look: { element: 'fire', palette: ['#fff1a8', '#ff7a1a', '#ff3d00'], form: 'punch', charge: 'gather', impact: 'burst' } },
  { words: /black flash/i, look: { element: 'shadow', palette: ['#ff6b6b', '#1a0008', '#000000'], form: 'punch', impact: 'burst' } },
  { words: /kaio-?ken/i, look: { element: 'fire', palette: ['#ffe8e8', '#ff3d3d', '#a80000'], form: 'flame' } },
  { words: /solar flare|taiyoken/i, look: { element: 'light', palette: ['#ffffff', '#fff6c2', '#ffd23d'], form: 'flare', pose: 'fingers' } },
  { words: /instant transmission|shunkan id[oō]/i, look: { element: 'energy', palette: ['#ffffff', '#c9f0ff', '#59c7ff'], form: 'flash', pose: 'fingers' } },
  { words: /shadow clone|kage bunshin|zanzoken/i, look: { element: 'shadow', palette: ['#ffffff', '#b8c4ff', '#4b1d7a'], form: 'afterimage' } },
  { words: /substitution|kawarimi/i, look: { element: 'shadow', palette: ['#ffffff', '#d8d8d8', '#6a6a6a'], form: 'smoke' } },
  { words: /mjolnir|god of thunder/i, look: { element: 'lightning', palette: ['#ffffff', '#cfe8ff', '#5a8cff'], form: 'rain', pose: 'overhead', charge: 'sky' } },
]

const ELEMENT_WORDS: [Element, RegExp][] = [
  ['nature', /nature|leaf|leaves|\bvine|thorn|flower|bloom|blossom|forest|petal|\bwood|sakura|garden/i],
  ['poison', /poison|venom|toxic|acid|plague|miasma|virus/i],
  ['fire', /fire|flame|blaze|inferno|ember|burn|heat|lava|magma|solar|\bsun\b|phoenix|katon/i],
  ['ice', /\bice\b|\bicy|frost|freez|frozen|\bcold|snow|glacial|glacier|blizzard|cryo/i],
  ['lightning', /lightning|thunder|electric|volt|spark|chidori|static|shock|\bzap|tesla/i],
  ['water', /water|\btide|ocean|\bsea\b|aqua|hydro|torrent|tsunami/i],
  ['wind', /wind|gust|tornado|cyclone|\bair\b|breeze|hurricane|typhoon|aero/i],
  ['earth', /earth|\brocks?\b|stone|quake|ground|boulder|\bsand|mountain|crater|terra|avalanche|seismic|tremor/i],
  ['cosmic', /cosmic|\bstars?\b|galax|nebula|meteor|comet|space|gravity|black hole|orbit|astral|celestial|\bmoon|planet|singularity|\btime|chrono/i],
  ['shadow', /shadow|\bdark|\bvoid|abyss|death|\bnight|curse|\bhex|\bdoom|necro|\bsoul|ghost|phantom/i],
  ['light', /holy|\blight\b|divine|angel|\bheal|radiant|sacred|\bhope|bless|benedict|sanctu|renew|halo|purif|grace|guardian/i],
  ['money', /money|\bcash|stonk|\bgold|\bcoin|dollar|wealth|\brich|interest|\bdeal|\bbank|profit|dividend/i],
  ['sound', /sound|sonic|music|\bsong|voice|shout|scream|\broar|\becho|chime|\bdrum|\bbass\b|\bnote|\bcry\b/i],
  ['tech', /\bgpu|cuda|\bchip|cyber|laser|\btech|\bai\b|robot|drone|\bcode|digital|\bdata|cloud|network|\brail|\bnano|\bmech|turret|rocket|\bjet|tensor|silicon|circuit/i],
  ['metal', /metal|\biron|steel|blade|sword|chain|magnet|bullet|shrapnel|knife|knives|\baxe|kunai|pistol|rifle|\bgun|\bnail|shield/i],
  ['energy', /\bki\b|\bchi\b|energy|spirit|\baura|\bpower|plasma|\bbeam|blast/i],
]

// within a family the first form that matches wins; forms the delivery can't take are skipped
const FORM_WORDS: [Form, RegExp][] = [
  ['drill', /drill|spiral|corkscrew|gimlet|auger/i],
  ['helix', /helix|\btwin|double|\bdna\b|braid|intertwin/i],
  ['crackle', /crackl|lightning|thunder|electric|spark|static|\barc\b/i],
  ['laser', /laser|\bray\b|\brail|precision|needle|lance/i],
  ['pillar', /pillar|column|geyser|erupt|tower/i],
  ['stream', /stream|\bjet\b|torrent|\bhose|\bflow|flamethrower/i],
  ['wave', /wave|surge|blast|cannon|beam/i],
  ['disc', /\bdisc|\bdisk|\bsaw\b|chakram|frisbee|\bring\b/i],
  ['crescent', /crescent|\bmoon|flying slash|air slash|sword wave/i],
  ['meteor', /meteor|comet|boulder|\brocks?\b|fireball|asteroid/i],
  ['arrow', /arrow|\bdart|\bhook|harpoon|missile|bullet|\bshot\b|\bround|\brail|sniper|rifle|pistol|\bgun|\bnail|headshot|headhunter|sidearm/i],
  ['shard', /shard|icicle|crystal|kunai|knife|knives|needle|dagger|spike|shuriken/i],
  ['bolt', /bolt|\bzap|spark|shock|lightning|thunder/i],
  ['orb', /\borb|\bball|sphere|\bbomb|bubble|globe|cannon/i],
  ['flurry', /flurry|combo|barrage|\brush|frenzy|thousand/i],
  ['claw', /claw|talon|\brake|swipe|maul/i],
  ['thrust', /thrust|\bstab|lance|spear|pierce|rapier|impale/i],
  ['smash', /smash|hammer|\bslam|crush|\bpound|\bclub|colossus/i],
  ['punch', /punch|\bfist|\bjab|haymaker|\bhook|uppercut|strike|knuckle/i],
  ['slash', /slash|blade|sword|\bcut|cleav|\baxe|katana|\bedge|scythe|slice/i],
  ['breath', /breath|exhale|flame|\bfire|dragon|inferno|ember/i],
  ['sonic', /sonic|sound|shout|scream|\broar|voice|\becho|\bcry\b/i],
  ['gust', /gust|wind|\bpush|\bblow\b|tornado|\bforce/i],
  ['shards', /shards|shrapnel|needles|spikes/i],
  ['spray', /spray|scatter|shotgun|splash/i],
  ['rain', /\brain|storm|barrage|meteor|shower|\bhail|volley|airstrike|bombard|wrath/i],
  ['vortex', /vortex|gravity|black hole|whirlpool|\bwell\b|singularity|maelstrom/i],
  ['dome', /\bdome|domain|barrier|bubble|citadel|stasis|time stop/i],
  ['quake', /quake|tremor|shatter|stomp|crater|\bslam|seismic|avalanche/i],
  ['field', /field|circle|sanctuary|totem|\bward\b|glyph|\bseal\b|prison|\btrap|\bmine\b/i],
  ['blast', /blast|\bbomb|explosion|\bnova|burst|detonat|bang\b/i],
  ['flame', /flame|\bfire|\bburn|blaze|inferno/i],
  ['storm', /storm|lightning|thunder|static|electric/i],
  ['mist', /\bmist|\bfog\b|frost|smoke|miasma|poison|\bcold/i],
  ['ring', /\bring|halo|pulse|\bnova/i],
  ['shield', /shield|barrier|armou?r|\bskin\b|fortif|guard|\bwall|unbreak|immovable/i],
  ['spiral', /spiral|ascen|\brise|channel|\bwind/i],
  ['flare', /flare|flash|burst|solar|\bbang/i],
  ['glow', /\bglow|focus|\bpower|\brage|\bfury|surge/i],
  ['chain', /chain|\bhook|grappl|zipline|\brope|\bwhip|tether/i],
  ['rocket', /rocket|\bjet|thruster|booster|propel/i],
  ['afterimage', /afterimage|after-image|phantom|mirage|\bclone/i],
  ['smoke', /smoke|vanish|ninja|\bpoof|shadow step|substitut/i],
  ['flash', /flash|blink|teleport|instant|\bwarp|transmission|\bphase/i],
  ['streak', /dash|\brush|charge|sprint|slide|\bbull|\brun\b|leap|jump/i],
]

const POSE_WORDS: [CastPose, RegExp][] = [
  ['fingers', /two fingers|finger|\bpoint/i],
  ['overhead', /overhead|above (the|his|her|their) head|raised high/i],
  ['clap', /\bclap/i],
  ['slam', /\bslam|stomp|ground pound/i],
  ['summon', /summon|call(s|ed|ing)? down|conjur/i],
  ['breath', /breath|exhale|\bspit/i],
  ['spin', /\bspin|whirl|twirl/i],
  ['cross', /crossed|cross burst|\bx[- ]burst/i],
  ['palms', /\bpalms|both hands/i],
  ['palm', /\bpalm\b|one hand/i],
  ['hip', /\bhip\b|cupped/i],
]

const CHARGE_WORDS: [Charge, RegExp][] = [
  ['sky', /darken|the sky|heavens/i],
  ['crackle', /crackl/i],
  ['point', /fingertip/i],
  ['gather', /charge[ds]? up|gather|build[s]? up|focus(es|ed)? (its|his|her|their) /i],
]

/** The pose a form calls for when the words don't name one; basic attacks keep their quick swing or shot. */
const FORM_POSE: Partial<Record<Form, CastPose>> = {
  wave: 'hip',
  crackle: 'palms',
  drill: 'fingers',
  laser: 'palm',
  helix: 'palms',
  stream: 'palm',
  pillar: 'slam',
  orb: 'palm',
  bolt: 'fingers',
  disc: 'overhead',
  crescent: 'swing',
  shard: 'palm',
  meteor: 'overhead',
  arrow: 'shot',
  punch: 'palm',
  smash: 'slam',
  breath: 'breath',
  sonic: 'breath',
  gust: 'palm',
  spray: 'palm',
  shards: 'palm',
  rain: 'summon',
  quake: 'slam',
  dome: 'cross',
  vortex: 'palms',
  field: 'slam',
  flame: 'cross',
  storm: 'cross',
  flare: 'cross',
  shield: 'cross',
}

const first = <T>(list: [T, RegExp][], text: string, fits: (v: T) => boolean = () => true): T | undefined => list.find(([v, words]) => fits(v) && words.test(text))?.[0]

/** A famous move named in these words, if any: its whole look, called out by name. */
export function famousMove(text: string | undefined): SkillLook | undefined {
  const move = text ? MOVES.find((m) => m.words.test(text))?.look : undefined
  return move ? { ...elementLook(move.element), ...move, ...(move.palette ? { palette: [...move.palette] as SkillLook['palette'] } : {}), callout: true } : undefined
}

export interface SkillWords {
  /** The player's own words: the skill's name, description and visual direction. */
  own: string
  /** The template's name, read after the player's words. */
  template?: string
  /** The template's tags, read last: they describe the mechanic ("splash", "root"), so they only break a tie. */
  tags?: string
  kind?: Delivery['kind']
  slot?: BuildSlot
  /** The hero's own element, for a skill whose words name none. */
  signature?: Element
}

/**
 * A look from words. A famous move is taken whole (its form only where the delivery can take it); otherwise the
 * element comes from the player's words, then the template's name, then the hero's signature, then the template's
 * tags, and a skill that names no element at all gets none, so it keeps its delivery's neutral look. The form is read
 * the same way, the pose and the charge from the player's words; an ultimate is called out.
 */
export function lookFromWords({ own, template = '', tags = '', kind, slot, signature }: SkillWords): SkillLook | undefined {
  const fits = (f: Form) => !kind || formsFor(kind).includes(f)
  const famous = famousMove(own)
  const element = famous?.element ?? first(ELEMENT_WORDS, own) ?? first(ELEMENT_WORDS, template) ?? signature ?? first(ELEMENT_WORDS, tags)
  if (!element) return undefined
  const look: SkillLook = famous ?? elementLook(element)
  const form = famous?.form && fits(famous.form) ? famous.form : kind ? (first(FORM_WORDS, own, fits) ?? first(FORM_WORDS, template, fits) ?? first(FORM_WORDS, tags, fits)) : undefined
  if (form) look.form = form
  else delete look.form
  // a basic attack keeps its swing or shot, and an ultimate its own big clip, unless the words name a pose
  const pose = famous?.pose ?? first(POSE_WORDS, own) ?? (slot !== 'basic' && slot !== 'ultimate' && form ? FORM_POSE[form] : undefined)
  if (pose) look.pose = pose
  const charge = famous?.charge ?? first(CHARGE_WORDS, own)
  if (charge) look.charge = charge
  if (slot === 'ultimate') look.callout = true
  return look
}

/** A look from a single phrase, as the offline director reads a theme. */
export const lookFor = (text: string | undefined, kind?: Delivery['kind']): SkillLook | undefined => (text ? lookFromWords({ own: text, kind }) : undefined)

/** The words a skill's template carries: its name and its tags. */
export const templateWords = (t: Pick<Template, 'name' | 'tags'>): Pick<SkillWords, 'template' | 'tags'> => ({ template: t.name, tags: t.tags.join(' ') })

/** The look a skill is drawn with: its own when it has one, else the one its words give it. */
export function skillLookOf(build: Pick<Build, 'slots' | 'look'>, slot: BuildSlot, signature?: Element): SkillLook | undefined {
  const own = build.look?.skills?.[slot]
  if (own) return own
  const spec = build.slots[slot]
  if (!spec || !hasTemplate(spec.templateId)) return undefined
  const template = getTemplate(spec.templateId)
  return lookFromWords({ own: [spec.name, spec.flavour, spec.visual].filter(Boolean).join(' '), ...templateWords(template), kind: template.delivery.kind, slot, signature })
}
