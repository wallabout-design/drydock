// React helpers. Wrap the tree in <ContentProvider reader={...}> (the site
// builds the reader per request), then use <Text k="..." /> and <List />.
import { createContext, createElement, useContext } from 'react';
import { itemAttrs, listAttrs, textAttrs } from '../core/read.js';
const ReaderContext = createContext(null);
export function ContentProvider(props) {
    return createElement(ReaderContext.Provider, { value: props.reader }, props.children);
}
function useReader() {
    const reader = useContext(ReaderContext);
    if (!reader)
        throw new Error('Wrap the page in <ContentProvider reader={...}> to read content');
    return reader;
}
/** The text for `k`, in an element marked `data-copy`. An unknown key is a type error. */
export function Text(props) {
    const reader = useReader();
    return createElement(props.as ?? 'span', { ...textAttrs(props.k), className: props.className }, reader.text(props.k));
}
/**
 * A list: the container carries `data-list`, each item `data-item`. `children`
 * draws one item; it should return the item's own element content, which is
 * wrapped in `itemAs` (default `li`).
 */
export function List(props) {
    const reader = useReader();
    const items = reader.list(props.name);
    return createElement(props.as ?? 'ul', { ...listAttrs(props.name), className: props.className }, items.map((item, i) => createElement(props.itemAs ?? 'li', { key: item.id, ...itemAttrs(item) }, props.children(item, i))));
}
