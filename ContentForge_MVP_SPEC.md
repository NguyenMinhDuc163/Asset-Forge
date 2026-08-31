# ContentForge — MVP Product & Technical Spec

**Status:** MVP specification  
**Product type:** Local-first game asset generation and conversion tool  
**Primary user:** Solo game developer who is strong at code but does not want to design or manually edit game art  
**Frontend:** Next.js App Router + TypeScript + Tailwind CSS  
**Authentication:** None in MVP  
**Database:** None in MVP  
**AI provider in MVP:** OpenAI API  
**Non-AI mode:** Yes  
**Primary goal:** Idea or source image → game-ready asset package that can be consumed directly by game code.

---

## 1. Product vision

ContentForge is not an image generator with extra buttons. It is an **asset compiler for game developers**.

The product accepts either:

- a short natural-language idea,
- a source/reference image,
- or both,

then hides the design and conversion complexity behind code and produces an asset package matching a selected game/project profile.

The desired mental model is:

```text
Idea / Image
    ↓
ContentForge
    ↓
Generate or adapt visual
    ↓
Normalize for target game
    ↓
Validate
    ↓
Preview
    ↓
Export game-ready package
    ↓
Game code can consume it
```

The user should behave like a director, not a designer. They describe what they want, approve a visual result, and export it. They should not need to understand pixel dimensions, alpha cleanup, sprite pivots, atlas coordinates, prompt engineering, model IDs, image quality flags, animation metadata, or legacy game formats unless they explicitly open Advanced settings.

---

## 2. Product principles

### 2.1 One intent → one primary action

The normal workflow should contain one dominant action: **Create asset**.

Do not expose technical steps such as:

- generate prompt,
- remove background,
- resize,
- quantize,
- split sprite,
- pack atlas,
- validate metadata,
- export manifest

as separate required buttons. These are pipeline stages handled automatically.

### 2.2 Progressive disclosure

Basic mode should expose only what is necessary:

1. Asset type.
2. Idea and/or reference image.
3. Create asset.
4. Preview.
5. Export.

Everything else belongs in Settings or a collapsed Advanced area.

### 2.3 Project-aware, not model-aware

The user should think in terms of:

- Character
- Map / Environment
- Item / Object
- Effect

not model names or image-generation parameters.

Model selection exists because the user requested it, but **Auto** is the default and should be the first option.

### 2.4 Deterministic conversion after generation

AI creates or adapts the visual source. Code owns the game format.

Never rely on the image model to emit the final metadata format correctly. After image generation, deterministic code should handle:

- dimensions,
- alpha cleanup,
- crop/trim,
- scaling,
- palette reduction,
- sprite slicing,
- pivot/offset,
- atlas packing,
- naming,
- manifest generation,
- target adapter validation.

### 2.5 Provider-agnostic core

OpenAI is the first AI provider, not a permanent architectural dependency.

The core pipeline must work with:

```text
OpenAI Provider
Manual Image Provider
Future Local AI Provider
Future Other API Provider
```

### 2.6 Local-first

MVP is intended to run locally for one developer.

No login, no user management, no cloud database, no team permissions, no billing system, no telemetry requirement.

---

## 3. Scope of MVP

### Must have

- Next.js + TypeScript + Tailwind UI.
- One main Studio screen.
- Asset kind selection: Character, Environment, Item, Effect.
- Prompt input.
- Image upload by drag/drop or file picker.
- OpenAI mode.
- Non-AI image processing mode.
- Settings for OpenAI API key.
- Friendly model dropdown with Auto default.
- Runtime model discovery from the user's API key.
- Preview of generated/processed result.
- Generic game-ready export package.
- Adapter system for game-specific export.
- First real adapter focused on the developer's current 2D sprite game workflow.
- Local filesystem persistence.
- No login.
- No PostgreSQL.
- Minimal validation and error handling.
- Lint before final build; do not run tests/build continuously.

### Explicitly not required in MVP

