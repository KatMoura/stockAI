import type { AccessLog, AppUser, Product, Repository } from '../models';

const STORAGE_KEYS = {
  usuarios: 'stockia.usuarios',
  produtos: 'stockia.produtos',
  logs_acesso: 'stockia.logs_acesso',
};

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export class LocalRepository implements Repository {
  async getUsers(): Promise<AppUser[]> {
    return readJson<AppUser[]>(STORAGE_KEYS.usuarios, []);
  }

  async saveUsers(usuarios: AppUser[]): Promise<void> {
    writeJson(STORAGE_KEYS.usuarios, usuarios);
  }

  async deleteUser(userId: string): Promise<void> {
    const usuarios = readJson<AppUser[]>(STORAGE_KEYS.usuarios, []);
    writeJson(
      STORAGE_KEYS.usuarios,
      usuarios.filter((usuario) => usuario.id !== userId),
    );
  }

  async getProducts(): Promise<Product[]> {
    return readJson<Product[]>(STORAGE_KEYS.produtos, []);
  }

  async saveProducts(produtos: Product[]): Promise<void> {
    writeJson(STORAGE_KEYS.produtos, produtos);
  }

  async deleteProduct(productId: string): Promise<void> {
    const produtos = readJson<Product[]>(STORAGE_KEYS.produtos, []);
    writeJson(
      STORAGE_KEYS.produtos,
      produtos.filter((produto) => produto.id !== productId),
    );
  }

  async getAccessLogs(): Promise<AccessLog[]> {
    return readJson<AccessLog[]>(STORAGE_KEYS.logs_acesso, []);
  }

  async saveAccessLogs(logs: AccessLog[]): Promise<void> {
    writeJson(STORAGE_KEYS.logs_acesso  , logs);
  }
}
