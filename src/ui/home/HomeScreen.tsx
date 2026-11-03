import { Link } from 'react-router'
import type { Build } from '../../charter/build'
import type { BuildRecord } from '../api'
import { LoadoutScreen } from '../loadout/LoadoutScreen'
import './home.css'

/**
 * `/` (GAME.md §11): where the loop starts. Make a hero, take one to the lobby or the range, and below, every hero on
 * this device with the global search and the most used heroes.
 */
export function HomeScreen({ onEdit, onRemix, onForge }: { onEdit: (record: BuildRecord) => void; onRemix: (build: Build) => void; onForge: () => void }) {
  return (
    <div className="home">
      <section className="home-hero">
        <h1>Make anyone. Drop them in. Watch them brawl.</h1>
        <p>Describe a hero and the Forge builds it, kit and all. It pops out of the gacha machine and onto the House of Instinct.</p>
        <div className="home-actions">
          <button className="btn primary big" onClick={onForge}>
            Create a hero
          </button>
          <Link className="btn big" to="/lobby">
            Stage a battle
          </Link>
          <Link className="btn big" to="/range">
            Training range
          </Link>
        </div>
      </section>
      <LoadoutScreen onEdit={onEdit} onRemix={onRemix} onForge={onForge} />
      <footer className="home-foot">
        <Link to="/credits">Credits</Link>
      </footer>
    </div>
  )
}