- Team accounts.
- Cloud sync.
- Asset marketplace.
- Version history UI.
- Complex layer editor.
- Photoshop-style tools.
- Node editor.
- Timeline animation editor.
- Fully autonomous map generation.
- Fine-tuning models.
- Training custom models.
- PostgreSQL.
- Background workers / queues.
- Web deployment as a public SaaS.
- Large automated test suite.

---

## 4. Two operating directions

## 4.1 Direction A — OpenAI API mode

This is the full creation path.

### Supported inputs

#### Idea only

```text
"A small desert swordsman with white hair and a red scarf"
        ↓
Generate source art
        ↓
Convert to project format
```

#### Image only

```text
reference.png
    ↓
Adapt/restyle image for the selected project
    ↓
Convert to project format
```

#### Idea + image

```text
reference.png
+
"Keep the silhouette but make it an ice warrior"
        ↓
Image edit / reference workflow
        ↓
Convert to project format
```

### OpenAI API strategy for MVP

Use the **Image API** for generation and image editing because the MVP is fundamentally a one-request → one-result workflow.

Use:

- `images.generate` for prompt-only creation.
- `images.edit` when source/reference images are supplied.

Default image model:

```text
gpt-image-2
```

Do not build the first MVP around conversational Responses API image editing. Reserve Responses API for a later feature such as:

```text
"Make the hair longer"
"Keep everything but change the armor"
"Use version 2 and make the weapon smaller"
```

### Important transparency behavior

Do not assume the image model returns transparent sprites.

The pipeline should intentionally generate assets on a simple separable background when transparency is required, then perform post-processing in ContentForge.

For example:

```text
AI output on simple flat background
        ↓
edge/background detection
        ↓
alpha cleanup
        ↓
transparent sprite PNG
```

For complex source images where deterministic background removal is unreliable, MVP should preserve the image rather than silently destroy it. A future optional local segmentation plugin can improve this.

---

## 4.2 Direction B — No-AI mode

No-AI mode is fully supported, but its capabilities must be communicated honestly.

### It can do

```text
Source image
    ↓
Crop / trim
    ↓
Resize
    ↓
Nearest-neighbor pixel scaling
    ↓
Alpha cleanup
    ↓
Palette reduction
    ↓
Sprite slicing based on adapter templates
    ↓
Atlas packing
    ↓
Metadata generation
    ↓
Game-ready export
```

### It cannot do

A text idea cannot become new original artwork without a generative model.

Therefore if the user selects No-AI mode and enters only text, do not show a misleading Create button. Show a short message:

> Add a source image to use image-only processing.

No-AI mode is ideal when the developer already has:

- an image from an artist,
- an image from another legal source,
- an existing game asset,
- a clean PNG,
- a sprite sheet,
- an asset generated somewhere else.

### Future free/local extension

After MVP, a third provider can be added for local ML/AI tools such as background removal or local image generation. This should plug into the same provider interface rather than change the core architecture.

---

## 5. Core concept: Project Profile

To produce assets that are actually usable by code, ContentForge needs to understand the target game.

This is represented by a lightweight **Project Profile**.

A Project Profile contains rules such as:

```ts
interface ProjectProfile {
  id: string;
  name: string;
  rootPath: string;
  adapterId: string;
  outputPath: string;
  styleReferencePaths?: string[];
  defaults: {
    assetKind?: AssetKind;
  };
}
```

The user should not manually enter technical sprite information here.

The selected **adapter** provides those rules automatically.

First-time setup should ask at most:

1. Which game/project folder?
2. Which adapter?

Then ContentForge infers/defaults everything else.

### Built-in adapters for MVP

#### Generic 2D Sprite

Output:

- PNG
- manifest JSON

#### Generic Sprite Sheet

Output:

- sprite sheet PNG
- frame metadata JSON
- pivot metadata

#### Current Game / NRO Legacy Adapter

This is the first real game-specific adapter.

It should translate ContentForge's normalized asset representation into the current game's SmallImage / sprite-part / ID-oriented format.

Keep all NRO-specific code inside this adapter. The rest of ContentForge must remain generic.

---

