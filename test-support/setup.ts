import { setDefaultTimeout } from 'bun:test';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Compiler, bundle and browser integration tests also run on slower machines.
setDefaultTimeout(30_000);

// Windows can give the temp folder by its short name (`C:\Users\THEOPH~1\…`). Vite 8.2 compares
// a root given that way with the real path of each file it loads, and refuses to load the files of
// a test app copied there ("Does the file exist?"). Temp folders get the real name instead.
const temporary = realpathSync.native(tmpdir());
process.env.TEMP = temporary;
process.env.TMP = temporary;
process.env.TMPDIR = temporary;
