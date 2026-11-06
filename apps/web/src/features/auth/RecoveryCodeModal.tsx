import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { downloadFile } from '@/services/export/exportService/filename';
import { useAuth } from './AuthProvider';

interface RecoveryCodeModalProps {
  onClose: () => void;
}

export function RecoveryCodeModal({ onClose }: RecoveryCodeModalProps) {
  const { t, i18n } = useTranslation(['auth', 'errors']);
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const status = trpc.auth.recoveryCodeStatus.useQuery();
  const generate = trpc.auth.generateRecoveryCode.useMutation({
    onSuccess: () => utils.auth.recoveryCodeStatus.invalidate(),
  });
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<{ currentPassword: string }>({ defaultValues: { currentPassword: '' } });

  const submit = form.handleSubmit(async ({ currentPassword }) => {
    const result = await generate.mutateAsync({ currentPassword }).catch(() => null);
    if (!result) return;
    form.reset();
    setCode(result.code);
  });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    if (!code) return;
    const lines = [
      t('recoveryCode.fileHeading'),
      '',
      code,
      '',
      user?.email ?? '',
      new Date().toLocaleDateString(i18n.language),
    ];
    downloadFile(
      new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }),
      'puntovivo-recovery-code.txt'
    );
  };

  const configuredAt = status.data?.createdAt
    ? new Date(status.data.createdAt).toLocaleDateString(i18n.language)
    : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('recoveryCode.title')}
      closeOnBackdrop={code === null}
      footer={
        code ? (
          <>
            <ModalButton onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t('recoveryCode.copied') : t('recoveryCode.copy')}
            </ModalButton>
            <ModalButton onClick={download}>
              <Download className="h-4 w-4" />
              {t('recoveryCode.download')}
            </ModalButton>
            <ModalButton variant="primary" onClick={onClose}>
              {t('recoveryCode.done')}
            </ModalButton>
          </>
        ) : (
          <>
            <ModalButton onClick={onClose} disabled={generate.isPending}>
              {t('recoveryCode.cancel')}
            </ModalButton>
            <ModalButton variant="primary" onClick={submit} pending={generate.isPending}>
              {generate.isPending ? t('recoveryCode.generating') : t('recoveryCode.generate')}
            </ModalButton>
          </>
        )
      }
    >
      {code ? (
        <div className="space-y-4">
          <p className="text-sm text-fg2">{t('recoveryCode.saveIt')}</p>
          <p
            data-testid="recovery-code-value"
            className="card-inset select-all px-4 py-4 text-center font-mono text-xl tracking-[0.18em] text-secondary-950"
          >
            {code}
          </p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-fg2">{t('recoveryCode.description')}</p>
          {configuredAt && (
            <p className="text-sm text-fg2">
              {t('recoveryCode.configuredOn', { date: configuredAt })}
            </p>
          )}
          <div>
            <label htmlFor="recovery-code-current-password" className="label">
              {t('changePassword.currentPassword')}
            </label>
            <input
              id="recovery-code-current-password"
              type="password"
              autoComplete="current-password"
              className="input mt-1"
              {...form.register('currentPassword', {
                required: t('changePassword.currentRequired'),
              })}
            />
            {form.formState.errors.currentPassword && (
              <p className="mt-1 text-sm text-danger-600">
                {form.formState.errors.currentPassword.message}
              </p>
            )}
          </div>
          {generate.error && (
            <p role="alert" className="text-sm text-danger-600">
              {translateServerError(generate.error, t, t('recoveryCode.error'))}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
