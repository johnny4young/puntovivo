/**
 * API Client for Open Yojob Server
 *
 * Provides a clean interface for communicating with the Fastify backend.
 * Supports authentication, CRUD operations, and real-time SSE subscriptions.
 *
 * @module services/api/client
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8090';

// Auth token storage
let authToken: string | null = null;
let currentUser: AuthUser | null = null;
let currentTenant: AuthTenant | null = null;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  tenant: AuthTenant;
}

export interface ListResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Make an authenticated API request
 */
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  if (currentTenant) {
    (headers as Record<string, string>)['X-Tenant-ID'] = currentTenant.id;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err) {
    // Check if it's a network error (backend not reachable)
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Cannot connect to server at ${API_URL}. Please ensure the backend server is running.`
      );
    }
    throw err;
  }
}

/**
 * API Client class with tenant context
 */
class ApiClient {
  /**
   * Get the API base URL
   */
  getBaseUrl(): string {
    return API_URL;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return authToken !== null;
  }

  /**
   * Get current auth token
   */
  getToken(): string | null {
    return authToken;
  }

  /**
   * Get current user
   */
  getUser(): AuthUser | null {
    return currentUser;
  }

  /**
   * Get current tenant
   */
  getTenant(): AuthTenant | null {
    return currentTenant;
  }

  /**
   * Get tenant ID
   */
  getTenantId(): string | null {
    return currentTenant?.id || null;
  }

  /**
   * Set tenant ID (for multi-tenant switching)
   */
  setTenantId(tenantId: string): void {
    if (currentTenant) {
      currentTenant = { ...currentTenant, id: tenantId };
    }
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    authToken = response.token;
    currentUser = response.user;
    currentTenant = response.tenant;

    // Store in localStorage for persistence
    localStorage.setItem('auth_token', response.token);
    localStorage.setItem('auth_user', JSON.stringify(response.user));
    localStorage.setItem('auth_tenant', JSON.stringify(response.tenant));

    return response;
  }

  /**
   * Logout and clear auth state
   */
  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors on logout
    }

    authToken = null;
    currentUser = null;
    currentTenant = null;

    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_tenant');
  }

  /**
   * Refresh the auth token
   */
  async refreshToken(): Promise<{ token: string }> {
    const response = await request<{ token: string }>('/api/auth/refresh', {
      method: 'POST',
    });

    authToken = response.token;
    localStorage.setItem('auth_token', response.token);

    return response;
  }

  /**
   * Get current user info from server
   */
  async getMe(): Promise<{ user: AuthUser; tenant: AuthTenant | null }> {
    return request('/api/auth/me');
  }

  /**
   * Change password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  /**
   * Restore auth from localStorage (call on app init)
   */
  restoreAuth(): boolean {
    const token = localStorage.getItem('auth_token');
    const userStr = localStorage.getItem('auth_user');
    const tenantStr = localStorage.getItem('auth_tenant');

    if (token && userStr && tenantStr) {
      try {
        authToken = token;
        currentUser = JSON.parse(userStr);
        currentTenant = JSON.parse(tenantStr);
        return true;
      } catch {
        this.logout();
      }
    }

    return false;
  }

  // ============================================================================
  // Collections CRUD
  // ============================================================================

  /**
   * Get list of items from a collection
   */
  async getList<T>(
    collection: string,
    page = 1,
    perPage = 50,
    filter?: string,
    sort = '-created_at'
  ): Promise<ListResponse<T>> {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      sort,
    });

    if (filter) {
      params.set('filter', filter);
    }

    return request<ListResponse<T>>(`/api/collections/${collection}?${params}`);
  }

  /**
   * Get a single item by ID
   */
  async getOne<T>(collection: string, id: string): Promise<T> {
    return request<T>(`/api/collections/${collection}/${id}`);
  }

  /**
   * Create a new item
   */
  async create<T>(collection: string, data: Partial<T>): Promise<T> {
    return request<T>(`/api/collections/${collection}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing item
   */
  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T> {
    return request<T>(`/api/collections/${collection}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete an item
   */
  async delete(collection: string, id: string): Promise<{ success: boolean; id: string }> {
    return request(`/api/collections/${collection}/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Sync
  // ============================================================================

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<{
    pendingCount: number;
    conflictsCount: number;
    externalSyncEnabled: boolean;
    lastSyncAt: string | null;
    status: string;
  }> {
    return request('/api/sync/status');
  }

  /**
   * Get pending sync queue items
   */
  async getSyncQueue(limit = 50): Promise<{
    items: Array<{
      id: string;
      entityType: string;
      entityId: string;
      operation: string;
      data: Record<string, unknown>;
      createdAt: string;
    }>;
    count: number;
  }> {
    return request(`/api/sync/queue?limit=${limit}`);
  }

  /**
   * Get unresolved sync conflicts
   */
  async getSyncConflicts(): Promise<{
    items: Array<{
      id: string;
      entityType: string;
      entityId: string;
      localData: Record<string, unknown>;
      remoteData: Record<string, unknown>;
      status: string;
      createdAt: string;
    }>;
    count: number;
  }> {
    return request('/api/sync/conflicts');
  }

  // ============================================================================
  // Real-time SSE Subscriptions
  // ============================================================================

  /**
   * Subscribe to real-time updates via SSE
   *
   * @param collections - Array of collection names to subscribe to
   * @param onEvent - Callback for received events
   * @param onError - Optional error callback
   * @returns Unsubscribe function
   */
  subscribe(
    collections: string[],
    onEvent: (event: { event: string; data: unknown }) => void,
    onError?: (error: Error) => void
  ): () => void {
    const collectionsParam = collections.join(',');
    const url = `${API_URL}/api/realtime/subscribe?collections=${collectionsParam}`;

    const eventSource = new EventSource(url);

    eventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        onEvent({ event: 'message', data });
      } catch {
        onEvent({ event: 'message', data: event.data });
      }
    };

    eventSource.addEventListener('connected', event => {
      const data = JSON.parse((event as MessageEvent).data);
      onEvent({ event: 'connected', data });
    });

    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received, connection is alive
    });

    for (const collection of collections) {
      for (const action of ['create', 'update', 'delete']) {
        const eventName = `${collection}.${action}`;
        eventSource.addEventListener(eventName, event => {
          const data = JSON.parse((event as MessageEvent).data);
          onEvent({ event: eventName, data });
        });
      }
    }

    eventSource.onerror = error => {
      console.error('[SSE] Connection error:', error);
      onError?.(new Error('SSE connection failed'));
    };

    return () => {
      eventSource.close();
    };
  }

  /**
   * Unsubscribe helper (deprecated)
   */
  unsubscribe(): void {
    console.warn('unsubscribe() is deprecated. Use the function returned by subscribe() instead.');
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export for backwards compatibility with PocketBase SDK
export const pb = {
  authStore: {
    get isValid() {
      return api.isAuthenticated();
    },
    get token() {
      return api.getToken();
    },
    clear() {
      api.logout();
    },
  },
  collection: (name: string) => ({
    getList: <T>(page: number, perPage: number, options?: { filter?: string; sort?: string }) =>
      api.getList<T>(name, page, perPage, options?.filter, options?.sort),
    getOne: <T>(id: string) => api.getOne<T>(name, id),
    create: <T>(data: Partial<T>) => api.create<T>(name, data),
    update: <T>(id: string, data: Partial<T>) => api.update<T>(name, id, data),
    delete: (id: string) => api.delete(name, id),
    subscribe: <T>(_topic: string, callback: (data: { action: string; record: T }) => void) => {
      const unsubscribe = api.subscribe([name], event => {
        const action = event.event.split('.')[1] || 'unknown';
        callback({ action, record: event.data as T });
      });
      return unsubscribe;
    },
    unsubscribe: () => {},
  }),
  realtime: {
    unsubscribe: () => {},
  },
};

export default api;
