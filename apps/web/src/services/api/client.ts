import PocketBase from 'pocketbase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8090';

export const pb = new PocketBase(API_URL);

// Auto-refresh authentication
pb.autoCancellation(false);

// API client wrapper with tenant context
class ApiClient {
  private tenantId: string | null = null;

  setTenantId(tenantId: string) {
    this.tenantId = tenantId;
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  // Auth methods
  async login(email: string, password: string) {
    const authData = await pb.collection('users').authWithPassword(email, password);
    return authData;
  }

  async logout() {
    pb.authStore.clear();
  }

  async refreshToken() {
    if (pb.authStore.isValid) {
      await pb.collection('users').authRefresh();
    }
  }

  // Generic CRUD operations with tenant isolation
  async getList<T>(
    collection: string,
    page = 1,
    perPage = 50,
    filter = '',
    sort = '-created'
  ): Promise<{ items: T[]; totalItems: number; totalPages: number }> {
    const tenantFilter = this.tenantId ? `tenant_id="${this.tenantId}"` : '';
    const combinedFilter = filter
      ? tenantFilter
        ? `${tenantFilter} && ${filter}`
        : filter
      : tenantFilter;

    const result = await pb.collection(collection).getList<T>(page, perPage, {
      filter: combinedFilter,
      sort,
    });

    return {
      items: result.items,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
    };
  }

  async getOne<T>(collection: string, id: string): Promise<T> {
    return await pb.collection(collection).getOne<T>(id);
  }

  async create<T>(collection: string, data: Partial<T>): Promise<T> {
    const payload = this.tenantId ? { ...data, tenant_id: this.tenantId } : data;
    return await pb.collection(collection).create<T>(payload);
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T> {
    return await pb.collection(collection).update<T>(id, data);
  }

  async delete(collection: string, id: string): Promise<boolean> {
    await pb.collection(collection).delete(id);
    return true;
  }

  // Real-time subscriptions
  subscribe<T>(
    collection: string,
    callback: (data: { action: string; record: T }) => void,
    filter?: string
  ) {
    const tenantFilter = this.tenantId ? `tenant_id="${this.tenantId}"` : '';
    const combinedFilter = filter
      ? tenantFilter
        ? `${tenantFilter} && ${filter}`
        : filter
      : tenantFilter;

    return pb.collection(collection).subscribe<T>('*', callback, {
      filter: combinedFilter,
    });
  }

  unsubscribe(collection?: string) {
    if (collection) {
      pb.collection(collection).unsubscribe();
    } else {
      pb.realtime.unsubscribe();
    }
  }
}

export const api = new ApiClient();

export default api;
