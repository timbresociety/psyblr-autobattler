# The creator against FC 26 and WWE 2K26: libraries and foundations

*2026-10-31, evening. Owner's direction: "The hair and beard library needs to be reworked as it's not at all
extensive, same issue with body, outfit and gear. You need to properly study FC 26 and WWE 2K26 character creators.
We can also generate 3D glbs if required but for that our foundations need to be strong at base model and rigging
level, so that we can prompt and generate accurately." This document is the study and the plan it leads to. The canon
(`2026-10-31-canon-psyblr-human.md`) still rules where they overlap.*

## 1. What the two creators actually offer

Gathered from the games' own menus, EA's and 2K's published material and the guides that reproduce them. Where a
source names a count it is kept; where it does not, the row says so.

### EA SPORTS FC 26 / 27, Create Your Pro

| Tab | What it holds |
| --- | --- |
| Start | A grid of preset faces (scanned, "starhead", custom and generic types), chosen before any editing |
| Skin | Skin tone (a wide range), complexion, skin surface, freckles; Cranium (FC 25 on) adds scars, acne and burns |
| Head | Shape sliders by region: forehead, jaw, ears, cheeks; Cranium's "define" then "refine" passes (upper forehead width, eye-socket depth, jaw position are the basic parameters EA names) |
| Face | Eye colour, eye shape, brow ridge; nose, mouth and teeth sculpting |
| Hair | Hair colour, hairstyle, eyebrows, facial hair, each from a catalogue |
| Physique | Height, weight, body type |
| Outfit | Boots, socks, ankle tape, gloves, wrist accessories, jersey fit, sleeve style, undershirt; street look and matchday look |
| Animations | Running style, celebration, set-piece routine |

The point of FC's creator is **likeness from a photo and a few sliders**: a scanned-quality face as the start, then a
small number of well-chosen regional sliders, then catalogue picks for everything that reads as silhouette (hair,
brows, beard). Nothing is modelled by the player; everything is picked or nudged.

### WWE 2K26, Create-a-Superstar

| Category | What it holds |
| --- | --- |
| Start | Blank, a template, or a face photo capture aligned by mouth and brows (the game then supplies eyes) |
| Face | Over a hundred adjustable facial points, in regions: head (shape, size), eyebrows (shape, position, angle, size), eyes (shape, size, position, rotation, depth, colour, lids, pupils), nose (bridge, size, tip, nostrils, width), cheeks (bones, fullness), mouth (lips size, width, position, teeth), jaw (width, angle, length), chin (prominence), ears (size, position, angle), neck; expressions for celebration and pain |
| Skin | Tone (a wide range), skin type that reacts to light and sweat, sweat level, age and wrinkles, blemishes, freckles, make-up |
| Hair | "Dozens" of styles, colour per section, highlights, length, sheen; hair rigging for motion |
| Facial hair | Beards, moustaches, stubble with density and colour |
| Body | Body type (light, medium, heavyweight), height and weight (linked but partly independent), muscle density per group (biceps, calves, chest…), body morphing returned in 2K26: individual limbs, torso and glutes scaled |
| Attire | 60 layers per attire (40 for the body), each a garment, pad, tape, pattern or logo with material and colour; clothing resizable to stop clipping; glasses, masks and headgear toggled per match type |
| Save | 200 slots; sharing through Community Creations |

The point of WWE's creator is **depth and breadth**: everything on the body is a slider, everything worn is a layer,
and the catalogues are long. It is also the one whose per-part body morphing matches our size classes and roles.

### What both have that the Forge does not, today

Today's Forge: 98 face sliders in 10 regions over a 200-group MakeHuman basis (deeper than FC, close to WWE's face);
a photo fit with depth; 20 hair styles, 6 beards, 16 tops, 9 trousers, 12 full-body outfits, 11 hats, 3 face pieces,
9 pairs of shoes, 3 back items, 34 rigid gear pieces; 5 body morphs (weight, muscle, age); chat that patches named
parts. Missing against the two:

1. **Breadth.** 20 hair styles against "dozens" to a hundred; 6 beards against a full beard, moustache and stubble
   matrix; no eyebrow catalogue; no skin detail layers (complexion, surface, freckles, scars, age); 9 shoes; no
   per-part body morphing; no attire layering (one item per slot, no pads, tape, logos, patterns beyond prints).
2. **Quality of the hair.** The shell-plus-cards hair reads as fibre, not as locks, and the hairline is a cut edge.
   Both games use authored card hair with strand textures, flow maps and anisotropic shading, in several layers.
3. **Body.** Height, weight, muscle and age only, and the size class. Both games scale parts: head, neck, shoulders,
   chest, waist, hips, glutes, arms, hands, thighs, calves, feet.
4. **Skin.** One photo projection and one flat tone; no complexion, surface, age or freckle layers.
5. **Generation.** Nothing generated feeds back into the catalogue with a guarantee it fits the rig.

## 2. Foundations before breadth

