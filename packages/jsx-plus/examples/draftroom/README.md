# Draftroom

Draftroom is an Auwla drawing and diagramming SPA. A fresh workspace opens an onboarding plan with the current flow, a proposal, and open questions. It also includes product workflow and brainstorm boards.

## Run the example

From `packages/jsx-plus`:

```sh
bun run examples/draftroom/preview.ts
```

Open <http://127.0.0.1:3065/>. The preview serves the editor, publishes individual frame snapshots, and rebuilds on save. Set `AUWLA_EXAMPLE_PORT` to use a different port. Append `--build` to compile without starting the preview.

To type-check the `.auwla` files through the workspace's TypeScript content mapper:

```sh
bun run ../../node_modules/typescript/lib/tsc.js --project examples/draftroom/tsconfig.json --runExternalCode --pretty false
```

## Use the workspace

- Open **Onboarding workflow**, or add **Onboarding walkthrough** from the templates menu. Move a step on the canvas and watch its arrows follow. Choose the Arrow tool and drag from inside one card to inside another to make a new attachment. An endpoint dropped on empty canvas stays free.
- Drag a selection rectangle on empty canvas to select the shapes it encloses, or hold `Shift` and click objects or layers. The inspector can group, ungroup, align, distribute, duplicate, and delete the selection. `Ctrl`/`⌘` + `G` groups, and `Ctrl`/`⌘` + `Shift` + `G` ungroups. Copy and paste work between Draftroom boards and tabs, preserving arrows whose endpoints are copied together.
- Draw a **Frame** around objects. Drag its title bar to move it and its contents, or select it and edit its name in the inspector. Click a frame in the outline to focus it. **Present** steps through the current board's frames, **PNG** exports the chosen frame, and **Share** creates a read-only link that opens on that exact frame.
- Choose a tool to draw a rectangle, ellipse, diamond, arrow, freehand stroke, text box, or sticky note. Click to place a default-size box or drag to set its size. Drag with Select to move an object and use its corner handle to resize a box.
- Double-click an object on the canvas to edit its text, or select it and press `Enter` with the canvas focused. New text boxes and sticky notes open their editor automatically. The canvas updates as you type here or in the inspector. Click away or press `Ctrl`/`⌘` + `Enter` in the canvas editor to save the text as one undo step. `Esc` cancels the canvas edit.
- Drag a row in Layers to a new position. The insertion line shows where it will land. On touch screens, drag the grip. With a row focused, use `Alt` + `↑` or `↓` to move it one position. The inspector also offers color, line style, opacity, hide, lock, duplicate, and delete controls.
- Use Pages to switch boards, start a blank board, or add a template. Rename the current page in Board settings. Undo and redo apply to edits across the project.
- Hold `Space` and drag to pan. You can press `Space` before or after the pointer goes down. If you were moving or drawing an object, the preview clears and the board pans from your current pointer position. `Ctrl` or `⌘` plus the wheel zooms around the pointer. The zoom controls can fit the drawing, and clicking the minimap recenters the viewport.
- **Export** saves the current page as PNG or all pages as a JSON project. **Open** loads that project format. The current workspace autosaves in this browser's local storage. Undo history and camera position are session state.

The editable workspace autosaves to the current browser origin. Sharing publishes a frozen image and text of the selected frame to the host. Anyone who can reach the host and has the link can open it. The local preview stores snapshots in the example's ignored `.memoized/shares/` directory across restarts. A hosted instance needs a public origin and writable persistent storage for share links.

## Read the code

| Area | Responsibility |
| --- | --- |
| `App.auwla`, `ui/` | Compose the workspace and display editor snapshots. The canvas ref attaches input listeners and returns their cleanup. |
| `editor.ts`, `shortcuts.ts` | Connect UI commands to the document and viewport, and bind keyboard commands. |
| `text-editing.ts`, `ui/InlineText.auwla` | Preview text as it changes and commit one document edit when the field closes. |
| `ui/Layers.auwla`, `ui/layer-drag.ts` | Render the layer stack and track a drop position without changing the drawing until release. |
| `project-files.ts` | Coordinate autosave, imports, and downloads with the current workspace. |
| `clipboard.ts`, `model/selection.ts` | Move and align groups and remap copied IDs while preserving group membership and connections. |
| `model/connections.ts`, `model/frames.ts` | Attach arrows at card boundaries and determine which objects belong to each frame. |
| `frame-actions.ts`, `ui/FrameOutline.auwla`, `ui/Presentation.auwla` | Focus, present, export, and publish one frame at a time. |
| `server.ts`, `server/` | Store and serve snapshots. Auwla renders the read-only HTML on the server. |
| `model/document.ts`, `model/history.ts` | Manage pages, object stacking, selection, and undo. Edits replace the affected page and share the unchanged objects between snapshots. |
| `model/types.ts`, `model/templates.ts`, `model/files.ts` | Define the project format, create sample pages, and validate imported projects and autosaves. |
| `canvas/gestures.ts`, `canvas/drafts.ts`, `canvas/geometry.ts` | Translate pointer input into world coordinates, calculate temporary drafts, and hit-test shapes. |
| `canvas/viewport.ts`, `canvas/surface.ts` | Own the camera, schedule paints, and size the canvases. |
| `canvas/board-painter.ts`, `canvas/dirty-region.ts` | Repaint only the part of the board affected by a drag or text preview, in the original layer order. |
| `canvas/shapes.ts`, `canvas/shape-text.ts`, `canvas/shape-bounds.ts` | Draw geometry and text, and calculate where each object can leave visible pixels. |
| `canvas/paint.ts` | Draw the minimap and export the board as an image. |
| `styles/` | Keep workspace layout, controls, inspector, and canvas overlays in separate stylesheets. |

A drag updates a temporary canvas draft. Releasing the pointer commits one document edit, adds one undo step, and saves the resulting project. This keeps pointer moves out of both history and local storage.

The dotted grid is a repeating CSS background aligned with the camera. The minimap redraws when the committed shapes, camera, or viewport size changes. During a preview, the board painter clears the rectangle containing the old and new positions and redraws the layers that intersect it. This keeps the surrounding pixels in the same canvas. Camera changes, resizing, and document commits redraw the whole board.

The onscreen board limits high-DPI oversampling to about 1.6 million backing pixels while keeping at least CSS resolution when the display supports it. The editor requests a frame only in response to a change in the board or viewport.
