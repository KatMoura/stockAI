import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { AccessLog, AppUser, Product, Repository } from '../models';

type EntityKey = 'users' | 'products' | 'logs';

type TableConfig = {
  table: string;
  orderColumn: string;
  mapUser?: (row: Record<string, unknown>) => AppUser;
  mapProduct?: (row: Record<string, unknown>) => Product;
  mapLog?: (row: Record<string, unknown>) => AccessLog;
  userPayload?: (user: AppUser) => Record<string, unknown>;
  productPayload?: (product: Product) => Record<string, unknown>;
  logPayload?: (log: AccessLog) => Record<string, unknown>;
};

const TABLE_CANDIDATES: Record<EntityKey, TableConfig[]> = {
  users: [
    {
      table: 'usuarios',
      orderColumn: 'criado_as',
      mapUser: (row) => ({
        id: String(row.id),
        name: String(row.nome),
        email: String(row.email),
        password: String(row.senha),
        role: row.role === 'admin' ? 'admin' : 'staff',
        createdAt: String(row.criado_as),
        lastLoginAt: row.ultimo_login_as ? String(row.ultimo_login_as) : undefined,
      }),
      userPayload: (user) => ({
        id: user.id,
        nome: user.name,
        email: user.email,
        senha: user.password,
        role: user.role,
        criado_as: user.createdAt,
        ultimo_login_as: user.lastLoginAt ?? null,
      }),
    },
    {
      table: 'users',
      orderColumn: 'created_at',
      mapUser: (row) => ({
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        password: String(row.password),
        role: row.role === 'admin' ? 'admin' : 'staff',
        createdAt: String(row.created_at),
        lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
      }),
      userPayload: (user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        password: user.password,
        role: user.role,
        created_at: user.createdAt,
        last_login_at: user.lastLoginAt ?? null,
      }),
    },
  ],
  products: [
    {
      table: 'produtos',
      orderColumn: 'atualizado_em',
      mapProduct: (row) => ({
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
      }),
      productPayload: (product) => ({
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
      }),
    },
    {
      table: 'products',
      orderColumn: 'updated_at',
      mapProduct: (row) => ({
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
      }),
      productPayload: (product) => ({
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
      }),
    },
  ],
  logs: [
    {
      table: 'logs_acesso',
      orderColumn: 'timestamp',
      mapLog: (row) => ({
        id: String(row.id),
        userId: String(row.id_usuario),
        userName: String(row.nome_usuario),
        action: String(row.acao) as AccessLog['action'],
        timestamp: String(row.timestamp),
        details: row.detalhes ? String(row.detalhes) : undefined,
      }),
      logPayload: (log) => ({
        id: log.id,
        id_usuario: log.userId,
        nome_usuario: log.userName,
        acao: log.action,
        timestamp: log.timestamp,
        detalhes: log.details ?? null,
      }),
    },
    {
      table: 'access_logs',
      orderColumn: 'timestamp',
      mapLog: (row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        userName: String(row.user_name),
        action: String(row.action) as AccessLog['action'],
        timestamp: String(row.timestamp),
        details: row.details ? String(row.details) : undefined,
      }),
      logPayload: (log) => ({
        id: log.id,
        user_id: log.userId,
        user_name: log.userName,
        action: log.action,
        timestamp: log.timestamp,
        details: log.details ?? null,
      }),
    },
  ],
};

function isMissingTable(error: PostgrestError | null): boolean {
  return !!error && /schema cache|Could not find the table|relation .* does not exist/i.test(error.message);
}

export class SupabaseRepository implements Repository {
  private readonly client: SupabaseClient;
  private readonly resolvedTables: Partial<Record<EntityKey, TableConfig>> = {};

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private async resolveTable(entity: EntityKey): Promise<TableConfig> {
    const cached = this.resolvedTables[entity];
    if (cached) {
      return cached;
    }

    let lastError: PostgrestError | null = null;

    for (const config of TABLE_CANDIDATES[entity]) {
      const { error } = await this.client.from(config.table).select('*', { head: true, count: 'exact' });
      if (!error) {
        this.resolvedTables[entity] = config;
        return config;
      }

      if (!isMissingTable(error)) {
        throw new Error(error.message);
      }

      lastError = error;
    }

    throw new Error(lastError?.message ?? `Nenhuma tabela valida encontrada para ${entity}.`);
  }

  async getUsers(): Promise<AppUser[]> {
    const config = await this.resolveTable('users');
    const { data, error } = await this.client
      .from(config.table)
      .select('*')
      .order(config.orderColumn, { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => config.mapUser!(row as Record<string, unknown>));
  }

  async saveUsers(users: AppUser[]): Promise<void> {
    const config = await this.resolveTable('users');
    const payload = users.map((user) => config.userPayload!(user));
    const { error } = await this.client.from(config.table).upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const config = await this.resolveTable('users');
    const { error } = await this.client.from(config.table).delete().eq('id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async getProducts(): Promise<Product[]> {
    const config = await this.resolveTable('products');
    const { data, error } = await this.client
      .from(config.table)
      .select('*')
      .order(config.orderColumn, { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => config.mapProduct!(row as Record<string, unknown>));
  }

  async saveProducts(products: Product[]): Promise<void> {
    const config = await this.resolveTable('products');
    const payload = products.map((product) => config.productPayload!(product));
    const { error } = await this.client.from(config.table).upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteProduct(productId: string): Promise<void> {
    const config = await this.resolveTable('products');
    const { error } = await this.client.from(config.table).delete().eq('id', productId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async getAccessLogs(): Promise<AccessLog[]> {
    const config = await this.resolveTable('logs');
    const { data, error } = await this.client
      .from(config.table)
      .select('*')
      .order(config.orderColumn, { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => config.mapLog!(row as Record<string, unknown>));
  }

  async saveAccessLogs(logs: AccessLog[]): Promise<void> {
    const config = await this.resolveTable('logs');
    const payload = logs.map((log) => config.logPayload!(log));
    const { error } = await this.client.from(config.table).upsert(payload, { onConflict: 'id' });

    if (error) {
      throw new Error(error.message);
    }
  }
}