## 6. Asset pipeline

All asset creation should go through the same conceptual pipeline.

```text
Input
 ↓
Intent normalization
 ↓
Generation source
 ↓
Image normalization
 ↓
Adapter transformation
 ↓
Validation
 ↓
Preview
 ↓
Export
```

### Stage 1 — Input

Input object:

```ts
interface CreateAssetInput {
  projectId: string;
  kind: "character" | "environment" | "item" | "effect";
  prompt?: string;
  referenceImagePaths?: string[];
  provider: "openai" | "manual";
}
```

### Stage 2 — Intent normalization

MVP should primarily use deterministic prompt templates rather than an extra LLM call.

Example internal prompt composition:

```text
USER IDEA
+
ASSET KIND RULES
+
PROJECT STYLE RULES
+
ADAPTER GENERATION RULES
+
OUTPUT COMPOSITION RULES
```

This keeps cost and latency low.

A separate text-planning model can be introduced later if vague prompts need stronger interpretation.

### Stage 3 — Generation source

Provider abstraction:

```ts
interface AssetGenerationProvider {
  id: string;
  label: string;
  canGenerateFromText: boolean;
  canEditImage: boolean;

  generate(input: ProviderGenerateInput): Promise<GeneratedVisual>;
}
```

Initial implementations:

```text
OpenAIImageProvider
ManualImageProvider
```

### Stage 4 — Image normalization

Server-side image processing should handle:

- supported format conversion,
- dimensions,
- EXIF orientation,
- alpha,
- trim,
- resize,
- nearest-neighbor scaling where required,
- PNG output,
- palette quantization where adapter requests it.

Recommended implementation: `sharp`.

### Stage 5 — Adapter transformation

The adapter receives normalized visual data and converts it into the target game structure.

```ts
interface AssetAdapter {
  id: string;
  label: string;
  supportedKinds: AssetKind[];

  getGenerationRecipe(ctx: AdapterContext): GenerationRecipe;
  transform(input: NormalizedAsset): Promise<AdapterOutput>;
  validate(output: AdapterOutput): Promise<ValidationResult>;
  createPreview(output: AdapterOutput): Promise<PreviewModel>;
  export(output: AdapterOutput, destination: string): Promise<ExportResult>;
}
```

### Stage 6 — Validation

Validation should fix issues automatically whenever possible.

Examples:

```text
Wrong dimension → resize automatically
Wrong image format → convert automatically
Trailing transparent space → trim automatically
Missing manifest field → compute automatically
Non-power-of-two atlas → only fix if adapter requires it
```

Only interrupt the user when code cannot safely infer the answer.

### Stage 7 — Preview

Preview must reflect the adapter result, not merely show the raw AI image.

For a composited character adapter, preview the composed character.

For a sprite sheet, preview animation frames if available.

For a map/background, preview the exported layers or final scene representation.

### Stage 8 — Export

MVP export should create a folder rather than directly mutate the user's game project.

Example:

```text
generated-assets/
└── ice-warrior/
    ├── asset.manifest.json
    ├── source.png
    ├── processed.png
    ├── sprites/
    │   ├── head.png
    │   ├── body.png
    │   └── legs.png
    ├── atlas.png
    ├── atlas.json
    └── integration/
        └── README.md
```

A game-specific adapter can change this structure.

Later add **Install into project** as an explicit action. Do not automatically overwrite game files in MVP.

---

## 7. OpenAI Settings UX

Settings should be a small secondary surface, not a setup wizard that blocks the Studio.

Basic settings:

```text
AI Provider
[ OpenAI ]

API key
[ sk-•••••••••••••• ]

Image model
[ Auto — Recommended ▾ ]
```

Saving the API key should automatically validate it. Avoid a separate required "Test" step.

### API key handling

API key must never be returned to the client after it is saved.

Do not store it in:

- localStorage,
- sessionStorage,
- cookies,
- client React state after save,
- source code,
- committed `.env` files.

For the local-first MVP, store provider secrets server-side under the current OS user directory, for example:

