import type {} from '@memoized-dom/compiler/jsx';

export const EditorComponent = ({ label }: { label: string }) => (
  <button onClick={(event) => [label, event.currentTarget.disabled]}>{label}</button>
);

const node: Node = <EditorComponent label="typed" />;
// @ts-expect-error Component props stay checked in editor programs.
const wrongProp = <EditorComponent label={1} />;
// @ts-expect-error Arbitrary objects are not renderable children.
const wrongChild = <div>{{ arbitrary: true }}</div>;

export const editorAssertions = [node, wrongProp, wrongChild];
