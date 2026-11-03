# The engine

How John Rated Rumble gets to Unreal Engine 5–grade output in a browser tab, on a MacBook Air M1 and up, built by
the owner, Claude and Blender together. GAME.md says what the game is; this says how the engine underneath it is built
and what it still lacks. Owner direction, 2026-11-03.

## Principles

1. **One clock, one path.** The fight is a deterministic 60 Hz simulation (`src/arena/engine`). Every tick, live or
   replayed, goes through `advance()` in `engine/replay.ts`. The renderer only ever draws between two engine states.
2. **Everything can be replayed.** A match is its setup plus the player's inputs. Recordings replay to the same
   state, tick for tick, in the browser or headless in Node, and a state hash every second proves it.
3. **Everything can be driven and read from a script.** The page has the same handles a person has (keys, mouse,
   camera) plus held time (`__arena.seat`), so an agent plays at its own pace and sees what a player would have seen.
4. **Assets are built, not hand-placed.** Blender runs headless from scripts in `tools/blender`. A map, a prop or a
   garment is a script plus its inputs, so it can be rebuilt, changed and checked by rendering it.
5. **Budget first.** The target is a steady 60 fps at the full 1559×830 render target on the M1 Air in a 10v10. Every
   feature below names how it stays inside that.

## Playtesting and debugging

| Piece | Where | State |
| --- | --- | --- |
| Session recording: setup, inputs that changed, a hash a second, marks | `engine/replay.ts`, live loop in `client/match-view.ts` | Done |
| F9 marks "this felt wrong" and saves the recording | `ui/arena/ArenaScreen.tsx` | Done (dev saves to `.dev-store/recordings`) |
| Replay page, checking the hashes as it plays | `/dev/replay`, `ui/dev/ReplayScreen.tsx` | Done |
| Headless replay to any tick (about 1 ms a tick for a 10v10) | `replay()` | Done |
| The seat: hold time, step n ticks, a row of what the hero, body and camera did | `__arena.seat` | Done |
| Filmstrips and clips from stepped frames | `.scratch` probes + ffmpeg | Done (script side) |
| Playtesters' recordings to analytics, next to the session replay | PostHog | Next: setup and inputs gzipped as an event attached to the session; needs the owner's go-ahead to send data |
| Debug view: capsules, velocity, ground probe, camera ray, collision boxes | client overlay | Next |
| Feel checks as tests: press to motion, dropped presses, animation snaps, camera inside geometry | vitest + seat probes | Started (input buffer, camera tests) |

The recording keeps the staged heroes (`view`) so the replay page can draw them again. A forged hero replays with its
package as it was when the match was played.

## Unreal Engine 5 features, and what stands in for each here

| UE5 | In the browser on an M1 Air | State |
| --- | --- | --- |
| Lumen (dynamic GI) | Baked in Blender: lightmaps (Cycles bake) for the static House, plus an irradiance probe grid for heroes and anything that moves. Screen-space AO on the high tier only | House lightmap done (v1); probes next |
| Nanite (virtualised geometry) | meshopt-simplified LOD chains, impostor cards past the far tier, instancing and batching static pieces to a draw per material | LOD chains and impostors done; meshopt-compressed GLBs next |
| Virtual Shadow Maps | Cascaded sun shadows only for things that move; static shadows baked into the lightmaps | Cascades done; baking next |
| Temporal Super Resolution | Dynamic resolution scaler (done) plus a temporal AA pass on WebGPU | Scaler done; TAA later |
| MetaHuman + materials | One body topology, shading-only customisation: skin, hair, cloth and gear varied by material parameters, not new meshes (owner, 2026-11-03) | Next session's Forge work |
| Material Editor | three.js node materials (TSL), the same graph idea, compiled to WGSL or GLSL | In use; a shared library next |
| Niagara | Our effects system (`client/effects`), GPU sprites and meshes, anime colour discipline | In use |
| Control Rig, IK, Motion Matching | Animation state machine with blends, foot IK, then motion matching on the clip library | Foot planting done; state machine next |
| Chaos physics | The deterministic engine owns gameplay collision; Rapier only for cosmetic debris and bodies | Done |
| Sequencer | Seat plus replays drive cameras for trailers and reels | Later |
| Editor | Blender as the level and asset editor (below); the game itself as the play-in-editor | Next |
| Texture streaming, Oodle | KTX2 (Basis) textures and meshopt geometry, loaded by distance | House packed (meshopt floats, UASTC lightmap); streaming later |

## The Blender pipeline

Blender 5.2 runs headless on this machine (`/Applications/Blender.app/Contents/MacOS/Blender -b --python …`).

1. **Author.** A map's gameplay shape stays in the engine (`engine/house.ts`), since collision has to be exact and
   deterministic. A script exports those pieces to JSON for Blender, so art and collision can't drift apart.
2. **Dress.** `tools/blender` builds the render meshes from the pieces: bevelled edges that catch light, the arcade
   palette as physically based materials (porcelain gloss, graphite, chip lacquer, cobalt and jade enamel), trims and
   panel lines. No stone, trees, grass or banners anywhere (GAME.md §1).
3. **Bake.** Cycles bakes the hall's light into a lightmap atlas on a second UV set: ambient occlusion and bounce
   light from the fluorescent panels. That's the look Lumen gives Unreal, paid once at build time instead of every
   frame.
4. **Pack.** glTF out of Blender; meshopt geometry and KTX2 textures through `@gltf-transform` and `ktx2-encoder`.
5. **Check.** Blender renders previews from fixed cameras and the game renders the same views; both are looked at
   before anything ships (test with the senses).
6. **Load.** The client draws the baked GLB in place of the painted grey boxes, still using the engine's pieces for
   collision, occlusion and destruction.

## Building the House

```
npx tsx tools/blender/house-export.ts            # engine pieces -> tools/blender/build/house.json
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/house.py -- --size 2048 --samples 256
npx tsx tools/blender/house-pack.ts              # -> public/maps/house/{house.glb, lightmap.ktx2}
```

About 7 minutes on the M1 Air (three Cycles bake passes, then the KTX2 encode). The game draws it when the files are
there; `?bake=0` (remembered for the tab) draws the painted grey boxes instead. Version 1 (2026-11-03) has the palette
as real materials, 5 cm bevels and baked fill and bounce. Side by side with the grey boxes it's a modest step: softer
light, edges that catch highlights, no grid. The big steps are what the pipeline now makes cheap: surface detail
(pachinko faces, cabinet panels, decals, signage), emissive screens that light the bake, and reflections.

Lessons:
- Never quantize vertices for WebGPU: there are no three-component 16-bit or 8-bit vertex formats.
- The seat must cap a frame's time like live play does. A 4-second frame blows cloth and debris apart and looks like
  broken geometry.

## Next, in order

1. The debug view.
2. House v2: surface detail and emissive signage in the bake, irradiance probes for the heroes, and a frame-time
   check on the M1 Air with the baked House against the grey boxes.
3. An animation state machine for jump, double jump, roll and mantle, using the seat's rows to check every transition.
4. Playtester recordings into PostHog, once the owner approves sending them.
