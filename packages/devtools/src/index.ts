/** Tooling protocol; applications never need to import the inspector. */
export { diagnostic, readDiagnostic } from './protocol';
export type { DiagnosticEvent, Metadata, Stamp } from './protocol';
export { InspectorStore } from './store';
