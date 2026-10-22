/**
 * The offline director's culture table (KTD4): enough references to fill blindspots without a model.
 * A live director knows far more; this keeps the forge useful offline and gives tests a stable brain.
 */
export interface CultureEntry {
  key: string
  names: string[]
  realPerson: boolean
  elements: string[]
  catchphrases: string[]
  skillThemes: string[]
  colors: string[]
  heroicLean: string
  memeLean: string
}

export const CULTURE: CultureEntry[] = [
  {
    key: 'jensen',
    names: ['jensen', 'huang'],
    realPerson: true,
    elements: ['black leather jacket', 'keynote stage spotlight', 'GPU die chest plate', 'oven-mitt gauntlet from the kitchen keynote'],
    catchphrases: ['The more you buy, the more you save', 'This is a GPU'],
    skillThemes: ['CUDA core barrage', 'tensor beam', 'Huang\'s law overclock', 'datacenter summon'],
    colors: ['NVIDIA green', 'jet black'],
    heroicLean: 'a GPU god who bends compute itself',
    memeLean: 'a keynote showman who sells you three GPUs mid-fight',
  },
  {
    key: 'raiden',
    names: ['raiden', 'rayden'],
    realPerson: false,
    elements: ['wide conical straw hat', 'crackling lightning eyes', 'thunder-god robes'],
    catchphrases: ['Flawless victory'],
    skillThemes: ['lightning teleport', 'torpedo dash', 'electric fly'],
    colors: ['storm white', 'electric blue'],
    heroicLean: 'a thunder god judging the arena',
    memeLean: 'a lightning god who keeps teleporting into the wrong spot',
  },
  {
    key: 'goku',
    names: ['goku', 'kakarot'],
    realPerson: false,
    elements: ['orange gi with blue undershirt', 'spiky hair that flares gold', 'power pole'],
    catchphrases: ['Kamehameha!', 'I am the hope of the universe'],
    skillThemes: ['Kamehameha beam', 'Super Saiyan transformation', 'Instant Transmission', 'Spirit Bomb'],
    colors: ['gi orange', 'Super Saiyan gold'],
    heroicLean: 'a Saiyan pushing past every limit',
    memeLean: 'a Saiyan who stops the fight to ask about food',
  },
  {
    key: 'elon',
    names: ['elon', 'musk'],
    realPerson: true,
    elements: ['black bomber jacket', 'rocket booster backpack', 'X-logo shield'],
    catchphrases: ['Funding secured', 'Occupy Mars'],
    skillThemes: ['Starship launch', 'flamethrower', 'Cybertruck ram', 'Mars colony summon'],
    colors: ['matte black', 'rocket-exhaust orange'],
    heroicLean: 'a rocket baron conquering orbit',
    memeLean: 'a meme lord whose rockets explode on schedule',
  },
  {
    key: 'luffy',
    names: ['luffy', 'monkey d'],
    realPerson: false,
    elements: ['straw hat', 'red open vest', 'stretching rubber limbs'],
    catchphrases: ['I\'m gonna be King of the Pirates!'],
    skillThemes: ['Gum-Gum Pistol', 'Gear Fifth transformation', 'Gum-Gum Gatling'],
    colors: ['straw yellow', 'pirate red'],
    heroicLean: 'a future pirate king who never gives up',
    memeLean: 'a rubber man who wins by laughing',
  },
  {
    key: 'sam',
    names: ['sam altman', 'altman'],
    realPerson: true,
    elements: ['plain grey hoodie', 'calm keynote stare', 'glowing model weights halo'],
    catchphrases: ['AGI is coming'],
    skillThemes: ['model release shockwave', 'compute scale-up', 'board reshuffle'],
    colors: ['soft grey', 'OpenAI white'],
    heroicLean: 'an architect of artificial minds',
    memeLean: 'a founder who gets fired and rehired between rounds',
  },
]

export function findCulture(text: string): CultureEntry[] {
  const lower = text.toLowerCase()
  return CULTURE.filter((entry) => entry.names.some((n) => lower.includes(n)))
}
