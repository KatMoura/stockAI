export type UserRole = 'admin' | 'staff';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Product {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number;
  price: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Campos opcionais para contexto de supermercado
  category?: string;
  unit?: string; // e.g., "kg", "un", "ltr"
  barcode?: string;
  imageUrl?: string;
}

export type AccessAction =
  | 'login'
  | 'logout'
  | 'page_view'
  | 'create_product'
  | 'update_product'
  | 'delete_product'
  | 'create_user'
  | 'delete_user';

export interface AccessLog {
  id: string;
  userId: string;
  userName: string;
  action: AccessAction;
  timestamp: string;
  details?: string;
}

export interface Repository {
  getUsers(): Promise<AppUser[]>;
  saveUsers(users: AppUser[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  getProducts(): Promise<Product[]>;
  saveProducts(products: Product[]): Promise<void>;
  deleteProduct(productId: string): Promise<void>;
  getAccessLogs(): Promise<AccessLog[]>;
  saveAccessLogs(logs: AccessLog[]): Promise<void>;
}
