import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessLog, AppUser, Product, Repository } from '../models';

function mapUser(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    password: String(row.password),
    role: row.role === 'admin' ? 'admin' : 'staff',
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
  };
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    quantity: Number(row.quantity),
    minQuantity: Number(row.min_quantity),
    price: Number(row.price),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    category: row.category ? String(row.category) : undefined,
    unit: row.unit ? String(row.unit) : undefined,
    barcode: row.barcode ? String(row.barcode) : undefined,
    imageUrl: row.image_url ? String(row.image_url) : undefined,
  };
}

function mapAccessLog(row: Record<string, unknown>): AccessLog {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    action: String(row.action) as AccessLog['action'],
    timestamp: String(row.timestamp),
    details: row.details ? String(row.details) : undefined,
  };
}

export class SupabaseRepository implements Repository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getUsers(): Promise<AppUser[]> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapUser(row as Record<string, unknown>));
  }

  async saveUsers(users: AppUser[]): Promise<void> {
    const payload = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      created_at: user.createdAt,
      last_login_at: user.lastLoginAt ?? null,
    }));

    const { error } = await this.client.from('users').upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async getProducts(): Promise<Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapProduct(row as Record<string, unknown>));
  }

  async saveProducts(products: Product[]): Promise<void> {
    const payload = products.map((product) => ({
      id: product.id,
      name: product.name,
      quantity: product.quantity,
      min_quantity: product.minQuantity,
      price: product.price,
      created_by: product.createdBy,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
      category: product.category ?? null,
      unit: product.unit ?? null,
      barcode: product.barcode ?? null,
      image_url: product.imageUrl ?? null,
    }));

    const { error } = await this.client
      .from('products')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteProduct(productId: string): Promise<void> {
    const { error } = await this.client.from('products').delete().eq('id', productId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async getAccessLogs(): Promise<AccessLog[]> {
    const { data, error } = await this.client
      .from('access_logs')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapAccessLog(row as Record<string, unknown>));
  }

  async saveAccessLogs(logs: AccessLog[]): Promise<void> {
    const payload = logs.map((log) => ({
      id: log.id,
      user_id: log.userId,
      user_name: log.userName,
      action: log.action,
      timestamp: log.timestamp,
      details: log.details ?? null,
    }));

    const { error } = await this.client
      .from('access_logs')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }
}
