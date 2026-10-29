import type { PublicUser } from '@igo/shared';

export const BotBadge = ({ user }: { user: PublicUser }) => (user.bot ? <span className="badge ai">AI</span> : null);
