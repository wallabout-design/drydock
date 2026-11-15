const PASSED = [{ name: 'test', status: 'completed', conclusion: 'success' }];
export function fakeRepo(files, options = {}) {
    const base = options.base ?? 'main';
    const now = options.now ?? (() => new Date('2026-11-10T15:00:00Z'));
    let checks = options.checks ?? (() => PASSED);
    const commits = new Map();
    const branches = new Map();
    const all = [];
    const calls = [];
    const add = (commit) => {
        const sha = `c${commits.size + 1}`;
        commits.set(sha, { ...commit, date: now().toISOString() });
        return sha;
    };
    const apply = (from, changes) => {
        const out = { ...from };
        for (const [path, text] of Object.entries(changes)) {
            if (text === null)
                delete out[path];
            else
                out[path] = text;
        }
        return out;
    };
    const push = (branch, changed, message = 'change') => {
        const parent = branches.get(branch) ?? null;
        const sha = add({ parent, files: apply(parent ? commits.get(parent).files : {}, changed), message });
        branches.set(branch, sha);
        return sha;
    };
    push(base, files, 'first');
    const view = (p) => ({ number: p.number, url: p.url, branch: p.branch, head: p.head, labels: [...p.labels], state: p.state, createdAt: p.createdAt });
    function merge(number, sha) {
        const pull = all.find((p) => p.number === number);
        if (!pull || pull.state !== 'open')
            return { ok: false, message: 'not open' };
        if (pull.head !== sha)
            return { ok: false, message: 'moved' };
        const head = commits.get(pull.head);
        const was = (head.parent ? commits.get(head.parent).files : {});
        const main = commits.get(branches.get(base)).files;
        const result = {};
        for (const path of new Set([...Object.keys(was), ...Object.keys(main), ...Object.keys(head.files)])) {
            const [b, m, h] = [was[path], main[path], head.files[path]];
            if (h === b)
                continue; // the branch left it alone: main's stays
            if (m === b || m === h)
                result[path] = h ?? null;
            else
                return { ok: false, message: `conflict in ${path}` };
        }
        push(base, result, `merge #${number}`);
        pull.state = 'merged';
        branches.delete(pull.branch);
        return { ok: true };
    }
    const settle = (number) => {
        if (!options.autoMerge)
            return;
        const pull = all.find((p) => p.number === number);
        if (pull && pull.state === 'open' && !pull.labels.includes(options.autoMerge.skipLabel))
            merge(number, pull.head);
    };
    return {
        commits,
        branches,
        pulls_: all,
        calls,
        push,
        filesAt: (branch) => commits.get(branches.get(branch)).files,
        setChecks(next) {
            checks = next;
        },
        async tip(branch) {
            calls.push(`tip ${branch}`);
            return branches.get(branch) ?? null;
        },
        async commitFacts(sha) {
            calls.push(`facts ${sha}`);
            const commit = commits.get(sha);
            if (!commit)
                return null;
            const before = commit.parent ? commits.get(commit.parent).files : {};
            const names = new Set([...Object.keys(before), ...Object.keys(commit.files)]);
            return {
                parents: commit.parent ? [commit.parent] : [],
                files: [...names].filter((name) => before[name] !== commit.files[name]),
                date: commit.date,
                message: commit.message,
            };
        },
        async contains(branch, sha) {
            calls.push(`contains ${branch} ${sha}`);
            for (let at = branches.get(branch) ?? null; at; at = commits.get(at).parent)
                if (at === sha)
                    return true;
            return false;
        },
        async files(commit, prefix) {
            calls.push(`files ${commit}`);
            return Object.keys(commits.get(commit)?.files ?? {}).filter((path) => path.startsWith(prefix));
        },
        async read(path, commit) {
            calls.push(`read ${path} ${commit}`);
            return commits.get(commit)?.files[path] ?? null;
        },
        async commit({ branch, expected, parent, files: changes, message }) {
            calls.push(`commit ${branch}`);
            // As on GitHub: the branch moves only from the tip the caller read.
            if ((branches.get(branch) ?? null) !== expected)
                return null;
            const sha = add({ parent, files: apply(commits.get(parent).files, changes), message });
            branches.set(branch, sha);
            for (const pull of all)
                if (pull.state === 'open' && pull.branch === branch)
                    pull.head = sha;
            return sha;
        },
        async pulls(into, state) {
            calls.push(`pulls ${into} ${state}`);
            return all
                .filter((p) => p.base === into && (state === 'all' || p.state === 'open'))
                .sort((a, b) => b.number - a.number)
                .map(view);
        },
        async pull(number) {
            calls.push(`pull ${number}`);
            const found = all.find((p) => p.number === number);
            return found ? view(found) : null;
        },
        async createPull({ branch, base: into, title, body, labels }) {
            calls.push(`createPull ${branch}`);
            // GitHub allows one open pull request per branch and base.
            if (all.some((p) => p.state === 'open' && p.branch === branch && p.base === into))
                return null;
            const number = all.length + 1;
            const url = `https://github.test/pull/${number}`;
            all.push({ number, url, branch, head: branches.get(branch), labels: [...labels], state: 'open', createdAt: now().toISOString(), base: into, title, body });
            const created = view(all[all.length - 1]);
            settle(number);
            return created;
        },
        async updatePull(number, { title, body }) {
            calls.push(`updatePull ${number}`);
            const pull = all.find((p) => p.number === number);
            if (pull?.state !== 'open')
                return false;
            Object.assign(pull, { title, body });
            settle(number);
            return true;
        },
        async closePull(number) {
            calls.push(`closePull ${number}`);
            const pull = all.find((p) => p.number === number);
            if (pull?.state === 'open')
                pull.state = 'closed';
        },
        async addLabel(number, name) {
            calls.push(`addLabel ${number} ${name}`);
            const pull = all.find((p) => p.number === number);
            if (pull && !pull.labels.includes(name))
                pull.labels.push(name);
        },
        async removeLabel(number, name) {
            calls.push(`removeLabel ${number} ${name}`);
            const pull = all.find((p) => p.number === number);
            if (pull)
                pull.labels = pull.labels.filter((l) => l !== name);
        },
        async checks(commit) {
            calls.push(`checks ${commit}`);
            return checks(commit);
        },
        async merge(number, sha) {
            calls.push(`merge ${number}`);
            return merge(number, sha);
        },
    };
}
