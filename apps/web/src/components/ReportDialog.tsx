import { REPORT_REASONS, ReportReason, ReportTarget } from '@igo/shared';
import { FormEvent, useState } from 'react';
import { api, errorText } from '../api';
import { Modal } from './Modal';

const WHAT: Record<ReportTarget, string> = {
  user: 'この人',
  avatar: 'このプロフィール画像',
  lobbychat: 'このメッセージ',
  dm: 'このメッセージ',
};

/** Sends a report to the operators. */
export function ReportDialog({ type, id, onClose }: { type: ReportTarget; id: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>(type === 'avatar' ? 'inappropriate' : 'harassment');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.report({ targetType: type, targetId: id, reason, detail: detail.trim() || undefined });
      setDone(true);
    } catch (err) {
      setError(errorText((err as Error).message));
    }
  };

  return (
    <Modal title={`${WHAT[type]}を通報する`} onClose={onClose}>
      {done ? (
        <>
          <p>通報を受け付けました。運営が確認します。ありがとうございました。</p>
          <div className="buttons">
            <button onClick={onClose}>閉じる</button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={send}>
          {error && <p className="error">{error}</p>}
          <label>
            理由
            <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {Object.entries(REPORT_REASONS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            詳しい内容（任意）
            <textarea rows={3} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          <small>通報したことは相手に知らされません。</small>
          <div className="buttons">
            <button type="button" onClick={onClose}>
              やめる
            </button>
            <button className="danger">通報する</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
