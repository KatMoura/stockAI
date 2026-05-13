import './style.css';
import type { AccessLog, AppUser, Product, Repository, UserRole } from './models';
import { LocalRepository } from './data/localRepository';
import { supabase, isSupabaseConfigured } from './data/supabaseClient';
import { SupabaseRepository } from './data/supabaseRepository';

type Screen = 'inicio' | 'produtos' | 'relatorios' | 'alertas' | 'historico' | 'usuarios' | 'metricas';
type AuthMode = 'login' | 'register';

const foodCategories = [
  { value: 'Hortifrutis', unit: 'kg' },
  { value: 'Padaria', unit: 'un' },
  { value: 'Bebidas', unit: 'un' },
  { value: 'Mercearia', unit: 'un' },
  { value: 'Carnes e Frios', unit: 'kg' },
  { value: 'Laticinios', unit: 'un' },
  { value: 'Higiene e Limpeza', unit: 'un' },
  { value: 'Congelados', unit: 'un' },
  { value: 'Descartaveis', unit: 'un' },
  { value: 'Rotisseria', unit: 'kg' },
];

const appElement = document.querySelector<HTMLDivElement>('#app');

if (!appElement) {
  throw new Error('Elemento #app nao encontrado.');
}

const app = appElement;
const requestedProvider = import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? 'supabase' : 'local';
const repository: Repository =
  requestedProvider === 'supabase' && supabase && isSupabaseConfigured
    ? new SupabaseRepository(supabase)
    : new LocalRepository();

const isSupabaseProvider = requestedProvider === 'supabase' && !!supabase && isSupabaseConfigured;
const mobileMedia = window.matchMedia('(max-width: 960px)');

let users: AppUser[] = [];
let products: Product[] = [];
let accessLogs: AccessLog[] = [];
let currentUser: AppUser | null = null;
let activeScreen: Screen = 'inicio';
let authMode: AuthMode = 'login';
let authMessage = '';
let editProductId: string | null = null;
let editingUserId: string | null = null;
let searchQuery = '';
let productFilter: 'all' | 'critical' | 'low' | 'out' = 'all';
let sidebarCollapsed = false;
let mobileMenuOpen = false;
let syncStatus = isSupabaseProvider ? 'Tempo real ativo' : 'Sincronizacao local ativa';
let lastSyncedAt: string | null = null;
let refreshInFlight: Promise<void> | null = null;
const cleanups: Array<() => void> = [];

