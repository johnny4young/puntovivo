import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Pencil, Plus, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { DataTable } from '@/components/tables/DataTable';
import type { User, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

interface UserFormValues {
  email: string;
  name: string;
  role: Extract<UserRole, 'admin' | 'manager' | 'cashier'>;
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
    role: (user.role === 'viewer' ? 'cashier' : user.role) as Extract<UserRole, 'admin' | 'manager' | 'cashier'>,
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
  const form = useForm<UserFormValues>({
    defaultValues: mapUserToForm(user),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !user;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create User' : 'Edit User'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create User' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="user-name" className="label">
            Name
          </label>
          <input
            id="user-name"
            className="input mt-1"
            {...form.register('name', { required: 'Name is required' })}
          />
        </div>

        <div>
          <label htmlFor="user-email" className="label">
            Email
          </label>
          <input
            id="user-email"
            type="email"
            className="input mt-1"
            {...form.register('email', { required: 'Email is required' })}
          />
        </div>

        <div>
          <label htmlFor="user-role" className="label">
            Role
          </label>
          <select id="user-role" className="input mt-1" {...form.register('role')}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
          </select>
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          User is active
        </label>

        {isCreate && (
          <div>
            <label htmlFor="user-password" className="label">
              Initial Password
            </label>
            <input
              id="user-password"
              type="password"
              className="input mt-1"
              {...form.register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'Password must be at least 8 characters' },
              })}
            />
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
  const form = useForm<{ password: string }>({
    defaultValues: { password: '' },
  });

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit(values.password);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reset Password"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Resetting...' : 'Reset Password'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-secondary-600">
          Set a new temporary password for {user?.name ?? 'this user'}.
        </p>
        <div>
          <label htmlFor="reset-password" className="label">
            New Password
          </label>
          <input
            id="reset-password"
            type="password"
            className="input mt-1"
            {...form.register('password', {
              required: 'Password is required',
              minLength: { value: 8, message: 'Password must be at least 8 characters' },
            })}
          />
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
  const { user: currentUser } = useAuth();
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
    },
  });

  const updateMutation = trpc.users.update.useMutation({
    onSuccess: async () => {
      await utils.users.list.invalidate();
      setIsUserModalOpen(false);
      setEditingUser(null);
    },
  });

  const resetPasswordMutation = trpc.users.resetPassword.useMutation({
    onSuccess: async () => {
      setPasswordUser(null);
    },
  });

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'name',
      header: 'User',
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
      header: 'Role',
      size: 120,
      cell: ({ row }) => <span className="capitalize">{row.original.role}</span>,
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      size: 120,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? 'Active' : 'Inactive'}
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
          <h1 className="text-2xl font-bold text-secondary-900">Users</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Create staff accounts, assign roles, and reset passwords.
          </p>
        </div>
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Only administrators can access user management.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Users</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Create staff accounts, assign roles, and reset passwords.
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
          Add User
        </button>
      </div>

      <div className="card p-6">
        {usersQuery.isLoading && <p className="py-4 text-secondary-500">Loading users...</p>}
        {usersQuery.error && <p className="py-4 text-danger-500">{usersQuery.error.message}</p>}
        {!usersQuery.isLoading && !usersQuery.error && (
          <DataTable
            columns={columns}
            data={users}
            searchKey="name"
            searchPlaceholder="Search users..."
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
