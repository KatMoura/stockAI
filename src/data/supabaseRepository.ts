import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessLog, AppUser, Product, Repository } from '../models';

function mapUser(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    name: String(row.nome),
    email: String(row.email),
    password: String(row.senha),
    role: row.role === 'admin' ? 'admin' : 'staff',
    createdAt: String(row.criado_as),
    lastLoginAt: row.ultimo_login_as ? String(row.ultimo_login_as) : undefined,
  };
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.nome),
    quantity: Number(row.quantidade),
    minQuantity: Number(row.min_quantidade),
    price: Number(row.preco),
    createdBy: String(row.criado_por),
    createdAt: String(row.criado_em),
    updatedAt: String(row.atualizado_em),
    category: row.categoria ? String(row.categoria) : undefined,
    unit: row.unidade ? String(row.unidade) : undefined,
    barcode: row.codigo ? String(row.codigo) : undefined,
    imageUrl: row.image_url ? String(row.image_url) : undefined,
  };
}

function mapAccessLog(row: Record<string, unknown>): AccessLog {
  return {
    id: String(row.id),
    userId: String(row.id_usuario),
    userName: String(row.nome_usuario),
    action: String(row.acao) as AccessLog['action'],
    timestamp: String(row.timestamp),
    details: row.detalhes ? String(row.detalhes) : undefined,
  };
}

export class SupabaseRepository implements Repository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getUsers(): Promise<AppUser[]> {
    const { data, error } = await this.client
      .from('usuarios')
      .select('*')
      .order('criado_as', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapUser(row as Record<string, unknown>));
  }

  async saveUsers(users: AppUser[]): Promise<void> {
    const payload = users.map((user) => ({
      id: user.id,
      nome: user.name,
      email: user.email,
      senha: user.password,
      role: user.role,
      criado_as: user.createdAt,
      ultimo_login_as: user.lastLoginAt ?? null,
    }));

    const { error } = await this.client.from('usuarios').upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.from('usuarios').delete().eq('id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async getProducts(): Promise<Product[]> {
    const { data, error } = await this.client
      .from('produtos')
      .select('*')
      .order('atualizado_em', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapProduct(row as Record<string, unknown>));
  }

  async saveProducts(products: Product[]): Promise<void> {
    const payload = products.map((product) => ({
      id: product.id,
      nome: product.name,
      quantidade: product.quantity,
      min_quantidade: product.minQuantity,
      preco: product.price,
      criado_por: product.createdBy,
      criado_em: product.createdAt,
      atualizado_em: product.updatedAt,
      categoria: product.category ?? null,
      unidade: product.unit ?? null,
      codigo: product.barcode ?? null,
      image_url: product.imageUrl ?? null,
    }));

    const { error } = await this.client
      .from('produtos')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteProduct(productId: string): Promise<void> {
    const { error } = await this.client.from('produtos').delete().eq('id', productId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async getAccessLogs(): Promise<AccessLog[]> {
    const { data, error } = await this.client
      .from('logs_acesso')
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
      id_usuario: log.userId,
      nome_usuario: log.userName,
      acao: log.action,
      timestamp: log.timestamp,
      detalhes: log.details ?? null,
    }));

    const { error } = await this.client
      .from('logs_acesso')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }
}