function id(): string {
  return crypto.randomUUID();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function defaultUnitForCategory(category: string): string {
  return foodCategories.find((item) => item.value === category)?.unit ?? 'un';
}

function isAdmin(user: AppUser | null): user is AppUser {
  return !!user && user.role === 'admin';
}

function isRestrictedScreen(screen: Screen): boolean {
  return screen === 'usuarios' || screen === 'metricas' || screen === 'relatorios';
}

function ensureScreenAccess(): void {
  if (!currentUser) {
    activeScreen = 'inicio';
    return;
  }

  if (isRestrictedScreen(activeScreen) && !isAdmin(currentUser)) {
    activeScreen = 'inicio';
  }
}

function closeTransientPanels(): void {
  if (mobileMedia.matches) {
    mobileMenuOpen = false;
  }
}

function syncCurrentUserReference(): void {
  if (!currentUser) {
    return;
  }

  const freshUser = users.find((user) => user.id === currentUser?.id);
  currentUser = freshUser ? { ...freshUser } : null;
  ensureScreenAccess();
}

function lastLoginForUser(userId: string): string | undefined {
  const user = users.find((item) => item.id === userId);
  return user?.lastLoginAt;
}

function getDashboardMetrics() {
  const totalProdutos = products.length;
  const estoqueTotal = products.reduce((sum, product) => sum + product.quantity, 0);
  const valorTotal = products.reduce((sum, product) => sum + product.price * product.quantity, 0);
  const itensCriticos = products.filter((product) => product.quantity <= product.minQuantity).length;

  return { totalProdutos, estoqueTotal, valorTotal, itensCriticos };
}

function getAccessMetrics() {
  const now = Date.now();
  const sevenDays = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = now - 30 * 24 * 60 * 60 * 1000;

  const recentLogins = accessLogs.filter(
    (log) => log.action === 'login' && new Date(log.timestamp).getTime() >= sevenDays,
  ).length;

  const activeUsers = new Set(
    accessLogs
      .filter((log) => new Date(log.timestamp).getTime() >= thirtyDays)
      .map((log) => log.userId),
  ).size;

  const pageViews = accessLogs.filter((log) => log.action === 'page_view');
  const pageCounter = pageViews.reduce<Record<string, number>>((acc, log) => {
    const key = log.details ?? 'inicio';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const topPages = Object.entries(pageCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return {
    recentLogins,
    activeUsers,
    totalPageViews: pageViews.length,
    topPages,
  };
}

function getReportMetrics() {
  const byCategory = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category ?? 'Sem categoria';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const byCategoryValue = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category ?? 'Sem categoria';
    acc[key] = (acc[key] ?? 0) + product.quantity;
    return acc;
  }, {});

  const byUnit = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.unit ?? 'un';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const orderedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const criticalProducts = products
    .filter((product) => product.quantity <= product.minQuantity)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 6);

  const totalItems = products.reduce((sum, product) => sum + product.quantity, 0);
  const stockValue = products.reduce((sum, product) => sum + product.quantity * product.price, 0);
  const averageTicket = products.length > 0 ? stockValue / products.length : 0;

  return {
    orderedCategories,
    byCategoryValue: Object.entries(byCategoryValue).sort((a, b) => b[1] - a[1]),
    byUnit: Object.entries(byUnit).sort((a, b) => b[1] - a[1]),
    criticalProducts,
    totalItems,
    stockValue,
    averageTicket,
  };
}

function getFilteredProducts(): Product[] {
  const q = searchQuery.trim().toLowerCase();

  return products.filter((product) => {
    const matchesQuery =
      !q ||
      product.name.toLowerCase().includes(q) ||
      (product.category ?? '').toLowerCase().includes(q) ||
      (product.barcode ?? '').toLowerCase().includes(q);

    let matchesFilter = true;
    if (productFilter === 'critical') {
      matchesFilter = product.quantity <= product.minQuantity;
    }
    if (productFilter === 'low') {
      matchesFilter =
        product.quantity <= product.minQuantity * 2 && product.quantity > product.minQuantity;
    }
    if (productFilter === 'out') {
      matchesFilter = product.quantity === 0;
    }

    return matchesQuery && matchesFilter;
  });
}

function productStatus(product: Product): { label: string; className: string } {
  if (product.quantity === 0) {
    return { label: 'Zerado', className: 'danger' };
  }

  if (product.quantity <= product.minQuantity) {
    return { label: 'Critico', className: 'warning' };
  }

  if (product.quantity <= product.minQuantity * 2) {
    return { label: 'Baixo', className: 'low' };
  }

  return { label: 'Estavel', className: 'ok' };
}

function screenTitle(screen: Screen): string {
  const titles: Record<Screen, string> = {
    inicio: 'Painel',
    produtos: 'Produtos',
    relatorios: 'Relatorios',
    alertas: 'Alertas',
    historico: 'Historico',
    usuarios: 'Usuarios',
    metricas: 'Metricas',
  };

  return titles[screen];
}

function screenSubtitle(screen: Screen): string {
  if (isAdmin(currentUser)) {
    const subtitles: Record<Screen, string> = {
      inicio: 'Controle executivo do estoque, equipe e saude operacional.',
      produtos: 'Cadastro completo, busca rapida e leitura de criticidade por item.',
      relatorios: 'Visao consolidada por valor, categoria e unidades mais sensiveis.',
      alertas: 'Reposicoes urgentes e gargalos com impacto direto na operacao.',
      historico: 'Rastro das acoes da equipe e trilha recente do sistema.',
      usuarios: 'Gestao de acessos, perfis e atividade dos colaboradores.',
      metricas: 'Engajamento da plataforma e intensidade de uso por paginas.',
    };

    return subtitles[screen];
  }

  const subtitles: Record<Screen, string> = {
    inicio: 'Painel do turno com foco em reposicao e rotina operacional.',
    produtos: 'Atualize saldo, categorias e consulta rapida do catalogo.',
    relatorios: 'Acesso restrito.',
    alertas: 'Itens que precisam de reposicao ou revisao imediata.',
    historico: 'Acompanhe os eventos recentes registrados na loja.',
    usuarios: 'Acesso restrito.',
    metricas: 'Acesso restrito.',
  };

  return subtitles[screen];
}

async function refreshData(reason = 'Atualizado'): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const [nextUsers, nextProducts, nextLogs] = await Promise.all([
      repository.getUsers(),
      repository.getProducts(),
      repository.getAccessLogs(),
    ]);

    users = nextUsers;
    products = nextProducts;
    accessLogs = nextLogs;
    syncCurrentUserReference();
    lastSyncedAt = new Date().toISOString();
    syncStatus = reason;
    renderApp();
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function logAction(action: AccessLog['action'], details?: string): Promise<void> {
  if (!currentUser) {
    return;
  }

  accessLogs.unshift({
    id: id(),
    userId: currentUser.id,
    userName: currentUser.name,
    action,
    details,
    timestamp: new Date().toISOString(),
  });

  accessLogs = accessLogs.slice(0, 1000);
  await repository.saveAccessLogs(accessLogs);
}

async function seedInitialData(): Promise<void> {
  users = await repository.getUsers();
  products = await repository.getProducts();
  accessLogs = await repository.getAccessLogs();

  if (users.length === 0) {
    const admin: AppUser = {
      id: id(),
      name: 'Administrador StockIa',
      email: 'admin@stockia.com',
      password: 'Admin@123',
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    users = [admin];
    await repository.saveUsers(users);
  }

  if (products.length === 0) {
    const now = new Date().toISOString();
    const creatorId = users[0].id;
    products = [
      {
        id: id(),
        name: 'Tomate Italiano',
        quantity: 11,
        minQuantity: 5,
        price: 8.9,
        category: 'Hortifrutis',
        unit: 'kg',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Pao Frances',
        quantity: 45,
        minQuantity: 20,
        price: 0.99,
        category: 'Padaria',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Leite Integral 1L',
        quantity: 18,
        minQuantity: 12,
        price: 5.49,
        category: 'Laticinios',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Refrigerante Cola 2L',
        quantity: 7,
        minQuantity: 8,
        price: 9.99,
        category: 'Bebidas',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
    ];
    await repository.saveProducts(products);
  }
}

function renderAuth(): void {
  const isLogin = authMode === 'login';

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card reveal">
        <div class="auth-brand">
          <p class="logo-tag">StockIa</p>
          <span class="status-dot">${isSupabaseProvider ? 'Nuvem conectada' : 'Modo local'}</span>
        </div>
        <h1>Estoque inteligente com operacao bonita, simples e rapida.</h1>
        <p class="subtitle">Controle produtos, acompanhe alertas e mantenha equipe e administracao sincronizadas em uma mesma tela.</p>

        <div class="auth-tabs">
          <button data-action="set-auth-mode" data-mode="login" class="${isLogin ? 'active' : ''}">Entrar</button>
          <button data-action="set-auth-mode" data-mode="register" class="${!isLogin ? 'active' : ''}">Cadastrar</button>
        </div>

        <form id="auth-form" class="form-grid">
          ${
            isLogin
              ? `
            <label>
              Email
              <input name="email" type="email" required placeholder="admin@stockia.com" />
            </label>
            <label>
              Senha
              <input name="password" type="password" required minlength="6" placeholder="********" />
            </label>
          `
              : `
            <label>
              Nome completo
              <input name="name" type="text" required minlength="3" placeholder="Seu nome" />
            </label>
            <label>
              Email
              <input name="email" type="email" required placeholder="voce@empresa.com" />
            </label>
            <label>
              Senha
              <input name="password" type="password" required minlength="6" placeholder="Minimo 6 caracteres" />
            </label>
            <label>
              Confirmar senha
              <input name="confirmPassword" type="password" required minlength="6" placeholder="Repita a senha" />
            </label>
          `
          }
          <button type="submit" class="primary">${isLogin ? 'Entrar no painel' : 'Criar conta'}</button>
        </form>

        <div class="auth-footer">
          <p class="helper">Credencial inicial: admin@stockia.com / Admin@123</p>
          ${authMessage ? `<p class="message">${escapeHtml(authMessage)}</p>` : ''}
        </div>
      </section>
    </main>
  `;
}

function renderHome(): string {
  if (!currentUser) {
    return '';
  }

  const metrics = getDashboardMetrics();
  const access = getAccessMetrics();
  const reportMetrics = getReportMetrics();
  const recentProducts = [...products]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  const criticalProducts = products
    .filter((product) => product.quantity <= product.minQuantity)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 5);

  if (!isAdmin(currentUser)) {
    return `
      <section class="hero-banner panel role-panel staff-highlight">
        <div class="hero-copy-block">
          <p class="eyebrow">Operacao do turno</p>
          <h2>Fila de reposicao clara, leitura rapida e foco total no piso de loja.</h2>
          <p class="hero-copy">Acompanhe itens criticos, veja o que entrou em atualizacao recente e trabalhe com menos ruido na interface.</p>
        </div>
        <div class="hero-metric-stack">
          <div class="metric-box">
            <span>Reposicoes urgentes</span>
            <strong>${metrics.itensCriticos}</strong>
          </div>
          <div class="metric-box">
            <span>Produtos ativos</span>
            <strong>${metrics.totalProdutos}</strong>
          </div>
          <div class="metric-box">
            <span>Ultimas visitas</span>
            <strong>${access.totalPageViews}</strong>
          </div>
        </div>
      </section>

      <section class="cards">
        <article class="card accent-card">
          <p>Itens em estoque</p>
          <h3>${metrics.estoqueTotal}</h3>
        </article>
        <article class="card">
          <p>Categorias ativas</p>
          <h3>${new Set(products.map((product) => product.category ?? 'Sem categoria')).size}</h3>
        </article>
        <article class="card warning">
          <p>Criticos agora</p>
          <h3>${metrics.itensCriticos}</h3>
        </article>
      </section>

      <section class="content-grid two-columns">
        <article class="panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Checklist</p>
              <h3>Lista de reposicao</h3>
            </div>
            <span class="info-chip">Turno atual</span>
          </div>
          <div class="stack">
            ${
              criticalProducts.length > 0
                ? criticalProducts
                    .map((product) => {
                      const status = productStatus(product);
                      return `
                        <article class="report-card">
                          <div class="row-between">
                            <strong>${escapeHtml(product.name)}</strong>
                            <span class="badge ${status.className}">${status.label}</span>
                          </div>
                          <span>${escapeHtml(product.category ?? 'Sem categoria')} · ${product.quantity} ${escapeHtml(product.unit ?? 'un')} em estoque</span>
                        </article>
                      `;
                    })
                    .join('')
                : '<p class="empty">Sem reposicoes pendentes no momento.</p>'
            }
          </div>
        </article>

        <article class="panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Atualizacoes</p>
              <h3>Movimento recente do estoque</h3>
            </div>
            <span class="info-chip">Ao vivo</span>
          </div>
          <div class="stack">
            ${
              recentProducts.length > 0
                ? recentProducts
                    .map((product) => `
                      <article class="activity-item">
                        <div>
                          <strong>${escapeHtml(product.name)}</strong>
                          <p>${escapeHtml(product.category ?? 'Sem categoria')}</p>
                        </div>
                        <small>${dateTime(product.updatedAt)}</small>
                      </article>
                    `)
                    .join('')
                : '<p class="empty">Nenhum produto cadastrado.</p>'
            }
          </div>
        </article>
      </section>
    `;
  }

  return `
    <section class="hero-banner panel role-panel admin-highlight">
      <div class="hero-copy-block">
        <p class="eyebrow">Central administrativa</p>
        <h2>Visao executiva de estoque, equipe e performance em uma unica operacao.</h2>
        <p class="hero-copy">Painel pensado para administracao: leitura de valor imobilizado, risco de ruptura, pulso da equipe e navegacao mais clara do que a area operacional.</p>
      </div>
      <div class="hero-metric-stack">
        <div class="metric-box">
          <span>Valor em estoque</span>
          <strong>${money(metrics.valorTotal)}</strong>
        </div>
        <div class="metric-box">
          <span>Usuarios ativos</span>
          <strong>${access.activeUsers}</strong>
        </div>
        <div class="metric-box">
          <span>Categoria lider</span>
          <strong>${escapeHtml(reportMetrics.orderedCategories[0]?.[0] ?? 'Sem dados')}</strong>
        </div>
      </div>
    </section>

    <section class="cards">
      <article class="card accent-card">
        <p>Produtos cadastrados</p>
        <h3>${metrics.totalProdutos}</h3>
      </article>
      <article class="card">
        <p>Unidades em estoque</p>
        <h3>${metrics.estoqueTotal}</h3>
      </article>
      <article class="card">
        <p>Usuarios no sistema</p>
        <h3>${users.length}</h3>
      </article>
      <article class="card warning">
        <p>Itens criticos</p>
        <h3>${metrics.itensCriticos}</h3>
      </article>
    </section>

    <section class="content-grid admin-grid">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Inventario</p>
            <h3>Ultimas atualizacoes</h3>
          </div>
          <span class="info-chip">${lastSyncedAt ? `Sync ${dateTime(lastSyncedAt)}` : 'Sync ativo'}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Estoque</th>
                <th>Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              ${
                recentProducts.length > 0
                  ? recentProducts
                      .map(
                        (product) => `
                    <tr>
                      <td>${escapeHtml(product.name)}</td>
                      <td>${product.quantity}</td>
                      <td>${dateTime(product.updatedAt)}</td>
                    </tr>
                  `,
                      )
                      .join('')
                  : '<tr><td colspan="3">Nenhum produto cadastrado.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Equipe</p>
            <h3>Pulso dos usuarios</h3>
          </div>
          <span class="info-chip">Admin</span>
        </div>
        <div class="stack">
          ${users
            .slice(0, 5)
            .map(
              (user) => `
                <article class="activity-item">
                  <div>
                    <strong>${escapeHtml(user.name)}</strong>
                    <p>${user.role === 'admin' ? 'Administrador' : 'Operador'} · ${escapeHtml(user.email)}</p>
                  </div>
                  <small>${user.lastLoginAt ? dateTime(user.lastLoginAt) : 'Sem login'}</small>
                </article>
              `,
            )
            .join('')}
        </div>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Categorias</p>
            <h3>Resumo por categoria</h3>
          </div>
        </div>
        <div class="summary-grid">
          ${reportMetrics.orderedCategories
            .slice(0, 6)
            .map(
              ([category, count]) => `
                <div class="summary-chip">
                  <strong>${escapeHtml(category)}</strong>
                  <span>${count} produtos</span>
                </div>
              `,
            )
            .join('')}
        </div>
      </article>
    </section>
  `;
}

function renderProducts(): string {
  const editingProduct = editProductId ? products.find((product) => product.id === editProductId) : null;
  const filtered = getFilteredProducts();

  return `
    <section class="panel catalog-toolbar">
      <div>
        <p class="eyebrow">Catalogo</p>
        <h3>Cadastro de produtos por setor</h3>
      </div>
      <div class="catalog-metrics">
        <div><span>Itens filtrados</span><strong>${filtered.length}</strong></div>
        <div><span>Alertas</span><strong>${products.filter((product) => product.quantity <= product.minQuantity).length}</strong></div>
        <div><span>Categorias</span><strong>${new Set(products.map((product) => product.category ?? 'Sem categoria')).size}</strong></div>
      </div>
    </section>

    <section class="content-grid product-layout">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${editingProduct ? 'Edicao' : 'Novo item'}</p>
            <h3>${editingProduct ? 'Atualizar produto' : 'Cadastrar produto'}</h3>
          </div>
        </div>
        <form id="product-form" class="form-grid product-form">
          <input type="hidden" name="productId" value="${editingProduct ? editingProduct.id : ''}" />
          <label>
            Nome do produto
            <input name="name" required minlength="3" value="${editingProduct ? escapeHtml(editingProduct.name) : ''}" />
          </label>
          <label>
            Categoria
            <select name="category">
              <option value="">Selecione a categoria</option>
              ${foodCategories
                .map(
                  (category) => `
                    <option value="${category.value}" ${editingProduct?.category === category.value ? 'selected' : ''}>${category.value}</option>
                  `,
                )
                .join('')}
            </select>
          </label>
          <label>
            Unidade
            <select name="unit">
              <option value="un" ${editingProduct?.unit === 'un' ? 'selected' : ''}>un</option>
              <option value="kg" ${editingProduct?.unit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="l" ${editingProduct?.unit === 'l' ? 'selected' : ''}>l</option>
              <option value="cx" ${editingProduct?.unit === 'cx' ? 'selected' : ''}>cx</option>
              <option value="dz" ${editingProduct?.unit === 'dz' ? 'selected' : ''}>dz</option>
            </select>
          </label>
          <label>
            Codigo de barras
            <input name="barcode" value="${editingProduct ? escapeHtml(editingProduct.barcode ?? '') : ''}" />
          </label>
          <label>
            Imagem (URL)
            <input name="imageUrl" value="${editingProduct ? escapeHtml(editingProduct.imageUrl ?? '') : ''}" placeholder="https://..." />
          </label>
          <label>
            Quantidade
            <input name="quantity" type="number" min="0" required value="${editingProduct ? editingProduct.quantity : 0}" />
          </label>
          <label>
            Estoque minimo
            <input name="minQuantity" type="number" min="0" required value="${editingProduct ? editingProduct.minQuantity : 0}" />
          </label>
          <label>
            Valor unitario
            <input name="price" type="number" min="0" step="0.01" required value="${editingProduct ? editingProduct.price : 0}" />
          </label>
          <div class="inline-actions">
            <button type="submit" class="primary">${editingProduct ? 'Salvar alteracoes' : 'Cadastrar produto'}</button>
            ${editingProduct ? '<button type="button" data-action="cancel-product-edit">Cancelar</button>' : ''}
          </div>
        </form>
      </article>

      <article class="panel">
        <div class="section-head search-section">
          <div>
            <p class="eyebrow">Consulta</p>
            <h3>Produtos cadastrados</h3>
          </div>
          <div class="search-bar">
            <input data-action="search" placeholder="Buscar produto, categoria ou codigo" value="${escapeHtml(searchQuery)}" />
            <select data-action="filter">
              <option value="all" ${productFilter === 'all' ? 'selected' : ''}>Todos</option>
              <option value="critical" ${productFilter === 'critical' ? 'selected' : ''}>Criticos</option>
              <option value="low" ${productFilter === 'low' ? 'selected' : ''}>Baixo estoque</option>
              <option value="out" ${productFilter === 'out' ? 'selected' : ''}>Zerados</option>
            </select>
          </div>
        </div>

        <div class="product-list">
          ${
            filtered.length > 0
              ? filtered
                  .map((product) => {
                    const status = productStatus(product);
                    return `
                      <article class="product-card">
                        <div class="product-card-top">
                          ${
                            product.imageUrl
                              ? `<img src="${escapeHtml(product.imageUrl)}" alt="" class="product-thumb" />`
                              : `<div class="product-thumb fallback-thumb">${escapeHtml((product.name[0] ?? 'P').toUpperCase())}</div>`
                          }
                          <div class="product-main">
                            <div class="row-between">
                              <strong>${escapeHtml(product.name)}</strong>
                              <span class="badge ${status.className}">${status.label}</span>
                            </div>
                            <p>${escapeHtml(product.category ?? 'Sem categoria')} · ${escapeHtml(product.barcode ?? 'Sem codigo')}</p>
                          </div>
                        </div>
                        <div class="product-meta">
                          <span>Qtd: <strong>${product.quantity}</strong></span>
                          <span>Min: <strong>${product.minQuantity}</strong></span>
                          <span>Un: <strong>${escapeHtml(product.unit ?? '-')}</strong></span>
                          <span>Valor: <strong>${money(product.price)}</strong></span>
                        </div>
                        <div class="actions">
                          <button data-action="edit-product" data-id="${product.id}">Editar</button>
                          <button data-action="delete-product" data-id="${product.id}" class="danger">Excluir</button>
                        </div>
                      </article>
                    `;
                  })
                  .join('')
              : '<p class="empty">Nenhum produto encontrado.</p>'
          }
        </div>
      </article>
    </section>
  `;
}

function renderAlerts(): string {
  const criticalProducts = products.filter((product) => product.quantity <= product.minQuantity);

  return `
    <section class="cards">
      <article class="card warning">
        <p>Alertas ativos</p>
        <h3>${criticalProducts.length}</h3>
      </article>
      <article class="card">
        <p>Itens zerados</p>
        <h3>${criticalProducts.filter((product) => product.quantity === 0).length}</h3>
      </article>
      <article class="card">
        <p>Reposicao moderada</p>
        <h3>${products.filter((product) => product.quantity > product.minQuantity && product.quantity <= product.minQuantity * 2).length}</h3>
      </article>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Monitoramento</p>
          <h3>Alertas de estoque minimo</h3>
        </div>
      </div>
      <div class="stack">
        ${
          criticalProducts.length > 0
            ? criticalProducts
                .map((product) => `
                  <article class="alert-card">
                    <div class="row-between">
                      <strong>${escapeHtml(product.name)}</strong>
                      <span class="badge warning">Urgente</span>
                    </div>
                    <p>${escapeHtml(product.category ?? 'Sem categoria')}</p>
                    <small>Quantidade atual: ${product.quantity} · Minimo esperado: ${product.minQuantity}</small>
                  </article>
                `)
                .join('')
            : '<p class="empty">Nenhum alerta no momento.</p>'
        }
      </div>
    </section>
  `;
}

function renderReports(): string {
  if (!isAdmin(currentUser)) {
    return '<section class="panel"><p>Acesso restrito ao administrador.</p></section>';
  }

  const metrics = getReportMetrics();

  return `
    <section class="cards">
      <article class="card accent-card">
        <p>Itens em estoque</p>
        <h3>${metrics.totalItems}</h3>
      </article>
      <article class="card">
        <p>Valor estimado</p>
        <h3>${money(metrics.stockValue)}</h3>
      </article>
      <article class="card">
        <p>Ticket medio por item</p>
        <h3>${money(metrics.averageTicket)}</h3>
      </article>
      <article class="card warning">
        <p>Produtos criticos</p>
        <h3>${metrics.criticalProducts.length}</h3>
      </article>
    </section>

    <section class="content-grid two-columns">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Distribuicao</p>
            <h3>Categoria x quantidade</h3>
          </div>
        </div>
        <div class="bar-list">
          ${metrics.byCategoryValue
            .map(
              ([category, quantity]) => `
                <div class="bar-row">
                  <span>${escapeHtml(category)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, quantity)}%"></div></div>
                  <strong>${quantity}</strong>
                </div>
              `,
            )
            .join('')}
        </div>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Leitura rapida</p>
            <h3>Produtos por unidade</h3>
          </div>
        </div>
        <div class="summary-grid compact">
          ${metrics.byUnit
            .map(
              ([unit, count]) => `
                <div class="summary-chip">
                  <strong>${escapeHtml(unit)}</strong>
                  <span>${count} itens</span>
                </div>
              `,
            )
            .join('')}
        </div>
        <div class="spacer"></div>
        <h3>Reposicao urgente</h3>
        <div class="stack">
          ${
            metrics.criticalProducts.length > 0
              ? metrics.criticalProducts
                  .map(
                    (product) => `
                      <article class="report-card">
                        <strong>${escapeHtml(product.name)}</strong>
                        <span>${escapeHtml(product.category ?? 'Sem categoria')} · ${product.quantity} ${escapeHtml(product.unit ?? 'un')}</span>
                      </article>
                    `,
                  )
                  .join('')
              : '<p class="empty">Nenhum produto precisa de reposicao.</p>'
          }
        </div>
      </article>
    </section>
  `;
}

function renderHistory(): string {
  const history = accessLogs.slice(0, 120);

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Auditoria</p>
          <h3>Historico de eventos</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Usuario</th>
              <th>Acao</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            ${
              history.length > 0
                ? history
                    .map(
                      (log) => `
                  <tr>
                    <td>${dateTime(log.timestamp)}</td>
                    <td>${escapeHtml(log.userName)}</td>
                    <td>${escapeHtml(log.action)}</td>
                    <td>${escapeHtml(log.details ?? '-')}</td>
                  </tr>
                `,
                    )
                    .join('')
                : '<tr><td colspan="4">Sem historico.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUsers(): string {
  if (!isAdmin(currentUser)) {
    return '<section class="panel"><p>Acesso restrito ao administrador.</p></section>';
  }

  const adminUser = currentUser;
  const editingUser = editingUserId ? users.find((user) => user.id === editingUserId) : null;
  const admins = users.filter((user) => user.role === 'admin').length;
  const staff = users.length - admins;

  return `
    <section class="cards">
      <article class="card accent-card">
        <p>Total de usuarios</p>
        <h3>${users.length}</h3>
      </article>
      <article class="card">
        <p>Administradores</p>
        <h3>${admins}</h3>
      </article>
      <article class="card">
        <p>Operadores</p>
        <h3>${staff}</h3>
      </article>
      <article class="card">
        <p>Sync de usuarios</p>
        <h3>${isSupabaseProvider ? 'Ao vivo' : 'Entre abas'}</h3>
      </article>
    </section>

    <section class="content-grid user-layout">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${editingUser ? 'Permissao' : 'Novo acesso'}</p>
            <h3>${editingUser ? 'Editar usuario' : 'Criar usuario interno'}</h3>
          </div>
        </div>
        <form id="user-form" class="form-grid">
          <input type="hidden" name="userId" value="${editingUser ? editingUser.id : ''}" />
          <label>
            Nome
            <input name="name" required minlength="3" value="${editingUser ? escapeHtml(editingUser.name) : ''}" />
          </label>
          <label>
            Email
            <input name="email" type="email" required value="${editingUser ? escapeHtml(editingUser.email) : ''}" />
          </label>
          <label>
            Senha
            <input name="password" type="password" minlength="6" ${editingUser ? '' : 'required'} placeholder="${editingUser ? 'Preencha apenas para trocar' : 'Minimo 6 caracteres'}" />
          </label>
          <label>
            Perfil
            <select name="role">
              <option value="staff" ${editingUser?.role === 'staff' ? 'selected' : ''}>Operador</option>
              <option value="admin" ${editingUser?.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
          </label>
          <div class="inline-actions">
            <button type="submit" class="primary">${editingUser ? 'Salvar usuario' : 'Criar usuario'}</button>
            ${editingUser ? '<button type="button" data-action="cancel-user-edit">Cancelar</button>' : ''}
          </div>
        </form>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Equipe</p>
            <h3>Usuarios cadastrados</h3>
          </div>
          <span class="info-chip">${syncStatus}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Perfil</th>
                <th>Ultimo login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${users
                .map(
                  (user) => `
                    <tr>
                      <td>${escapeHtml(user.name)}</td>
                      <td>${escapeHtml(user.email)}</td>
                      <td>${user.role === 'admin' ? 'Admin' : 'Operador'}</td>
                      <td>${lastLoginForUser(user.id) ? dateTime(lastLoginForUser(user.id) as string) : '-'}</td>
                      <td class="actions">
                        <button data-action="edit-user" data-id="${user.id}">Editar</button>
                        ${
                          adminUser.id !== user.id
                            ? `<button data-action="delete-user" data-id="${user.id}" class="danger">Excluir</button>`
                            : ''
                        }
                      </td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderMetrics(): string {
  if (!isAdmin(currentUser)) {
    return '<section class="panel"><p>Apenas administradores podem visualizar as metricas.</p></section>';
  }

  const metrics = getAccessMetrics();

  return `
    <section class="cards">
      <article class="card accent-card">
        <p>Logins (7 dias)</p>
        <h3>${metrics.recentLogins}</h3>
      </article>
      <article class="card">
        <p>Usuarios ativos (30 dias)</p>
        <h3>${metrics.activeUsers}</h3>
      </article>
      <article class="card">
        <p>Visualizacoes de paginas</p>
        <h3>${metrics.totalPageViews}</h3>
      </article>
      <article class="card">
        <p>Eventos registrados</p>
        <h3>${accessLogs.length}</h3>
      </article>
    </section>

    <section class="content-grid two-columns">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Trafego</p>
            <h3>Paginas mais acessadas</h3>
          </div>
        </div>
        <ul class="stats-list">
          ${
            metrics.topPages.length > 0
              ? metrics.topPages
                  .map(
                    ([page, count]) => `<li><span>${escapeHtml(page)}</span><strong>${count}</strong></li>`,
                  )
                  .join('')
              : '<li><span>Sem dados</span><strong>0</strong></li>'
          }
        </ul>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Timeline</p>
            <h3>Ultimos 20 eventos</h3>
          </div>
        </div>
        <ul class="timeline">
          ${accessLogs
            .slice(0, 20)
            .map(
              (log) => `
                <li>
                  <p><strong>${escapeHtml(log.userName)}</strong> executou <strong>${escapeHtml(log.action)}</strong></p>
                  <small>${dateTime(log.timestamp)} ${log.details ? `· ${escapeHtml(log.details)}` : ''}</small>
                </li>
              `,
            )
            .join('')}
        </ul>
      </article>
    </section>
  `;
}

function renderCurrentScreen(): string {
  switch (activeScreen) {
    case 'produtos':
      return renderProducts();
    case 'relatorios':
      return renderReports();
    case 'alertas':
      return renderAlerts();
    case 'historico':
      return renderHistory();
    case 'usuarios':
      return renderUsers();
    case 'metricas':
      return renderMetrics();
    case 'inicio':
    default:
      return renderHome();
  }
}

async function handleDeleteProduct(productId: string): Promise<void> {
  const product = products.find((item) => item.id === productId);
  if (!product) {
    return;
  }

  const confirmed = confirm(`Excluir ${product.name}?`);
  if (!confirmed) {
    return;
  }

  try {
    await repository.deleteProduct(productId);
    products = products.filter((item) => item.id !== productId);
    if (editProductId === productId) {
      editProductId = null;
    }
    renderApp();
    await logAction('delete_product', product.name);
    if (!isSupabaseProvider) {
      await refreshData('Produto removido com sucesso');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao excluir o produto.';
    alert(message);
  }
}

async function handleDeleteUser(userId: string): Promise<void> {
  if (!isAdmin(currentUser)) {
    return;
  }

  const user = users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  if (currentUser.id === userId) {
    alert('Voce nao pode excluir o proprio usuario logado.');
    return;
  }

  const adminCount = users.filter((item) => item.role === 'admin').length;
  if (user.role === 'admin' && adminCount <= 1) {
    alert('Nao e permitido excluir o ultimo administrador do sistema.');
    return;
  }

  const confirmed = confirm(`Excluir o funcionario ${user.name}?`);
  if (!confirmed) {
    return;
  }

  try {
    await repository.deleteUser(userId);
    users = users.filter((item) => item.id !== userId);
    if (editingUserId === userId) {
      editingUserId = null;
    }
    renderApp();
    await logAction('delete_user', user.name);
    if (!isSupabaseProvider) {
      await refreshData('Funcionario removido com sucesso');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao excluir o funcionario.';
    alert(message);
  }
}

function renderApp(): void {
  if (!currentUser) {
    renderAuth();
    return;
  }

  ensureScreenAccess();

  const navItems: Array<{ id: Screen; label: string; adminOnly?: boolean; short: string }> = [
    { id: 'inicio', label: 'Painel', short: 'PI' },
    { id: 'produtos', label: 'Produtos', short: 'PR' },
    { id: 'relatorios', label: 'Relatorios', adminOnly: true, short: 'RE' },
    { id: 'alertas', label: 'Alertas', short: 'AL' },
    { id: 'historico', label: 'Historico', short: 'HI' },
    { id: 'usuarios', label: 'Usuarios', adminOnly: true, short: 'US' },
    { id: 'metricas', label: 'Metricas', adminOnly: true, short: 'ME' },
  ];

  app.innerHTML = `
    <div class="app-shell ${currentUser.role === 'admin' ? 'shell-admin' : 'shell-staff'} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}">
      <button class="mobile-overlay" data-action="close-mobile-menu" aria-label="Fechar menu"></button>

      <aside class="sidebar reveal">
        <div class="sidebar-top">
          <div class="brand-block">
            <div>
              <p class="logo-tag">StockIa</p>
              <h2>${currentUser.role === 'admin' ? 'Central de Controle' : 'Operacao da Loja'}</h2>
            </div>
            <button class="icon-button desktop-only" data-action="toggle-sidebar" aria-label="Recolher menu">
              ${sidebarCollapsed ? '>' : '<'}
            </button>
          </div>

          <div class="profile-card">
            <strong>${escapeHtml(currentUser.name)}</strong>
            <p>${currentUser.role === 'admin' ? 'Administrador' : 'Operador'}</p>
            <span class="role-chip ${currentUser.role === 'admin' ? 'admin' : 'staff'}">${currentUser.role === 'admin' ? 'Visao executiva' : 'Rotina operacional'}</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          ${navItems
            .filter((item) => !item.adminOnly || isAdmin(currentUser))
            .map(
              (item) => `
                <button data-action="change-screen" data-screen="${item.id}" class="${activeScreen === item.id ? 'active' : ''}">
                  <span class="nav-icon">${item.short}</span>
                  <span class="nav-label">${item.label}</span>
                </button>
              `,
            )
            .join('')}
        </nav>

        <div class="sidebar-footer">
          <div class="sync-card">
            <span>${syncStatus}</span>
            <strong>${lastSyncedAt ? dateTime(lastSyncedAt) : isSupabaseProvider ? 'Tempo real' : 'Navegador atual'}</strong>
          </div>
          <button class="logout" data-action="logout">Sair</button>
        </div>
      </aside>

      <main class="content reveal">
        <header class="header">
          <div class="header-main">
            <div class="header-title-row">
              <button class="icon-button mobile-only" data-action="toggle-mobile-menu" aria-label="Abrir menu">=</button>
              <div>
                <p class="eyebrow">${currentUser.role === 'admin' ? 'Painel admin' : 'Painel operacional'}</p>
                <h1>${screenTitle(activeScreen)}</h1>
              </div>
            </div>
            <p class="header-copy">${screenSubtitle(activeScreen)}</p>
          </div>
          <div class="header-aside">
            <span class="pill">${currentUser.role === 'admin' ? 'Unidade Matriz' : 'Equipe de Loja'}</span>
            <span class="sync-inline">${syncStatus}</span>
          </div>
        </header>

        ${renderCurrentScreen()}
      </main>
    </div>
  `;
}

async function handleAuthSubmit(form: HTMLFormElement): Promise<void> {
  const formData = new FormData(form);

  if (authMode === 'login') {
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    const user = users.find((item) => item.email.toLowerCase() === email && item.password === password);

    if (!user) {
      authMessage = 'Email ou senha invalidos.';
      renderAuth();
      return;
    }

    currentUser = { ...user, lastLoginAt: new Date().toISOString() };
    users = users.map((item) => (item.id === user.id ? currentUser! : item));
    await repository.saveUsers(users);
    authMessage = '';
    activeScreen = 'inicio';
    renderApp();
    await logAction('login');
    await logAction('page_view', 'inicio');
    return;
  }

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    authMessage = 'As senhas nao conferem.';
    renderAuth();
    return;
  }

  if (users.some((user) => user.email.toLowerCase() === email)) {
    authMessage = 'Ja existe usuario com este email.';
    renderAuth();
    return;
  }

  const newUser: AppUser = {
    id: id(),
    name,
    email,
    password,
    role: 'staff',
    createdAt: new Date().toISOString(),
  };

  users = [newUser, ...users];
  await repository.saveUsers(users);
  authMode = 'login';
  authMessage = 'Cadastro concluido. Agora faca login.';
  renderAuth();
}

async function handleProductSubmit(form: HTMLFormElement): Promise<void> {
  if (!currentUser) {
    return;
  }

  const formData = new FormData(form);
  const productId = String(formData.get('productId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim() || defaultUnitForCategory(category);
  const barcode = String(formData.get('barcode') ?? '').trim();
  const imageUrl = String(formData.get('imageUrl') ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? 0);
  const minQuantity = Number(formData.get('minQuantity') ?? 0);
  const price = Number(formData.get('price') ?? 0);

  if (!name) {
    return;
  }

  if (productId) {
    products = products.map((product) =>
      product.id === productId
        ? {
            ...product,
            name,
            category: category || undefined,
            unit: unit || undefined,
            barcode: barcode || undefined,
            imageUrl: imageUrl || undefined,
            quantity,
            minQuantity,
            price,
            updatedAt: new Date().toISOString(),
          }
        : product,
    );
    editProductId = null;
    await repository.saveProducts(products);
    renderApp();
    await logAction('update_product', name);
    return;
  }

  const now = new Date().toISOString();
  products = [
    {
      id: id(),
      name,
      category: category || undefined,
      unit: unit || undefined,
      barcode: barcode || undefined,
      imageUrl: imageUrl || undefined,
      quantity,
      minQuantity,
      price,
      createdBy: currentUser.id,
      createdAt: now,
      updatedAt: now,
    },
    ...products,
  ];
  await repository.saveProducts(products);
  renderApp();
  await logAction('create_product', name);
}

async function handleUserSubmit(form: HTMLFormElement): Promise<void> {
  if (!isAdmin(currentUser)) {
    return;
  }

  const formData = new FormData(form);
  const userId = String(formData.get('userId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const role = (String(formData.get('role') ?? 'staff') === 'admin' ? 'admin' : 'staff') as UserRole;

  const duplicateEmail = users.find((user) => user.email.toLowerCase() === email && user.id !== userId);
  if (duplicateEmail) {
    alert('Ja existe usuario com este email.');
    return;
  }

  if (userId) {
    users = users.map((user) => {
      if (user.id !== userId) {
        return user;
      }

      return {
        ...user,
        name,
        email,
        role,
        password: password ? password : user.password,
      };
    });

    await repository.saveUsers(users);
    syncCurrentUserReference();
    editingUserId = null;
    renderApp();
    return;
  }

  const newUser: AppUser = {
    id: id(),
    name,
    email,
    password: password || '123456',
    role,
    createdAt: new Date().toISOString(),
  };

  users = [newUser, ...users];
  await repository.saveUsers(users);
  editingUserId = null;
  renderApp();
  await logAction('create_user', name);
}

app.addEventListener('submit', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();

  if (target.id === 'auth-form') {
    void handleAuthSubmit(target);
    return;
  }

  if (target.id === 'product-form') {
    void handleProductSubmit(target);
    return;
  }

  if (target.id === 'user-form') {
    void handleUserSubmit(target);
  }
});

app.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>('button[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'set-auth-mode') {
    authMode = button.dataset.mode === 'register' ? 'register' : 'login';
    authMessage = '';
    renderAuth();
    return;
  }

  if (action === 'toggle-sidebar') {
    sidebarCollapsed = !sidebarCollapsed;
    renderApp();
    return;
  }

  if (action === 'toggle-mobile-menu') {
    mobileMenuOpen = !mobileMenuOpen;
    renderApp();
    return;
  }

  if (action === 'close-mobile-menu') {
    mobileMenuOpen = false;
    renderApp();
    return;
  }

  if (action === 'logout') {
    void logAction('logout');
    currentUser = null;
    editProductId = null;
    editingUserId = null;
    activeScreen = 'inicio';
    mobileMenuOpen = false;
    renderAuth();
    return;
  }

  if (action === 'change-screen' && currentUser) {
    const screen = button.dataset.screen as Screen | undefined;
    if (!screen) {
      return;
    }

    if (isRestrictedScreen(screen) && !isAdmin(currentUser)) {
      return;
    }

    editProductId = null;
    editingUserId = null;
    activeScreen = screen;
    closeTransientPanels();
    renderApp();
    void logAction('page_view', screen);
    return;
  }

  if (action === 'cancel-product-edit') {
    editProductId = null;
    renderApp();
    return;
  }

  if (action === 'edit-product') {
    const productId = button.dataset.id;
    if (!productId) {
      return;
    }

    editProductId = productId;
    renderApp();
    return;
  }

  if (action === 'delete-product') {
    const productId = button.dataset.id;
    if (!productId) {
      return;
    }
    void handleDeleteProduct(productId);
    return;
  }

  if (action === 'edit-user') {
    const userId = button.dataset.id;
    if (!userId) {
      return;
    }

    editingUserId = userId;
    renderApp();
    return;
  }

  if (action === 'delete-user') {
    const userId = button.dataset.id;
    if (!userId) {
      return;
    }

    void handleDeleteUser(userId);
    return;
  }

  if (action === 'cancel-user-edit') {
    editingUserId = null;
    renderApp();
  }
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.getAttribute('data-action');
  if (!action) {
    return;
  }

  if (action === 'search' && target instanceof HTMLInputElement) {
    searchQuery = target.value;
    renderApp();
  }

  if (action === 'filter' && target instanceof HTMLSelectElement) {
    productFilter = (target.value as typeof productFilter) || 'all';
    renderApp();
  }
});

function subscribeToRealtime(): void {
  cleanups.splice(0).forEach((dispose) => dispose());

  const handleStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('stockia.')) {
      void refreshData('Dados atualizados em outra aba');
    }
  };

  const handleBreakpoint = (event: MediaQueryListEvent) => {
    if (!event.matches) {
      mobileMenuOpen = false;
    }
    renderApp();
  };

  window.addEventListener('storage', handleStorage);
  mobileMedia.addEventListener('change', handleBreakpoint);
  cleanups.push(() => window.removeEventListener('storage', handleStorage));
  cleanups.push(() => mobileMedia.removeEventListener('change', handleBreakpoint));

  if (!isSupabaseProvider || !supabase) {
    return;
  }

  const client = supabase;

  const channel = client
    .channel('stockia-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, () => {
      void refreshData('Usuarios atualizados em tempo real');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, () => {
      void refreshData('Produtos atualizados em tempo real');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs_acesso' }, () => {
      void refreshData('Historico atualizado em tempo real');
    })
    .subscribe();

  cleanups.push(() => {
    void client.removeChannel(channel);
  });
}

async function bootstrap(): Promise<void> {
  await seedInitialData();
  subscribeToRealtime();
  renderAuth();
}

void bootstrap();
