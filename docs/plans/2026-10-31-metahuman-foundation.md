# Foundation reset: MetaHuman topology, DNA and RigLogic in the browser

*2026-10-31, night. Owner's direction: "The MakeHuman approach isn't working." Then three links: Epic's OpenRigLogic,
the MetaHuman Conform Topology pack on Fab ("use this model"), and a showcase of UE 5.8 running in the browser
("this guy literally built Unreal Engine 5.8 in the web, what are we doing wrong"). This document is the honest
diagnosis and the approach that replaces the Psyblr Human v2 base. The canon (`2026-10-31-canon-psyblr-human.md`)
still rules on art target, controls and combat; its phase 1 "base model" changes as written here.*

## 1. What we were doing wrong

1. **Building foundations instead of adopting them.** Own topology (MakeHuman's 13.5k mesh), own rig (76 Mixamo
   names), own face basis (landmarks over 200 MakeHuman targets), own hair (shell plus shader cards), own cloth fit.
   Each of those is a multi-year studio discipline. We did each in a day or two and the result reads that way.
2. **Starting from a mean mesh with a thin target set** and expecting FC 26 likeness. MakeHuman's targets were made
   for a 2008 modelling tool, not for photo likeness; the head is a mean head with offsets. No amount of least squares
   over it gives Jensen's parting or jaw.
3. **Hair as a shader trick.** Every game in the reference set uses authored grooms or cards. Ours was a procedural
   shell. It could be tuned forever and never become hair.
4. **No ecosystem.** Every hairstyle, beard, garment and prop had to be made by us. With a standard topology, the
   whole MetaHuman market on Fab (grooms, clothing, textures, many free) fits our body by construction.
5. **No levels of detail, no threading.** Twenty full-mesh bodies at one LOD in single-threaded JavaScript. The
   browser UE demo ships 8 head LODs and 4 body LODs per character, WebAssembly threads with SIMD, and caches every
   WebGPU bind group and pipeline. Its author did not build a character system; he compiled a proven one.
6. **Accepting by my own screenshots.** The owner's eye caught the gap each time. Acceptance has to be a reference
   beside the result at a fixed camera, judged by the owner, before anything is called done.

## 2. What the three links give us

**OpenRigLogic** (github.com/EpicGames/openriglogic, MIT). Two C++11 libraries with Python bindings: a DNA
reader/writer (`BinaryStreamReader`, `JSONStreamReader`, layers `DefinitionReader`, `BehaviorReader`,
`GeometryReader`, `RBFBehavior`, `MachineLearnedBehavior`) and RigLogic (`RigLogic`, `RigInstance`), "the same
runtime rig evaluation as Unreal Engine". CMake, no engine dependency, "platform independence is a critical design
feature". Branch `5.8` is the stable snapshot. Nothing about WebAssembly in the README; a C++11 CMake library with
optional AVX is a normal Emscripten target, but that is the first thing to prove. Sample DNA files are sold
separately on Fab; Epic's older MetaHuman-DNA-Calibration repository shipped Ada and Taro DNAs.

**MetaHuman Conform Topology** (Fab, Epic Games, free, Standard License, v1.3.0 updated 2025-09-18, FBX, 97.88 MB).
"Separate MetaHuman head and body archetype meshes using standard MetaHuman topology and UV layout. Excludes joints,
skinweights, blendshapes, and LOD meshes. Topology guide textures are included." Made for the "conform from template
mesh" workflow: wrap these archetypes onto a custom sculpt in a third-party tool, import as a static mesh, conform
in MetaHuman Creator. Listing flags: Allows usage with AI: **No**; Generated with AI: No. The pack is the
published contract of the MetaHuman surface.

**UE 5.8 in the browser** (forums thread 2838620, 2026-10-08, demo at unrealtwin.com/ue-demo). The Game Animation
Sample compiled to multi-threaded WebAssembly with `-msimd128`, Chaos physics, a WebGPU RHI with descriptor hashing
and bind group and pipeline caching after 100 ms GC stalls from per-frame bind groups. Motion matching over 500+
clips, physics-control ragdolls, multi-character combat. On an i5-1235U laptop with 16 GB: JS heap 371 to 385 MB,
WebAssembly memory 1,191.8 MiB, GPU 399.8 MiB, 400k to 650k triangles, 180 to 370 draws, 0 device losses. No source.
The lesson is not "port Unreal"; it is that a complete character stack with LODs, cached GPU state and threaded CPU
work runs in a browser tab, and that memory, not the GPU, is the budget on an 8 GB machine.

## 3. The new foundation