```text
~/.contentforge/secrets.json
```

Use restrictive file permissions where supported (`0600`).

Settings API should return only:

```json
{
  "configured": true,
  "maskedKey": "sk-••••••••••a9F2"
}
```

This storage strategy is for a local application. It must be reconsidered before public/serverless deployment.

---

## 8. Model dropdown design

The user should never have to remember raw OpenAI model IDs.

### Basic dropdown

```text
Auto — Recommended
GPT Image 2 — Best image generation
```

Raw ID may appear as muted secondary information:

```text
GPT Image 2
`gpt-image-2`
```

### Dynamic model discovery

When API key is configured:

```text
GET /api/providers/openai/models
        ↓
OpenAI GET /v1/models
        ↓
Available model IDs
        ↓
Intersect with local capability registry
        ↓
Friendly dropdown
```

Important implementation detail: OpenAI's model-list endpoint provides basic model metadata but does not provide enough capability metadata to reliably decide whether a model is an image generator.

Therefore maintain a small local registry:

```ts
interface KnownModel {
  id: string;
  label: string;
  capability: "image" | "planner";
  recommended?: boolean;
  deprecated?: boolean;
}
```

Example initial registry:

```ts
const KNOWN_MODELS = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    capability: "image",
    recommended: true,
  },
];
```

The API result determines whether the user's key can access the model. The local registry determines how ContentForge presents it.

### Auto behavior

`Auto` should resolve to the first available non-deprecated recommended model.

At the time of this spec:

```text
Auto image model → gpt-image-2
```

Do not hard-code the assumption throughout the application. Resolve it in one `modelCatalog` module.

### Unknown future models

If OpenAI returns a new model not yet known to ContentForge:

- do not make it the default automatically,
- optionally show it under **Advanced / Other available models**,
- display the raw model ID,
- update capability registry in a future release.

---

## 9. User experience

## 9.1 Main Studio

The application should feel like one focused creative workbench, not an admin dashboard.

Suggested information hierarchy:

```text
┌──────────────────────────────────────────────────────────┐
│ ContentForge        Project: My Game          Settings   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ What do you want to make?                                │
│ Character   Environment   Item   Effect                  │
│                                                          │
│ ┌─────────────────────────────┐  ┌─────────────────────┐ │
│ │ Describe it                 │  │                     │ │
│ │ [                         ] │  │       Preview       │ │
│ │                             │  │                     │ │
│ │ Drop reference image here   │  │                     │ │
│ │                             │  │                     │ │
│ │        [ Create asset ]     │  │                     │ │
│ └─────────────────────────────┘  └─────────────────────┘ │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Main controls only

- Asset type.
- Prompt.
- Reference image drop zone.
- Create asset.

Do not require users to choose:

- width,
- height,
- image format,
- quality,
- background type,
- palette,
- frame dimensions,
- pivot,
- atlas packing,
- AI temperature,
- image fidelity,
- model parameters.

Those are project/adapter defaults.

## 9.2 Result state

After processing:

```text
Large preview

Ready for game
✓ Format valid
✓ Size normalized
✓ Metadata generated

