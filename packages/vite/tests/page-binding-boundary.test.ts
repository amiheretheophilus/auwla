import { expect, it } from 'bun:test';
import { analyzeServerFunctionModule, compileModulesDetailed, generateServerFunctionClient } from '@memoized-dom/compiler';
import { pageBindingsBoundary } from '../src/server-pages';

const facade = generateServerFunctionClient(analyzeServerFunctionModule(`
 import {define,page} from '../define';
 export const getBoard=define.function({live:()=>['board'],async get(){return page(<p>Board</p>);}});
 export const rename=define.function({async post(_context,title:string){return page(<p>{title}</p>);}});
`, { moduleId: './server/functions/boards.tsx' }));
const app = `import {getBoard,rename} from './boards';
 export function App(){let board=getBoard();const form=$forms((fields:FormData)=>{const result=rename(String(fields.get('title')));board=result;return result;});
 return <main>{board}<form onSubmit={form.submit}><button disabled={form.pending}>Save</button></form></main>;}`;
const compile = (source = app, boundary = true, generated = facade) => compileModulesDetailed({ './app.tsx': source, './boards.ts': generated }, {
  experimentalPackageArtifacts: boundary ? [pageBindingsBoundary] : [],
});

it('describes generated binding loaders through the ordinary boundary contract without polling page consumers', () => {
  expect(compile(app, false).output['./app.tsx']).toContain('volatile: true');
  const result = compile();
  expect(result.output['./app.tsx']).not.toContain('volatile: true');
  expect(result.metadata['./boards.ts']!.functionExports.find(fn => fn.exported === 'getBoard')?.opaqueReads).not.toBe(true);
  expect(result.output['./boards.ts']).toContain('__mmd_pageBinding');
  expect(result.output['./app.tsx']).toContain('submit');
});
it('retains opaque polling for real external state, including state captured by a page-source factory', () => {
  expect(compile(app.replace('export function App()', "import {clock} from 'opaque-clock';export function App()").replace('<main>', '<main>{clock.value}')).output['./app.tsx']).toContain('volatile: true');
  const captured = "import {clock} from 'opaque-clock';\n" + facade.replace('return __mmd_page(', 'clock.value;return __mmd_page(');
  expect(compile(app, true, captured).output['./app.tsx']).toContain('volatile: true');
});