| Layer | Was (Psyblr Human v2) | Becomes |
| --- | --- | --- |
| Surface | MakeHuman full mesh, 13,552 verts, one LOD | MetaHuman topology and UVs (head and body archetypes), 8 head and 4 body LODs from DNA |
| Rig | 76 bones, Mixamo names, 52 ARKit shapes | MetaHuman skeleton (UE5-compatible body joints, facial joints) driven by RigLogic from a DNA; ARKit maps to its raw controls as MetaHuman already does |
| Identity | Landmark fit over MakeHuman targets | One DNA per hero, made by conforming a head and body to the template (MetaHuman Creator, Conform from Template) and exported with DCC Export |
| Face animation | Blendshape weights | RigLogic in WebAssembly: controls in, joint transforms and LOD0 blendshapes out |
| Body motion | Mixamo clips retargeted to our rig | Mixamo clips retargeted once, offline, to the MetaHuman body skeleton (the Mixamo to UE5 skeleton path is standard) |
| Hair | Shell plus shader cards | Authored grooms and cards made for the MetaHuman head (Fab, many free), through our fit gate |
| Clothes | Items fitted to our surface | MetaHuman-fitted clothing from Fab or generated against the archetype, through our fit gate |
| Look | Our anime-realism shading | Unchanged: our shading over MetaHuman textures, our outline and skill bursts |
| Creator | Sliders over MakeHuman targets, chat patcher | Creator-style regional controls over DNA neutral geometry and joint positions (the DNA writer edits them), same chat patcher mapping |

What stays as is: the fit gate (`tools/wardrobe/fit.ts`, now against the MetaHuman body), carry-over and refinement
(`src/kit/fit/retarget.ts`, `refine-raw.ts`), the face landmark detector, the chat patcher (`src/forge/patch.ts`),
the Forge UI, the control table and combat.

## 4. Hard constraints found tonight

- **This Mac cannot run the authoring pipeline.** MacBook Air M1, 8 GB, 39 GB free; no Unreal Engine, cmake or
  Emscripten installed. UE 5.7's editor needs well over 100 GB and Epic recommends far more than 8 GB. As of 5.7
  MetaHuman Creator runs in the editor on Mac, but Identity and Performance creation, MetaHuman Animator and
  "Conform from Identity" are Windows only. "Conform from Template" is not listed as disabled. Making DNAs needs
  another machine: a Windows box, a cloud workstation, or a borrowed PC. Runtime stays on the Air.
- **Licence.** From UE 5.6 MetaHuman is covered by the Unreal Engine EULA; Epic's licensing page says MetaHumans can
  be used with any engine or creative software, free under US$1M revenue (press, June 2025, consistent across
  CG Channel, Digital Production, Creative Bloq). The full text at metahuman.com/license needs an Epic sign-in; the
  owner should read it before we ship. The topology pack's "Allows usage with AI: No" means the archetype meshes
  are not fed to a generative model; generated heads are wrapped onto the topology, which is the published workflow.
- **RigLogic in WebAssembly is unproven.** The README promises platform independence, not a web build.
- **Memory.** A MetaHuman head LOD0 carries tens of thousands of vertices and hundreds of blendshape targets. Twenty
  characters need the LOD policy below and shared behaviour data, and the budget is the Air's 8 GB.
- **Our rig contract changes.** `src/kit/rig/standard.json`, the motion library, sockets and the fit tool re-point
  to the MetaHuman skeleton. That is the cost of leaving the Mixamo names behind.

## 5. Spikes before committing, each with a pass line

1. **RigLogic to WebAssembly.** Install cmake and emsdk, build `openriglogic` branch 5.8 with Emscripten, load a
   DNA, evaluate one frame. Pass: under 0.3 ms per rig per frame at head LOD1 on the Air, module under 3 MB.
2. **Render a DNA.** Convert a DNA's geometry, weights, joints and LOD0 shapes to our binary; render head and body in
   Three.js WebGPU with our shading; instance twenty at a LOD mix (one at LOD0, four at LOD2, the rest at LOD4 and
   below). Pass: p95 at or under 16.7 ms, JS heap under 1.5 GB, GPU memory under 600 MB.
3. **Likeness path.** On a machine that runs UE 5.7: generate a head from a reference image, wrap the archetype to it,
   Conform from Template, DCC Export, load in spike 2. Pass: Jensen beside the reference at a fixed camera, owner
   says yes.
4. **Ecosystem fit.** One Fab MetaHuman groom and one outfit through the fit gate onto the body DNA. Pass: gate
   clean, nothing of the body shows, hair reads as locks at the Forge camera.

Spikes 1, 2 and 4 run on the Air. Spike 3 needs the owner's decision on an authoring machine.

## 6. LOD and memory policy

- Head: LOD0 only for the Forge studio and the camera's own hero in combat; LOD1 to LOD3 for the field within 10 m;
  LOD4 and lower beyond. Body: LOD0 in the studio, LOD1 for the hero, LOD2 and LOD3 on the field.
- Blendshapes are LOD0 only (as DNA defines); joints carry the face at every other LOD.
- Behaviour data of a DNA is loaded once per rig definition and shared by every instance of it; neutral geometry
  is per hero.
- GPU skinning in the shader; bind groups and pipelines cached by key, as the browser UE demo does.

## 7. Acceptance

A hero is done when the owner, looking at the reference beside the render at the fixed Forge camera and in motion
on the field, says it is them. Numbers: p95 frame time at or under 16.7 ms with twenty heroes on the Air; heap and
GPU budgets from spike 2 held in the soak.
