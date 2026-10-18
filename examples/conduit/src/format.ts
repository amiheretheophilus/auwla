import { format, formatDistanceToNow } from 'date-fns';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const longDate = (iso: string) => format(new Date(iso), 'MMMM d, yyyy');
export const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

/** Markdown to safe HTML. Browser only: DOMPurify needs a DOM. */
export const renderMarkdown = (source: string) => DOMPurify.sanitize(marked.parse(source, { async: false }) as string);
