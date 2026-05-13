import type { AccessLog, AppUser, Product, Repository } from '../models';

const STORAGE_KEYS = {
  users: 'stockia.users',
  products: 'stockia.products',
  accessLogs: 'stockia.accessLogs',
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
    return readJson<AppUser[]>(STORAGE_KEYS.users, []);
  }

  async saveUsers(users: AppUser[]): Promise<void> {
    writeJson(STORAGE_KEYS.users, users);
  }

  async deleteUser(userId: string): Promise<void> {
    const users = readJson<AppUser[]>(STORAGE_KEYS.users, []);
    writeJson(
      STORAGE_KEYS.users,
      users.filter((user) => user.id !== userId),
    );
  }

  async getProducts(): Promise<Product[]> {
    return readJson<Product[]>(STORAGE_KEYS.products, []);
  }

  async saveProducts(products: Product[]): Promise<void> {
    writeJson(STORAGE_KEYS.products, products);
  }

  async deleteProduct(productId: string): Promise<void> {
    const products = readJson<Product[]>(STORAGE_KEYS.products, []);
    writeJson(
      STORAGE_KEYS.products,
      products.filter((product) => product.id !== productId),
    );
  }

  async getAccessLogs(): Promise<AccessLog[]> {
    return readJson<AccessLog[]>(STORAGE_KEYS.accessLogs, []);
  }

  async saveAccessLogs(logs: AccessLog[]): Promise<void> {
    writeJson(STORAGE_KEYS.accessLogs, logs);
  }
}