[ Try another ]               [ Export ]
```

Validation details should stay collapsed unless there is a problem.

## 9.3 Error language

Errors should describe what the user can do, not expose raw API internals first.

Examples:

Bad:

```text
400 invalid_request_error
```

Good:

```text
This API key cannot use GPT Image 2.
Choose another available model in Settings or check your OpenAI project access.
```

Raw error details can exist under a disclosure for developers.

---

## 10. UI direction and Taste-Skill rules

Treat the UI as a focused creative developer tool.

### Design read

```text
Local-first creative utility for a technical solo developer,
with a quiet premium tool language and very low interaction burden.
```

Recommended design characteristics:

- light warm-neutral base or restrained dark neutral,
- one accent color only,
- high-quality typography,
- generous workspace spacing,
- large preview surface,
- strong primary action,
- no decorative AI-purple gradient,
- no generic three-card feature grid,
- no excessive glassmorphism,
- no dashboard KPI cards,
- no unnecessary sidebar in MVP,
- no icon soup,
- no giant setup wizard.

### Next.js implementation style

- App Router.
- Server Components by default.
- Isolate interactive Studio controls into Client Components.
- Tailwind CSS, using the version already present in the project.
- `next/font` for fonts.
- Prefer Geist / Geist Mono or another restrained sans family.
- Use one icon family if icons are necessary.
- Prefer native CSS transitions; Motion is unnecessary for MVP unless already installed.
- Accessibility: labels, keyboard focus, adequate contrast, 44px-ish touch targets where relevant.

### Proposed visual system

```text
Background: warm off-white / neutral
Text: near-black
Secondary text: muted neutral
Accent: muted forge-orange / amber OR project accent
Borders: subtle warm gray
Radius: medium, not excessive pill UI
Shadow: very restrained
```

The large preview canvas should provide the main visual character of the interface; the rest of the UI should stay quiet.

---

## 11. Technical architecture

Suggested structure:

```text
src/
├── app/
│   ├── page.tsx
│   ├── studio/
│   │   └── page.tsx
│   └── api/
│       ├── settings/
│       │   └── openai/route.ts
│       ├── providers/
│       │   └── openai/
│       │       └── models/route.ts
│       ├── assets/
│       │   ├── create/route.ts
│       │   ├── process/route.ts
│       │   └── export/route.ts
│       └── projects/
│           └── route.ts
│
├── components/
│   └── studio/
│       ├── studio-workspace.tsx
│       ├── asset-kind-switcher.tsx
│       ├── asset-input.tsx
│       ├── asset-preview.tsx
│       ├── result-actions.tsx
│       └── settings-panel.tsx
│
├── core/
│   ├── assets/
│   │   ├── types.ts
│   │   ├── pipeline.ts
│   │   └── manifest.ts
│   ├── providers/
│   │   ├── types.ts
│   │   ├── manual-provider.ts
│   │   └── openai-provider.ts
│   ├── adapters/
│   │   ├── types.ts
│   │   ├── generic-sprite.ts
│   │   ├── generic-spritesheet.ts
│   │   └── nro-legacy.ts
│   └── image/
│       ├── normalize.ts
│       ├── background.ts
│       ├── palette.ts
│       └── atlas.ts
│
├── lib/
│   ├── openai/
│   │   ├── client.ts
│   │   └── model-catalog.ts
│   ├── storage/
│   │   ├── settings.ts
│   │   ├── secrets.ts
│   │   └── projects.ts
│   └── fs/
│       └── safe-path.ts
│
└── styles/
```

---

## 12. Storage and database decision

### MVP decision: do not use a database

A relational database adds operational complexity without solving an important MVP problem.

Data volume is small and naturally file-oriented:

- settings,
- API provider configuration,
- project profiles,
- source images,
- processed images,
- manifests,
- exports.

Suggested layout:

```text
~/.contentforge/
├── settings.json
├── secrets.json
├── cache/
└── logs/
```

Per game project:

```text
<game-root>/.contentforge/
├── project.json
└── references/
```

Generated output:

```text
<game-root>/generated-assets/
```

### When PostgreSQL becomes justified

Introduce PostgreSQL only when one or more become true:

- multi-user web app,
- authentication,
- cloud asset library,
- asset search/tagging across thousands of assets,
- versions/history,
- generation jobs shared across machines,
- team collaboration,
- permissions,
- billing/usage.

If that stage arrives, PostgreSQL is the preferred database.

---

## 13. Suggested internal manifest

Keep ContentForge's own representation generic.

```json
{
  "version": 1,
  "id": "ice-warrior",
  "kind": "character",
  "project": "my-game",
  "source": {
    "provider": "openai",
    "model": "gpt-image-2"
  },
  "visual": {
    "width": 64,
    "height": 64,
    "format": "png"
  },
  "adapter": {
    "id": "nro-legacy-v1"
  },
  "files": []
}
```

Adapters can extend this through adapter-owned metadata.

Do not pollute the generic schema with game-specific fields.

---

## 14. Current-game character strategy

For the first real adapter, do not generate one pretty full-body image and then expect perfect arbitrary segmentation.

Prefer an **adapter-driven generation recipe**.

For example, if the target character format needs separate head/body/leg parts, the adapter asks the AI to create those parts in a predictable composition or fixed cell layout.

Conceptually:

```text
AI generation recipe
        ↓
