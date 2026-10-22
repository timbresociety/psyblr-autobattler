---
title: Hero Forge - Plan
type: feat
date: 2026-10-22
topic: hero-forge
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Hero Forge - Plan

## Goal Capsule

- **Objective:** A player who can't find the hero they want in the global loadout can describe it in their own words and references and, in one guided session, get a rigged, animated, hyper-realistic hero that matches what they asked for, fills in what they didn't say with sharp cultural detail, and is ready to fight in any psyblr game.
- **Product authority:** The owner. This plan owns the Hero Forge: creation flow, cultural director, body, rig, movement and basic-attack motion, skill visuals, the hero asset, accounts and credits for forging. The Character Charter (`docs/plans/2026-10-22-1113-feat-character-charter-plan.md`, PR #1) is upstream and owns every number. The 3D Arena and the rendering pipeline are downstream and not active scope.
- **Open blockers:** None.

---

## Product Contract

### Summary

Hero Forge is a plan-mode creation experience that starts at the global loadout. When nothing there fits, a cultural director turns the player's prompt and reference images into a confirmed spec sheet, then generates the hero stage by stage, and the player confirms each stage before the next one is paid for.
Every forged hero is a hyper-realistic humanoid in the house art style, with a rig, a motion set, and a visual for each of its six Charter skills, stored as a platform asset any psyblr game can load.

### Problem Frame

The Charter makes any hero fair, but a hero is still a photo on a card. Streamers and players come for the moment their idea comes to life: "Jensen as a Raiden-style GPU god with CUDA, Circle Jerk and Stonks skills" has to look and move like what they pictured, and it has to surprise them with details they didn't think to ask for.
One-shot generation fails this in two ways. It spends real money on guesses the player would have corrected. And it either ignores the cultural texture of the request or invents the wrong one. Generative 3D tools also have hard limits: the default provider (Tripo) rigs any humanoid in about 30 seconds but offers only 11 preset motions, renders real faces weakly, and produces no 2D sheets or effect sprites.
Some players will come for the forging experience alone and take their heroes into several psyblr games, so the Forge is a product in its own right, not a settings screen.

### Key Decisions

- **Plan-mode staged flow.** The Forge writes a plan, the player confirms each stage, and money is spent only after a confirm. (session-settled: user-directed — chosen over one-shot generation: the experience should feel like plan mode on Claude.) Governs R6, R11, R12.
- **The whole Forge stays in one plan.** Body, rig, motion, skill visuals and flow are planned together. (session-settled: user-directed — chosen over splitting into body, motion, skill-visual and flow plans: they only work together.)
- **Start at the global loadout; forge only when nothing fits.** (session-settled: user-directed — chosen over checking the loadout as a side step: reuse is the default path.) Governs R1, R2.
- **One free hero, then prepaid credits, with capped retries per stage.** This is the Hyper3D Rodin pattern. (session-settled: user-directed — chosen over a single price, free-until-mesh, and pay-per-generation: the first creation must be free.) Governs R3, R4.
- **Email sign-in and IP-level limits gate forging.** (session-settled: user-directed — chosen over anonymous device IDs: a free credit per device can be farmed.) Governs R3, R5.
- **The cultural director fills the blindspots.** It reads where the player sits between "alpha", "meme" and "just want Jensen", then brainstorms or suggests until the spec is confirmed. (session-settled: user-directed — this is what makes players say "wow".) Governs R7, R8, R9.
- **Motion library plus custom effects.** Skill motions come from our own library per mechanic, retargeted onto any body; uniqueness comes from generated effects, auras and colors. (session-settled: user-approved — chosen over AI-generated motion per skill and a paid custom-motion upgrade: works on every body, cheap, consistent.) Governs R16, R17, R18.
- **Hyper-realistic house style, with real-person likeness allowed.** Silhouette and signature elements are confirmed with the player. Faces aim for recognisable likeness; slightly imperfect is fine. (session-settled: user-directed — chosen over a stylized look and a stylized "inspired-by" likeness: creative freedom within the law.) Governs R10, R13, R25.
- **3 to 5 size classes, chosen freely, priced by the engine.** A large mage or a small tank is allowed. (session-settled: user-directed — chosen over role-locked sizes, cosmetic-only size and free-form size.) Governs R14.
- **Humanoid heroes only, for now.** (session-settled: user-directed.) Governs R13.
- **Provider-agnostic generation that is as unrestricted as the law allows.** Each stage can route to several providers and falls through on a decline. (session-settled: user-directed — chosen over offering the closest alternative on a decline: this is the most crucial part of the puzzle.) Governs R23, R24, R25.
- **Heroes are platform assets reusable across psyblr games.** (session-settled: user-approved — chosen over export to outside engines.) Governs R21, R22.

### Actors

- A1. **Player:** a signed-in player, often a streamer, forging or adding heroes.
- A2. **Cultural director:** the Forge's AI guide. It interprets intent, suggests, drafts the spec sheet, and writes prompts for the generation providers.
- A3. **Generation providers:** external services for text, images, 3D mesh, rigging, retargeting and effects. Tripo is the default for mesh, rig and preset motion.
- A4. **Character Charter:** the existing engine that assigns role, templates and numbers, and runs the balance gate.

### Requirements

**Entry and reuse**

- R1. The Forge opens on the global loadout search, and a player forges a new hero only after choosing "forge new".
- R2. A player can start a new forge from an existing hero as a reference, and the result is a separate new hero.

**Accounts, credits and abuse limits**

- R3. Forging requires email sign-in, and every new account receives enough credits to forge one complete hero, including its capped retries.
- R4. Each paid stage has a fixed retry cap. Further heroes and extra retries are bought with prepaid credits, and a stage that fails or is declined by every provider costs nothing.
- R5. Free-credit claims and forging requests are limited per account and per IP to block farming.

**Cultural director and spec sheet**

- R6. The Forge opens with a chat that offers a suggested example prompt and accepts up to 3 reference images.
- R7. The cultural director classifies the player's intent along the spectrum from heroic to meme. When the intent is unclear, it asks or offers concrete choices.
- R8. The cultural director fills unstated details with culturally specific suggestions (signature outfit, props, catchphrases, references), and the player can accept, swap or drop each one.
- R9. Before any visual is generated, the player confirms a spec sheet: a full-body description, size class, silhouette and signature elements, basic attack style (melee or ranged), and a theme for each skill. The player confirms through options or an editable form.
- R10. Clarifying questions offer only choices the providers can produce (for example Tripo's humanoid rig and preset motions), never options that cannot be built.

**Staged generation and confirms**

- R11. Generation runs in this order, with a confirm before the next stage:
  1. spec sheet and 2D character sheet (front and turnaround)
  2. 3D quad mesh
  3. rig plus movement and basic-attack motions, with the movement skill's effect
  4. active 1 motion and effects
  5. active 2 motion and effects
  6. passive visual and ultimate motion and effects
  7. final stat split
- R12. At each confirm the player can approve, retry within the cap, or edit the inputs for that stage, and an approved stage is never regenerated by a later one.
- R13. Every hero is a rigged humanoid in the hyper-realistic house style, recognisable through silhouette, signature elements and, where providers can deliver it, the face.
- R14. The player picks one of 3 to 5 size classes independent of role. Each class has a standard hitbox and reach, which the Charter prices in the stat budget.
- R15. Each long stage shows live progress, and the player can leave and return to a forge in progress without losing approved stages.

**Motion and effects**

- R16. Movement, basic attack and every skill use motions from a shared library mapped to each Charter template, retargeted onto the hero's rig.
- R17. Where a template has several motion variants, the player picks one at that skill's confirm.
- R18. Each skill's visuals (effect sprites, aura, colors, projectile and impact look) are generated from the player's visual direction and the spec sheet, and they match the mechanic's real shape and range.
- R19. A passive is shown as either an aura or an element on the body that visibly shows the passive's effect.

**Charter integration**

- R20. The Forge uses the Charter for role, templates and stats, so the player's names, descriptions and visuals sit on standard mechanics. The final confirm is the Charter's stat split and balance check.

**Hero asset and platform**

- R21. A finished hero is saved as one versioned, game-neutral package: body, rig, motions, skill visuals, the spec sheet, the 2D sheet and its Charter build.
- R22. Any psyblr game can load a hero package, and the hero appears in the global loadout under the Charter's shared-look rules.

**Providers and content floor**

- R23. Each generation stage can route to more than one provider. A decline or failure falls through to the next provider without the player restarting the stage.
- R24. The provider choice per stage is configuration, so a provider can be added or swapped without changing the player's flow.
- R25. The Forge allows everything legal, including real-person likeness, parody and memes. It refuses only sexual depictions of real people, anything involving minors, and depicting a real person as endorsing the game.

### Key Flows

- F1. Forge a new hero
  - **Trigger:** The player searches the global loadout, finds nothing they like, and chooses "forge new".
  - **Steps:** The player signs in if needed, writes a prompt and attaches references. The cultural director clarifies and suggests, then the player confirms the spec sheet and 2D sheet. The Forge generates the mesh, then the rig and motions, then each skill's visuals, each confirmed in turn. The Charter proposes the stat split and runs the balance gate. The hero package is saved and published to the loadout.
  - **Covered by:** R1, R3, R6–R22
- F2. Retry or edit a stage
  - **Trigger:** The player dislikes a stage's result.
  - **Steps:** The player retries within the cap, or edits that stage's inputs and regenerates. Over the cap, the Forge offers prepaid credits.
  - **Covered by:** R4, R12
- F3. Provider decline or failure
  - **Trigger:** A provider declines or fails a stage.
  - **Steps:** The Forge routes the stage to the next provider. If all decline, the stage costs nothing and the player is told what could not be made and why.
  - **Covered by:** R4, R23, R25
- F4. Resume a forge
  - **Trigger:** The player leaves during generation.
  - **Steps:** On return, the forge reopens at the current stage with every approved stage intact.
  - **Covered by:** R15

### Acceptance Examples

- AE1. **Covers R7, R8, R9.** Given the prompt "Jensen in a Raiden-like avatar as a GPU god, skills around CUDA, Circle Jerk, Stonks and other memes" with photos of Jensen and Raiden, when the cultural director replies, then it asks whether the tone is godlike, meme or both. It also suggests signature elements (leather jacket, Raiden-style hat with GPU-green lightning) and skill themes beyond the three named, and nothing is generated before the spec sheet is confirmed.
- AE2. **Covers R4.** Given a free-credit account at the mesh stage with all retries used, when the player asks for another retry, then the Forge offers prepaid credits and does not generate until they are bought.
- AE3. **Covers R14.** Given a Mage, when the player picks the largest size class, then the confirm shows its larger hitbox and the Charter's stat cost for it, and the role stays Mage.
- AE4. **Covers R19.** Given a passive themed "always charging GPUs", when the passive is confirmed, then the player can choose between an aura and a glowing GPU core on the chest that pulses when the passive triggers.
- AE5. **Covers R23.** Given the default provider declines the meme-heavy ultimate visual, when the stage runs, then the next provider generates it and the player sees no error.
- AE6. **Covers R25.** Given a request for a sexual depiction of a real person, when the spec is drafted, then the cultural director declines that element, offers the rest of the hero, and charges nothing for the declined element.
- AE7. **Covers R1, R2.** Given a player who types "Jensen", when existing Jensens are found, then they can add one for free or start a new forge from one as a reference.

### Success Criteria

- Streamers judge the result close to their prompt and surprising in a good way. Measure this with a post-forge rating that asks both questions ("did it match what you asked for?" and "did it add things you loved?").
- A first-time player finishes a full forge on the free credits without running out of retries at most stages.
- Every published hero loads in the Arena and runs every one of its six skills' motions and effects without missing assets.
- The average generation cost of a complete hero stays inside the free-credit allowance, with headroom for the capped retries.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan owns the Hero Forge. The breakdown below is the current understanding, not a committed roadmap.

- Character Charter (done, PR #1)
  - Enables this plan: roles, templates, stats, the balance gate and the global loadout.
  - Shares: each template's `animationHook`, which this plan turns into the motion-library mapping.
- The 3D Arena (third-person combat with take-control switching)
  - Depends on this plan's hero package and motion library.
- The visual bar (WebGPU rendering, LODs, shaders, HUD)
  - Shares the hero package's asset spec. Still to decide: polycount budgets and LOD generation.
- Accounts and payments
  - This plan brings email sign-in and prepaid credits into scope for the Forge. Payment processing details are still to decide.

### Scope Boundaries

**Deferred for later**

- Non-humanoid heroes (beasts, mechs, creatures).
- AI-generated custom motion per skill.
- Voice lines and sound design for heroes.

**Outside this product's identity**

- Exporting heroes to outside engines or games.
- A form-based character editor with sliders. Creation is conversational with confirms.

### Dependencies / Assumptions

- Tripo is the default provider for mesh, rig and preset motion. As of 2026-10-22 it offers image, multiview and text to 3D, quad output up to 150k faces (FBX), auto-rig for humanoids with Mixamo, Unreal or Unity skeletons in about 30 seconds, and 11 preset motions. It has no custom motion and no 2D sheet or sprite generation. A rigged, animated hero costs roughly 95 to 140 credits (about $1 to $1.50). Paid-tier outputs are commercially usable.
- Tripo takes one main image, so the player's references are merged into one front concept image (from the 2D sheet stage) before the mesh is generated.
- A separate image provider produces the 2D character sheet and effect sprites.
- Real-person faces from generative 3D are imperfect. The owner accepts slightly imperfect likeness.
- The owner accepts the legal exposure of real-person likeness under R25's floor.
- The motion library needs authored or licensed motion clips per template, on a skeleton Tripo can target.

### Outstanding Questions

**Deferred to Planning**

- Which providers back each stage, in what fallback order, and how decline versus failure is detected per provider.
- Source of the motion library (licensed packs, Mixamo-compatible clips, or captured motion) and how variants map to the Charter's templates.
- The retry cap per stage and the credit price of each stage, set from measured provider costs.
- The hero package format, versioning, and the asset spec (polycount, textures, LODs), agreed with the visual-bar plan.
- How the cultural director is evaluated for "elite ball knowledge" (an eval set of real prompts).

### Sources / Research

- Tripo developer docs: https://developers.tripo3d.com/en/docs/introduction.md, rigging https://developers.tripo3d.com/en/docs/animations-rig, retargeting https://developers.tripo3d.com/en/docs/animations-retarget, pricing https://developers.tripo3d.com/en/pricing.
- Pricing pattern reference: Hyper3D Rodin (free starter credits, then prepaid).
- Upstream plan: `docs/plans/2026-10-22-1113-feat-character-charter-plan.md`.
