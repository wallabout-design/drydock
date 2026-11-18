/** The localStorage key the edit view sets to "1". */
export declare const STAFF_HINT_KEY = "drydock-staff";
export interface StaffStatus {
    email: string;
    role: 'editor' | 'admin';
    /** Changes waiting for approval: counted for admins, 0 for editors. */
    waiting: number;
}
export interface StaffOptions {
    /** For tests. Defaults to the page's fetch. */
    fetch?: typeof fetch;
    /** For tests. Defaults to the page's localStorage. */
    storage?: Pick<Storage, 'getItem'>;
}
/** Who is signed in to this site, or null: no hint, signed out, or anything that goes wrong. Never throws. */
export declare function staffStatus(options?: StaffOptions): Promise<StaffStatus | null>;