┌─────────┬─────────┬─────────┐
│  HEAD   │  BODY   │  LEGS   │
└─────────┴─────────┴─────────┘
        ↓
Deterministic crop
        ↓
Downscale / pixel normalize
        ↓
Offsets / metadata
        ↓
Game adapter export
```

This changes an unreliable computer-vision segmentation problem into a controlled generation + deterministic crop problem.

The exact layout belongs to the NRO adapter, not the core product.

Animation frames should be a follow-up milestone after a static character can be exported and rendered reliably.

---

## 15. API routes

### `PUT /api/settings/openai`

Input:

```json
{
  "apiKey": "...",
  "model": "auto"
}
```

Behavior:

1. Validate key by listing models.
2. Save secret server-side.
3. Resolve selected/default model.
4. Return masked configuration.

### `GET /api/providers/openai/models`

Returns friendly compatible models:

```json
{
  "models": [
    {
      "id": "auto",
      "label": "Auto",
      "description": "Recommended",
      "recommended": true
    },
    {
      "id": "gpt-image-2",
      "label": "GPT Image 2",
      "description": "Best image generation"
    }
  ]
}
```

### `POST /api/assets/create`

Input:

- project ID,
- asset kind,
- prompt,
- optional references,
- provider.

Returns:

- generation ID,
- preview representation,
- validation summary,
- export readiness.

MVP can execute synchronously. Do not add queue infrastructure yet.

### `POST /api/assets/export`

Input:

- generation ID,
- destination/project.

Returns paths to written output files.

---

## 16. Failure handling

Handle at least:

- missing API key,
- invalid API key,
- inaccessible model,
- organization verification requirement,
- moderation block,
- rate limit,
- unsupported image type,
- file too large,
- corrupt image,
- unwritable output folder,
- adapter validation failure,
- no-AI mode with prompt only.

Automatic retries should be conservative. One retry for transient errors is enough for MVP. Do not create invisible repeated API spend.

---

## 17. Performance and cost behavior

Default to a balanced quality preset rather than maximum quality.

The UI should expose a simple quality concept only if needed later:

```text
Draft
Standard
Final
```

Do not expose raw image-generation parameters in the main flow.

For MVP, use one output candidate per click. Do not generate four variants automatically because that multiplies cost.

The user can click **Try another** when they want another candidate.

Cache intermediate files locally for the current session/project to avoid accidental repeat processing.

---

## 18. Development rules

The implementation agent should follow these constraints.

### Testing

Do not create a large test suite.

Only add tests when they protect a high-risk deterministic component such as:

- atlas packing,
- manifest serialization,
- adapter validation.

The developer will perform manual product testing.

### Lint/build workflow

Do not run lint/test/build after every small edit.

Recommended workflow:

```text
Implement coherent feature block
        ↓
Run lint
        ↓
Fix syntax/type/lint issues
        ↓
