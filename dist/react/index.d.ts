import { type ElementType, type ReactNode } from 'react';
import type { ImageField, ImageValue } from '../core/types.js';
import { type ListItem, type ListName, type Reader, type TextKey } from '../core/read.js';
export { DARK_MEDIA, fullSrc } from '../core/image.js';
export declare function ContentProvider(props: {
    reader: Reader;
    children?: ReactNode;
}): import("react").FunctionComponentElement<import("react").ProviderProps<Reader<import("../core/types.js").ContentDeclaration> | null>>;
/** The text for `k`, in an element marked `data-copy`. An unknown key is a type error. */
export declare function Text(props: {
    k: TextKey;
    as?: ElementType;
    className?: string;
}): import("react").ReactElement<any, string | import("react").JSXElementConstructor<any>>;
/**
 * A list: the container carries `data-list`, each item `data-item`. `children`
 * draws one item; it should return the item's own element content, which is
 * wrapped in `itemAs` (default `li`).
 */
export declare function List(props: {
    name: ListName;
    as?: ElementType;
    itemAs?: ElementType;
    className?: string;
    children: (item: ListItem, index: number) => ReactNode;
}): import("react").ReactElement<any, string | import("react").JSXElementConstructor<any>>;
/**
 * An image field's picture: an uploaded image gets srcset and sizes, an AVIF
 * source where the size has one, and with `dark` the page shows that image in
 * dark mode through the same <picture>. The attributes come from imageMarkup,
 * the same as the Astro component.
 */
export declare function Image(props: {
    field: ImageField;
    value: ImageValue;
    dark?: ImageValue;
    prefix?: string;
    loading?: 'lazy' | 'eager';
    className?: string;
}): import("react").DetailedReactHTMLElement<import("react").HTMLAttributes<HTMLElement>, HTMLElement> | import("react").DetailedReactHTMLElement<{
    src: string;
    srcSet: string | undefined;
    sizes: string | undefined;
    width: number | undefined;
    height: number | undefined;
    alt: string;
    loading: "eager" | "lazy" | undefined;
    className: string | undefined;
}, HTMLElement>;
