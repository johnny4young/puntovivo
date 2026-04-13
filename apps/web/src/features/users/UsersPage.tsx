import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Pencil, Plus, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import type { User, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { getPasswordRequirementMessage, type PasswordRequirementKey } from '@/features/auth/passwordPolicy';
import { getErrorMessage } from '@/lib/utils';

interface UserFormValues {
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  password: string;
}

const createDefaultValues: UserFormValues = {
  email: '',
  name: '',
  role: 'cashier',
  isActive: true,
  password: '',
};

function mapUserToForm(user: User | null): UserFormValues {
  if (!user) {
    return createDefaultValues;
  }

  return {
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive ?? true,
    password: '',
  };
}

interface UserFormModalProps {
  isOpen: boolean;
  user: User | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
}

function UserFormModal({
  isOpen,
  user,
  isSaving,
  error,
  onClose,
  onSubmit,
}: UserFormModalProps) {
  const { t } = useTranslation(['settings', 'common']);
  const form = useForm<UserFormValues>({
    defaultValues: mapUserToForm(user),
  });
  const translatePasswordRequirement = (key: PasswordRequirementKey) => t(`common:passwordPolicy.${key}`);

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !user;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('users.form.createTitle') : t('users.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('users.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('users.form.submitting') : isCreate ? t('users.form.create') : t('users.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="user-name" className="label">
            {t('users.form.name')}
          </label>
          <input
            id="user-name"
            className="input mt-1"
            {...form.register('name', { required: t('users.form.nameRequired') })}
          />
        </div>

        <div>
          <label htmlFor="user-email" className="label">
            {t('users.form.email')}
          </label>
          <input
            id="user-email"
            type="email"
            className="input mt-1"
            {...form.register('email', { required: t('users.form.emailRequired') })}
          />
        </div>

        <div>
          <label htmlFor="user-role" className="label">
            {t('users.form.role')}
          </label>
          <select id="user-role" className="input mt-1" {...form.register('role')}>
            <option value="admin">{t('users.roles.admin')}</option>
            <option value="manager">{t('users.roles.manager')}</option>
            <option value="cashier">{t('users.roles.cashier')}</option>
            <option value="viewer">{t('users.roles.viewer')}</option>
          </select>
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('users.form.isActive')}
        </label>

        {isCreate && (
          <div>
            <label htmlFor="user-password" className="label">
              {t('users.form.initialPassword')}
            </label>
            <input
              id="user-password"
              type="password"
              className="input mt-1"
              {...form.register('password', {
                required: t('users.form.passwordRequired'),
                validate: value => getPasswordRequirementMessage(value, translatePasswordRequirement) ?? true,
              })}
            />
            {form.formState.errors.password && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.password.message}</p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

interface ResetPasswordModalProps {
  isOpen: boolean;
  user: User | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}

function ResetPasswordModal({
  isOpen,
  user,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ResetPasswordModalProps) {
  const { t } = useTranslation(['settings', 'common']);
  const form = useForm<{ password: string }>({
    defaultValues: { password: '' },
  });
  const translatePasswordRequirement = (key: PasswordRequirementKey) => t(`common:passwordPolicy.${key}`);

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit(values.password);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('users.resetPassword.title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('users.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('users.form.submitting') : t('users.resetPassword.submit')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-secondary-600">
          {t('users.resetPassword.description')} {user?.name ?? t('users.resetPassword.fallbackUser')}.
        </p>
        <div>
          <label htmlFor="reset-password" className="label">
            {t('users.resetPassword.newPassword')}
          </label>
          <input
            id="reset-password"
            type="password"
            className="input mt-1"
            {...form.register('password', {
              required: t('users.form.passwordRequired'),
              validate: value => getPasswordRequirementMessage(value, translatePasswordRequirement) ?? true,
            })}
          />
          {form.formState.errors.password && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.password.message}</p>
          )}
        </div>
        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

function canManageUsers(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function UsersPage() {
  const { t } = useTranslation('settings');
  const { user: currentUser, logout } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const usersQuery = trpc.users.list.useQuery({ page: 1, perPage: 50 });
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const canManage = canManageUsers(currentUser?.role);
  const users: User[] = (usersQuery.data?.items ?? []).map(user => ({
    ...user,
    isActive: user.isActive ?? true,
  }));

  const createMutation = trpc.users.create.useMutation({
    onSuccess: async () => {
      await utils.users.list.invalidate();
      setIsUserModalOpen(false);
      setEditingUser(null);
      toast.success({ title: t('users.toast.created') });
    },
    onError: error => {
      toast.error({
        title: t('users.toast.createError'),
        description: getErrorMessage(error, t('users.toast.createError')),
      });
    },
  });

  const updateMutation = trpc.users.update.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.users.list.invalidate();
      setIsUserModalOpen(false);
      setEditingUser(null);

      const updatedOwnClaims =
        variables.id === currentUser?.id &&
        ((variables.email !== undefined && variables.email !== currentUser.email) ||
          (variables.role !== undefined && variables.role !== currentUser.role));

      if (updatedOwnClaims) {
        toast.success({
          title: t('users.toast.updated'),
          description: t('users.toast.claimsChanged'),
        });
        await logout();
        return;
      }

      toast.success({ title: t('users.toast.updated') });
    },
    onError: error => {
      toast.error({
        title: t('users.toast.updateError'),
        description: getErrorMessage(error, t('users.toast.updateError')),
      });
    },
  });

  const resetPasswordMutation = trpc.users.resetPassword.useMutation({
    onSuccess: async (_data, variables) => {
      setPasswordUser(null);

      if (variables.id === currentUser?.id) {
        toast.success({
          title: t('users.toast.passwordReset'),
          description: t('users.toast.passwordChanged'),
        });
        await logout();
        return;
      }

      toast.success({ title: t('users.toast.passwordReset') });
    },
    onError: error => {
      toast.error({
        title: t('users.toast.updateError'),
        description: getErrorMessage(error, t('users.toast.updateError')),
      });
    },
  });

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'name',
      header: t('users.columns.user'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100">
            <UserRound className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: t('users.columns.role'),
      size: 120,
      cell: ({ row }) => <span className="capitalize">{row.original.role}</span>,
    },
    {
      accessorKey: 'isActive',
      header: t('users.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? t('users.columns.active') : t('users.columns.inactive')}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 120,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => {
              setEditingUser(row.original);
              setIsUserModalOpen(true);
            }}
            disabled={!canManage}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => setPasswordUser(row.original)}
            disabled={!canManage}
          >
            <KeyRound className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const handleSubmitUser = async (values: UserFormValues) => {
    if (editingUser) {
      await updateMutation.mutateAsync({
        id: editingUser.id,
        email: values.email,
        name: values.name,
        role: values.role,
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      email: values.email,
      name: values.name,
      password: values.password,
      role: values.role,
      isActive: values.isActive,
    });
  };

  if (!canManage) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('users.description')}
          </p>
        </div>
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('users.permissionNote')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('users.description')}
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => {
            setEditingUser(null);
            setIsUserModalOpen(true);
          }}
          disabled={!canManage}
        >
          <Plus className="h-5 w-5" />
          {t('users.add')}
        </button>
      </div>

      <div className="card p-6">
        {usersQuery.isLoading && <TableLoadingState message={t('users.loading')} />}
        {usersQuery.error && (
          <TableErrorState
            title={t('users.error')}
            message={usersQuery.error.message}
            onRetry={() => {
              void usersQuery.refetch();
            }}
          />
        )}
        {!usersQuery.isLoading && !usersQuery.error && (
          <DataTable
            columns={columns}
            data={users}
            searchKey="name"
            searchPlaceholder={t('users.search')}
            pageSize={10}
          />
        )}
      </div>

      <UserFormModal
        key={editingUser?.id ?? 'new-user'}
        isOpen={isUserModalOpen}
        user={editingUser}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={() => {
          setIsUserModalOpen(false);
          setEditingUser(null);
        }}
        onSubmit={handleSubmitUser}
      />

      <ResetPasswordModal
        key={passwordUser?.id ?? 'reset-user'}
        isOpen={!!passwordUser}
        user={passwordUser}
        isSaving={resetPasswordMutation.isPending}
        error={resetPasswordMutation.error?.message ?? null}
        onClose={() => setPasswordUser(null)}
        onSubmit={async password => {
          if (!passwordUser) {
            return;
          }
          await resetPasswordMutation.mutateAsync({
            id: passwordUser.id,
            newPassword: password,
          });
        }}
      />
    </div>
  );
}
