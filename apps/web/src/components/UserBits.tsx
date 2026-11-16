import type { PublicUser } from '@igo/shared';
import { Link } from 'react-router-dom';
import { BotBadge } from './BotBadge';

type Who = Pick<PublicUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

/** A colour that stays the same for a person: the default picture's background. */
function hueOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** The profile picture, or a coloured circle with the first letter of the nickname. */
export function Avatar({ u, size = 36 }: { u: Who; size?: number }) {
  if (u.avatarUrl) {
    const src = size <= 64 ? u.avatarUrl.replace(/-256\.webp$/, '-64.webp') : u.avatarUrl;
    return <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  const hue = hueOf(u.id);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 75%)`, color: `hsl(${hue} 50% 22%)` }}
    >
      {[...(u.displayName || u.username)][0]?.toUpperCase()}
    </span>
  );
}

/** "Nickname (@username)": the nickname first, the login id to tell apart people with the same nickname. */
export function UserName({ u, link = false, rank = true }: { u: PublicUser; link?: boolean; rank?: boolean }) {
  const name = (
    <>
      <span className="display-name">{u.displayName}</span>
      {u.displayName !== u.username && <span className="handle"> @{u.username}</span>}
    </>
  );
  return (
    <span className="user-name">
      {link ? <Link to={`/u/${u.username}`}>{name}</Link> : name}
      {rank && <span className="rank"> {u.rank}</span>}
      <BotBadge user={u} />
    </span>
  );
}

export const LevelBadge = ({ level }: { level: number }) => <span className="level">Lv{level}</span>;
