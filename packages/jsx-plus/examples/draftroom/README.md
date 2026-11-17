# Draftroom

Draftroom is a browser-local drawing and diagramming SPA written with Auwla. It opens on an editable product workflow and includes a second page for brainstorming.

## Run the example

From `packages/jsx-plus`:

```sh
bun run examples/draftroom/preview.ts
```

Open <http://127.0.0.1:3065/>. The shared preview rebuilds the app on save. Set `AUWLA_EXAMPLE_PORT` to use a different port. Append `--build` to compile without starting the preview.

To type-check the `.auwla` files through the workspace's TypeScript content mapper:

```sh
bun run ../../node_modules/typescript/lib/tsc.js --project examples/draftroom/tsconfig.json --runExternalCode --pretty false
```

## Use the workspace

- Choose a tool to draw a rectangle, ellipse, diamond, arrow, freehand stroke, text box, or sticky note. Drag with Select to move an object and use its corner handle to resize a box. Use the inspector to edit text, color, line style, width, and opacity.
- Use Layers to select overlapping objects, including hidden ones. The inspector can hide, lock, reorder, duplicate, or delete the selection.
- Use Pages to switch boards, start a blank board, or add a template. Rename the current page in Board settings. Undo and redo apply to edits across the project.
- Hold `Space` and drag to pan. `Ctrl` or `⌘` plus the wheel zooms around the pointer. The zoom controls can fit the drawing, and clicking the minimap recenters the viewport.
- **Export** saves the current page as PNG or all pages as a JSON project. **Open** loads that project format. The current workspace autosaves in this browser's local storage. Undo history and camera position are session state.

The example works in one browser and supports one selected object at a time. It has no backend or shared editing session.

## Read the code

| Area | Responsibility |
| --- | --- |
| `App.auwla`, `ui/` | Compose the workspace and display editor snapshots. The canvas ref attaches input listeners and returns their cleanup. |
| `editor.ts`, `shortcuts.ts` | Connect UI commands to the document and viewport, and bind keyboard commands. |
| `project-files.ts` | Coordinate autosave, imports, and downloads with the current workspace. |
| `model/document.ts`, `model/history.ts` | Manage pages, object stacking, selection, and undo. Edits replace the affected page and share the unchanged objects between snapshots. |
| `model/types.ts`, `model/templates.ts`, `model/files.ts` | Define the project format, create sample pages, and validate imported projects and autosaves. |
| `canvas/gestures.ts`, `canvas/drafts.ts`, `canvas/geometry.ts` | Translate pointer input into world coordinates, calculate temporary drafts, and hit-test shapes. |
| `canvas/viewport.ts`, `canvas/paint.ts`, `canvas/shapes.ts` | Own the camera, schedule paints, and render the board, minimap, and exported image. |
| `canvas/draft-layers.ts` | Cache unchanged shapes during a drag, preserving the moving object's place in the layer order. |
| `styles/` | Keep workspace layout, controls, inspector, and canvas overlays in separate stylesheets. |

A drag updates a temporary canvas draft. Releasing the pointer commits one document edit, adds one undo step, and saves the resulting project. This keeps pointer moves out of both history and local storage.

The dotted grid is a repeating CSS background aligned with the camera. The minimap redraws when the committed shapes, camera, or viewport size changes. On the main board, the painter reuses the shapes below and above a moving object so only the object itself needs to be drawn again.
