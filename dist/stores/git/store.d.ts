import type { Content } from '../../core/declare.js';
import type { Store } from '../../core/store.js';
import type { Repo } from './repo.js';
import { type GitStoreConfig } from './save.js';
export interface GitStoreOptions {
    repo: Repo;
    content: Content;
    config: Partial<GitStoreConfig> & Pick<GitStoreConfig, 'site'>;
    /** The store's clock. */
    now?: () => Date;
}
export declare function gitStore(options: GitStoreOptions): Store;
