import { setDefaultTimeout } from 'bun:test';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Compiler, bundle and browser integration tests also run on slower machines.
setDefaultTimeout(30_000);

// Windows can give the temp folder by its short name (`C:\Users\THEOPH~1\…`). Vite resolves every
// root and id to its real name, so a build never mixes spellings; but many tests hand paths under
// the temp folder straight to the plugin's internal functions, which compare paths as text.
// Temp folders get their real name, as Vite would give them. (An entry a user gives by a short name
// is spelled out by the plugin itself: `packages/vite/src/paths.ts`, `longPath`.)
const temporary = realpathSync.native(tmpdir());
process.env.TEMP = temporary;
process.env.TMP = temporary;
process.env.TMPDIR = temporary;
