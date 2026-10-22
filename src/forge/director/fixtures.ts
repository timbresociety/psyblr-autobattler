/**
 * The director's evaluation set (KTD4): real prompts and the themes a good answer should surface.
 * Tests run it against the offline brain; run it by hand against a live model to judge its culture knowledge.
 */
export interface DirectorFixture {
  prompt: string
  expectTone: 'heroic' | 'meme' | 'mixed' | 'unsure'
  expectThemes: string[]
}

export const DIRECTOR_FIXTURES: DirectorFixture[] = [
  {
    prompt: 'Jensen in a Rayden-like avatar as a GPU god, build his skills around CUDA, Circle Jerk, Stonks, and other relevant cultural memes',
    expectTone: 'mixed',
    expectThemes: ['leather jacket', 'hat', 'lightning', 'The more you buy'],
  },
  { prompt: 'just Jensen', expectTone: 'unsure', expectThemes: ['leather jacket'] },
  { prompt: 'legendary Goku at his most powerful', expectTone: 'heroic', expectThemes: ['Kamehameha', 'gi'] },
  { prompt: 'meme Elon whose rockets keep exploding lol', expectTone: 'meme', expectThemes: ['rocket', 'Funding secured'] },
  { prompt: 'Luffy but an epic pirate king', expectTone: 'heroic', expectThemes: ['straw hat', 'Gum-Gum'] },
]
