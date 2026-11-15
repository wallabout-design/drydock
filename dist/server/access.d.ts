import { type JWTVerifyGetKey } from 'jose';
export interface AccessEnv {
    /** e.g. "wallabout-design.cloudflareaccess.com" */
    ACCESS_TEAM_DOMAIN?: string;
    /** The Access application's audience tag. */
    ACCESS_AUD?: string;
    /** Who may edit: emails, separated by commas. May be empty when only admins edit. */
    EDITOR_EMAILS?: string;
    /** Who may also approve changes and see history: emails, separated by commas. Needed. */
    ADMIN_EMAILS?: string;
    /** Previews only: the email of a fixed test editor. Never set it in production. */
    PREVIEW_TEST_LOGIN?: string;
}
export type Role = 'editor' | 'admin';
export type Action = 'edit' | 'approve' | 'history';
export interface Identity {
    email: string;
    role: Role;
    /** True for the preview test editor, who must never write to real content. */
    test: boolean;
}
export declare const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
/** For tests: the keys the token is checked against, and the time it is checked at. */
export interface IdentifyOptions {
    keys?: JWTVerifyGetKey;
    now?: Date;
}
/** The signed-in person and their role, or null. */
export declare function identify(request: Request, env: AccessEnv, options?: IdentifyOptions): Promise<Identity | null>;
/** Whether this person may do this. An admin may do everything an editor may. */
export declare function can(identity: Identity | null, action: Action): boolean;