Continue
```

At the end of the MVP:

1. Run lint.
2. Fix all blocking lint/type issues.
3. Run build once if practical/necessary.
4. If a dev server was launched for visual verification, terminate it explicitly.
5. Verify the temporary port is no longer listening.
6. Remove temporary preview/build-cache artifacts that are not meant to remain.

Do not leave background dev servers running.

### Dependency discipline

Before importing any dependency, inspect the existing `package.json`.

Do not install packages that duplicate existing capabilities.

Prefer:

- built-in Next.js features,
- native browser APIs,
- Tailwind,
- `sharp` for server image processing,
- official `openai` JavaScript SDK.

Avoid adding a state library unless the Studio becomes difficult to manage with local state / reducer / context.

---

## 19. MVP implementation order

### Phase 1 — Shell and UX

Build the single Studio surface:

- project selector,
- asset kind switcher,
- prompt/image input,
- preview,
- result actions,
- settings panel.

Use mock pipeline output initially so the UX is visible immediately.

### Phase 2 — Local/no-AI pipeline

Implement:

```text
Upload PNG/JPEG/WebP
→ normalize
→ resize/trim
→ preview
→ generic export
```

This proves the full pipeline without API dependency.

### Phase 3 — OpenAI integration

Implement:

- API key storage,
- model discovery,
- friendly model catalog,
- image generation,
- image editing,
- result persistence.

### Phase 4 — Adapter layer

Add:

- generic sprite adapter,
- current-game NRO character adapter.

MVP success for the current project is achieved when one newly created character asset can be exported and consumed by the game without hand-editing the generated files.

### Phase 5 — Polish

Only after the pipeline works:

- empty states,
- loading states,
- concise error messages,
- responsive layout,
- keyboard/focus polish,
- final lint,
- one final build if needed.

---

## 20. Acceptance criteria

The MVP is complete when all of the following are true.

### First run

- User opens ContentForge with no login.
- User can enter OpenAI Settings.
- User can paste an API key.
- Key is validated and stored only server-side locally.
- Model dropdown defaults to Auto.
- Available compatible models are derived from the API-key-visible model list plus the local capability catalog.

### AI creation

- User selects Character.
- User enters a short idea.
- User presses one Create asset button.
- ContentForge generates one result through OpenAI.
- Result passes through normalization and adapter logic.
- User sees the adapter preview.
- User can export a game-ready package.

### Image/reference creation

- User can upload an image with or without a text instruction.
- OpenAI mode can adapt/edit it.
- No-AI mode can process it deterministically.

### No-AI

- User can disable/use no-AI mode.
- Source image can be normalized and exported without an API key.
- Prompt-only creation clearly explains that a source image is required.

### Export

- Exported assets contain a manifest and correctly named image files.
- The target adapter performs validation before marking output Ready.
- The current-game adapter has a path to produce the current game's required sprite data without manual image editing.

### UX

- Common flow does not expose technical image parameters.
- Advanced settings are optional.
- No generic dashboard/card-spam layout.
- One clear primary action per state.

---

## 21. Post-MVP roadmap

### V1.1 — Better automatic cleanup

- local background-removal provider,
- segmentation plugin,
- palette extraction from game references,
- stronger auto-crop.

### V1.2 — Iterative AI edits

Introduce Responses API workflow:

```text
Generate
↓
"Make the helmet smaller"
↓
Edit same asset
↓
Keep project constraints
```

### V1.3 — Animation

- idle frames,
- walk frames,
- attack frames,
- adapter-specific frame recipes,
- preview playback.

### V1.4 — Map Forge

- environment concept generation,
- background/layer generation,
- tile extraction,
- decoration objects,
- collision/helper metadata where adapters support it.

### V1.5 — Local AI provider

- ComfyUI provider interface,
- local model discovery,
- workflows per asset adapter.

### V2 — Asset library

Only at this stage reconsider PostgreSQL if the product needs searchable/versioned persistent asset history.

---

## 22. Final architecture target

```text
                         ContentForge
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 Studio             Settings
                    │                   │
                    └─────────┬─────────┘
                              │
                         Asset Pipeline
                              │
             ┌────────────────┼────────────────┐
             │                │                │
       OpenAI Provider   Manual Provider   Future Local AI
             │                │                │
             └────────────────┼────────────────┘
                              │
                       Image Normalizer
                              │
                       Project Adapter
                              │
               ┌──────────────┼──────────────┐
               │              │              │
          Generic Sprite  Sprite Sheet   Game-specific
                                           Adapter
                              │
                           Preview
                              │
                           Validate
                              │
                            Export
                              │
                            Game
```

The most important architectural boundary is:

> **AI creates visual material. ContentForge code creates game assets.**

That boundary keeps the product stable when models change and makes no-AI mode possible.
