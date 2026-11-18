// React helpers. Wrap the tree in <ContentProvider reader={...}> (the site
// builds the reader per request), then use <Text k="..." /> and <List />.
import { createContext, createElement, useContext, type ElementType, type ReactNode } from 'react';
import { imageMarkup, type ImageMarkupOptions } from '../core/image.js';
import type { ImageField, ImageValue } from '../core/types.js';
import { itemAttrs, listAttrs, textAttrs, type ListItem, type ListName, type Reader, type TextKey } from '../core/read.js';

export { DARK_MEDIA, fullSrc } from '../core/image.js';

const ReaderContext = createContext<Reader | null>(null);

export function ContentProvider(props: { reader: Reader; children?: ReactNode }) {
  return createElement(ReaderContext.Provider, { value: props.reader }, props.children);
}

function useReader(): Reader {
  const reader = useContext(ReaderContext);
  if (!reader) throw new Error('Wrap the page in <ContentProvider reader={...}> to read content');
  return reader;
}

/** The text for `k`, in an element marked `data-copy`. An unknown key is a type error. */
export function Text(props: { k: TextKey; as?: ElementType; className?: string }) {
  const reader = useReader();
  return createElement(props.as ?? 'span', { ...textAttrs(props.k), className: props.className }, reader.text(props.k));
}

/**
 * A list: the container carries `data-list`, each item `data-item`. `children`
 * draws one item; it should return the item's own element content, which is
 * wrapped in `itemAs` (default `li`).
 */
export function List(props: {
  name: ListName;
  as?: ElementType;
  itemAs?: ElementType;
  className?: string;
  children: (item: ListItem, index: number) => ReactNode;
}) {
  const reader = useReader();
  const items = reader.list(props.name);
  return createElement(
    props.as ?? 'ul',
    { ...listAttrs(props.name), className: props.className },
    items.map((item, i) => createElement(props.itemAs ?? 'li', { key: item.id, ...itemAttrs(item) }, props.children(item, i))),
  );
}

/**
 * An image field's picture: an uploaded image gets srcset and sizes, an AVIF
 * source where the size has one, and with `dark` the page shows that image in
 * dark mode through the same <picture>. The attributes come from imageMarkup,
 * the same as the Astro component.
 */
export function Image(props: {
  field: ImageField;
  value: ImageValue;
  dark?: ImageValue;
  prefix?: string;
  loading?: 'lazy' | 'eager';
  className?: string;
}) {
  const options: ImageMarkupOptions = { dark: props.dark, prefix: props.prefix };
  const markup = imageMarkup(props.field, props.value, options);
  const img = createElement('img', {
    src: markup.img.src,
    srcSet: markup.img.srcset,
    sizes: markup.img.sizes,
    width: markup.img.width,
    height: markup.img.height,
    alt: markup.img.alt,
    loading: props.loading,
    className: props.className,
  });
  if (markup.sources.length === 0) return img;
  const sources = markup.sources.map((source, i) =>
    createElement('source', { key: i, media: source.media, type: source.type, srcSet: source.srcset, sizes: source.sizes }),
  );
  return createElement('picture', null, ...sources, img);
}
