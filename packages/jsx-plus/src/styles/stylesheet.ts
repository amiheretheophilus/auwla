import type { SourceStylesheetRecipe } from '@memoized-dom/compiler-next';
import type { StyleBlock } from './blocks';
import { styleChunks, styleDependencies } from './uses';
import { lowerConditions } from './conditions/lower';
import { scopeSelectors } from './scopes/selectors';
import { rebaseStyleUrls } from './urls';
import { JsxPlusError } from '../diagnostics';

/** CSS syntax stays here; the compiler supplies source reading and resolution. */
export function stylesheetRecipe(
  source: string, filename: string, blocks: readonly StyleBlock[], attributes: ReadonlyMap<StyleBlock, string>,
): SourceStylesheetRecipe {
  return {
    dependencies: styleDependencies(source, filename, blocks),
    render(resolve) {
      const chunks = styleChunks(source, filename, blocks, (message, start, end) => {
        throw new JsxPlusError('CSS3001', message, filename, [start, end], source);
      }, { resolve });

      return blocks.filter((block) => block.id === undefined).map((block) => {
        return chunks.get(block)!.map((chunk) => {
          const report = (code: string, message: string, start: number, end: number): never => {
            throw new JsxPlusError(code, message, chunk.filename, [chunk.start + start, chunk.start + end], chunk.source);
          };
          const lowered = lowerConditions(chunk.text, (message, start, end) => report('CSS2001', message, start, end));
          if (block.global) {
            return rebaseStyleUrls(lowered, chunk.filename, filename);
          }
          const scoped = scopeSelectors(chunk.text, attributes.get(block)!, (message, start, end) =>
            report('CSS3002', message, start, end));
          const css = lowerConditions(scoped, () => {
            throw new Error('Selector scoping changed a previously validated CSS condition');
          });
          return rebaseStyleUrls(css, chunk.filename, filename);
        }).join('\n');
      }).join('\n');
    },
  };
}
