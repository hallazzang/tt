import type { User } from './types.js';

const ME: User = { name: 'me', linear: { isMe: { eq: true } }, github: '@me' };

// TT_USERS lists Linear display names. GitHub logins come from the GitHub account each user
// linked in Linear. Without TT_USERS, tt shows only you. Call after .env is loaded.
export async function loadUsers(): Promise<User[]> {
  const names = (process.env.TT_USERS ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  if (!names.length) return [ME];

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: process.env.LINEAR_API_KEY ?? '' },
    body: JSON.stringify({
      query: 'query($n: [String!]!) { users(filter: { displayName: { in: $n } }) { nodes { id name displayName gitHubUserId } } }',
      variables: { n: names },
    }),
  });
  const body = await res.json();
  if (body.errors || !body.data) throw new Error(`Linear: ${body.errors?.[0]?.message ?? res.statusText}`);
  const found: { id: string; name: string; displayName: string; gitHubUserId: string | null }[] = body.data.users.nodes;

  return Promise.all(
    names.map(async (n) => {
      const u = found.find((f) => f.displayName === n);
      if (!u) throw new Error(`TT_USERS: no Linear user with display name "${n}"`);
      return { name: u.name, linear: { id: { eq: u.id } }, github: u.gitHubUserId ? await githubLogin(u.gitHubUserId) : undefined };
    }),
  );
}

async function githubLogin(id: string): Promise<string> {
  const res = await fetch(`https://api.github.com/user/${id}`, {
    headers: { authorization: `token ${process.env.GITHUB_TOKEN ?? ''}` },
  });
  if (!res.ok) throw new Error(`GitHub: user ${id}: ${res.statusText}`);
  return (await res.json()).login;
}
