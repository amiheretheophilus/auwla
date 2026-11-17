import { imageOf } from './canvas/paint';
import { download, openProject, readAutosave, writeAutosave } from './model/files';
import type { Page, Project } from './model/types';

interface WorkspaceFiles {
  project(): Project;
  page(): Page;
  replace(project: Project, persist: boolean): void;
}

export function createProjectFiles(workspace: WorkspaceFiles, say: (message: string) => void) {
  let revision = 0;

  function save(): void {
    const edit = ++revision;

    // A completion from an older edit must not replace the current status.
    function report(message: string): void {
      if (revision === edit) {
        say(message);
      }
    }

    void writeAutosave(workspace.project()).then(
      () => report('Saved on this device'),
      () => report('Autosave unavailable. Export to keep a copy.'),
    );
  }

  function restore(isConnected: () => boolean): void {
    const before = revision;
    void readAutosave().then(
      (saved) => {
        if (isConnected() && revision === before && saved !== undefined) {
          workspace.replace(saved, false);
          say('Saved on this device');
        }
      },
      () => {
        if (isConnected() && revision === before) {
          say('Autosave could not be loaded');
        }
      },
    );
  }

  function importFile(file: File): void {
    const before = revision;
    void openProject(file).then(
      (value) => {
        // Reading a file is asynchronous. Respect any edit made while it was opening.
        if (revision !== before) {
          say('Board changed during import. Open the file again.');
          return;
        }

        workspace.replace(value, true);
      },
      () => say('Could not open that Draftroom project'),
    );
  }

  function exportProject(): void {
    const contents = JSON.stringify(workspace.project(), null, 2);
    const blob = new Blob([contents], { type: 'application/json' });
    download(blob, 'draftroom.draft.json');
    say('Project exported');
  }

  function exportPng(): void {
    const page = workspace.page();
    const canvas = imageOf(page.shapes);
    if (canvas === undefined) {
      say('Add a visible shape before exporting');
      return;
    }

    const slug = page.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${slug || 'draftroom'}.png`;

    canvas.toBlob((blob) => {
      if (blob === null) {
        say('Could not export the PNG');
        return;
      }

      download(blob, filename);
      say('PNG exported');
    }, 'image/png');
  }

  return { save, restore, importFile, exportProject, exportPng };
}