Every catalogue item, generated or authored, has to land on one body and one rig without hand-fixing, or breadth is
just more things that break. The owner's condition ("foundations strong at base model and rigging level, so that we
can prompt and generate accurately") is the right order. The foundation is the Psyblr Human (canon, phase 1), and
what it needs so that generated GLBs fit:

- **One topology, published.** The v2 body (13,552 surface points, MakeHuman's full mesh) is the surface every
  item binds to. Its welded vertex order, UV layout, and the landmark triangles are the contract an item generator
  targets. Publish the base mesh as the template a generator receives (`public/heroes/v2/*.glb` already ships it).
- **One rig, published.** `src/kit/rig/standard.json`: 76 bones, Mixamo names. A generated item is skinned by
  transfer from the body under it, never by its own weights, so a generator only has to produce geometry near the
  body. That transfer exists (the wardrobe fit binds any mesh to the surface) and now carries items between bodies
  (`src/kit/fit/retarget.ts`).
- **Sockets and the face frame.** Gear hangs from named sockets (head, face, back, both hands) and the face fit
  works in one head frame. A generated piece states which socket it is for and nothing else.
- **A fit gate.** `tools/wardrobe/fit.ts` already reports binding error, skin showing through, coverage of the slot's
  core and triangle budget per item. That is the acceptance for anything generated: it goes into the catalogue only
  when the gate passes, like a build passes the balance gate.
- **Per-part body morphs on the base.** Built in Blender from MakeHuman's measurement targets (chest, waist, hips,
  shoulders, neck, upper arm, forearm, thigh, calf, hands, feet, head size) as morph deltas on the welded surface,
  the way weight, muscle and age are today. Items follow automatically because they are bound to the surface.

## 3. The library plan

In the order the creator feels it. Each line is a catalogue and the way it gets filled; "generate" means an image
model draws the reference, a mesh model makes the GLB, and the fit gate accepts it onto the base (the owner has
ChatGPT, Google Flow and Mixamo open; image-to-3D for props and garments is the next tool to put in the loop).

1. **Hair, authored as textured cards.** A strand atlas (root-to-tip alpha, id and flow) and a set of card layouts
   per style family: short back and sides, crop, buzz, swept and side part, quiff, curly, afro, bob, long straight,
   long wavy, ponytail, braid, bun and top knot, mohawk, dreads, undercut, fade, thinning and bald patterns. Each
   family in three lengths and with a parting left, right or none gives sixty-plus styles from about twenty
   layouts. Colour per section, roots and highlights as texture parameters, grey as a percentage. Anisotropic
   shading stays as it is (`dress-model.ts` has it). Jensen's reference needs: swept back, silver with dark roots,
   volume on top, short sides.
2. **Facial hair and brows.** Beards as the same cards: stubble (three densities), goatee, chin strap, full (three
   lengths), moustache (five shapes), mutton chops, soul patch; brows as a card pair with ten shapes and thickness.
3. **Skin layers.** Tone, complexion (undertone and evenness), surface (pores and oil), age (lines by region),
   freckles, blemishes, scars; each a procedural layer on the atlas blended under the photo face, exposed as sliders
   in the Skin section, read by the chat ("older", "freckled", "a scar over the left brow").
4. **Body per part.** The morphs above, in a Body section that mirrors WWE's: height, weight, muscle, age, then
   head, neck, shoulders, chest, waist, hips, glutes, arms, hands, thighs, calves, feet.
5. **Outfit layers.** Keep one surface item per slot for the cut, add layers over it: pads, tape, belts, logos,
   patterns and decals with material and colour, up to a budget per hero. Fill the garment catalogue by family
   (tee, shirt, hoodie, jacket, coat, robe, armour, gi, suit, dress, trousers, shorts, skirt, boots, sneakers,
   sandals, gloves) with three cuts each, generated against the base and gated.
6. **Gear.** Weapons and props by role: the 34 pieces grow to a catalogue by family (blades, blunt, polearms, bows,
   guns, staves, shields, instruments, tech), generated from references and hung by socket.

Done when a prompt like "silver swept-back hair, square glasses, a leather jacket with green circuit lines, cargo
trousers and combat boots, broad jaw, mid fifties" reaches a hero that reads as the reference from every angle, with
nothing of the body showing through the clothes, on this Air at 60 fps with twenty of them on the field.

## 4. Status, 2026-10-31 evening

- Fit foundations: items are carried from the first body onto the Psyblr Human before binding (`retarget.ts`);
  what hides the skin is pushed out of it; buried parts are tucked, never dropped; footwear hides the whole foot;
  a seam's overlap no longer counts as a layer. All twelve bodies are rebuilt on v2 with the glasses socket at the
  eyes; the motion library is retargeted for both genders.
- Creator: the chat patches named parts (`src/forge/patch.ts`: sculpt nudges, colours and shades, build, wardrobe).
- Hair: card clumps widened and faded to locks at a distance, the hairline feathered; still shell-plus-cards, so the
  authored-card hair above is the next piece of work.
