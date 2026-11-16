import type { PublicUser, SeekRequest } from '@igo/shared';
import { useState } from 'react';
import { errorText } from '../api';
import { call } from '../socket';
import { GameForm } from './GameForm';
import { Modal } from './Modal';

/** Choose conditions and offer a game to one person. */
export function ChallengeDialog({ to, onClose }: { to: PublicUser; onClose: () => void }) {
  const [error, setError] = useState('');
  const send = async (req: SeekRequest) => {
    setError('');
    const r = await call('challenge:create', to.id, req);
    if (r.ok) onClose();
    else setError(errorText(r.error));
  };
  return (
    <Modal title={`${to.username}さんに対局を申し込む`} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      <GameForm submitLabel="申し込む" onSubmit={send} onCancel={onClose} />
    </Modal>
  );
}
