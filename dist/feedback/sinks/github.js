// githubIssuesSink: opens one GitHub issue per submitted note (standards drydock.md,
// "feedback delivery as plugins"). The routine already turns `feedback`-labelled
// issues into work, so this sink lands notes where it looks.
//
// The body carries the note, the page details and the quoted selection. It never
// carries the sender's address, because some site repositories are public.
//
// Imports nothing from the rest of the package: the auth comes in as an argument
// (the result of `resolveGitAuth`, which the site's Worker calls), and the types
// are written out here, so this file bundles with the feedback link and nothing else.
/** The page details and note as the issue body. Plain text, with no sender address. */
export function issueBody(note) {
    const quote = note.context.selection.trim();
    const lines = [
        note.note,
        '',
        ...(quote ? ['About this text:', ...quote.split(/\r?\n/).map((line) => `> ${line}`), ''] : []),
        '---',
        `url: ${note.context.url}`,
        `viewport: ${note.context.viewport} @${Math.round(note.context.dpr * 100) / 100}x`,
        `build: ${note.context.build}`,
    ];
    return lines.join('\n');
}
/** A sentence a reviewer understands, for a GitHub status. */
export function explainFailure(status) {
    if (status === 401 || status === 403)
        return 'GitHub would not accept the note, so the site’s GitHub access needs checking.';
    if (status === 404)
        return 'GitHub could not find the site’s repository, so the note was not sent.';
    if (status === 410)
        return 'Issues are turned off for the site’s repository, so the note was not sent.';
    if (status === 422)
        return 'GitHub would not open an issue for this note. Try again, or send it by email.';
    if (status === 429 || status >= 500)
        return 'GitHub is busy right now. Try again in a few minutes.';
    return 'The note could not be sent to GitHub. Try again, or send it by email.';
}
export function githubIssuesSink(options) {
    const { repo, auth, label = 'feedback', fetcher = fetch } = options;
    return {
        async send(note) {
            if (!auth.ok)
                return { ok: false, message: 'The note could not be sent: the site’s GitHub access is not set up.' };
            try {
                const response = await fetcher(`https://api.github.com/repos/${repo}/issues`, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${await auth.token()}`,
                        accept: 'application/vnd.github+json',
                        'x-github-api-version': '2022-11-28',
                        'content-type': 'application/json',
                        'user-agent': 'wallabout-editor',
                    },
                    body: JSON.stringify({ title: note.subject, body: issueBody(note), labels: [label] }),
                });
                if (!response.ok)
                    return { ok: false, message: explainFailure(response.status) };
                const json = (await response.json());
                if (typeof json.html_url !== 'string')
                    return { ok: false, message: 'GitHub opened the issue but did not say where, so the note was not confirmed.' };
                return { ok: true, ref: json.html_url };
            }
            catch {
                return { ok: false, message: 'The note could not be sent to GitHub. Check the connection and try again, or send it by email.' };
            }
        },
    };
}
