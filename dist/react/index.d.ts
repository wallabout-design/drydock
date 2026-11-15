import { type ElementType, type ReactNode } from 'react';
import { type ListItem, type ListName, type Reader, type TextKey } from '../core/read.js';
export declare function ContentProvider(props: {
    reader: Reader;
    children?: ReactNode;
}): import("react").FunctionComponentElement<import("react").ProviderProps<Reader<import("../index.js").ContentDeclaration> | null>>;
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
